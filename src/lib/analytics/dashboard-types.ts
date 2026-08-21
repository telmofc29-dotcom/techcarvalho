import "server-only";
import { createClient } from "@/lib/supabase/server";

// Shapes the admin analytics dashboard renders, independent of where the
// numbers eventually come from. Every numeric field is nullable — `null`
// means "not available" (not connected, or the provider couldn't answer),
// never a fabricated 0. A future GA4 Data API–backed provider implements
// AnalyticsDataProvider and the page doesn't change.

export type DateRange = {
  label: string;
  startDate: string; // YYYY-MM-DD
  endDate: string; // YYYY-MM-DD
};

export type OverviewMetrics = {
  sessions: number | null;
  users: number | null;
  pageviews: number | null;
  avgEngagementSeconds: number | null;
};

export type ContentPerformanceRow = {
  path: string;
  title: string | null;
  pageviews: number | null;
};

export type AcquisitionRow = {
  channel: string; // e.g. "Organic Search", "Direct", "Referral"
  sessions: number | null;
};

export type GeographyRow = {
  country: string;
  // Optional finer breakdown — GA4 can report city-level data; not every
  // provider/plan will, so this stays optional rather than forcing every
  // row to carry it.
  city?: string | null;
  sessions: number | null;
};

export type TechnologyRow = {
  dimension: "device" | "browser" | "os";
  label: string; // e.g. "Mobile", "Chrome", "iOS"
  sessions: number | null;
};

export type SiteJourneyRow = {
  path: string;
  entrances: number | null;
  exits: number | null;
};

export type MonetisationSummary = {
  adImpressions: number | null;
  adClicks: number | null;
  affiliateClicks: number | null;
  // Outbound clicks that aren't affiliate (e.g. a manufacturer website
  // link), and clicks through to a product/article page from elsewhere on
  // the site — see src/lib/analytics/events.ts (outbound_link_click,
  // product_click) and the first-party public.outbound_click_events table
  // for the two independent sources these could eventually be backed by.
  outboundClicks: number | null;
  productClicks: number | null;
  articleClicks: number | null;
};

// One adapter call per dashboard section, all async so a real network-backed
// provider (GA4 Data API) fits the same shape as the null provider below.
export interface AnalyticsDataProvider {
  isConnected(): boolean;
  getOverview(range: DateRange): Promise<OverviewMetrics>;
  getContentPerformance(range: DateRange): Promise<ContentPerformanceRow[]>;
  getAcquisition(range: DateRange): Promise<AcquisitionRow[]>;
  getGeography(range: DateRange): Promise<GeographyRow[]>;
  getTechnology(range: DateRange): Promise<TechnologyRow[]>;
  getSiteJourneys(range: DateRange): Promise<SiteJourneyRow[]>;
  getMonetisation(range: DateRange): Promise<MonetisationSummary>;
}

// Active whenever no GA4 Data API credentials exist (i.e. always, today).
// Returns explicit "not available" shapes for everything GA4-derived — the
// page is responsible for rendering those as a setup state, not as
// empty/zeroed real data. getMonetisation() is the one exception: it's
// backed by our own first-party outbound_click_events table (see
// getFirstPartyMonetisation below), which has nothing to do with GA4 being
// configured — this class isn't purely "null" for that one method, kept
// here rather than as a separate provider so the dashboard page doesn't
// need two providers wired in for one section.
export class NullAnalyticsProvider implements AnalyticsDataProvider {
  isConnected(): boolean {
    return false;
  }
  async getOverview(): Promise<OverviewMetrics> {
    return { sessions: null, users: null, pageviews: null, avgEngagementSeconds: null };
  }
  async getContentPerformance(): Promise<ContentPerformanceRow[]> {
    return [];
  }
  async getAcquisition(): Promise<AcquisitionRow[]> {
    return [];
  }
  async getGeography(): Promise<GeographyRow[]> {
    return [];
  }
  async getTechnology(): Promise<TechnologyRow[]> {
    return [];
  }
  async getSiteJourneys(): Promise<SiteJourneyRow[]> {
    return [];
  }
  async getMonetisation(range: DateRange): Promise<MonetisationSummary> {
    return getFirstPartyMonetisation(range);
  }
}

// Real, first-party monetisation counts from public.outbound_click_events —
// no GA4/Google credentials involved, this table is entirely our own and
// already applied to production (supabase/migrations/20260820_outbound_
// click_events.sql). Only affiliateClicks/outboundClicks are backed by a
// real table today: adImpressions/adClicks (no ad network wired up yet) and
// productClicks/articleClicks (no first-party internal-navigation-click
// table exists — only outbound/affiliate clicks are captured) stay null,
// honestly, rather than being approximated from a column that doesn't
// actually measure them.
export async function getFirstPartyMonetisation(range: DateRange): Promise<MonetisationSummary> {
  const supabase = await createClient();
  const endExclusive = new Date(`${range.endDate}T00:00:00.000Z`);
  endExclusive.setUTCDate(endExclusive.getUTCDate() + 1);

  const [{ count: affiliateClicks, error: affiliateError }, { count: outboundClicks, error: outboundError }] =
    await Promise.all([
      supabase
        .from("outbound_click_events")
        .select("id", { count: "exact", head: true })
        .eq("kind", "affiliate")
        .gte("created_at", `${range.startDate}T00:00:00.000Z`)
        .lt("created_at", endExclusive.toISOString()),
      supabase
        .from("outbound_click_events")
        .select("id", { count: "exact", head: true })
        .eq("kind", "outbound")
        .gte("created_at", `${range.startDate}T00:00:00.000Z`)
        .lt("created_at", endExclusive.toISOString()),
    ]);

  // RLS restricts SELECT on this table to admins (see the migration's own
  // header comment) — a query failure here (e.g. called without an admin
  // session) degrades to "not available", never a fabricated 0, same
  // honesty rule as every other field on this type.
  const failed = Boolean(affiliateError || outboundError);

  return {
    adImpressions: null,
    adClicks: null,
    affiliateClicks: failed ? null : (affiliateClicks ?? 0),
    outboundClicks: failed ? null : (outboundClicks ?? 0),
    productClicks: null,
    articleClicks: null,
  };
}

// Fixed set of selectable date ranges for the (currently inert) date-range
// selector — real values once a real provider computes them.
export function getDefaultDateRanges(): DateRange[] {
  const today = new Date();
  const iso = (d: Date) => d.toISOString().slice(0, 10);
  const daysAgo = (n: number) => {
    const d = new Date(today);
    d.setDate(d.getDate() - n);
    return d;
  };
  return [
    { label: "Last 7 days", startDate: iso(daysAgo(7)), endDate: iso(today) },
    { label: "Last 28 days", startDate: iso(daysAgo(28)), endDate: iso(today) },
    { label: "Last 90 days", startDate: iso(daysAgo(90)), endDate: iso(today) },
  ];
}

// Single place that decides which provider implementation backs the
// dashboard. Today this always returns the null provider — swap this
// function's body for a GA4 Data API–backed provider once credentials
// exist; nothing else in the dashboard needs to change.
export function getAnalyticsDataProvider(): AnalyticsDataProvider {
  return new NullAnalyticsProvider();
}
