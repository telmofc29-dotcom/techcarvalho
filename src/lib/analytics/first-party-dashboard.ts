import "server-only";
import { createClient } from "@/lib/supabase/server";
import type { AnalyticsEventType } from "@/lib/types/database";

// Query layer for /admin/analytics' "TechCarvalho Analytics" zone — the
// first-party system (supabase/migrations_pending/20260821_first_party_analytics.sql),
// entirely separate from GA4/dashboard-types.ts's AnalyticsDataProvider
// (which stays untouched) and from outbound_click_events/
// getFirstPartyMonetisation() (also untouched — that stays the
// consent-independent baseline, shown alongside, not replaced).
//
// Strategy: for each requested range this fetches raw analytics_events +
// their analytics_sessions once (loadRangeData), then every section below
// derives its numbers from that same in-memory dataset — one pair of
// round trips serves the whole dashboard instead of N separate queries,
// and guarantees every section agrees on the same underlying rows. This
// queries analytics_events directly rather than preferring
// analytics_daily_rollups for past-only ranges, which the rollup table
// exists specifically to make fast — a deliberate shortcut, correct at
// today's traffic scale (near-zero), explicitly called out in this
// batch's own build directive as acceptable for now. If TechCarvalho's
// traffic grows enough that this table scan becomes slow, switch
// non-today-inclusive ranges to read analytics_daily_rollups instead
// (same dimension_key/dimension_type shape as the grouping done here) —
// the rollup table and its nightly cron already exist and don't need
// building, only wiring in here.
//
// The 10,000-row cap on both fetches is the other today's-scale
// shortcut: fine while traffic is low, should become server-side
// aggregation (SQL group-by / the rollup table) before it would ever
// silently truncate a real, busy day.

const RAW_FETCH_LIMIT = 10000;
const MIN_TREND_VOLUME = 5; // Below this, a % change is noise, not a trend
// (a 1-view-to-2-view jump is technically "+100%" and meaningless) — see
// getTrend() below. Chosen as a small, defensible floor for a young,
// low-traffic site rather than a statistically derived threshold; revisit
// once real traffic volume exists to base it on actual variance.

export type FpDateRange = { startDate: string; endDate: string };

export type FpDatePreset = "today" | "7d" | "28d" | "90d" | "custom";

export type FpDateRangeSelection = FpDateRange & { preset: FpDatePreset; label: string };

function isoDate(d: Date): string {
  return d.toISOString().slice(0, 10);
}

function startIso(date: string): string {
  return `${date}T00:00:00.000Z`;
}

function endExclusiveIso(date: string): string {
  const d = new Date(`${date}T00:00:00.000Z`);
  d.setUTCDate(d.getUTCDate() + 1);
  return d.toISOString();
}

// Resolves ?range=today|7d|28d|90d|custom&from=YYYY-MM-DD&to=YYYY-MM-DD into
// a concrete date range — the Server-Component-searchParams pattern already
// used elsewhere in this admin (see products/page.tsx's q/published/category
// params), not a client-side date-picker library.
export function resolveDateRangeSelection(searchParams: {
  range?: string;
  from?: string;
  to?: string;
}): FpDateRangeSelection {
  const today = new Date();
  const todayStr = isoDate(today);
  const daysAgo = (n: number) => {
    const d = new Date(today);
    d.setUTCDate(d.getUTCDate() - n);
    return isoDate(d);
  };

  const preset = (searchParams.range as FpDatePreset) ?? "7d";

  if (preset === "custom" && searchParams.from && searchParams.to) {
    return { preset: "custom", label: "Custom range", startDate: searchParams.from, endDate: searchParams.to };
  }
  if (preset === "today") return { preset: "today", label: "Today", startDate: todayStr, endDate: todayStr };
  if (preset === "90d") return { preset: "90d", label: "Last 90 days", startDate: daysAgo(89), endDate: todayStr };
  if (preset === "28d") return { preset: "28d", label: "Last 28 days", startDate: daysAgo(27), endDate: todayStr };
  return { preset: "7d", label: "Last 7 days", startDate: daysAgo(6), endDate: todayStr };
}

// The immediately preceding period of equal length — the comparison basis
// for every "trend"/"rising" figure in this file. E.g. for a 7-day range
// [Aug 15..21], this returns [Aug 8..14], not a calendar-month or
// lifetime-total comparison.
export function previousPeriod(range: FpDateRange): FpDateRange {
  const start = new Date(startIso(range.startDate));
  const end = new Date(startIso(range.endDate));
  const spanDays = Math.round((end.getTime() - start.getTime()) / 86_400_000) + 1;
  const prevEnd = new Date(start);
  prevEnd.setUTCDate(prevEnd.getUTCDate() - 1);
  const prevStart = new Date(prevEnd);
  prevStart.setUTCDate(prevStart.getUTCDate() - (spanDays - 1));
  return { startDate: isoDate(prevStart), endDate: isoDate(prevEnd) };
}

// current/previous in, a signed % (rounded) or null when below the volume
// floor on the current side (nothing meaningful to say yet) out.
export function getTrend(current: number, previous: number): number | null {
  if (current < MIN_TREND_VOLUME) return null;
  if (previous === 0) return current >= MIN_TREND_VOLUME ? 100 : null;
  return Math.round(((current - previous) / previous) * 100);
}

export type FpEventRow = {
  id: string;
  session_id: string;
  event_type: AnalyticsEventType;
  path: string;
  entity_type: string | null;
  product_id: string | null;
  content_id: string | null;
  manufacturer_id: string | null;
  category_slug: string | null;
  metadata: Record<string, unknown>;
  created_at: string;
};

export type FpSessionRow = {
  id: string;
  visitor_id: string | null;
  started_at: string;
  last_seen_at: string;
  entry_path: string;
  referrer_host: string | null;
  utm_source: string | null;
  utm_medium: string | null;
  utm_campaign: string | null;
  device_type: string | null;
  is_admin: boolean;
};

export type FpRangeData = {
  events: FpEventRow[];
  sessionsById: Map<string, FpSessionRow>;
  hasError: boolean;
};

const EMPTY_RANGE_DATA: FpRangeData = { events: [], sessionsById: new Map(), hasError: false };

export async function loadRangeData(range: FpDateRange): Promise<FpRangeData> {
  const supabase = await createClient();

  const { data: eventRows, error: eventsError } = await supabase
    .from("analytics_events")
    .select("id, session_id, event_type, path, entity_type, product_id, content_id, manufacturer_id, category_slug, metadata, created_at")
    .gte("created_at", startIso(range.startDate))
    .lt("created_at", endExclusiveIso(range.endDate))
    .order("created_at", { ascending: true })
    .limit(RAW_FETCH_LIMIT);

  if (eventsError) {
    return { ...EMPTY_RANGE_DATA, hasError: true };
  }
  const events = (eventRows ?? []) as FpEventRow[];
  if (events.length === 0) return EMPTY_RANGE_DATA;

  const sessionIds = [...new Set(events.map((e) => e.session_id))];
  const { data: sessionRows, error: sessionsError } = await supabase
    .from("analytics_sessions")
    .select("id, visitor_id, started_at, last_seen_at, entry_path, referrer_host, utm_source, utm_medium, utm_campaign, device_type, is_admin")
    .in("id", sessionIds);

  if (sessionsError) {
    return { ...EMPTY_RANGE_DATA, hasError: true };
  }

  // Defense in depth (see the migration's own header comment): the
  // ingestion endpoint never creates a session/event for an
  // admin-authenticated request in the first place, so this should
  // exclude nothing in practice — but a dashboard reporting real numbers
  // shouldn't rely solely on an upstream promise it can't verify itself.
  const nonAdminSessions = (sessionRows ?? []).filter((s) => !s.is_admin);
  const sessionsById = new Map(nonAdminSessions.map((s) => [s.id, s as FpSessionRow]));
  const filteredEvents = events.filter((e) => sessionsById.has(e.session_id));

  return { events: filteredEvents, sessionsById, hasError: false };
}

// ---- Headline metrics ----

export type FpHeadlineMetrics = {
  sessions: number;
  pageViews: number;
  articleViews: number;
  productViews: number;
  searches: number;
  internalClicks: number;
  outboundClicks: number;
  affiliateClicks: number;
};

export function computeHeadlineMetrics(data: FpRangeData): FpHeadlineMetrics {
  const sessions = new Set(data.events.map((e) => e.session_id)).size;
  let pageViews = 0;
  let articleViews = 0;
  let productViews = 0;
  let searches = 0;
  let internalClicks = 0;
  let outboundClicks = 0;
  let affiliateClicks = 0;

  for (const e of data.events) {
    switch (e.event_type) {
      case "page_view":
        pageViews++;
        if (e.entity_type === "content") articleViews++;
        if (e.entity_type === "product") productViews++;
        break;
      case "search":
        searches++;
        break;
      case "internal_link_click":
      case "related_content_click":
      case "navigation_click":
      case "search_result_click":
      case "cta_click":
        internalClicks++;
        break;
      case "outbound_link_click":
        outboundClicks++;
        break;
      case "affiliate_click":
        affiliateClicks++;
        break;
    }
  }

  return { sessions, pageViews, articleViews, productViews, searches, internalClicks, outboundClicks, affiliateClicks };
}

// ---- Category comparison / Most Popular / Trending Areas ----

export type FpCategoryRow = {
  slug: string;
  views: number;
  sessions: number;
  contentClicks: number;
  searches: number;
  affiliateOutboundClicks: number;
  trend: number | null;
};

function categoryStatsFromEvents(events: FpEventRow[]): Map<string, { views: number; sessions: Set<string>; contentClicks: number; affiliateOutboundClicks: number }> {
  const map = new Map<string, { views: number; sessions: Set<string>; contentClicks: number; affiliateOutboundClicks: number }>();
  const get = (slug: string) => {
    let row = map.get(slug);
    if (!row) {
      row = { views: 0, sessions: new Set(), contentClicks: 0, affiliateOutboundClicks: 0 };
      map.set(slug, row);
    }
    return row;
  };
  for (const e of events) {
    if (!e.category_slug) continue;
    const row = get(e.category_slug);
    row.sessions.add(e.session_id);
    if (e.event_type === "page_view") row.views++;
    else if (e.event_type === "affiliate_click" || e.event_type === "outbound_link_click") row.affiliateOutboundClicks++;
    else if (e.event_type !== "search") row.contentClicks++;
  }
  return map;
}

// Searches don't carry category_slug directly (a search spans all
// content), so "Searches" per category is approximated as: searches in a
// session that also viewed that category at some point in the range —
// a reasonable, explainable proxy rather than a precise attribution model.
function searchesByCategory(events: FpEventRow[]): Map<string, number> {
  const sessionCategories = new Map<string, Set<string>>();
  for (const e of events) {
    if (!e.category_slug) continue;
    let set = sessionCategories.get(e.session_id);
    if (!set) {
      set = new Set();
      sessionCategories.set(e.session_id, set);
    }
    set.add(e.category_slug);
  }
  const counts = new Map<string, number>();
  for (const e of events) {
    if (e.event_type !== "search") continue;
    const cats = sessionCategories.get(e.session_id);
    if (!cats) continue;
    for (const slug of cats) counts.set(slug, (counts.get(slug) ?? 0) + 1);
  }
  return counts;
}

export async function getCategoryComparison(
  categorySlugs: string[],
  range: FpDateRange
): Promise<{ rows: FpCategoryRow[]; hasError: boolean }> {
  const [current, previous] = await Promise.all([loadRangeData(range), loadRangeData(previousPeriod(range))]);
  if (current.hasError || previous.hasError) return { rows: [], hasError: true };

  const currentStats = categoryStatsFromEvents(current.events);
  const previousStats = categoryStatsFromEvents(previous.events);
  const currentSearches = searchesByCategory(current.events);

  const rows: FpCategoryRow[] = categorySlugs.map((slug) => {
    const cur = currentStats.get(slug);
    const prev = previousStats.get(slug);
    return {
      slug,
      views: cur?.views ?? 0,
      sessions: cur?.sessions.size ?? 0,
      contentClicks: cur?.contentClicks ?? 0,
      searches: currentSearches.get(slug) ?? 0,
      affiliateOutboundClicks: cur?.affiliateOutboundClicks ?? 0,
      trend: getTrend(cur?.views ?? 0, prev?.views ?? 0),
    };
  });

  return { rows, hasError: false };
}

// ---- Top Content / Top Products ----

export type FpTopEntityRow = {
  id: string;
  views: number;
  sessions: number;
  engagementRate: number | null; // share of viewing sessions that also generated an internal click for this entity
};

function topEntities(events: FpEventRow[], entityType: "content" | "product", idField: "content_id" | "product_id", limit: number): FpTopEntityRow[] {
  const stats = new Map<string, { views: number; sessions: Set<string>; engagedSessions: Set<string> }>();
  for (const e of events) {
    const id = e[idField];
    if (!id) continue;
    let row = stats.get(id);
    if (!row) {
      row = { views: 0, sessions: new Set(), engagedSessions: new Set() };
      stats.set(id, row);
    }
    if (e.event_type === "page_view" && e.entity_type === entityType) {
      row.views++;
      row.sessions.add(e.session_id);
    } else if (
      e.event_type === "internal_link_click" ||
      e.event_type === "related_content_click" ||
      e.event_type === "outbound_link_click" ||
      e.event_type === "affiliate_click"
    ) {
      row.engagedSessions.add(e.session_id);
    }
  }
  return [...stats.entries()]
    .filter(([, v]) => v.views > 0)
    .map(([id, v]) => ({
      id,
      views: v.views,
      sessions: v.sessions.size,
      engagementRate: v.sessions.size > 0 ? Math.round((v.engagedSessions.size / v.sessions.size) * 100) : null,
    }))
    .sort((a, b) => b.views - a.views)
    .slice(0, limit);
}

export function getTopContent(data: FpRangeData, limit = 10): FpTopEntityRow[] {
  return topEntities(data.events, "content", "content_id", limit);
}
export function getTopProducts(data: FpRangeData, limit = 10): FpTopEntityRow[] {
  return topEntities(data.events, "product", "product_id", limit);
}

// ---- Search Intelligence ----

export type FpSearchTermRow = { query: string; count: number; trend: number | null };
export type FpSearchIntelligence = {
  topSearches: FpSearchTermRow[];
  zeroResultSearches: FpSearchTermRow[];
  noClickSearches: FpSearchTermRow[]; // had results, nobody clicked a result in the same session
  risingSearches: FpSearchTermRow[];
};

function normalizeQuery(raw: unknown): string | null {
  if (typeof raw !== "string") return null;
  const q = raw.trim().toLowerCase();
  return q.length > 0 ? q : null;
}

function searchCounts(events: FpEventRow[]): Map<string, number> {
  const counts = new Map<string, number>();
  for (const e of events) {
    if (e.event_type !== "search") continue;
    const q = normalizeQuery(e.metadata?.query);
    if (!q) continue;
    counts.set(q, (counts.get(q) ?? 0) + 1);
  }
  return counts;
}

export async function getSearchIntelligence(range: FpDateRange, limit = 10): Promise<{ data: FpSearchIntelligence; hasError: boolean }> {
  const [current, previous] = await Promise.all([loadRangeData(range), loadRangeData(previousPeriod(range))]);
  const empty: FpSearchIntelligence = { topSearches: [], zeroResultSearches: [], noClickSearches: [], risingSearches: [] };
  if (current.hasError || previous.hasError) return { data: empty, hasError: true };

  const currentCounts = searchCounts(current.events);
  const previousCounts = searchCounts(previous.events);

  const topSearches = [...currentCounts.entries()]
    .map(([query, count]) => ({ query, count, trend: getTrend(count, previousCounts.get(query) ?? 0) }))
    .sort((a, b) => b.count - a.count)
    .slice(0, limit);

  const zeroResultCounts = new Map<string, number>();
  const searchedQueriesBySession = new Map<string, Set<string>>();
  const clickedQueriesBySession = new Map<string, Set<string>>();

  for (const e of current.events) {
    if (e.event_type === "search") {
      const q = normalizeQuery(e.metadata?.query);
      if (!q) continue;
      const resultCount = typeof e.metadata?.result_count === "number" ? e.metadata.result_count : null;
      if (resultCount === 0) zeroResultCounts.set(q, (zeroResultCounts.get(q) ?? 0) + 1);
      let set = searchedQueriesBySession.get(e.session_id);
      if (!set) {
        set = new Set();
        searchedQueriesBySession.set(e.session_id, set);
      }
      set.add(q);
    } else if (e.event_type === "search_result_click") {
      const q = normalizeQuery(e.metadata?.query);
      if (!q) continue;
      let set = clickedQueriesBySession.get(e.session_id);
      if (!set) {
        set = new Set();
        clickedQueriesBySession.set(e.session_id, set);
      }
      set.add(q);
    }
  }

  const zeroResultSearches = [...zeroResultCounts.entries()]
    .map(([query, count]) => ({ query, count, trend: null }))
    .sort((a, b) => b.count - a.count)
    .slice(0, limit);

  const noClickCounts = new Map<string, number>();
  for (const [sessionId, queries] of searchedQueriesBySession) {
    const clicked = clickedQueriesBySession.get(sessionId);
    for (const q of queries) {
      if (zeroResultCounts.has(q)) continue; // already covered above, distinct category
      if (!clicked?.has(q)) noClickCounts.set(q, (noClickCounts.get(q) ?? 0) + 1);
    }
  }
  const noClickSearches = [...noClickCounts.entries()]
    .map(([query, count]) => ({ query, count, trend: null }))
    .sort((a, b) => b.count - a.count)
    .slice(0, limit);

  const risingSearches = topSearches
    .filter((r) => r.trend !== null && r.trend > 0)
    .sort((a, b) => (b.trend ?? 0) - (a.trend ?? 0))
    .slice(0, limit);

  return { data: { topSearches, zeroResultSearches, noClickSearches, risingSearches }, hasError: false };
}

// ---- User Journeys (page A -> page B transition pairs) ----

export type FpJourneyRow = { from: string; to: string; count: number };

// Aggregate transition pairs rather than per-session full paths: a table
// of "N sessions went from /a to /b next" is both more robust (doesn't
// require every session to have >=3 events to be useful) and more
// performant to compute/display than trying to render whole distinct
// session paths, which fragment into a huge number of low-count rows on
// any real traffic volume. This still directly answers "how do visitors
// move through the site" — chain the top pairs by eye for a fuller path.
export function getUserJourneys(data: FpRangeData, limit = 15): FpJourneyRow[] {
  const bySession = new Map<string, FpEventRow[]>();
  for (const e of data.events) {
    if (e.event_type !== "page_view") continue;
    let arr = bySession.get(e.session_id);
    if (!arr) {
      arr = [];
      bySession.set(e.session_id, arr);
    }
    arr.push(e);
  }
  const pairCounts = new Map<string, number>();
  for (const events of bySession.values()) {
    events.sort((a, b) => a.created_at.localeCompare(b.created_at));
    for (let i = 0; i < events.length - 1; i++) {
      const key = `${events[i].path} -> ${events[i + 1].path}`;
      pairCounts.set(key, (pairCounts.get(key) ?? 0) + 1);
    }
  }
  return [...pairCounts.entries()]
    .map(([key, count]) => {
      const [from, to] = key.split(" -> ");
      return { from, to, count };
    })
    .sort((a, b) => b.count - a.count)
    .slice(0, limit);
}

// ---- Entry / Exit pages ----

export type FpPathCountRow = { path: string; count: number };

export function getEntryPages(data: FpRangeData, limit = 10): FpPathCountRow[] {
  const counts = new Map<string, number>();
  for (const s of data.sessionsById.values()) {
    counts.set(s.entry_path, (counts.get(s.entry_path) ?? 0) + 1);
  }
  return [...counts.entries()].map(([path, count]) => ({ path, count })).sort((a, b) => b.count - a.count).slice(0, limit);
}

export function getExitPages(data: FpRangeData, limit = 10): FpPathCountRow[] {
  const lastPathBySession = new Map<string, { path: string; at: string }>();
  for (const e of data.events) {
    const existing = lastPathBySession.get(e.session_id);
    if (!existing || e.created_at > existing.at) {
      lastPathBySession.set(e.session_id, { path: e.path, at: e.created_at });
    }
  }
  const counts = new Map<string, number>();
  for (const { path } of lastPathBySession.values()) {
    counts.set(path, (counts.get(path) ?? 0) + 1);
  }
  return [...counts.entries()].map(([path, count]) => ({ path, count })).sort((a, b) => b.count - a.count).slice(0, limit);
}

// ---- Engagement ----

export type FpEngagement = {
  pagesPerSession: number | null;
  eventsPerSession: number | null;
  returningVisitorRate: number | null; // % of visitors in range with prior activity before the range
};

export async function getEngagement(data: FpRangeData, range: FpDateRange): Promise<FpEngagement> {
  const sessionCount = data.sessionsById.size;
  if (sessionCount === 0) return { pagesPerSession: null, eventsPerSession: null, returningVisitorRate: null };

  const pageViewCount = data.events.filter((e) => e.event_type === "page_view").length;
  const pagesPerSession = Math.round((pageViewCount / sessionCount) * 10) / 10;
  const eventsPerSession = Math.round((data.events.length / sessionCount) * 10) / 10;

  const visitorIds = [...new Set([...data.sessionsById.values()].map((s) => s.visitor_id).filter((v): v is string => Boolean(v)))];
  if (visitorIds.length === 0) return { pagesPerSession, eventsPerSession, returningVisitorRate: null };

  const supabase = await createClient();
  const { data: visitorRows, error } = await supabase
    .from("analytics_visitors")
    .select("id, first_seen_at")
    .in("id", visitorIds);
  if (error || !visitorRows) return { pagesPerSession, eventsPerSession, returningVisitorRate: null };

  const rangeStart = startIso(range.startDate);
  const returning = visitorRows.filter((v) => v.first_seen_at < rangeStart).length;
  const returningVisitorRate = Math.round((returning / visitorRows.length) * 100);

  return { pagesPerSession, eventsPerSession, returningVisitorRate };
}

// ---- Monetisation funnel (session-correlated, complements outbound_click_events) ----

export type FpMonetisationFunnel = {
  sessionsViewingProduct: number;
  sessionsClickingAffiliateOrOutbound: number;
  conversionRate: number | null; // of sessions that viewed a product, % that also clicked affiliate/outbound in the same session
};

export function getMonetisationFunnel(data: FpRangeData): FpMonetisationFunnel {
  const sessionsViewingProduct = new Set<string>();
  const sessionsClicking = new Set<string>();
  for (const e of data.events) {
    if (e.event_type === "page_view" && e.entity_type === "product") sessionsViewingProduct.add(e.session_id);
    if (e.event_type === "affiliate_click" || e.event_type === "outbound_link_click") sessionsClicking.add(e.session_id);
  }
  let both = 0;
  for (const s of sessionsViewingProduct) {
    if (sessionsClicking.has(s)) both++;
  }
  return {
    sessionsViewingProduct: sessionsViewingProduct.size,
    sessionsClickingAffiliateOrOutbound: sessionsClicking.size,
    conversionRate: sessionsViewingProduct.size > 0 ? Math.round((both / sessionsViewingProduct.size) * 100) : null,
  };
}
