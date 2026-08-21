import "server-only";
import type { createClient } from "@/lib/supabase/server";
import { newCounters, recordJobRun, isFlagEnabled } from "@/lib/engine/cron";
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
      const { data: result, error: upsertError } = await supabase.rpc("engine_upsert_freshness", {
        p_kind: c.kind,
        p_entity_id: c.entity_id,
        p_reason: check.reason,
        p_detail: check.detail,
        p_severity: check.severity,
      });
      if (upsertError) counters.failed++;
      else if (result === "created") counters.created++;
      else counters.deduped++;
    }
  }

  // Same reasoning as the discovery pass: on a repeat run every review
  // already exists and dedupes, so `created` alone is not a success signal.
  const status =
    counters.failed === 0
      ? "success"
      : counters.created > 0 || counters.deduped > 0
        ? "partial"
        : "failed";
  await recordJobRun(supabase, JOB, status, counters, { staleDays: STALE_DAYS });
  return { status, ...counters, detail: { staleDays: STALE_DAYS } };
}
