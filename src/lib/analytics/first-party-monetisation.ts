import "server-only";
import { createClient } from "@/lib/supabase/server";
import type { DateRange, MonetisationSummary } from "./dashboard-types";

// Real, first-party monetisation counts from public.outbound_click_events —
// no GA4/Google credentials involved, this table is entirely our own and
// already applied to production (supabase/migrations/20260820_outbound_
// click_events.sql). Only affiliateClicks/outboundClicks are backed by a
// real table today: adImpressions/adClicks (no ad network wired up yet) and
// productClicks/articleClicks (no first-party internal-navigation-click
// table exists — only outbound/affiliate clicks are captured) stay null,
// honestly, rather than being approximated from a column that doesn't
// actually measure them.
//
// Deliberately its own file (not part of dashboard-types.ts, where this
// used to live): both NullAnalyticsProvider and Ga4DataApiProvider need
// this same function for their identical getMonetisation() delegation, and
// having dashboard-types.ts import Ga4DataApiProvider while ga4-provider.ts
// also needed this function back would be a circular runtime import — this
// file breaks that cycle by depending on dashboard-types.ts for a
// type-only (erased) import only.
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
