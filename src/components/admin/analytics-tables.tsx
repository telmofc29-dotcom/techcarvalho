import { Card, EmptyState, Badge } from "@/components/admin/ui";
import type { Insight, OpportunityScore } from "@/lib/analytics/insights-engine";
import type {
  FpHeadlineMetrics,
  FpCategoryRow,
  FpTopEntityRow,
  FpSearchIntelligence,
  FpJourneyRow,
  FpPathCountRow,
  FpEngagement,
  FpMonetisationFunnel,
  FpKpi,
  FpDailyPoint,
  FpTopManufacturerRow,
  FpClickedElementRow,
  FpPageDepthRow,
  FpCommercialRow,
} from "@/lib/analytics/first-party-dashboard";

// Presentational table/grid components for the TechCarvalho-first-party
// half of /admin/analytics — kept separate from the GA4 tables already
// living inline in analytics/page.tsx so that file doesn't grow unbounded,
// and so this new dashboard half is easy to find/review as one unit.

function Trend({ value }: { value: number | null }) {
  if (value === null) return <span className="text-neutral-400">—</span>;
  const tone = value > 0 ? "text-green-700" : value < 0 ? "text-red-700" : "text-neutral-500";
  const sign = value > 0 ? "+" : "";
  return <span className={`font-medium ${tone}`}>{sign}{value}%</span>;
}

export function HeadlineMetricsGrid({ metrics }: { metrics: FpHeadlineMetrics }) {
  const tiles: { label: string; value: number }[] = [
    { label: "Sessions", value: metrics.sessions },
    { label: "Page views", value: metrics.pageViews },
    { label: "Article views", value: metrics.articleViews },
    { label: "Product views", value: metrics.productViews },
    { label: "Searches", value: metrics.searches },
    { label: "Internal clicks", value: metrics.internalClicks },
    { label: "Outbound clicks", value: metrics.outboundClicks },
    { label: "Affiliate clicks", value: metrics.affiliateClicks },
  ];
  return (
    <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
      {tiles.map((t) => (
        <div key={t.label} className="rounded-lg border border-neutral-200 bg-white p-4">
          <p className="text-xs font-medium uppercase tracking-wide text-neutral-500">{t.label}</p>
          <p className="mt-1 text-lg font-semibold text-neutral-900">{t.value}</p>
        </div>
      ))}
    </div>
  );
}

export function CategoryComparisonTable({ rows, labelBySlug }: { rows: FpCategoryRow[]; labelBySlug: Map<string, string> }) {
  const anyActivity = rows.some((r) => r.views > 0 || r.contentClicks > 0 || r.searches > 0 || r.affiliateOutboundClicks > 0);
  if (!anyActivity) {
    return <EmptyState title="No category activity yet" description="This table populates once visitors browse the site with analytics consent granted." />;
  }
  return (
    <div className="overflow-x-auto">
      <table className="w-full text-sm">
        <thead>
          <tr>
            <th className="text-left font-medium text-neutral-500 pb-2">Area</th>
            <th className="text-right font-medium text-neutral-500 pb-2">Views</th>
            <th className="text-right font-medium text-neutral-500 pb-2">Sessions</th>
            <th className="text-right font-medium text-neutral-500 pb-2">Content clicks</th>
            <th className="text-right font-medium text-neutral-500 pb-2">Searches</th>
            <th className="text-right font-medium text-neutral-500 pb-2">Affiliate/Outbound</th>
            <th className="text-right font-medium text-neutral-500 pb-2">Trend</th>
          </tr>
        </thead>
        <tbody>
          {[...rows]
            .sort((a, b) => b.views - a.views)
            .map((row) => (
              <tr key={row.slug}>
                <td className="py-1.5 text-neutral-900 font-medium">{labelBySlug.get(row.slug) ?? row.slug}</td>
                <td className="py-1.5 text-right text-neutral-700">{row.views}</td>
                <td className="py-1.5 text-right text-neutral-700">{row.sessions}</td>
                <td className="py-1.5 text-right text-neutral-700">{row.contentClicks}</td>
                <td className="py-1.5 text-right text-neutral-700">{row.searches}</td>
                <td className="py-1.5 text-right text-neutral-700">{row.affiliateOutboundClicks}</td>
                <td className="py-1.5 text-right">
                  <Trend value={row.trend} />
                </td>
              </tr>
            ))}
        </tbody>
      </table>
    </div>
  );
}

export function TopEntityTable({
  rows,
  nameById,
  emptyLabel,
}: {
  rows: FpTopEntityRow[];
  nameById: Map<string, { label: string; href: string }>;
  emptyLabel: string;
}) {
  if (rows.length === 0) return <p className="text-sm text-neutral-500">{emptyLabel}</p>;
  return (
    <div className="overflow-x-auto">
      <table className="w-full text-sm">
        <thead>
          <tr>
            <th className="text-left font-medium text-neutral-500 pb-1">Title</th>
            <th className="text-right font-medium text-neutral-500 pb-1">Views</th>
            <th className="text-right font-medium text-neutral-500 pb-1">Sessions</th>
            <th className="text-right font-medium text-neutral-500 pb-1">Engagement</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => {
            const entity = nameById.get(row.id);
            return (
              <tr key={row.id}>
                <td className="py-1 text-neutral-700">
                  {entity ? (
                    <a href={entity.href} className="hover:text-accent underline decoration-neutral-300">
                      {entity.label}
                    </a>
                  ) : (
                    <span className="text-neutral-400">Unknown ({row.id.slice(0, 8)})</span>
                  )}
                </td>
                <td className="py-1 text-right text-neutral-900 font-medium">{row.views}</td>
                <td className="py-1 text-right text-neutral-700">{row.sessions}</td>
                <td className="py-1 text-right text-neutral-700">{row.engagementRate !== null ? `${row.engagementRate}%` : "—"}</td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

function SearchTermTable({ rows, showCount = true }: { rows: { query: string; count: number; trend: number | null }[]; showCount?: boolean }) {
  if (rows.length === 0) return <p className="text-xs text-neutral-400">None in this range.</p>;
  return (
    <table className="w-full text-sm">
      <tbody>
        {rows.map((r) => (
          <tr key={r.query}>
            <td className="py-1 text-neutral-700">&ldquo;{r.query}&rdquo;</td>
            {showCount && <td className="py-1 text-right text-neutral-900 font-medium">{r.count}</td>}
            {r.trend !== null && (
              <td className="py-1 text-right">
                <Trend value={r.trend} />
              </td>
            )}
          </tr>
        ))}
      </tbody>
    </table>
  );
}

export function SearchIntelligencePanel({ data }: { data: FpSearchIntelligence }) {
  const nothingAtAll =
    data.topSearches.length === 0 &&
    data.zeroResultSearches.length === 0 &&
    data.noClickSearches.length === 0 &&
    data.risingSearches.length === 0;
  if (nothingAtAll) {
    return <EmptyState title="No searches yet" description="Search activity will appear here once visitors use the search box." />;
  }
  return (
    <div className="grid grid-cols-1 sm:grid-cols-2 gap-6">
      <div>
        <p className="text-xs font-medium text-neutral-500 mb-1">Top searches</p>
        <SearchTermTable rows={data.topSearches} />
      </div>
      <div>
        <p className="text-xs font-medium text-neutral-500 mb-1">
          No results found <span className="text-neutral-400">(content gap signal)</span>
        </p>
        <SearchTermTable rows={data.zeroResultSearches} />
      </div>
      <div>
        <p className="text-xs font-medium text-neutral-500 mb-1">
          Results shown, nothing clicked <span className="text-neutral-400">(weak-match signal)</span>
        </p>
        <SearchTermTable rows={data.noClickSearches} />
      </div>
      <div>
        <p className="text-xs font-medium text-neutral-500 mb-1">Rising</p>
        <SearchTermTable rows={data.risingSearches} showCount={false} />
      </div>
    </div>
  );
}

export function JourneysTable({ rows }: { rows: FpJourneyRow[] }) {
  if (rows.length === 0) return <p className="text-sm text-neutral-500">Not enough multi-page sessions in this range yet.</p>;
  return (
    <table className="w-full text-sm">
      <tbody>
        {rows.map((r) => (
          <tr key={`${r.from}->${r.to}`}>
            <td className="py-1 text-neutral-700">
              {r.from} <span className="text-neutral-400">→</span> {r.to}
            </td>
            <td className="py-1 text-right text-neutral-900 font-medium">{r.count}</td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

export function PathCountTable({ rows }: { rows: FpPathCountRow[] }) {
  if (rows.length === 0) return <p className="text-xs text-neutral-400">None in this range.</p>;
  return (
    <table className="w-full text-sm">
      <tbody>
        {rows.map((r) => (
          <tr key={r.path}>
            <td className="py-1 text-neutral-700">{r.path}</td>
            <td className="py-1 text-right text-neutral-900 font-medium">{r.count}</td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

export function EngagementGrid({ engagement, sessions }: { engagement: FpEngagement; sessions: number }) {
  if (sessions === 0) {
    return <p className="text-sm text-neutral-500">No sessions in this range yet.</p>;
  }
  return (
    <div className="grid grid-cols-3 gap-3">
      <div>
        <p className="text-xs font-medium uppercase tracking-wide text-neutral-500">Pages / session</p>
        <p className="mt-1 text-lg font-semibold text-neutral-900">{engagement.pagesPerSession ?? "—"}</p>
      </div>
      <div>
        <p className="text-xs font-medium uppercase tracking-wide text-neutral-500">Events / session</p>
        <p className="mt-1 text-lg font-semibold text-neutral-900">{engagement.eventsPerSession ?? "—"}</p>
      </div>
      <div>
        <p className="text-xs font-medium uppercase tracking-wide text-neutral-500">Returning visitors</p>
        <p className="mt-1 text-lg font-semibold text-neutral-900">
          {engagement.returningVisitorRate !== null ? `${engagement.returningVisitorRate}%` : "—"}
        </p>
      </div>
    </div>
  );
}

export function MonetisationFunnelCard({ funnel }: { funnel: FpMonetisationFunnel }) {
  return (
    <Card className="p-5">
      <h3 className="text-sm font-semibold text-neutral-900 mb-1">Monetisation funnel</h3>
      <p className="text-xs text-neutral-500 mb-3">
        Sessions that viewed a product page and later clicked an affiliate/outbound link in that same session —
        content/category → product → retailer intent, not just raw traffic. Only reflects visitors who granted
        analytics consent (see the baseline total in the GA4 section below for the consent-independent count).
      </p>
      {funnel.sessionsViewingProduct === 0 ? (
        <p className="text-sm text-neutral-500">No product-viewing sessions in this range yet.</p>
      ) : (
        <div className="grid grid-cols-3 gap-3">
          <div>
            <p className="text-xs font-medium uppercase tracking-wide text-neutral-500">Viewed a product</p>
            <p className="mt-1 text-lg font-semibold text-neutral-900">{funnel.sessionsViewingProduct}</p>
          </div>
          <div>
            <p className="text-xs font-medium uppercase tracking-wide text-neutral-500">Also clicked out</p>
            <p className="mt-1 text-lg font-semibold text-neutral-900">{funnel.sessionsClickingAffiliateOrOutbound}</p>
          </div>
          <div>
            <p className="text-xs font-medium uppercase tracking-wide text-neutral-500">Conversion</p>
            <p className="mt-1 text-lg font-semibold text-neutral-900">
              {funnel.conversionRate !== null ? `${funnel.conversionRate}%` : "—"}
            </p>
          </div>
        </div>
      )}
    </Card>
  );
}

// ---- Sparkline / time-series (plain inline SVG — no charting library) ----

function Sparkline({ values, width = 96, height = 28 }: { values: number[]; width?: number; height?: number }) {
  if (values.length < 2 || values.every((v) => v === 0)) {
    return <div style={{ width, height }} className="flex items-center justify-center text-[10px] text-neutral-300">no data</div>;
  }
  const max = Math.max(...values, 1);
  const step = width / (values.length - 1);
  const points = values.map((v, i) => `${(i * step).toFixed(1)},${(height - (v / max) * height).toFixed(1)}`).join(" ");
  return (
    <svg width={width} height={height} viewBox={`0 0 ${width} ${height}`} className="text-accent" aria-hidden="true">
      <polyline points={points} fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinejoin="round" strokeLinecap="round" />
    </svg>
  );
}

export function KpiGrid({ kpis }: { kpis: FpKpi[] }) {
  return (
    <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-3">
      {kpis.map((k) => (
        <div key={k.label} className="rounded-lg border border-neutral-200 bg-white p-4 flex flex-col gap-2">
          <p className="text-xs font-medium uppercase tracking-wide text-neutral-500">{k.label}</p>
          <div className="flex items-end justify-between gap-2">
            <p className="text-lg font-semibold text-neutral-900">{k.current}</p>
            <Trend value={k.trend} />
          </div>
          {k.sparkline.length > 0 && <Sparkline values={k.sparkline} />}
          <p className="text-[11px] text-neutral-400">was {k.previous} last period</p>
        </div>
      ))}
    </div>
  );
}

// A named line chart with up to 3 series, plain SVG — the traffic
// time-series. Each series gets its own polyline; a legend lists series
// name + period total so the previous-period comparison is a real number,
// not just a shape overlaid without scale context.
export function TrafficChart({
  series,
}: {
  series: { label: string; points: FpDailyPoint[]; previousTotal?: number; color: string }[];
}) {
  const width = 640;
  const height = 160;
  const padding = 24;
  const allValues = series.flatMap((s) => s.points.map((p) => p.value));
  const max = Math.max(...allValues, 1);
  const dayCount = series[0]?.points.length ?? 0;
  if (dayCount < 2) return <p className="text-sm text-neutral-500">Not enough days in this range to chart.</p>;
  const step = (width - padding * 2) / (dayCount - 1);

  return (
    <div>
      <svg width="100%" viewBox={`0 0 ${width} ${height}`} className="max-w-full">
        <line x1={padding} y1={height - padding} x2={width - padding} y2={height - padding} stroke="#e5e5e5" strokeWidth="1" />
        {series.map((s) => {
          const points = s.points
            .map((p, i) => {
              const x = padding + i * step;
              const y = height - padding - (p.value / max) * (height - padding * 2);
              return `${x.toFixed(1)},${y.toFixed(1)}`;
            })
            .join(" ");
          return <polyline key={s.label} points={points} fill="none" stroke={s.color} strokeWidth="2" strokeLinejoin="round" strokeLinecap="round" />;
        })}
      </svg>
      <div className="flex flex-wrap gap-4 mt-2">
        {series.map((s) => {
          const total = s.points.reduce((sum, p) => sum + p.value, 0);
          return (
            <div key={s.label} className="flex items-center gap-1.5 text-xs text-neutral-600">
              <span className="inline-block h-2 w-2 rounded-full" style={{ backgroundColor: s.color }} />
              {s.label}: <span className="font-medium text-neutral-900">{total}</span>
              {s.previousTotal !== undefined && (
                <span className="text-neutral-400">(was {s.previousTotal} last period)</span>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}

export function ManufacturerTable({ rows, nameById }: { rows: FpTopManufacturerRow[]; nameById: Map<string, { label: string; href: string }> }) {
  if (rows.length === 0) return <p className="text-sm text-neutral-500">No manufacturer-attributed activity in this range yet.</p>;
  return (
    <table className="w-full text-sm">
      <tbody>
        {rows.map((r) => {
          const m = nameById.get(r.id);
          return (
            <tr key={r.id}>
              <td className="py-1 text-neutral-700">
                {m ? (
                  <a href={m.href} className="hover:text-accent underline decoration-neutral-300">
                    {m.label}
                  </a>
                ) : (
                  <span className="text-neutral-400">Unknown ({r.id.slice(0, 8)})</span>
                )}
              </td>
              <td className="py-1 text-right text-neutral-900 font-medium">{r.views}</td>
              <td className="py-1 text-right text-neutral-500">{r.sessions} sessions</td>
            </tr>
          );
        })}
      </tbody>
    </table>
  );
}

export function ClickedElementsTable({ rows }: { rows: FpClickedElementRow[] }) {
  if (rows.length === 0) return <p className="text-sm text-neutral-500">No card/link clicks in this range yet.</p>;
  return (
    <table className="w-full text-sm">
      <tbody>
        {rows.map((r) => (
          <tr key={`${r.destination}-${r.linkPosition}`}>
            <td className="py-1 text-neutral-700">{r.destination}</td>
            <td className="py-1 text-right text-neutral-400 text-xs">{r.linkPosition}</td>
            <td className="py-1 text-right text-neutral-900 font-medium pl-3">{r.count}</td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

export function PageDepthTable({ rows, showRate = true }: { rows: FpPageDepthRow[]; showRate?: boolean }) {
  if (rows.length === 0) return <p className="text-xs text-neutral-400">Not enough data yet.</p>;
  return (
    <table className="w-full text-sm">
      <tbody>
        {rows.map((r) => (
          <tr key={r.path}>
            <td className="py-1 text-neutral-700">{r.path}</td>
            {showRate && <td className="py-1 text-right text-neutral-900 font-medium">{r.exitRate}%</td>}
            <td className="py-1 text-right text-neutral-400 text-xs pl-3">{r.entries} seen</td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

export function MonetisationSeriesChart({ affiliate, outbound }: { affiliate: FpDailyPoint[]; outbound: FpDailyPoint[] }) {
  const total = affiliate.reduce((s, p) => s + p.value, 0) + outbound.reduce((s, p) => s + p.value, 0);
  if (total === 0) return <p className="text-sm text-neutral-500">No affiliate/outbound clicks in this range yet.</p>;
  return (
    <TrafficChart
      series={[
        { label: "Affiliate clicks", points: affiliate, color: "#ea580c" },
        { label: "Outbound clicks", points: outbound, color: "#71717a" },
      ]}
    />
  );
}

// ---- Analytics Insights (deterministic, see insights-engine.ts) ----

export function InsightsPanel({ briefing, insights }: { briefing: string | null; insights: Insight[] }) {
  if (insights.length === 0) {
    return (
      <EmptyState
        title="No insights yet"
        description="Insights are only generated once real activity crosses a meaningful volume threshold for the selected range — this is expected on a young or low-traffic period, not a bug."
      />
    );
  }
  return (
    <div className="flex flex-col gap-4">
      {briefing && (
        <div className="rounded-lg bg-accent-soft/40 border border-accent/20 p-4">
          <p className="text-xs font-semibold uppercase tracking-wide text-accent mb-1">TechCarvalho Today</p>
          <p className="text-sm text-neutral-800">{briefing}</p>
        </div>
      )}
      <ul className="flex flex-col gap-2">
        {insights.map((insight, i) => (
          <li key={i} className="flex items-start gap-2 text-sm">
            <Badge tone={insight.kind === "observation" ? "neutral" : "amber"}>
              {insight.kind === "observation" ? "Observed" : "Suggested"}
            </Badge>
            <span className="text-neutral-700 flex-1">{insight.text}</span>
            <span className="text-[10px] uppercase tracking-wide text-neutral-400 shrink-0 mt-0.5">{insight.confidence}</span>
          </li>
        ))}
      </ul>
    </div>
  );
}

export function OpportunityScoreTable({ scores }: { scores: OpportunityScore[] }) {
  const scored = scores.filter((s) => s.score !== null);
  if (scored.length === 0) {
    return <p className="text-sm text-neutral-500">Not enough traffic/search volume in this range to score any category yet.</p>;
  }
  return (
    <div className="flex flex-col gap-3">
      {[...scored]
        .sort((a, b) => (b.score ?? 0) - (a.score ?? 0))
        .map((s) => (
          <div key={s.key} className="rounded-lg border border-neutral-200 p-3">
            <div className="flex items-center justify-between mb-1">
              <p className="text-sm font-medium text-neutral-900">{s.label}</p>
              <p className="text-sm font-semibold text-neutral-900">
                {s.score}
                <span className="text-neutral-400 font-normal">/100</span>
              </p>
            </div>
            <div className="h-1.5 rounded-full bg-neutral-100 overflow-hidden mb-2">
              <div className="h-full bg-accent" style={{ width: `${s.score}%` }} />
            </div>
            <ul className="text-xs text-neutral-500 list-disc list-inside">
              {s.reasons.map((r, i) => (
                <li key={i}>{r}</li>
              ))}
            </ul>
          </div>
        ))}
    </div>
  );
}

export function CommercialPagesTable({ rows, nameById }: { rows: FpCommercialRow[]; nameById: Map<string, { label: string; href: string }> }) {
  if (rows.length === 0) return <p className="text-sm text-neutral-500">No commercial (affiliate/outbound) clicks attributed to a product or article yet.</p>;
  return (
    <table className="w-full text-sm">
      <thead>
        <tr>
          <th className="text-left font-medium text-neutral-500 pb-1">Page</th>
          <th className="text-right font-medium text-neutral-500 pb-1">Clicks</th>
          <th className="text-right font-medium text-neutral-500 pb-1">CTR</th>
        </tr>
      </thead>
      <tbody>
        {rows.map((r) => {
          const entity = nameById.get(r.id);
          return (
            <tr key={r.id}>
              <td className="py-1 text-neutral-700">
                {entity ? (
                  <a href={entity.href} className="hover:text-accent underline decoration-neutral-300">
                    {entity.label}
                  </a>
                ) : (
                  <span className="text-neutral-400">
                    Unknown {r.kind} ({r.id.slice(0, 8)})
                  </span>
                )}
              </td>
              <td className="py-1 text-right text-neutral-900 font-medium">{r.clicks}</td>
              <td className="py-1 text-right text-neutral-500">{r.ctr !== null ? `${r.ctr}%` : "—"}</td>
            </tr>
          );
        })}
      </tbody>
    </table>
  );
}
