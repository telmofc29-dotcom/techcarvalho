import { requireAdmin } from "@/lib/dal";
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
import { PageHeader, Card, Badge } from "@/components/admin/ui";

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

export default async function AdminAnalyticsPage() {
  await requireAdmin();

  const configured = isAnalyticsConfiguredServer();
  const provider = getAnalyticsDataProvider();
  const connected = provider.isConnected();
  const ranges = getDefaultDateRanges();
  const activeRange = ranges[1]; // "Last 28 days" default

  const [overview, content, acquisition, geography, technology, journeys, monetisation] = await Promise.all([
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
      <PageHeader title="Analytics" description="Traffic, acquisition, content, and monetisation performance." />

      <Card className="p-5 mb-6 max-w-2xl">
        <div className="flex items-center gap-2 mb-2">
          <h2 className="text-sm font-semibold text-neutral-900">Setup status</h2>
          <Badge tone={configured ? "green" : "amber"}>{configured ? "GA4 measurement ID set" : "Not configured"}</Badge>
        </div>
        {configured ? (
          <p className="text-sm text-neutral-700">
            <code className="text-xs bg-neutral-100 rounded px-1 py-0.5">NEXT_PUBLIC_GA_MEASUREMENT_ID</code> is set,
            so the site sends GA4 events once a visitor consents to analytics. This dashboard itself still shows no
            numbers below — that requires a separate, server-side GA4 Data API connection (a Google Cloud service
            account with read access to this GA4 property), which is not configured yet. See{" "}
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
        <h2 className="text-xs font-medium uppercase tracking-wide text-neutral-500 mb-2">Date range</h2>
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
        <SectionCard title="Site journeys" connected={connected} hasRows={journeys.length > 0} emptyLabel="Top entry and exit pages">
          <JourneysTable rows={journeys} />
        </SectionCard>
        <Card className="p-5">
          <div className="flex items-center gap-2 mb-3">
            <h2 className="text-sm font-semibold text-neutral-900">Monetisation</h2>
            {monetisation.affiliateClicks !== null ? (
              <Badge tone="green">Connected — first-party</Badge>
            ) : (
              <Badge tone="amber">Query failed — check server logs</Badge>
            )}
          </div>
          <p className="text-xs text-neutral-500 mb-3">
            Affiliate/outbound clicks come from our own <code>outbound_click_events</code> table — real, and
            independent of GA4 being configured. Ad impressions/clicks need an ad network wired up (none yet);
            product/article click-through counts need first-party tracking this app doesn&apos;t capture yet — both
            stay honestly blank rather than approximated.
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

function JourneysTable({ rows }: { rows: SiteJourneyRow[] }) {
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
