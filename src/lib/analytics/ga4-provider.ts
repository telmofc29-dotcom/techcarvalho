import "server-only";
import { BetaAnalyticsDataClient } from "@google-analytics/data";
import type {
  AnalyticsDataProvider,
  DateRange,
  OverviewMetrics,
  ContentPerformanceRow,
  AcquisitionRow,
  GeographyRow,
  TechnologyRow,
  SiteJourneyRow,
  MonetisationSummary,
} from "./dashboard-types";
import { getFirstPartyMonetisation } from "./first-party-monetisation";

// GA4 Data API–backed provider — implements the same AnalyticsDataProvider
// interface NullAnalyticsProvider does, so getAnalyticsDataProvider() can
// swap between them purely based on whether credentials exist, with zero
// changes anywhere in /admin/analytics itself.
//
// UNTESTED against a real GA4 property — no service-account credential
// exists in this environment to exercise it against. Written directly
// against the GA4 Data API's documented runReport dimension/metric names
// (https://developers.google.com/analytics/devguides/reporting/data/v1/api-schema),
// which are stable and well-documented, but this should get one real
// smoke test (e.g. the "Last 7 days" overview card actually rendering
// real numbers) once GA4_* env vars are configured — see this file's own
// getGa4Credentials() for exactly which three values are required and
// docs/analytics-architecture.md for the full manual setup walkthrough.
//
// Credentials are read from server-only env vars — GA4_SERVICE_ACCOUNT_EMAIL
// and GA4_SERVICE_ACCOUNT_PRIVATE_KEY must NEVER be prefixed NEXT_PUBLIC_
// (that would ship them to every visitor's browser JS bundle) and must
// only ever be read here, in server-only code, never passed to a Client
// Component.

export function getGa4Credentials(): { propertyId: string; clientEmail: string; privateKey: string } | null {
  const propertyId = process.env.GA4_PROPERTY_ID;
  const clientEmail = process.env.GA4_SERVICE_ACCOUNT_EMAIL;
  // Service account private keys from Google's JSON key file contain
  // literal "\n" sequences that survive JSON-stringification but not a
  // plain .env value — env vars can't hold real newlines cleanly, so the
  // deployment environment variable is expected to have escaped \n
  // sequences, unescaped here before use (the standard, documented
  // workaround for this exact Google-credential-in-env-var problem).
  const privateKeyRaw = process.env.GA4_SERVICE_ACCOUNT_PRIVATE_KEY;

  if (!propertyId || !clientEmail || !privateKeyRaw) return null;

  return { propertyId, clientEmail, privateKey: privateKeyRaw.replace(/\\n/g, "\n") };
}

function toGa4DateRange(range: DateRange) {
  return { startDate: range.startDate, endDate: range.endDate };
}

function firstNumber(value: string | null | undefined): number | null {
  if (value === null || value === undefined) return null;
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}

export class Ga4DataApiProvider implements AnalyticsDataProvider {
  private client: BetaAnalyticsDataClient;
  private propertyPath: string;

  constructor(credentials: { propertyId: string; clientEmail: string; privateKey: string }) {
    this.client = new BetaAnalyticsDataClient({
      credentials: { client_email: credentials.clientEmail, private_key: credentials.privateKey },
    });
    this.propertyPath = `properties/${credentials.propertyId}`;
  }

  isConnected(): boolean {
    return true;
  }

  async getOverview(range: DateRange): Promise<OverviewMetrics> {
    try {
      const [response] = await this.client.runReport({
        property: this.propertyPath,
        dateRanges: [toGa4DateRange(range)],
        metrics: [
          { name: "sessions" },
          { name: "totalUsers" },
          { name: "screenPageViews" },
          { name: "averageSessionDuration" },
        ],
      });
      const row = response.rows?.[0]?.metricValues;
      return {
        sessions: firstNumber(row?.[0]?.value),
        users: firstNumber(row?.[1]?.value),
        pageviews: firstNumber(row?.[2]?.value),
        avgEngagementSeconds: firstNumber(row?.[3]?.value),
      };
    } catch (e) {
      console.error("[ga4] getOverview failed", e);
      return { sessions: null, users: null, pageviews: null, avgEngagementSeconds: null };
    }
  }

  async getContentPerformance(range: DateRange): Promise<ContentPerformanceRow[]> {
    try {
      const [response] = await this.client.runReport({
        property: this.propertyPath,
        dateRanges: [toGa4DateRange(range)],
        dimensions: [{ name: "pagePath" }, { name: "pageTitle" }],
        metrics: [{ name: "screenPageViews" }],
        orderBys: [{ metric: { metricName: "screenPageViews" }, desc: true }],
        limit: 25,
      });
      return (response.rows ?? []).map((r) => ({
        path: r.dimensionValues?.[0]?.value ?? "",
        title: r.dimensionValues?.[1]?.value ?? null,
        pageviews: firstNumber(r.metricValues?.[0]?.value),
      }));
    } catch (e) {
      console.error("[ga4] getContentPerformance failed", e);
      return [];
    }
  }

  async getAcquisition(range: DateRange): Promise<AcquisitionRow[]> {
    try {
      const [response] = await this.client.runReport({
        property: this.propertyPath,
        dateRanges: [toGa4DateRange(range)],
        dimensions: [{ name: "sessionDefaultChannelGroup" }],
        metrics: [{ name: "sessions" }],
        orderBys: [{ metric: { metricName: "sessions" }, desc: true }],
      });
      return (response.rows ?? []).map((r) => ({
        channel: r.dimensionValues?.[0]?.value ?? "Unknown",
        sessions: firstNumber(r.metricValues?.[0]?.value),
      }));
    } catch (e) {
      console.error("[ga4] getAcquisition failed", e);
      return [];
    }
  }

  async getGeography(range: DateRange): Promise<GeographyRow[]> {
    try {
      const [response] = await this.client.runReport({
        property: this.propertyPath,
        dateRanges: [toGa4DateRange(range)],
        dimensions: [{ name: "country" }, { name: "city" }],
        metrics: [{ name: "sessions" }],
        orderBys: [{ metric: { metricName: "sessions" }, desc: true }],
        limit: 25,
      });
      return (response.rows ?? []).map((r) => ({
        country: r.dimensionValues?.[0]?.value ?? "Unknown",
        city: r.dimensionValues?.[1]?.value ?? null,
        sessions: firstNumber(r.metricValues?.[0]?.value),
      }));
    } catch (e) {
      console.error("[ga4] getGeography failed", e);
      return [];
    }
  }

  async getTechnology(range: DateRange): Promise<TechnologyRow[]> {
    try {
      const [deviceRes, browserRes, osRes] = await Promise.all([
        this.client.runReport({
          property: this.propertyPath,
          dateRanges: [toGa4DateRange(range)],
          dimensions: [{ name: "deviceCategory" }],
          metrics: [{ name: "sessions" }],
        }),
        this.client.runReport({
          property: this.propertyPath,
          dateRanges: [toGa4DateRange(range)],
          dimensions: [{ name: "browser" }],
          metrics: [{ name: "sessions" }],
          orderBys: [{ metric: { metricName: "sessions" }, desc: true }],
          limit: 10,
        }),
        this.client.runReport({
          property: this.propertyPath,
          dateRanges: [toGa4DateRange(range)],
          dimensions: [{ name: "operatingSystem" }],
          metrics: [{ name: "sessions" }],
          orderBys: [{ metric: { metricName: "sessions" }, desc: true }],
          limit: 10,
        }),
      ]);
      const rows: TechnologyRow[] = [];
      for (const r of deviceRes[0].rows ?? [])
        rows.push({ dimension: "device", label: r.dimensionValues?.[0]?.value ?? "Unknown", sessions: firstNumber(r.metricValues?.[0]?.value) });
      for (const r of browserRes[0].rows ?? [])
        rows.push({ dimension: "browser", label: r.dimensionValues?.[0]?.value ?? "Unknown", sessions: firstNumber(r.metricValues?.[0]?.value) });
      for (const r of osRes[0].rows ?? [])
        rows.push({ dimension: "os", label: r.dimensionValues?.[0]?.value ?? "Unknown", sessions: firstNumber(r.metricValues?.[0]?.value) });
      return rows;
    } catch (e) {
      console.error("[ga4] getTechnology failed", e);
      return [];
    }
  }

  async getSiteJourneys(range: DateRange): Promise<SiteJourneyRow[]> {
    try {
      const [entrancesRes, exitsRes] = await Promise.all([
        this.client.runReport({
          property: this.propertyPath,
          dateRanges: [toGa4DateRange(range)],
          dimensions: [{ name: "landingPagePlusQueryString" }],
          metrics: [{ name: "sessions" }],
          orderBys: [{ metric: { metricName: "sessions" }, desc: true }],
          limit: 25,
        }),
        this.client.runReport({
          property: this.propertyPath,
          dateRanges: [toGa4DateRange(range)],
          dimensions: [{ name: "pagePath" }],
          metrics: [{ name: "exits" }],
          orderBys: [{ metric: { metricName: "exits" }, desc: true }],
          limit: 25,
        }),
      ]);
      const byPath = new Map<string, SiteJourneyRow>();
      for (const r of entrancesRes[0].rows ?? []) {
        const path = r.dimensionValues?.[0]?.value ?? "";
        byPath.set(path, { path, entrances: firstNumber(r.metricValues?.[0]?.value), exits: null });
      }
      for (const r of exitsRes[0].rows ?? []) {
        const path = r.dimensionValues?.[0]?.value ?? "";
        const existing = byPath.get(path);
        if (existing) existing.exits = firstNumber(r.metricValues?.[0]?.value);
        else byPath.set(path, { path, entrances: null, exits: firstNumber(r.metricValues?.[0]?.value) });
      }
      return [...byPath.values()];
    } catch (e) {
      console.error("[ga4] getSiteJourneys failed", e);
      return [];
    }
  }

  // Monetisation stays first-party-backed even for this provider — GA4
  // doesn't know about our affiliate/outbound click taxonomy at all, and
  // ad metrics require a linked Ad Manager/AdSense account beyond plain
  // GA4 Data API scope. Keeping this identical to NullAnalyticsProvider's
  // own delegation means the dashboard's monetisation section behaves the
  // same regardless of which provider is active.
  async getMonetisation(range: DateRange): Promise<MonetisationSummary> {
    return getFirstPartyMonetisation(range);
  }
}
