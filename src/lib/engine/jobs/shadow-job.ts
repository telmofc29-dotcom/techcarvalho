import "server-only";
import type { createClient } from "@/lib/supabase/server";
import { newCounters, recordJobRun, isFlagEnabled } from "@/lib/engine/cron";
import {
  createPostconditionLog,
  statusFromPostconditions,
  worstStatus,
} from "@/lib/engine/postconditions";
import { postconditionDetail, writeCountsFrom } from "@/lib/engine/silent-success";
import { runShadowPipeline } from "@/lib/engine/shadow-pipeline";
import { tallyShadowRun, type ShadowDecision } from "@/lib/engine/shadow-decision";
import { shadowCandidateIdentity } from "@/lib/engine/shadow-composition";
import {
  buildShadowContext,
  buildShadowCandidate,
  buildSourceIndex,
  serialiseDecision,
  type RawCandidateRow,
  type RawContentSignalRow,
  type RawEntityRow,
  type RawEvidenceRow,
  type RawManufacturerRow,
  type RawMediaRow,
  type RawSourceRow,
} from "@/lib/engine/shadow-io";
import type { StageResult } from "./discovery";

type Client = Awaited<ReturnType<typeof createClient>>;
const JOB = "engine_shadow";

/**
 * Candidates evaluated per pass.
 *
 * Shadow is cheap per candidate (no network, no AI provider) but the ledger is
 * append-once, so there is no value in racing through the backlog: 40 a pass
 * spreads the evaluation across days, which is exactly what
 * READINESS.minDistinctDays is asking for. Cramming 500 decisions into one
 * night would satisfy the count and fail the criterion it exists to serve.
 */
export const SHADOW_CANDIDATES_PER_PASS = 40;

/**
 * The shadow evaluation pass.
 *
 * Runs the complete autonomous decision process over real candidates and
 * publishes NOTHING. The only write it performs is
 * `engine_shadow_record_decision`, which touches three `engine_shadow_*` tables
 * and has no parameter capable of naming, let alone publishing, a content item
 * or a product.
 *
 * WHAT COUNTS AND WHAT DOES NOT
 * -----------------------------
 * A candidate whose pipeline threw is recorded as a FAILURE with no outcome,
 * and `counters.failed` is incremented. It is not recorded as
 * HUMAN_REVIEW_REQUIRED, which would be the easy way to make a crash look like
 * a decision and quietly earn readiness credit for a broken run.
 *
 * A candidate already in the ledger is skipped rather than re-evaluated. The
 * RPC would refuse it anyway (`candidate_identity` is UNIQUE), but skipping
 * makes the intent explicit: re-running this job accumulates no credit.
 */
export async function runShadowEvaluation(supabase: Client): Promise<StageResult> {
  const counters = newCounters();

  if (!(await isFlagEnabled(supabase, "discovery"))) {
    await recordJobRun(supabase, JOB, "skipped", counters, { reason: "discovery_disabled" });
    return { status: "skipped", ...counters };
  }

  // --- Read the inputs. A failed read is a failure, never an empty set ------
  const [candidatesRes, signalsRes, entitiesRes, referenceRes, sourcesRes, ledgerRes] = await Promise.all([
    supabase.rpc("engine_shadow_candidates", { p_limit: 500 }),
    supabase.rpc("engine_shadow_content_signals"),
    supabase.rpc("engine_existing_entities"),
    supabase.rpc("engine_reference_data"),
    supabase.rpc("engine_shadow_sources"),
    supabase.rpc("engine_shadow_ledger", { p_limit: 20000 }),
  ]);

  const readFailure = [
    candidatesRes.error && `engine_shadow_candidates: ${candidatesRes.error.message}`,
    signalsRes.error && `engine_shadow_content_signals: ${signalsRes.error.message}`,
    entitiesRes.error && `engine_existing_entities: ${entitiesRes.error.message}`,
    referenceRes.error && `engine_reference_data: ${referenceRes.error.message}`,
    sourcesRes.error && `engine_shadow_sources: ${sourcesRes.error.message}`,
    ledgerRes.error && `engine_shadow_ledger: ${ledgerRes.error.message}`,
  ].filter(Boolean) as string[];

  if (readFailure.length > 0) {
    const message = readFailure.join(" | ");
    await recordJobRun(supabase, JOB, "failed", counters, { reads: readFailure }, message);
    return { status: "failed", ...counters, detail: { error: message, reads: readFailure } };
  }

  const candidateRows = (candidatesRes.data ?? []) as RawCandidateRow[];
  const known = new Set(
    ((ledgerRes.data ?? []) as { candidate_identity: string }[]).map((r) => r.candidate_identity)
  );

  // Provenance recovery for evidence rows written without a source_id — see
  // buildSourceIndex. Fails closed on an unmatched host.
  const sourceIndex = buildSourceIndex((sourcesRes.data ?? []) as RawSourceRow[]);

  const context = buildShadowContext({
    now: new Date().toISOString(),
    contentSignals: (signalsRes.data ?? []) as RawContentSignalRow[],
    entities: (entitiesRes.data ?? []) as RawEntityRow[],
    reference: (referenceRes.data ?? []) as RawManufacturerRow[],
  });

  const log = createPostconditionLog(counters);
  const decisions: ShadowDecision[] = [];
  let skippedAlreadyEvaluated = 0;
  let evaluated = 0;

  for (const row of candidateRows) {
    if (evaluated >= SHADOW_CANDIDATES_PER_PASS) break;

    const identity = shadowCandidateIdentity({ kind: "discovery", key: row.dedupe_key || row.id });
    if (known.has(identity)) {
      skippedAlreadyEvaluated++;
      continue;
    }

    counters.examined++;
    evaluated++;

    // Per-candidate reads. A failure here is a failure of THIS candidate, not
    // of the pass — but it must not turn into a decision made on partial data,
    // so it is recorded as a read failure and the candidate is skipped.
    const [evidenceRes, mediaRes] = await Promise.all([
      supabase.rpc("engine_shadow_evidence", { p_discovery_id: row.id }),
      supabase.rpc("engine_shadow_media", { p_product_id: row.product_id, p_content_id: row.content_id }),
    ]);
    if (evidenceRes.error || mediaRes.error) {
      counters.failed++;
      continue;
    }

    const candidate = buildShadowCandidate(
      row,
      (evidenceRes.data ?? []) as RawEvidenceRow[],
      (mediaRes.data ?? []) as RawMediaRow[],
      sourceIndex
    );

    const record = runShadowPipeline(candidate, context);
    decisions.push(record.decision);

    const payload = serialiseDecision(record);
    await log.rpc({
      operation: "engine_shadow_record_decision",
      subject: `${record.identity} -> ${record.decision.outcome ?? "FAILURE"}`,
      run: () => supabase.rpc("engine_shadow_record_decision", payload),
      accepted: ["created"],
      // 'deduped' is the identity constraint doing its job — a re-run banking
      // no credit. 'rejected_disabled' is the kill switch, also legitimate.
      benign: ["deduped", "rejected_disabled"],
    });
  }

  const tally = tallyShadowRun(decisions);
  const jobView = counters.failed === 0 ? "success" : counters.created > 0 ? "partial" : "failed";
  const postconditions = log.summarise();
  const status = worstStatus(jobView, statusFromPostconditions(postconditions));

  const detail = {
    candidatesAvailable: candidateRows.length,
    skippedAlreadyEvaluated,
    // Kept separate on purpose: a decision and a crash are different things and
    // summing them would be the whole problem.
    decisionsReached: tally.decisions,
    pipelineFailures: tally.failures,
    outcomes: tally.outcomes,
    reachedGate: tally.reachedGate,
    terminalStages: tally.terminalStages,
    topReasonCodes: Object.fromEntries(
      Object.entries(tally.reasonCodes)
        .sort((a, b) => b[1] - a[1])
        .slice(0, 15)
    ),
    published: 0,
    publishedNote: "SHADOW publishes nothing. There is no RPC in this path capable of it.",
    postconditions: postconditionDetail(postconditions),
  };

  await recordJobRun(supabase, JOB, status, counters, detail, undefined, writeCountsFrom(postconditions));
  return { status, ...counters, detail };
}
