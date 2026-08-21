-- DRAFTED, NOT YET APPLIED. Fixes a real bug found during live verification
-- of 20260821_first_party_analytics.sql (applied 2026-08-21): that
-- migration created RLS policies for anon/authenticated but never issued
-- the base GRANTs those policies depend on. RLS only ever RESTRICTS an
-- operation a role's grants already permit — it never substitutes for one.
-- Without an explicit GRANT INSERT, PostgREST correctly has nothing to
-- allow, and (per its own documented behavior of hiding objects a role has
-- zero privilege on, to avoid leaking schema existence to unprivileged
-- callers) reports the table as not found at all rather than a policy
-- rejection — which is exactly what independent verification observed:
-- admin (authenticated) could read every table straight away, while
-- anon's insert/select against the same tables failed with "Could not
-- find the table ... in the schema cache", not a permission-denied error.
--
-- Every previous migration in this schema worked without explicit GRANTs
-- because this Supabase project's default privileges evidently cover
-- `authenticated` automatically but not `anon` for tables created via the
-- SQL editor — outbound_click_events and product_launch_pricing both
-- happened to need anon INSERT (the former) or no anon access at all (the
-- latter's writes are admin-only), never surfacing this gap before.
-- Granting explicitly here, rather than continuing to depend on ambient
-- default privileges, is also simply the more correct, portable practice
-- going forward — every future migration touching anon-writable tables
-- should include its own explicit GRANTs rather than assume this.
--
-- Grants match each table's RLS policies exactly, no wider: anon/
-- authenticated get INSERT where an insert policy exists, UPDATE where an
-- update policy exists, and nothing beyond that — anon is deliberately
-- NOT granted SELECT on any of these tables (no anon SELECT policy exists
-- either; per "never expose raw analytics data publicly", anon should not
-- even attempt a read, not merely have it filtered to zero rows).

grant insert on public.analytics_visitors to anon, authenticated;
grant update on public.analytics_visitors to anon, authenticated;
grant select on public.analytics_visitors to authenticated;

grant insert on public.analytics_sessions to anon, authenticated;
grant update on public.analytics_sessions to anon, authenticated;
grant select on public.analytics_sessions to authenticated;

grant insert on public.analytics_events to anon, authenticated;
grant select on public.analytics_events to authenticated;

grant select on public.analytics_daily_rollups to authenticated;

grant execute on function public.compute_analytics_rollup(date) to authenticated;
