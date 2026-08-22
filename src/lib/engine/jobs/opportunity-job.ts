import "server-only";
import type { createClient } from "@/lib/supabase/server";
import { newCounters, recordJobRun, readFlag } from "@/lib/engine/cron";
import {
  createPostconditionLog,
  statusFromPostconditions,
  worstStatus,
} from "@/lib/engine/postconditions";
import { postconditionDetail, writeCountsFrom } from "@/lib/engine/silent-success";
import { computeOpportunityScore } from "@/lib/engine/opportunity";
import { concludeEmptyQueue } from "./reader-liveness";
import type { StageResult } from "./discovery";

type Client = Awaited<ReturnType<typeof createClient>>;
const JOB = "engine_opportunities";

// Opportunity scoring pass. Reads aggregated first-party analytics through a
// SECURITY DEFINER RPC (counts only — no raw analytics rows leave the
// database), scores each category with the tested pure function in
// src/lib/engine/opportunity.ts, and writes back an explainable score.
//
// This is the "learn from visitors" half of the loop: publish -> measure ->
// understand demand -> identify gaps. Categories with too little measured
// demand score null rather than a fabricated number.
export async function runOpportunityScoring(supabase: Client): Promise<StageResult> {
  const counters = newCounters();

  const opportunityFlag = await readFlag(supabase, "opportunity");
  if (!opportunityFlag.enabled) {
    // An UNREADABLE flag is a failure, not a deliberate skip. Recording it as
    // 'skipped' used to hide it twice over: the reason said the flag was off
    // when it had never been read, and silent-success.ts filters skipped runs
    // out entirely, so one denied RPC switched the engine off and still
    // produced a clean detector report.
    const status = opportunityFlag.readable ? "skipped" : "failed";
    await recordJobRun(
      supabase,
      JOB,
      status,
      counters,
      { reason: opportunityFlag.reason },
      opportunityFlag.error
    );
    return { status, ...counters, detail: { reason: opportunityFlag.reason } };
  }

  const { data, error } = await supabase.rpc("engine_opportunity_inputs", { p_days: 28 });
  if (error) {
    await recordJobRun(supabase, JOB, "failed", counters, {}, error.message);
    return { status: "failed", ...counters, detail: { error: error.message } };
  }

  const rows = (data ?? []) as {
    category_slug: string;
    search_volume: number;
    zero_result_searches: number;
    views: number;
    previous_views: number;
    existing_content_count: number;
    commercial_clicks: number;
    days_since_freshest: number;
  }[];

  // An empty input set used to fall through the loop and record success with
  // every counter at zero — the identical row a silently-denied read produces.
  // NOTHING_TO_DO has to be earned; see queue-read.ts.
  if (rows.length === 0) {
    const outcome = await concludeEmptyQueue(supabase, {
      stage: JOB,
      source: "engine_opportunity_inputs",
      kind: "security_definer_rpc",
      rowsReturned: 0,
      eligible: 0,
      reason: "no_opportunity_inputs",
    });
    await recordJobRun(supabase, JOB, outcome.status, counters, outcome.detail, outcome.error ?? undefined);
    return { status: outcome.status, ...counters, detail: outcome.detail };
  }

  const scored: { category: string; score: number | null }[] = [];
  const log = createPostconditionLog(counters);

  for (const row of rows) {
    counters.examined++;
    const result = computeOpportunityScore({
      searchVolume: row.search_volume,
      zeroResultSearches: row.zero_result_searches,
      views: row.views,
      previousViews: row.previous_views,
      existingContentCount: row.existing_content_count,
      commercialClicks: row.commercial_clicks,
      // 9999 is the RPC's "no published content at all" sentinel; carrying it
      // through as a real age would fake a freshness signal.
      daysSinceFreshest: row.days_since_freshest >= 9999 ? null : row.days_since_freshest,
      hasActiveDiscovery: false,
    });

    // engine_upsert_opportunity is declared `returns void`. There is therefore
    // NOTHING in the response that can distinguish "the row was upserted" from
    // "the statement matched nothing and the function returned". The previous
    // `else counters.created++` asserted the former on the strength of the
    // latter, which is the whole failure class in one line.
    //
    // Declared blind instead: the write is not counted as a creation, the job
    // reports how many unprovable writes it made, and the count blocks
    // autonomous graduation until the RPC is changed to return something. The
    // change is drafted in
    // supabase/migrations/20260822_silent_success_telemetry.sql, applied 2026-08-22.
    await log.pendingRpc({
      operation: "engine_upsert_opportunity",
      subject: `category/${row.category_slug}`,
      migration: "supabase/migrations/20260822_silent_success_telemetry.sql",
      run: () =>
        supabase.rpc("engine_upsert_opportunity", {
          p_subject_type: "category",
          p_subject_key: row.category_slug,
          p_label: row.category_slug,
          p_score: result.score,
          p_inputs: result.inputs,
          p_explanation: result.explanation,
        }),
      accepted: ["ok"],
      // Both rejections name WHICH input was refused, so a guard-list/CHECK
      // drift shows up as a specific status rather than a generic failure.
      benign: [],
    });

    scored.push({ category: row.category_slug, score: result.score });
  }

  const jobView = counters.failed > 0 ? (counters.created > 0 ? "partial" : "failed") : "success";
  const postconditions = log.summarise();
  const status = worstStatus(jobView, statusFromPostconditions(postconditions));

  const detail = { scored, postconditions: postconditionDetail(postconditions) };
  await recordJobRun(supabase, JOB, status, counters, detail, undefined, writeCountsFrom(postconditions));
  return { status, ...counters, detail };
}
