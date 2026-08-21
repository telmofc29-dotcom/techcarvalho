-- DRAFTED, NOT YET APPLIED. Fixes a third real bug found during live
-- production verification (after the grants fix and the rate-limit fix):
-- the ingestion route's visitor/session "touch" used upsert() — which
-- compiles to `INSERT ... ON CONFLICT (id) DO UPDATE` — against
-- analytics_visitors/analytics_sessions directly. Postgres needs
-- read-visibility on the existing row to evaluate the ON CONFLICT branch,
-- but anon was deliberately never granted SELECT on either table (the same
-- "raw analytics not publicly readable" principle already applied to
-- analytics_events) — so every upsert failed with a genuine RLS
-- violation. Confirmed live via temporary debug instrumentation
-- (since removed): both upserts errored with "new row violates row-level
-- security policy", and because neither error was being checked, the
-- broken session row then caused the final events insert to fail on its
-- foreign key reference — a cascading failure with no visible cause from
-- the API response alone.
--
-- Fix: consolidate the visitor+session touch into one SECURITY DEFINER
-- function (bypasses RLS internally for its own writes, same established
-- pattern as compute_analytics_rollup() and
-- analytics_session_under_rate_limit() in the earlier two migrations),
-- returning nothing. Anon's direct INSERT/UPDATE grants on
-- analytics_visitors/analytics_sessions (added by
-- 20260821_first_party_analytics_grants_fix.sql) are revoked here — they
-- were never sufficient for upsert() to work anyway (that migration
-- granted INSERT and UPDATE, but not the SELECT an upsert's conflict
-- detection actually needs, and granting anon SELECT on these tables was
-- correctly avoided per the same privacy principle) — so removing them is
-- a strict tightening, not a functional loss: this RPC is now the only
-- path anon uses for either table.

create or replace function public.record_analytics_touch(
  p_visitor_id uuid,
  p_session_id uuid,
  p_now timestamptz,
  p_is_new_session boolean,
  p_entry_path text,
  p_referrer_host text,
  p_utm_source text,
  p_utm_medium text,
  p_utm_campaign text,
  p_device_type text
)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into public.analytics_visitors (id, last_seen_at)
  values (p_visitor_id, p_now)
  on conflict (id) do update set last_seen_at = excluded.last_seen_at;

  if p_is_new_session then
    insert into public.analytics_sessions (
      id, visitor_id, entry_path, referrer_host, utm_source, utm_medium, utm_campaign, device_type, is_admin, last_seen_at
    )
    values (
      p_session_id, p_visitor_id, coalesce(p_entry_path, '/'), p_referrer_host, p_utm_source, p_utm_medium, p_utm_campaign, p_device_type, false, p_now
    )
    on conflict (id) do update set last_seen_at = excluded.last_seen_at;
  else
    update public.analytics_sessions set last_seen_at = p_now where id = p_session_id;
  end if;
end;
$$;

grant execute on function public.record_analytics_touch(uuid, uuid, timestamptz, boolean, text, text, text, text, text, text) to anon, authenticated;

revoke insert, update on public.analytics_visitors from anon, authenticated;
revoke insert, update on public.analytics_sessions from anon, authenticated;
