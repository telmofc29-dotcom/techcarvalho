import "server-only";
import type { createClient } from "@/lib/supabase/server";
import { newCounters, recordJobRun, isFlagEnabled } from "@/lib/engine/cron";
import {
  createPostconditionLog,
  statusFromPostconditions,
  worstStatus,
} from "@/lib/engine/postconditions";
import { postconditionDetail } from "@/lib/engine/silent-success";
import { computeOpportunityScore } from "@/lib/engine/opportunity";
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

  if (!(await isFlagEnabled(supabase, "opportunity"))) {
    await recordJobRun(supabase, JOB, "skipped", counters, { reason: "opportunity_disabled" });
    return { status: "skipped", ...counters };
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
    // supabase/migrations_pending/20260822_silent_success_telemetry.sql.
    await log.blind({
      operation: "engine_upsert_opportunity",
      subject: `category/${row.category_slug}`,
      why:
        "engine_upsert_opportunity is declared `returns void`, so a successful call and a call " +
        "that upserted nothing are byte-identical responses.",
      run: () =>
        supabase.rpc("engine_upsert_opportunity", {
          p_subject_type: "category",
          p_subject_key: row.category_slug,
          p_label: row.category_slug,
          p_score: result.score,
          p_inputs: result.inputs,
          p_explanation: result.explanation,
        }),
    });

    scored.push({ category: row.category_slug, score: result.score });
  }

  const jobView = counters.failed > 0 ? (counters.created > 0 ? "partial" : "failed") : "success";
  const postconditions = log.summarise();
  const status = worstStatus(jobView, statusFromPostconditions(postconditions));

  const detail = { scored, postconditions: postconditionDetail(postconditions) };
  await recordJobRun(supabase, JOB, status, counters, detail);
  return { status, ...counters, detail };
}
