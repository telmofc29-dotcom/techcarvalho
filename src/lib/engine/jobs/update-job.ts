import "server-only";
import type { createClient } from "@/lib/supabase/server";
import { newCounters, recordJobRun, isFlagEnabled } from "@/lib/engine/cron";
import { classifyUpdateSignal, proposedChanges } from "@/lib/engine/update-signals";
import { resolveEntity } from "@/lib/engine/entity-resolution";
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

  if (!(await isFlagEnabled(supabase, "freshness"))) {
    await recordJobRun(supabase, JOB, "skipped", counters, { reason: "freshness_disabled" });
    return { status: "skipped", ...counters };
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

  const proposals: string[] = [];
  // Most discoveries are new topics rather than updates. Counted separately
  // from `examined` so a quiet pass is visibly quiet rather than ambiguous.
  let notAnUpdate = 0;

  for (const discovery of discoveries) {
    counters.examined++;

    // Two conditions must BOTH hold: the wording describes a change, and the
    // change is about something we already have a record for. Either alone is
    // not an update — a firmware story about a camera we have never covered is
    // a new article, not an edit.
    const signal = classifyUpdateSignal(discovery.title, discovery.summary);
    if (!signal) {
      notAnUpdate++;
      continue;
    }

    const resolution = resolveEntity(discovery.title, entities);
    if (resolution.decision !== "matched_existing" || !resolution.matchedId) {
      notAnUpdate++;
      continue;
    }

    // Evidence travels with the proposal. An editor changing a published page
    // needs the sources, not a summary of them.
    const { data: evidenceRows } = await supabase.rpc("engine_evidence_for", {
      p_discovery_id: discovery.id,
    });
    const evidence = (evidenceRows ?? []) as { url: string; claim_status: string }[];

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

    const { data: result, error: upsertError } = await supabase.rpc("engine_upsert_update_proposal", {
      p_content_id: resolution.matchedKind === "content" ? resolution.matchedId : null,
      p_product_id: resolution.matchedKind === "product" ? resolution.matchedId : null,
      p_discovery_id: discovery.id,
      p_reason: signal.reason,
      p_summary: `${discovery.title}\n\n${signal.explanation} ${resolution.explanation}`,
      p_changes: proposedChanges({ verifiedFacts, uncertainties }),
      p_evidence: evidence.map((e) => e.url),
      p_confidence: confidence,
    });

    if (upsertError || result === "rejected_invalid") {
      counters.failed++;
      continue;
    }
    if (result === "created") {
      counters.created++;
      proposals.push(`${signal.reason}: ${resolution.matchedName}`);
    } else {
      counters.deduped++;
    }
  }

  // Most discoveries are legitimately not updates, so a pass that proposes
  // nothing is a success, not a failure.
  const status =
    counters.failed === 0
      ? "success"
      : counters.created + counters.deduped > 0
        ? "partial"
        : "failed";
  await recordJobRun(supabase, JOB, status, counters, { proposals, notAnUpdate });
  return { status, ...counters, detail: { proposals, notAnUpdate } };
}
