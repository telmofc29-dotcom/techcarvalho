import "server-only";
import type { createClient } from "@/lib/supabase/server";
import { newCounters, recordJobRun, isFlagEnabled } from "@/lib/engine/cron";
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

    const { error: upsertError } = await supabase.rpc("engine_upsert_opportunity", {
      p_subject_type: "category",
      p_subject_key: row.category_slug,
      p_label: row.category_slug,
      p_score: result.score,
      p_inputs: result.inputs,
      p_explanation: result.explanation,
    });

    if (upsertError) counters.failed++;
    else counters.created++;
    scored.push({ category: row.category_slug, score: result.score });
  }

  const status = counters.failed > 0 ? (counters.created > 0 ? "partial" : "failed") : "success";
  await recordJobRun(supabase, JOB, status, counters, { scored });
  return { status, ...counters, detail: { scored } };
}
