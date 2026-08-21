import { Card, EmptyState } from "@/components/admin/ui";
import type {
  FpHeadlineMetrics,
  FpCategoryRow,
  FpTopEntityRow,
  FpSearchIntelligence,
  FpJourneyRow,
  FpPathCountRow,
  FpEngagement,
  FpMonetisationFunnel,
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
