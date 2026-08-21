import Link from "next/link";
import { requireAdmin } from "@/lib/dal";
import { createClient } from "@/lib/supabase/server";
import { isAnalyticsConfiguredServer } from "@/lib/analytics/server-status";
import {
  getAnalyticsDataProvider,
  getDefaultDateRanges,
  type ContentPerformanceRow,
  type AcquisitionRow,
  type GeographyRow,
  type TechnologyRow,
  type SiteJourneyRow,
} from "@/lib/analytics/dashboard-types";
import {
  resolveDateRangeSelection,
  loadRangeData,
  computeHeadlineMetrics,
  getCategoryComparison,
  getTopContent,
  getTopProducts,
  getSearchIntelligence,
  getUserJourneys,
  getEntryPages,
  getExitPages,
  getEngagement,
  getMonetisationFunnel,
  type FpDateRangeSelection,
} from "@/lib/analytics/first-party-dashboard";
import { PLANNED_CATEGORIES } from "@/lib/public/categories";
import { PageHeader, Card, Badge, QueryErrorBanner } from "@/components/admin/ui";
import {
  HeadlineMetricsGrid,
  CategoryComparisonTable,
  TopEntityTable,
  SearchIntelligencePanel,
  JourneysTable as FpJourneysTable,
  PathCountTable,
  EngagementGrid,
  MonetisationFunnelCard,
} from "@/components/admin/analytics-tables";

const RANGE_OPTIONS: { value: FpDateRangeSelection["preset"]; label: string }[] = [
  { value: "today", label: "Today" },
  { value: "7d", label: "7 days" },
  { value: "28d", label: "28 days" },
  { value: "90d", label: "90 days" },
];

function SetupNotice({ children }: { children: React.ReactNode }) {
  return <p className="text-sm text-neutral-500">{children}</p>;
}

function StatTile({ label, value }: { label: string; value: number | null }) {
  return (
    <div className="rounded-lg border border-neutral-200 bg-white p-4">
      <p className="text-xs font-medium uppercase tracking-wide text-neutral-500">{label}</p>
      <p className="mt-1 text-lg font-semibold text-neutral-900">{value ?? "—"}</p>
    </div>
  );
}

function SectionCard({
  title,
  connected,
  emptyLabel,
  hasRows,
  children,
}: {
  title: string;
  connected: boolean;
  emptyLabel: string;
  hasRows: boolean;
  children?: React.ReactNode;
}) {
  return (
    <Card className="p-5">
      <div className="flex items-center gap-2 mb-3">
        <h2 className="text-sm font-semibold text-neutral-900">{title}</h2>
        <Badge tone={connected ? "green" : "neutral"}>{connected ? "Connected" : "Not connected"}</Badge>
      </div>
      {!connected ? (
        <SetupNotice>
          {emptyLabel} will appear here once GA4 is connected — see the setup notice above for exactly what&apos;s
          needed.
        </SetupNotice>
      ) : !hasRows ? (
        <SetupNotice>No data returned for this range yet.</SetupNotice>
      ) : (
        children
      )}
    </Card>
  );
}

export default async function AdminAnalyticsPage({
  searchParams,
}: {
  searchParams: Promise<{ range?: string; from?: string; to?: string }>;
}) {
  await requireAdmin();
  const params = await searchParams;

  // ---- TechCarvalho first-party analytics ----
  const fpRange = resolveDateRangeSelection(params);
  const categorySlugs = PLANNED_CATEGORIES.map((c) => c.slug);

  const [rangeData, categoryComparison, searchIntel] = await Promise.all([
    loadRangeData(fpRange),
    getCategoryComparison(categorySlugs, fpRange),
    getSearchIntelligence(fpRange),
  ]);
  const headline = computeHeadlineMetrics(rangeData);
  const topContent = getTopContent(rangeData);
  const topProducts = getTopProducts(rangeData);
  const journeys = getUserJourneys(rangeData);
  const entryPages = getEntryPages(rangeData);
  const exitPages = getExitPages(rangeData);
  const monetisationFunnel = getMonetisationFunnel(rangeData);
  const engagement = await getEngagement(rangeData, fpRange);

  // Name lookups for Top Content / Top Products — small, bounded batch
  // queries (top 10 each), not a wide scan.
  const supabase = await createClient();
  const [{ data: contentNames }, { data: productNames }] = await Promise.all([
    topContent.length > 0
      ? supabase.from("content_items").select("id, title, slug").in("id", topContent.map((r) => r.id))
      : Promise.resolve({ data: [] as { id: string; title: string; slug: string }[] }),
    topProducts.length > 0
      ? supabase.from("products").select("id, name, slug").in("id", topProducts.map((r) => r.id))
      : Promise.resolve({ data: [] as { id: string; name: string; slug: string }[] }),
  ]);
  const contentNameById = new Map((contentNames ?? []).map((c) => [c.id, { label: c.title, href: `/articles/${c.slug}` }]));
  const productNameById = new Map((productNames ?? []).map((p) => [p.id, { label: p.name, href: `/products/${p.slug}` }]));
  const categoryLabelBySlug = new Map(PLANNED_CATEGORIES.map((c) => [c.slug, c.label]));

  const fpHasError = rangeData.hasError || categoryComparison.hasError || searchIntel.hasError;

  // ---- GA4 (unchanged, existing) ----
  const configured = isAnalyticsConfiguredServer();
  const provider = getAnalyticsDataProvider();
  const connected = provider.isConnected();
  const ranges = getDefaultDateRanges();
  const activeRange = ranges[1];

  const [overview, content, acquisition, geography, technology, ga4Journeys, monetisation] = await Promise.all([
    provider.getOverview(activeRange),
    provider.getContentPerformance(activeRange),
    provider.getAcquisition(activeRange),
    provider.getGeography(activeRange),
    provider.getTechnology(activeRange),
    provider.getSiteJourneys(activeRange),
    provider.getMonetisation(activeRange),
  ]);

  return (
    <div>
      <PageHeader title="Analytics" description="How TechCarvalho's own visitors behave, plus (once connected) GA4." />

      {/* ================= TechCarvalho first-party analytics ================= */}
      <section className="mb-10">
        <div className="flex items-center gap-2 mb-1">
          <h2 className="text-base font-semibold text-neutral-900">TechCarvalho Analytics</h2>
          <Badge tone="green">First-party — no GA4 required</Badge>
        </div>
        <p className="text-sm text-neutral-500 mb-4">
          Our own event data (see <code className="text-xs bg-neutral-100 rounded px-1 py-0.5">analytics_events</code>{" "}
          — consent-gated, admin-only readable). Works independently of GA4 being configured or connected.
        </p>

        <div className="flex gap-2 mb-6">
          {RANGE_OPTIONS.map((opt) => (
            <Link
              key={opt.value}
              href={`/admin/analytics?range=${opt.value}`}
              className={`text-sm rounded-full px-3 py-1 border ${
                fpRange.preset === opt.value
                  ? "border-neutral-900 bg-neutral-900 text-white"
                  : "border-neutral-200 text-neutral-600 hover:border-neutral-400"
              }`}
            >
              {opt.label}
            </Link>
          ))}
          <form action="/admin/analytics" method="get" className="flex items-center gap-1.5 ml-1">
            <input type="hidden" name="range" value="custom" />
            <input
              type="date"
              name="from"
              defaultValue={fpRange.preset === "custom" ? fpRange.startDate : undefined}
              className="text-xs rounded border border-neutral-200 px-2 py-1"
              aria-label="Custom range start"
            />
            <span className="text-xs text-neutral-400">–</span>
            <input
              type="date"
              name="to"
              defaultValue={fpRange.preset === "custom" ? fpRange.endDate : undefined}
              className="text-xs rounded border border-neutral-200 px-2 py-1"
              aria-label="Custom range end"
            />
            <button
              type="submit"
              className={`text-sm rounded-full px-3 py-1 border ${
                fpRange.preset === "custom"
                  ? "border-neutral-900 bg-neutral-900 text-white"
                  : "border-neutral-200 text-neutral-600 hover:border-neutral-400"
              }`}
            >
              Go
            </button>
          </form>
          <span className="text-xs text-neutral-400 self-center ml-1">
            {fpRange.startDate === fpRange.endDate ? fpRange.startDate : `${fpRange.startDate} – ${fpRange.endDate}`}
          </span>
        </div>

        {fpHasError && <QueryErrorBanner message="One or more first-party analytics queries failed — see server logs. Numbers below may be incomplete." />}

        <HeadlineMetricsGrid metrics={headline} />

        <div className="mt-6">
          <Card className="p-5">
            <h3 className="text-sm font-semibold text-neutral-900 mb-1">Category comparison</h3>
            <p className="text-xs text-neutral-500 mb-3">
              Trend compares this period to the immediately preceding period of equal length. Categories with too
              little activity to call a trend show “—”.
            </p>
            <CategoryComparisonTable rows={categoryComparison.rows} labelBySlug={categoryLabelBySlug} />
          </Card>
        </div>

        <div className="grid gap-4 lg:grid-cols-2 mt-4">
          <Card className="p-5">
            <h3 className="text-sm font-semibold text-neutral-900 mb-3">Top articles</h3>
            <TopEntityTable rows={topContent} nameById={contentNameById} emptyLabel="No article views in this range yet." />
          </Card>
          <Card className="p-5">
            <h3 className="text-sm font-semibold text-neutral-900 mb-3">Top products</h3>
            <TopEntityTable rows={topProducts} nameById={productNameById} emptyLabel="No product views in this range yet." />
          </Card>
        </div>

        <div className="mt-4">
          <Card className="p-5">
            <h3 className="text-sm font-semibold text-neutral-900 mb-1">Search intelligence</h3>
            <p className="text-xs text-neutral-500 mb-3">
              What visitors are searching for — including what they search for that we don&apos;t have content for
              yet.
            </p>
            <SearchIntelligencePanel data={searchIntel.data} />
          </Card>
        </div>

        <div className="grid gap-4 lg:grid-cols-2 mt-4">
          <Card className="p-5">
            <h3 className="text-sm font-semibold text-neutral-900 mb-1">User journeys</h3>
            <p className="text-xs text-neutral-500 mb-3">Most common next-page transitions in this range.</p>
            <FpJourneysTable rows={journeys} />
          </Card>
          <Card className="p-5">
            <h3 className="text-sm font-semibold text-neutral-900 mb-3">Entry / exit pages</h3>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <div>
                <p className="text-xs font-medium text-neutral-500 mb-1">Entry pages</p>
                <PathCountTable rows={entryPages} />
              </div>
              <div>
                <p className="text-xs font-medium text-neutral-500 mb-1">Exit pages</p>
                <PathCountTable rows={exitPages} />
              </div>
            </div>
          </Card>
        </div>

        <div className="grid gap-4 lg:grid-cols-2 mt-4">
          <Card className="p-5">
            <h3 className="text-sm font-semibold text-neutral-900 mb-3">Engagement</h3>
            <EngagementGrid engagement={engagement} sessions={headline.sessions} />
          </Card>
          <MonetisationFunnelCard funnel={monetisationFunnel} />
        </div>
      </section>

      {/* ================= Google Analytics (GA4) ================= */}
      <section>
        <div className="flex items-center gap-2 mb-1">
          <h2 className="text-base font-semibold text-neutral-900">Google Analytics (GA4)</h2>
          <Badge tone={connected ? "green" : "neutral"}>{connected ? "Connected" : "Not connected"}</Badge>
        </div>
        <p className="text-sm text-neutral-500 mb-4">
          Independent acquisition, geography, device, and browser data from Google. Complements, not replaces, the
          first-party numbers above.
        </p>

        <Card className="p-5 mb-6 max-w-2xl">
          <div className="flex items-center gap-2 mb-2">
            <h3 className="text-sm font-semibold text-neutral-900">Setup status</h3>
            <Badge tone={configured ? "green" : "amber"}>{configured ? "GA4 measurement ID set" : "Not configured"}</Badge>
          </div>
          {configured ? (
            <p className="text-sm text-neutral-700">
              <code className="text-xs bg-neutral-100 rounded px-1 py-0.5">NEXT_PUBLIC_GA_MEASUREMENT_ID</code> is
              set, so the site sends GA4 events once a visitor consents to analytics. This dashboard itself still
              shows no numbers below — that requires a separate, server-side GA4 Data API connection (a Google Cloud
              service account with read access to this GA4 property), which is not configured yet. See{" "}
              <code className="text-xs bg-neutral-100 rounded px-1 py-0.5">docs/analytics-architecture.md</code> for
              the exact steps.
            </p>
          ) : (
            <p className="text-sm text-neutral-700">
              No analytics is active yet. Two separate things are needed, independently of each other:
            </p>
          )}
          {!configured && (
            <ul className="mt-2 text-sm text-neutral-700 list-disc list-inside space-y-1">
              <li>
                <span className="font-medium">To start collecting data:</span> set{" "}
                <code className="text-xs bg-neutral-100 rounded px-1 py-0.5">NEXT_PUBLIC_GA_MEASUREMENT_ID</code> in
                the deployment environment to a real GA4 measurement ID.
              </li>
              <li>
                <span className="font-medium">To populate this dashboard:</span> connect a GA4 Data API service
                account with read access to that property (a separate, later step — collection can start without
                it).
              </li>
            </ul>
          )}
        </Card>

        <div className="mb-6">
          <h3 className="text-xs font-medium uppercase tracking-wide text-neutral-500 mb-2">Date range</h3>
          <div className="flex gap-2">
            {ranges.map((range) => (
              <span
                key={range.label}
                className={`text-sm rounded-full px-3 py-1 border ${
                  range.label === activeRange.label
                    ? "border-neutral-900 bg-neutral-900 text-white"
                    : "border-neutral-200 text-neutral-500"
                }`}
              >
                {range.label}
              </span>
            ))}
          </div>
          <p className="text-xs text-neutral-400 mt-1">Selectable once a data source is connected.</p>
        </div>

        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4 mb-6">
          <StatTile label="Sessions" value={overview.sessions} />
          <StatTile label="Users" value={overview.users} />
          <StatTile label="Pageviews" value={overview.pageviews} />
          <StatTile label="Avg. engagement (s)" value={overview.avgEngagementSeconds} />
        </div>

        <div className="grid gap-4 lg:grid-cols-2">
          <SectionCard title="Content performance" connected={connected} hasRows={content.length > 0} emptyLabel="Top content by pageviews">
            <ContentTable rows={content} />
          </SectionCard>
          <SectionCard title="Acquisition" connected={connected} hasRows={acquisition.length > 0} emptyLabel="Traffic by channel">
            <AcquisitionTable rows={acquisition} />
          </SectionCard>
          <SectionCard title="Geography" connected={connected} hasRows={geography.length > 0} emptyLabel="Sessions by country">
            <GeographyTable rows={geography} />
          </SectionCard>
          <SectionCard title="Technology" connected={connected} hasRows={technology.length > 0} emptyLabel="Sessions by device and browser">
            <TechnologyTable rows={technology} />
          </SectionCard>
          <SectionCard title="Site journeys (GA4)" connected={connected} hasRows={ga4Journeys.length > 0} emptyLabel="Top entry and exit pages">
            <GA4JourneysTable rows={ga4Journeys} />
          </SectionCard>
          <Card className="p-5">
            <div className="flex items-center gap-2 mb-3">
              <h3 className="text-sm font-semibold text-neutral-900">Monetisation (baseline, consent-independent)</h3>
              {monetisation.affiliateClicks !== null ? (
                <Badge tone="green">Connected — first-party</Badge>
              ) : (
                <Badge tone="amber">Query failed — check server logs</Badge>
              )}
            </div>
            <p className="text-xs text-neutral-500 mb-3">
              From <code>outbound_click_events</code> — real, anonymous, and independent of both GA4 and analytics
              consent (see that table&apos;s own migration for why). For a session-correlated view of the same kind
              of activity (which products/categories actually drive affiliate clicks), see the Monetisation funnel
              in the TechCarvalho Analytics section above — that one only reflects consenting visitors, this one
              reflects everyone.
            </p>
            <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
              <StatTile label="Ad impressions" value={monetisation.adImpressions} />
              <StatTile label="Ad clicks" value={monetisation.adClicks} />
              <StatTile label="Affiliate clicks" value={monetisation.affiliateClicks} />
              <StatTile label="Outbound clicks" value={monetisation.outboundClicks} />
              <StatTile label="Product clicks" value={monetisation.productClicks} />
              <StatTile label="Article clicks" value={monetisation.articleClicks} />
            </div>
          </Card>
        </div>
      </section>
    </div>
  );
}

function ContentTable({ rows }: { rows: ContentPerformanceRow[] }) {
  return (
    <div className="overflow-x-auto">
      <table className="w-full text-sm">
        <tbody>
          {rows.map((row) => (
            <tr key={row.path}>
              <td className="py-1 text-neutral-700">{row.title ?? row.path}</td>
              <td className="py-1 text-right text-neutral-900 font-medium">{row.pageviews ?? "—"}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function AcquisitionTable({ rows }: { rows: AcquisitionRow[] }) {
  return (
    <div className="overflow-x-auto">
      <table className="w-full text-sm">
        <tbody>
          {rows.map((row) => (
            <tr key={row.channel}>
              <td className="py-1 text-neutral-700">{row.channel}</td>
              <td className="py-1 text-right text-neutral-900 font-medium">{row.sessions ?? "—"}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function GeographyTable({ rows }: { rows: GeographyRow[] }) {
  return (
    <div className="overflow-x-auto">
      <table className="w-full text-sm">
        <tbody>
          {rows.map((row) => (
            <tr key={row.country}>
              <td className="py-1 text-neutral-700">{row.country}</td>
              <td className="py-1 text-right text-neutral-900 font-medium">{row.sessions ?? "—"}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function TechnologyTable({ rows }: { rows: TechnologyRow[] }) {
  return (
    <div className="overflow-x-auto">
      <table className="w-full text-sm">
        <tbody>
          {rows.map((row) => (
            <tr key={`${row.dimension}-${row.label}`}>
              <td className="py-1 text-neutral-700">
                {row.label} <span className="text-neutral-400">({row.dimension})</span>
              </td>
              <td className="py-1 text-right text-neutral-900 font-medium">{row.sessions ?? "—"}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function GA4JourneysTable({ rows }: { rows: SiteJourneyRow[] }) {
  return (
    <div className="overflow-x-auto">
      <table className="w-full text-sm">
        <thead>
          <tr>
            <th className="text-left font-medium text-neutral-500 pb-1">Page</th>
            <th className="text-right font-medium text-neutral-500 pb-1">Entrances</th>
            <th className="text-right font-medium text-neutral-500 pb-1">Exits</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => (
            <tr key={row.path}>
              <td className="py-1 text-neutral-700">{row.path}</td>
              <td className="py-1 text-right text-neutral-900 font-medium">{row.entrances ?? "—"}</td>
              <td className="py-1 text-right text-neutral-900 font-medium">{row.exits ?? "—"}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
