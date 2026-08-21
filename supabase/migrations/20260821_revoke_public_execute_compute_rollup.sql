-- Fix: public.compute_analytics_rollup(date) was granted EXECUTE only to
-- `authenticated` in 20260821_first_party_analytics.sql /
-- 20260821_first_party_analytics_grants_fix.sql, with the intent that it's
-- an admin-triggered aggregation job. Postgres grants EXECUTE on every
-- newly created function to the PUBLIC pseudo-role by default unless
-- explicitly revoked — that revoke was missing, so `anon` (every
-- unauthenticated visitor) could call it too, forcing SECURITY DEFINER
-- recomputation of daily rollups for any date, repeatedly, for free.
-- Confirmed live via a genuine anon-role RPC call before this fix:
-- `anon.rpc("compute_analytics_rollup", { target_day: ... })` returned
-- `{ data: null, error: null }` instead of a permission error.
--
-- No data was exposed by this gap (the function returns void, and
-- analytics_daily_rollups itself stays admin-read-only via RLS) — this is
-- an authorization/DoS gap, not a data leak, but still real and worth
-- closing explicitly rather than relying on Postgres defaults.
revoke execute on function public.compute_analytics_rollup(date) from public;

-- Re-affirm the intended grant explicitly (idempotent, matches the
-- original migration's intent — this line is a no-op if already applied).
grant execute on function public.compute_analytics_rollup(date) to authenticated;

-- Defense-in-depth: the other two first-party analytics RPCs are
-- intentionally callable by anon (that's the point — they back
-- unauthenticated visitor tracking), so the implicit PUBLIC grant is
-- harmless there. Revoking PUBLIC and re-granting explicitly anyway, so no
-- function in this module relies on the implicit default.
revoke execute on function public.record_analytics_touch(uuid, uuid, timestamptz, boolean, text, text, text, text, text, text) from public;
grant execute on function public.record_analytics_touch(uuid, uuid, timestamptz, boolean, text, text, text, text, text, text) to anon, authenticated;

revoke execute on function public.analytics_session_under_rate_limit(uuid, integer) from public;
grant execute on function public.analytics_session_under_rate_limit(uuid, integer) to anon, authenticated;
