import { requireAdmin } from "@/lib/dal";
import { createClient } from "@/lib/supabase/server";
import { PageHeader, Card, Badge, EmptyState, QueryErrorBanner } from "@/components/admin/ui";
import { byTrendScore } from "@/lib/engine/trends";
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

export default async function EngineTrendingPage() {
  await requireAdmin();
  const supabase = await createClient();

  const { data, error } = await supabase
    .from("engine_trends")
    .select(
      "id, topic_key, label, category_slug, trend_score, confidence, velocity, contributing_signals, " +
        "why_trending, first_detected_at, last_observed_at, observation_count, " +
        "recommended_content_type, has_published_coverage, is_active"
    )
    .eq("is_active", true);

  const rows = (data ?? []) as unknown as TrendRow[];

  // Sort in JS rather than SQL so nulls sort LAST via the same helper the rest
  // of the engine uses. `order(..., nullsFirst: false)` would also work, but
  // routing both through byTrendScore keeps one definition of "unscored sorts
  // last, never as zero".
  const ranked = [...rows].sort((a, b) => byTrendScore({ score: a.trend_score }, { score: b.trend_score }));

  const scored = ranked.filter((r) => r.trend_score !== null);
  const unscored = ranked.filter((r) => r.trend_score === null);
  const missingCoverage = ranked.filter((r) => !r.has_published_coverage && r.trend_score !== null);

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
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 mb-6">
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
            </div>

            <div className="flex flex-col gap-3">
              {ranked.map((t, index) => {
                const lowConfidence = t.confidence < LOW_CONFIDENCE_THRESHOLD;
                return (
                  <Card
                    key={t.id}
                    className={`p-4 ${lowConfidence ? "border-neutral-200 bg-neutral-50" : ""}`}
                  >
                    <div className="flex flex-wrap items-start justify-between gap-2">
                      <div className="min-w-0">
                        <p className="text-sm font-medium text-neutral-900">
                          <span className="text-neutral-400 mr-2 tabular-nums">#{index + 1}</span>
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
                          <Badge tone={lowConfidence ? "neutral" : "blue"}>Score {t.trend_score.toFixed(1)}</Badge>
                        )}
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

                    {!t.has_published_coverage && t.trend_score !== null && (
                      <p className="text-xs text-neutral-600 mt-2">
                        Nothing published in this category during the measurement window. That is a gap indicator, not
                        an instruction — check the opportunity score and review queue before acting.
                      </p>
                    )}
                  </Card>
                );
              })}
            </div>
          </>
        )
      )}
    </div>
  );
}
