import "server-only";
import type { createClient } from "@/lib/supabase/server";
import { newCounters, recordJobRun, isFlagEnabled } from "@/lib/engine/cron";
import {
  createPostconditionLog,
  expectNonEmpty,
  statusFromPostconditions,
  worstStatus,
} from "@/lib/engine/postconditions";
import { postconditionDetail } from "@/lib/engine/silent-success";
import {
  computeTrend,
  rankTrends,
  TREND_EVIDENCE_HALF_LIFE_HOURS,
  TREND_EXPIRY_SCORE,
  TREND_EVIDENCE_HORIZON_HOURS,
  TREND_DECAY_GRACE_HOURS,
} from "@/lib/engine/trends";
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
//
// The pass has three phases, in this order:
//
//   1. RE-MEASURE. engine_trend_inputs returns a row for every taxonomy
//      category on every pass, and every one is re-scored from the current
//      14-day window and upserted. A trend is therefore never "scored once at
//      creation" — the stored number is always the most recent measurement,
//      and a topic that has gone quiet has its score fall on its own because
//      the evidence rolls out of the window.
//   2. RE-RANK. The pass's results are ordered through rankTrends() and the
//      ordering is recorded in the job run, so the ranking that admins see is
//      reproducible from the audit log rather than being an artefact of
//      whatever order rows came back in.
//   3. EXPIRE. Anything whose evidence has aged past the documented floor or
//      horizon is deactivated. This is the phase that stops an old trend
//      sitting at the top of the list forever, and it is the only one that
//      needs the database's help — see the note on the RPC below.
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

  const observedAt = new Date().toISOString();
  const scored: { topic: string; score: number | null; confidence: number; lastObservedAt: string }[] = [];
  const log = createPostconditionLog(counters);

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

    // The MEASURED score is what gets stored — never a decayed one. Decay is
    // an inference about how current a measurement still is, and writing it
    // into trend_score would make the two indistinguishable on the next read.
    // The return value used to be discarded and `created++` counted off a null
    // error alone. engine_upsert_trend answers 'rejected_invalid' when the
    // topic key or recommended type falls outside its guard list, and that
    // answer was going nowhere — a whole pass could re-measure nothing while
    // reporting a full set of scores.
    await log.rpc({
      operation: "engine_upsert_trend",
      subject: `trend/${row.topic_key}`,
      run: () =>
        supabase.rpc("engine_upsert_trend", {
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
        }),
      accepted: ["ok", "created", "refreshed"],
    });

    scored.push({
      topic: row.topic_key,
      score: result.score,
      confidence: result.confidence,
      lastObservedAt: observedAt,
    });
  }

  // Phase 2 — re-rank. Everything measured in this pass has age ~0 so nothing
  // is discounted yet; running it through the same function the admin UI uses
  // keeps one definition of the ordering and records it for audit.
  const ranked = rankTrends(scored).map((r, index) => ({
    rank: index + 1,
    topic: r.topic,
    score: r.score,
    confidence: r.confidence,
    lifecycle: r.decay.lifecycle,
  }));

  // Phase 3 — expire. This has to be an RPC: scheduled jobs run as `anon` and
  // engine_trends is admin-only under RLS, which denies by returning zero rows
  // rather than an error. A direct .update() here would silently match nothing
  // for ever — the 2026-08 anon-grant failure mode exactly.
  const expiry = await supabase.rpc("engine_expire_stale_trends", {
    p_half_life_hours: TREND_EVIDENCE_HALF_LIFE_HOURS,
    p_floor: TREND_EXPIRY_SCORE,
    p_horizon_hours: TREND_EVIDENCE_HORIZON_HOURS,
    p_grace_hours: TREND_DECAY_GRACE_HOURS,
  });

  let decay: Record<string, unknown>;
  if (expiry.error) {
    // Reported loudly rather than swallowed. If this RPC is missing (the
    // migration is still in supabase/migrations_pending/), NOTHING expires and
    // stale trends accumulate at the top of the ranking — which looks exactly
    // like a healthy engine. Degrading the run to "partial" makes that visible
    // on the engine health page instead of leaving it to be noticed months
    // later.
    counters.failed++;
    decay = {
      expired: 0,
      available: false,
      error: expiry.error.message,
      note: "Trend expiry RPC unavailable — engine_expire_stale_trends may not be applied yet (supabase/migrations_pending/20260822_trend_decay_expiry.sql). Stale trends CANNOT expire until it is.",
    };
  } else if (expiry.data === null) {
    // No error AND no row set. engine_expire_stale_trends returns a TABLE, so
    // supabase-js hands back [] when it genuinely expired nothing. A null is
    // the shape of a function that did not run as advertised — a missing
    // overload, a revoked grant — and reading it as "zero trends expired" is
    // precisely how a dead expiry phase would look permanently healthy.
    counters.failed++;
    decay = {
      expired: 0,
      available: false,
      error: null,
      note:
        "engine_expire_stale_trends returned null instead of a row set. That is not 'nothing " +
        "expired' — it is the RPC not answering in the shape it declares. Nothing can be assumed " +
        "to have expired.",
    };
  } else {
    const expiredRows = expiry.data as { topic_key: string; reason: string }[];
    decay = {
      expired: expiredRows.length,
      available: true,
      expiredTopics: expiredRows,
      halfLifeHours: TREND_EVIDENCE_HALF_LIFE_HOURS,
      floor: TREND_EXPIRY_SCORE,
      horizonHours: TREND_EVIDENCE_HORIZON_HOURS,
      graceHours: TREND_DECAY_GRACE_HOURS,
    };
  }

  // engine_trend_inputs returns a row for EVERY taxonomy category on every
  // pass, so an empty input set is not a quiet week — it means the read
  // returned nothing, which under RLS is what "denied" looks like. Recorded as
  // a postcondition so a re-measurement pass that measured nothing cannot
  // report a clean success.
  await log.verify({
    operation: "engine_trend_inputs",
    expectation: "at least one topic row, because the RPC emits one per taxonomy category",
    run: async () => ({ data: rows, error: null }),
    verify: expectNonEmpty("trend input"),
  });

  const jobView = counters.failed === 0 ? "success" : counters.created > 0 ? "partial" : "failed";
  const postconditions = log.summarise();
  const status = worstStatus(jobView, statusFromPostconditions(postconditions));

  const detail = { scored, ranked, decay, postconditions: postconditionDetail(postconditions) };
  await recordJobRun(supabase, JOB, status, counters, detail);
  return { status, ...counters, detail };
}
