import "server-only";
import type { createClient } from "@/lib/supabase/server";
import { newCounters, recordJobRun, isFlagEnabled } from "@/lib/engine/cron";
import { computeTrend } from "@/lib/engine/trends";
import type { StageResult } from "./discovery";

type Client = Awaited<ReturnType<typeof createClient>>;
const JOB = "engine_trends";

// Trend pass. Aggregates measured signals per topic and writes an explainable
// trend score.
//
// This deliberately does NOT decide what to publish — that inference lives in
// engine_opportunities and engine_briefs. A trend is a measurement; keeping the
// two separate is what stops "a vendor posted a lot today" turning into "we
// should write about this".
export async function runTrends(supabase: Client): Promise<StageResult> {
  const counters = newCounters();

  if (!(await isFlagEnabled(supabase, "opportunity"))) {
    await recordJobRun(supabase, JOB, "skipped", counters, { reason: "opportunity_disabled" });
    return { status: "skipped", ...counters };
  }

  const { data, error } = await supabase.rpc("engine_trend_inputs", { p_days: 14 });
  if (error) {
    await recordJobRun(supabase, JOB, "failed", counters, {}, error.message);
    return { status: "failed", ...counters, detail: { error: error.message } };
  }

  const rows = (data ?? []) as {
    topic_key: string;
    label: string;
    category_slug: string | null;
    recent_discoveries: number;
    relevant_discoveries: number;
    recent_views: number;
    prior_views: number;
    searches: number;
    zero_result_searches: number;
    commercial_clicks: number;
    published_coverage: number;
    newest_discovery_at: string | null;
  }[];

  const scored: { topic: string; score: number | null; confidence: number }[] = [];

  for (const row of rows) {
    counters.examined++;

    const hoursSince =
      row.newest_discovery_at === null
        ? null
        : (Date.now() - new Date(row.newest_discovery_at).getTime()) / 3_600_000;

    const result = computeTrend({
      recentDiscoveries: row.recent_discoveries,
      relevantDiscoveries: row.relevant_discoveries,
      recentViews: row.recent_views,
      priorViews: row.prior_views,
      searches: row.searches,
      zeroResultSearches: row.zero_result_searches,
      commercialClicks: row.commercial_clicks,
      publishedCoverage: row.published_coverage,
      hoursSinceNewestDiscovery: hoursSince,
    });

    const { error: upsertError } = await supabase.rpc("engine_upsert_trend", {
      p_topic_key: row.topic_key,
      p_label: row.label,
      p_category: row.category_slug,
      p_score: result.score,
      p_confidence: result.confidence,
      p_velocity: result.velocity,
      p_signals: result.signals,
      p_why: result.whyTrending,
      p_recommended_type: result.recommendedContentType,
      p_has_coverage: row.published_coverage > 0,
    });

    if (upsertError) counters.failed++;
    else counters.created++;
    scored.push({ topic: row.topic_key, score: result.score, confidence: result.confidence });
  }

  const status = counters.failed === 0 ? "success" : counters.created > 0 ? "partial" : "failed";
  await recordJobRun(supabase, JOB, status, counters, { scored });
  return { status, ...counters, detail: { scored } };
}
