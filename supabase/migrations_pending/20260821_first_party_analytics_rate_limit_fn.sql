-- DRAFTED, NOT YET APPLIED. Fixes a second real bug found during live
-- verification, after the grants fix (20260821_first_party_analytics_grants_fix.sql)
-- resolved the first one: /api/analytics/track's per-session rate-limit
-- check did `select count(*) ... from analytics_events where session_id = ...`
-- using the request's own (anon-role) client — but anon was deliberately
-- never granted SELECT on analytics_events (see the base migration's own
-- header: "never expose raw analytics data publicly"), so that query
-- itself was blocked, throwing and causing the whole ingestion request to
-- fail with {"ok":false} for every single event, confirmed live via a real
-- POST to the production endpoint landing zero rows.
--
-- Fix: a SECURITY DEFINER function that returns only a boolean (under the
-- limit or not) — never the raw event rows the check counts — so the rate
-- limit can actually run without granting anon any read access to
-- analytics_events, preserving the exact same "not publicly readable"
-- property the base migration established. Same established pattern as
-- compute_analytics_rollup() in the base migration.

create or replace function public.analytics_session_under_rate_limit(p_session_id uuid, p_max_per_minute integer)
returns boolean
language plpgsql
security definer
set search_path = public
as $$
declare
  recent_count integer;
begin
  select count(*) into recent_count
  from public.analytics_events
  where session_id = p_session_id
    and created_at > now() - interval '1 minute';
  return recent_count <= p_max_per_minute;
end;
$$;

grant execute on function public.analytics_session_under_rate_limit(uuid, integer) to anon, authenticated;
