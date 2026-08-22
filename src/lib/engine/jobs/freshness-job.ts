import "server-only";
import type { createClient } from "@/lib/supabase/server";
import { newCounters, recordJobRun, isFlagEnabled } from "@/lib/engine/cron";
import {
  createPostconditionLog,
  statusFromPostconditions,
  worstStatus,
} from "@/lib/engine/postconditions";
import { postconditionDetail, writeCountsFrom } from "@/lib/engine/silent-success";
import type { StageResult } from "./discovery";

type Client = Awaited<ReturnType<typeof createClient>>;
const JOB = "engine_freshness";
const STALE_DAYS = 180;

// Freshness pass. Flags published records that LOOK stale and records a
// recommendation for a human.
//
// It deliberately cannot edit published prose, change any status, or unpublish
// anything — requirement 8 says "generate update recommendations rather than
// silently rewriting published factual content", and the only write available
// here is engine_upsert_freshness, which appends a review row.
//
// Idempotent by construction: engine_upsert_freshness keeps one OPEN review
// per (entity, reason), so repeated runs do not pile up duplicates.
export async function runFreshness(supabase: Client): Promise<StageResult> {
  const counters = newCounters();

  if (!(await isFlagEnabled(supabase, "freshness"))) {
    await recordJobRun(supabase, JOB, "skipped", counters, { reason: "freshness_disabled" });
    return { status: "skipped", ...counters };
  }

  const { data, error } = await supabase.rpc("engine_freshness_candidates", { p_stale_days: STALE_DAYS });
  if (error) {
    await recordJobRun(supabase, JOB, "failed", counters, {}, error.message);
    return { status: "failed", ...counters, detail: { error: error.message } };
  }

  const candidates = (data ?? []) as {
    kind: string;
    entity_id: string;
    slug: string;
    title: string;
    age_days: number;
    source_count: number;
  }[];

  // Every mutation in this pass goes through the log, which folds results into
  // `counters` itself. There is deliberately no hand-written
  // `if (result === 'created') ... else deduped++` left in this file: that
  // `else` is where 'rejected_invalid' used to land, and it is the reason this
  // job's bridge never worked once.
  const log = createPostconditionLog(counters);

  let bridged = 0;
  const bridgeRejections: string[] = [];

  for (const c of candidates) {
    counters.examined++;

    // Two independent, non-overlapping signals so one record can raise both.
    const checks: { reason: string; detail: string; severity: string }[] = [
      {
        reason: "stale_facts",
        detail: `"${c.title}" (${c.slug}) has not been updated for ${c.age_days} days. Technology facts, pricing and availability in it may no longer be accurate — needs a human review, not an automatic rewrite.`,
        severity: c.age_days > 365 ? "high" : "medium",
      },
    ];

    // No recorded sources means nothing to re-verify the piece against — a
    // real evidence gap rather than merely an age problem.
    if (c.source_count === 0) {
      checks.push({
        reason: "broken_source_link",
        detail: `"${c.title}" (${c.slug}) has no source_records attached, so its factual claims cannot be re-verified against anything.`,
        severity: "high",
      });
    }

    for (const check of checks) {
      // 'rejected_invalid' is NOT in `benign`. engine_upsert_freshness returns
      // it whenever p_reason falls outside its guard list — the same class of
      // list-drift that broke the update-proposal bridge. Enumerating only the
      // statuses that mean something happened makes drift loud instead of
      // silent.
      await log.rpc({
        operation: "engine_upsert_freshness",
        subject: `${c.kind}/${c.slug} reason=${check.reason}`,
        run: () =>
          supabase.rpc("engine_upsert_freshness", {
            p_kind: c.kind,
            p_entity_id: c.entity_id,
            p_reason: check.reason,
            p_detail: check.detail,
            p_severity: check.severity,
          }),
        accepted: ["created"],
        benign: ["deduped"],
      });

      // Bridge the HIGH-severity findings into the update-proposal queue.
      //
      // Why both records exist rather than one: a freshness review is a
      // detection ("this page is old"), and it is cheap enough to raise on
      // everything that qualifies. An update proposal is an ACTION for an
      // editor, and the two must not be the same list or the actionable queue
      // drowns in low-severity age warnings.
      //
      // The point of the bridge is that the answer to a stale page is editing
      // that page — so it lands in the same queue as "new evidence about this
      // page", never as a reason to write a second article about the topic.
      //
      // Idempotent: engine_upsert_update_proposal keeps one OPEN proposal per
      // (target, reason), so a nightly pass refreshes rather than accumulates.
      if (check.severity !== "high") continue;

      // The RETURN VALUE IS CHECKED. It was not, and that is exactly how this
      // bridge silently never worked: the RPC's guard list omitted
      // 'stale_content', it answered 'rejected_invalid' every time, the job
      // discarded the answer, and engine_job_runs recorded success. An
      // operation that reports success while doing nothing is the failure
      // class this project treats as its own bug category.
      //
      // It is now checked BY CONSTRUCTION rather than by a hand-written branch
      // that a later edit could drop: 'created' and 'refreshed' are the only
      // answers that mean a proposal exists, and anything else — including a
      // status added to the RPC after this line was written — is a failure.
      const bridgeReason = check.reason === "broken_source_link" ? "broken_source" : "stale_content";
      const proposal = await log.rpc({
        operation: "engine_upsert_update_proposal",
        subject: `${c.kind}/${c.slug} reason=${bridgeReason}`,
        run: () =>
          supabase.rpc("engine_upsert_update_proposal", {
            p_content_id: c.kind === "content" ? c.entity_id : null,
            p_product_id: c.kind === "product" ? c.entity_id : null,
            p_discovery_id: null,
            // 'broken_source' is a genuine evidence gap; age alone is
            // 'stale_content'. Keeping them apart lets an editor tell "this
            // cannot be re-verified" from "nobody has checked this in a year".
            p_reason: bridgeReason,
            p_summary: check.detail,
            // Deliberately empty: freshness has found NO new evidence. It has
            // only established that time has passed. Inventing change
            // suggestions here would be fabrication — the editor re-verifies
            // against real sources.
            p_changes: [],
            p_evidence: [],
            // Age is a strong signal that a check is due, not a claim about
            // what is now wrong, so this stays well below the evidence-backed
            // levels the update-proposal job assigns.
            p_confidence: 0.3,
          }),
        accepted: ["created"],
        benign: ["refreshed"],
      });

      if (proposal.ok) bridged++;
      else bridgeRejections.push(`${proposal.detail}`);
    }
  }

  // The pass's own view, which knows about things the log does not.
  const jobView =
    counters.failed === 0
      ? "success"
      : counters.created > 0 || counters.deduped > 0
        ? "partial"
        : "failed";

  // ...but it can only make the verdict WORSE, never better. The postcondition
  // log is what actually looked at each write, so it has the final say on the
  // downside. This single line is the difference between incident #2 taking
  // weeks to find and taking one run.
  const postconditions = log.summarise();
  const status = worstStatus(jobView, statusFromPostconditions(postconditions));

  const detail = {
    staleDays: STALE_DAYS,
    bridged,
    bridgeRejections,
    postconditions: postconditionDetail(postconditions),
  };
  await recordJobRun(supabase, JOB, status, counters, detail, undefined, writeCountsFrom(postconditions));
  return { status, ...counters, detail };
}
