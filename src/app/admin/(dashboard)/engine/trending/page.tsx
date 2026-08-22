import { requireAdmin } from "@/lib/dal";
import { createClient } from "@/lib/supabase/server";
import { PageHeader, Card, Badge, EmptyState, QueryErrorBanner } from "@/components/admin/ui";
import {
  rankTrends,
  TREND_EVIDENCE_HALF_LIFE_HOURS,
  TREND_EXPIRY_SCORE,
  TREND_EVIDENCE_HORIZON_HOURS,
  type DecayedTrend,
} from "@/lib/engine/trends";
import { EngineTabs, TrendConfidenceBadge, formatDateTime, humanise } from "../shared";

// Measured trends, ranked.
//
// The single most important thing this page does is refuse to let two very
// different numbers look alike. A trend score built purely from feed activity —
// a vendor having a busy PR week — is not the same claim as a trend score built
// from readers actually searching and reading. Both come out of computeTrend()
// as a 0-100 number, so the UI has to carry the distinction that the number
// alone cannot: confidence is shown next to every score, low-confidence rows
// are visually demoted, and the "publisher output, not reader interest" warning
// is surfaced rather than buried in why_trending.
//
// AGE IS THE SAME KIND OF PROBLEM. A score measured a month ago and one
// measured this morning are also two different claims wearing the same number,
// so ordering is recomputed on every render through rankTrends(): the score
// shown is always the measurement as measured, and the ranking value beside it
// is that measurement discounted for how old its evidence is. Rows whose
// evidence has aged past the documented floor or horizon are moved out of the
// ranking entirely and shown as expired, rather than lingering at the bottom
// still looking current.
//
// The ranking is derived here rather than read from a stored rank column, for
// the same reason the public homepage recomputes its own: a stored rank is
// correct only at the instant it was written, and goes quietly wrong every hour
// afterwards.

type TrendRow = {
  id: string;
  topic_key: string;
  label: string;
  category_slug: string | null;
  trend_score: number | null;
  confidence: number;
  velocity: number | null;
  contributing_signals: Record<string, unknown>;
  why_trending: string;
  first_detected_at: string;
  last_observed_at: string;
  observation_count: number;
  recommended_content_type: string | null;
  has_published_coverage: boolean;
  is_active: boolean;
};

// Mirrors computeTrend()'s own threshold for "this is feed noise, not audience
// interest". Kept as a named constant so the UI rule is inspectable rather than
// a magic number buried in a ternary.
const LOW_CONFIDENCE_THRESHOLD = 0.3;

/**
 * Lifecycle badge. Deliberately worded so nothing implies a fresh measurement:
 * "Decaying" says the evidence is ageing, not that the audience is shrinking —
 * those are different claims and we only have grounds for the first.
 */
function LifecycleBadge({ decay }: { decay: DecayedTrend }) {
  switch (decay.lifecycle) {
    case "measured":
      return <Badge tone="green">Measured today</Badge>;
    case "decaying":
      return <Badge tone="amber">Evidence ageing</Badge>;
    case "unscored":
      return <Badge tone="neutral">Unscored</Badge>;
    case "expired":
      return <Badge tone="red">Expired</Badge>;
  }
}

const SIGNAL_LABELS: Record<string, string> = {
  audienceVolume: "Audience volume",
  audienceGrowth: "Audience growth",
  unmetDemand: "Unmet search demand",
  commercialIntent: "Commercial intent",
  feedActivity: "Source/feed activity",
  recency: "Recency",
};

function SignalBreakdown({ signals }: { signals: Record<string, unknown> }) {
  const entries = Object.entries(signals)
    .filter((e): e is [string, number] => typeof e[1] === "number" && e[1] > 0)
    .sort((a, b) => b[1] - a[1]);

  if (entries.length === 0) {
    return <p className="text-xs text-neutral-500">No contributing signals recorded.</p>;
  }

  // Contributions are already weighted fractions of the final score, so the
  // largest possible single contribution is its weight. Scaling bars to the
  // biggest present contribution keeps the comparison readable.
  const max = Math.max(...entries.map(([, v]) => v));

  return (
    <div className="flex flex-col gap-1.5">
      {entries.map(([key, value]) => (
        <div key={key} className="flex items-center gap-2">
          <span className="w-40 shrink-0 text-xs text-neutral-600">{SIGNAL_LABELS[key] ?? humanise(key)}</span>
          <div className="flex-1 h-2 rounded bg-neutral-100 overflow-hidden">
            <div
              className="h-full rounded bg-blue-600"
              style={{ width: `${Math.max((value / max) * 100, 2)}%` }}
            />
          </div>
          <span className="w-16 shrink-0 text-right text-xs tabular-nums text-neutral-700">
            {(value * 100).toFixed(1)}
          </span>
        </div>
      ))}
    </div>
  );
}

type RankedTrend = TrendRow & { decay: DecayedTrend };

function TrendCard({ t, rank }: { t: RankedTrend; rank: number | null }) {
  const lowConfidence = t.confidence < LOW_CONFIDENCE_THRESHOLD;
  const expired = t.decay.lifecycle === "expired";
  const discounted =
    t.decay.rankScore !== null &&
    t.decay.measuredScore !== null &&
    t.decay.rankScore < t.decay.measuredScore;

  return (
    <Card
      className={`p-4 ${expired ? "border-neutral-200 bg-neutral-50 opacity-80" : lowConfidence ? "border-neutral-200 bg-neutral-50" : ""}`}
    >
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div className="min-w-0">
          <p className="text-sm font-medium text-neutral-900">
            {rank !== null && <span className="text-neutral-400 mr-2 tabular-nums">#{rank}</span>}
            {t.label}
          </p>
          <p className="text-xs text-neutral-500 mt-0.5">
            {t.category_slug ?? "no category"} · key <code className="text-[11px]">{t.topic_key}</code>
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          {t.trend_score === null ? (
            <Badge tone="neutral">Unscored — insufficient data</Badge>
          ) : (
            <Badge tone={expired || lowConfidence ? "neutral" : "blue"}>
              Score {t.trend_score.toFixed(1)}
            </Badge>
          )}
          <LifecycleBadge decay={t.decay} />
          <TrendConfidenceBadge confidence={t.confidence} />
          {t.velocity !== null && (
            <Badge tone={t.velocity > 0 ? "green" : t.velocity < 0 ? "red" : "neutral"}>
              {t.velocity > 0 ? "+" : ""}
              {t.velocity.toFixed(0)}% vs previous
            </Badge>
          )}
          {!t.has_published_coverage && <Badge tone="amber">No coverage published</Badge>}
        </div>
      </div>

      {lowConfidence && (
        <p className="text-xs text-amber-800 mt-2 rounded border border-amber-200 bg-amber-50 p-2">
          Low confidence: this score is not backed by meaningful audience data, so it reflects publisher
          output rather than reader interest. Do not treat it as demand.
        </p>
      )}

      <div className="mt-3 rounded border border-neutral-200 bg-white p-3">
        <p className="text-xs font-semibold text-neutral-700 mb-1">Why this is trending</p>
        <p className="text-xs text-neutral-700">{t.why_trending}</p>
      </div>

      {/*
        Evidence age is presented separately from the score and in words, never
        as a second number in the same visual slot. "Score 62.4" is a
        measurement; "ranked at 31.2 because the evidence is three days old" is
        our judgement about that measurement. Showing the discounted value as
        if it were the score would erase exactly the distinction this engine is
        built to preserve.
      */}
      {(discounted || expired) && (
        <p className="text-xs text-neutral-700 mt-2 rounded border border-neutral-200 bg-white p-2">
          <strong className="font-semibold">Evidence age:</strong> {t.decay.decayNote}
        </p>
      )}

      <div className="mt-3">
        <p className="text-xs font-semibold text-neutral-700 mb-1.5">Contributing signals</p>
        <div className="overflow-x-auto">
          <SignalBreakdown signals={t.contributing_signals ?? {}} />
        </div>
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-2 gap-x-6 gap-y-1 mt-3 text-xs text-neutral-600">
        <p>First detected: {formatDateTime(t.first_detected_at)}</p>
        <p>Last observed: {formatDateTime(t.last_observed_at)}</p>
        <p>Observed {t.observation_count} time{t.observation_count === 1 ? "" : "s"}</p>
        <p>
          Recommended content type:{" "}
          {t.recommended_content_type ? humanise(t.recommended_content_type) : "none suggested"}
        </p>
      </div>

      {!expired && !t.has_published_coverage && t.trend_score !== null && (
        <p className="text-xs text-neutral-600 mt-2">
          Nothing published in this category during the measurement window. That is a gap indicator, not
          an instruction — check the opportunity score and review queue before acting.
        </p>
      )}
    </Card>
  );
}

export default async function EngineTrendingPage() {
  await requireAdmin();
  const supabase = await createClient();

  // No `.eq("is_active", true)` filter any more. Expiry is DERIVED from the
  // measurement and its age, so the page stays correct even if the sweep has
  // not run (or its migration has not been applied) — and an expired trend is
  // shown as expired rather than silently disappearing, which is the honest
  // way to retire a row an admin has been looking at for weeks.
  const { data, error } = await supabase
    .from("engine_trends")
    .select(
      "id, topic_key, label, category_slug, trend_score, confidence, velocity, contributing_signals, " +
        "why_trending, first_detected_at, last_observed_at, observation_count, " +
        "recommended_content_type, has_published_coverage, is_active"
    );

  const rows = (data ?? []) as unknown as TrendRow[];

  // Continuous re-ranking, recomputed on every render against the current
  // clock. rankTrends() is the same function the trend job records its ordering
  // with, so what an admin sees and what the audit log says are one definition.
  // Unscored still sorts last and never as zero; expired sorts below everything
  // live.
  const ranked: RankedTrend[] = rankTrends(
    rows.map((r) => ({ ...r, score: r.trend_score, lastObservedAt: r.last_observed_at }))
  ).map((r) => ({
    ...(r as unknown as TrendRow),
    // The stored flag is honoured as well as the derived state: if the sweep
    // has already deactivated a row, it stays retired here regardless of what
    // the derivation would say on its own.
    decay: r.is_active ? r.decay : { ...r.decay, lifecycle: "expired" as const, isActive: false },
  }));

  const live = ranked.filter((r) => r.decay.lifecycle !== "expired");
  const expired = ranked.filter((r) => r.decay.lifecycle === "expired");
  const scored = live.filter((r) => r.trend_score !== null);
  const unscored = live.filter((r) => r.trend_score === null);
  const missingCoverage = live.filter((r) => !r.has_published_coverage && r.trend_score !== null);

  return (
    <div>
      <PageHeader
        title="Trending"
        description="What is measurably being talked about and looked at. A measurement, not a decision to publish."
      />
      <EngineTabs current="/admin/engine/trending" />

      <Card className="p-4 mb-6 border-amber-200 bg-amber-50">
        <p className="text-sm font-medium text-neutral-900">Read the confidence, not just the score</p>
        <p className="text-xs text-neutral-700 mt-1">
          A trend score can be produced from source/feed activity alone. When there is no audience data behind it,
          the number measures <strong>how much a vendor published</strong>, not what readers care about — and it is
          marked <strong>Low confidence</strong>. Treat those rows as a prompt to look, not as evidence of demand. A
          trend is also separate from an <strong>opportunity</strong>: this page says what is happening, not what
          TechCarvalho should write.
        </p>
        <p className="text-xs text-neutral-700 mt-2">
          <strong>Scores age.</strong> Each one describes the 14-day window it was measured in, so ranking discounts
          it on a {TREND_EVIDENCE_HALF_LIFE_HOURS}h half-life as the evidence gets older. Below a ranking value of{" "}
          {TREND_EXPIRY_SCORE}, or once the measurement is more than{" "}
          {Math.round(TREND_EVIDENCE_HORIZON_HOURS / 24)} days old, a trend is retired as{" "}
          <strong>expired</strong> — we can no longer say it is trending. The score shown is always the number that
          was actually measured; the discount is our judgement about how current that measurement still is, and is
          never written back over it.
        </p>
      </Card>

      {error && <QueryErrorBanner message={`Failed to load trends: ${error.message}`} />}

      {!error && ranked.length === 0 ? (
        <EmptyState
          title="No trends recorded"
          description="The scheduled trend pass writes here once discovery and opportunity scoring are enabled and there are signals to measure."
        />
      ) : (
        !error && (
          <>
            <div className="grid grid-cols-1 sm:grid-cols-4 gap-3 mb-6">
              <Card className="p-4">
                <p className="text-xs font-medium uppercase tracking-wide text-neutral-500">Scored trends</p>
                <p className="mt-1 text-lg font-semibold text-neutral-900">{scored.length}</p>
              </Card>
              <Card className="p-4">
                <p className="text-xs font-medium uppercase tracking-wide text-neutral-500">Unscored (no data)</p>
                <p className="mt-1 text-lg font-semibold text-neutral-900">{unscored.length}</p>
              </Card>
              <Card className="p-4">
                <p className="text-xs font-medium uppercase tracking-wide text-neutral-500">Scored, no coverage</p>
                <p className="mt-1 text-lg font-semibold text-neutral-900">{missingCoverage.length}</p>
              </Card>
              <Card className="p-4">
                <p className="text-xs font-medium uppercase tracking-wide text-neutral-500">Expired (stale evidence)</p>
                <p className="mt-1 text-lg font-semibold text-neutral-900">{expired.length}</p>
              </Card>
            </div>

            {live.length === 0 ? (
              <EmptyState
                title="Nothing measurably trending right now"
                description="Every recorded trend has aged past its evidence window. That is an honest empty state, not a failure — the next scheduled pass will re-measure and anything real will come back."
              />
            ) : (
              <div className="flex flex-col gap-3">
                {live.map((t, index) => (
                  <TrendCard key={t.id} t={t} rank={index + 1} />
                ))}
              </div>
            )}

            {expired.length > 0 && (
              <div className="mt-8">
                <h2 className="text-sm font-semibold text-neutral-900">Expired</h2>
                <p className="text-xs text-neutral-600 mt-1 mb-3">
                  Kept as a record of what was observed, and unranked. The measurement is still shown as it was
                  measured — it is simply too old to support a claim that this is trending now. A topic returns to the
                  ranking on its own the moment a pass measures something again.
                </p>
                <div className="flex flex-col gap-3">
                  {expired.map((t) => (
                    <TrendCard key={t.id} t={t} rank={null} />
                  ))}
                </div>
              </div>
            )}
          </>
        )
      )}
    </div>
  );
}
