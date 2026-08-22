import "server-only";
import type { createClient } from "@/lib/supabase/server";
import { newCounters, recordJobRun, readFlag } from "@/lib/engine/cron";
import {
  createPostconditionLog,
  statusFromPostconditions,
  worstStatus,
} from "@/lib/engine/postconditions";
import { postconditionDetail, writeCountsFrom } from "@/lib/engine/silent-success";
import { classifyUpdateSignal, proposedChanges } from "@/lib/engine/update-signals";
import { resolveEntity } from "@/lib/engine/entity-resolution";
import { controlRead } from "@/lib/engine/queue-read";
import { concludeEmptyQueue } from "./reader-liveness";
import type { StageResult } from "./discovery";

type Client = Awaited<ReturnType<typeof createClient>>;
const JOB = "engine_update_proposals";

// Update-proposal pass.
//
// Runs BEFORE brief generation, and answers one question per relevant
// discovery: does this describe a CHANGE to something we already cover?
//
// When it does, the engine records a proposal against the existing product or
// article. It does not edit the page, does not change any status, and does not
// suppress the brief — an editor decides whether the right response is to
// update the existing page, write something new, or neither.
//
// Nothing here can publish or modify published prose. The only write is
// engine_upsert_update_proposal, which appends (or refreshes) a review row.
export async function runUpdateProposals(supabase: Client): Promise<StageResult> {
  const counters = newCounters();

  const freshnessFlag = await readFlag(supabase, "freshness");
  if (!freshnessFlag.enabled) {
    // An UNREADABLE flag is a failure, not a deliberate skip. Recording it as
    // 'skipped' used to hide it twice over: the reason said the flag was off
    // when it had never been read, and silent-success.ts filters skipped runs
    // out entirely, so one denied RPC switched the engine off and still
    // produced a clean detector report.
    const status = freshnessFlag.readable ? "skipped" : "failed";
    await recordJobRun(
      supabase,
      JOB,
      status,
      counters,
      { reason: freshnessFlag.reason },
      freshnessFlag.error
    );
    return { status, ...counters, detail: { reason: freshnessFlag.reason } };
  }

  const [{ data: discoveryRows, error: discoveryError }, { data: entityRows, error: entityError }] =
    await Promise.all([
      supabase.rpc("engine_briefable_discoveries", { p_limit: 30 }),
      supabase.rpc("engine_existing_entities"),
    ]);

  if (discoveryError || entityError) {
    const message = discoveryError?.message ?? entityError?.message ?? "unknown";
    await recordJobRun(supabase, JOB, "failed", counters, {}, message);
    return { status: "failed", ...counters, detail: { error: message } };
  }

  const discoveries = (discoveryRows ?? []) as {
    id: string;
    title: string;
    summary: string | null;
    claim_status: string;
  }[];
  const entities = (entityRows ?? []) as {
    kind: "product" | "content";
    id: string;
    name: string;
    slug: string;
    is_published: boolean;
  }[];

  // An empty discovery queue used to fall through the loop and record success
  // with every counter at zero — the identical row a silently-denied read
  // produces. The corroboration is free: engine_existing_entities answered in
  // the same pass, through the same anon grant path, so rows coming back from it
  // exclude a blanket loss of grants. See queue-read.ts for what that does and
  // does not establish.
  if (discoveries.length === 0) {
    const outcome = await concludeEmptyQueue(supabase, {
      stage: JOB,
      source: "engine_briefable_discoveries",
      kind: "security_definer_rpc",
      rowsReturned: 0,
      eligible: 0,
      reason: "no_briefable_discoveries",
      liveness: controlRead("engine_existing_entities", entities.length),
    });
    await recordJobRun(supabase, JOB, outcome.status, counters, outcome.detail, outcome.error ?? undefined);
    return { status: outcome.status, ...counters, detail: outcome.detail };
  }

  const proposals: string[] = [];
  // Most discoveries are new topics rather than updates.
  //
  // COUNTED, not merely tallied in the detail text. This job was caught by the
  // SILENT_SUCCESS detector on real production telemetry: it examined 23
  // discoveries, declined all 23 as "not an update", incremented NO counter,
  // and recorded examined:23 created:0 deduped:0 failed:0 status:success — a
  // row byte-identical to a pass whose every write was denied. `notAnUpdate`
  // lived only in the detail payload, which engine_recent_job_runs does not
  // expose, so nothing downstream could tell the two apart.
  //
  // A deliberate decision not to act is legitimate non-work, which is what the
  // `deduped` counter means here and what engine_briefs already does when it
  // declines a press release. Counting it makes "examined N and touched none"
  // mean what it should: we lost track of N items.
  let notAnUpdate = 0;
  // Evidence reads that failed. A proposal built on silently-empty evidence
  // would understate its own uncertainty, which is worse than not proposing.
  let evidenceUnavailable = 0;
  const log = createPostconditionLog(counters);

  for (const discovery of discoveries) {
    counters.examined++;

    // Two conditions must BOTH hold: the wording describes a change, and the
    // change is about something we already have a record for. Either alone is
    // not an update — a firmware story about a camera we have never covered is
    // a new article, not an edit.
    const signal = classifyUpdateSignal(discovery.title, discovery.summary);
    if (!signal) {
      notAnUpdate++;
      counters.deduped++;
      continue;
    }

    const resolution = resolveEntity(discovery.title, entities);
    if (resolution.decision !== "matched_existing" || !resolution.matchedId) {
      notAnUpdate++;
      counters.deduped++;
      continue;
    }

    // Evidence travels with the proposal. An editor changing a published page
    // needs the sources, not a summary of them.
    // The error on this read was previously DISCARDED and `?? []` used as the
    // fallback. A denied or failed evidence read then produced a proposal with
    // zero verified facts and zero evidence URLs — indistinguishable from a
    // discovery that genuinely has no evidence, and it would be handed to an
    // editor as though that were an established fact about the sources.
    const { data: evidenceRows, error: evidenceError } = await supabase.rpc("engine_evidence_for", {
      p_discovery_id: discovery.id,
    });
    if (evidenceError || evidenceRows === null) {
      counters.failed++;
      evidenceUnavailable++;
      continue;
    }
    const evidence = evidenceRows as { url: string; claim_status: string }[];

    const verifiedFacts = evidence
      .filter((e) => e.claim_status === "confirmed_primary")
      .map((e) => `Primary-confirmed source: ${e.url}`);
    const uncertainties = evidence
      .filter((e) => e.claim_status !== "confirmed_primary")
      .map((e) => `${e.claim_status.replace(/_/g, " ")}: ${e.url}`);

    // Confidence combines the wording signal with how strong the underlying
    // evidence actually is. A rumour about a price cut is not the same as a
    // manufacturer announcing one, and the proposal must not imply it is.
    const confidence = Number(
      (signal.confidence * (verifiedFacts.length > 0 ? 1 : 0.6)).toFixed(3)
    );

    // 'rejected_invalid' was already handled here, but by name only — any
    // status the RPC gains later would fall into the `else counters.deduped++`
    // branch below and be counted as a refresh that never happened. Enumerating
    // what is ACCEPTED instead of what is rejected inverts that: an unknown
    // status is a failure, which is the safe direction.
    const result = await log.rpc({
      operation: "engine_upsert_update_proposal",
      subject: `${resolution.matchedKind}/${resolution.matchedName} reason=${signal.reason}`,
      run: () =>
        supabase.rpc("engine_upsert_update_proposal", {
          p_content_id: resolution.matchedKind === "content" ? resolution.matchedId : null,
          p_product_id: resolution.matchedKind === "product" ? resolution.matchedId : null,
          p_discovery_id: discovery.id,
          p_reason: signal.reason,
          p_summary: `${discovery.title}\n\n${signal.explanation} ${resolution.explanation}`,
          p_changes: proposedChanges({ verifiedFacts, uncertainties }),
          p_evidence: evidence.map((e) => e.url),
          p_confidence: confidence,
        }),
      accepted: ["created"],
      benign: ["refreshed"],
    });

    if (result.data === "created") proposals.push(`${signal.reason}: ${resolution.matchedName}`);
  }

  // Most discoveries are legitimately not updates, so a pass that proposes
  // nothing is a success, not a failure.
  const jobView =
    counters.failed === 0
      ? "success"
      : counters.created + counters.deduped > 0
        ? "partial"
        : "failed";
  const postconditions = log.summarise();
  const status = worstStatus(jobView, statusFromPostconditions(postconditions));

  const detail = {
    proposals,
    notAnUpdate,
    evidenceUnavailable,
    postconditions: postconditionDetail(postconditions),
  };
  await recordJobRun(supabase, JOB, status, counters, detail, undefined, writeCountsFrom(postconditions));
  return { status, ...counters, detail };
}
