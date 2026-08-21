-- APPLIED TO PRODUCTION 2026-08-21. Tables/RLS/policies as written below
-- are correct and unchanged from the original draft, but this migration
-- ALONE was not sufficient to make the system work — three follow-up
-- migrations in this same directory were required after independent live
-- verification (tested as the real anon/authenticated roles against
-- production, not just service/admin access, which is what let the first
-- two gaps go unnoticed):
--   1. 20260821_first_party_analytics_grants_fix.sql — RLS policies alone
--      don't grant anything; the base GRANTs anon/authenticated need to
--      even attempt these policies' operations were missing entirely.
--   2. 20260821_first_party_analytics_rate_limit_fn.sql — the ingestion
--      endpoint's rate-limit check needed a SELECT against analytics_events
--      that anon can never be granted (raw analytics must never be
--      publicly readable) — replaced with a SECURITY DEFINER RPC.
--   3. 20260821_first_party_analytics_touch_fn.sql — visitor/session
--      upsert() also implicitly needs SELECT to detect the ON CONFLICT
--      branch, same underlying tension — replaced with a second SECURITY
--      DEFINER RPC, and the grants fix's INSERT/UPDATE grants on
--      analytics_visitors/analytics_sessions were revoked as no longer
--      used by anything.
-- Read all four files together to understand the table's actual, final
-- production shape — this file alone undersells what anon can actually do
-- (effectively nothing directly; every real write goes through one of the
-- two RPC functions added afterward).
--
-- Purpose: TechCarvalho's own first-party analytics/event system, separate
-- from and complementary to GA4 — so content-interest intelligence (which
-- categories/products/articles get attention) does not depend entirely on
-- a third party. Also separate from and does NOT replace
-- public.outbound_click_events (20260820_outbound_click_events.sql), which
-- stays exactly as-is: an anonymous, consent-INDEPENDENT click counter
-- with zero session/visitor correlation, by deliberate original design.
-- The tables below are session-correlated by nature (that's the whole
-- point — journeys, sessions-per-visitor, entry/exit pages) which is why,
-- unlike outbound_click_events, writes here are gated behind
-- consent.analytics on the client (see src/lib/analytics/first-party.ts) —
-- this is the correct legal distinction, not an inconsistency: a raw,
-- non-identifying click counter needs no consent; a session/journey model
-- needs an identifier, and reading/writing any per-visitor identifier from
-- the browser (even a short-lived one) is a consent-requiring measurement
-- under PECR, the same reasoning already applied to gating GA4 itself.
--
-- Three privacy tiers now coexist deliberately:
--   1. outbound_click_events — anonymous, no consent required, no session
--      correlation. Unaffected by this migration.
--   2. analytics_events (this migration) — session/visitor-correlated,
--      requires analytics consent, admin-read-only.
--   3. GA4 — third-party, requires analytics consent, Google-hosted.
--
-- Definitions used consistently across the schema/app (documented once,
-- here, rather than per-table):
--   * Session = one row in analytics_sessions, keyed by a random UUID the
--     client holds in sessionStorage (cleared when the tab/browser closes)
--     and rotates after 30 minutes of inactivity (mirrors GA4's own
--     default session-gap definition — not an arbitrary choice).
--   * Visitor = one row in analytics_visitors, keyed by a random UUID the
--     client holds in localStorage (persists across sessions on the same
--     browser/device), created only once consent is granted, used purely
--     to compute "unique visitors" / "returning visitor" aggregates — it
--     is never exposed as a raw value anywhere in the admin UI, only via
--     aggregate counts.
--   * Page view = an analytics_events row with event_type='page_view',
--     fired once per genuine navigation (see the client tracker's own
--     mount-based dedup discipline, mirroring RouteChangeTracker's
--     existing "skip the first effect run" pattern for GA4).
--   * Bot/admin traffic: the ingestion endpoint (not this migration —
--     Postgres has no way to inspect a User-Agent or session cookie)
--     drops obvious bot requests and any request from an authenticated
--     admin session before ever reaching this table, so admin_users
--     browsing the site does not inflate visitor/session counts.
--
-- Security design (this schema is written to by anonymous visitors, so it
-- is a genuine public attack surface, same category as outbound_click_events
-- — treated with the same care, plus the ingestion Route Handler's own
-- app-layer validation/rate-limiting/bot-filtering as the first line of
-- defense, since RLS alone cannot rate-limit or inspect a User-Agent):
--   * RLS enabled on every table. anon/authenticated may INSERT only,
--     never SELECT/UPDATE/DELETE on the raw tables — a visitor's own
--     events are never readable back (prevents enumeration of other
--     visitors' activity), matching outbound_click_events' own policy
--     shape exactly.
--   * Only admins (public.is_admin()) may SELECT from any table here.
--   * event_type, entity_type, device_type are closed vocabularies via
--     CHECK constraints — never a free-text injection point.
--   * Every free-text column is length-capped via CHECK.
--   * metadata is jsonb but capped in size by the ingestion endpoint
--     (Postgres itself has no jsonb byte-size CHECK primitive suitable
--     here) — documented as an app-layer responsibility, same pattern
--     outbound_click_events' own migration already established for rate
--     limiting.
--   * No IP address, no raw User-Agent string, no email, no free-text
--     form input, no search-result content is ever stored — only a
--     length-capped, sanitized search *query* (reusing the existing
--     sanitizeEventText()/sanitizeSlug() helpers in
--     src/lib/analytics/events.ts, not a new sanitizer).
--   * product_id/content_id/manufacturer_id are nullable FKs with ON
--     DELETE SET NULL, so a later product/content/manufacturer deletion
--     can never be blocked by, or leak information through, old event
--     history — same pattern as outbound_click_events.

create table if not exists public.analytics_visitors (
  id uuid primary key default gen_random_uuid(),
  first_seen_at timestamptz not null default now(),
  last_seen_at timestamptz not null default now()
);

create table if not exists public.analytics_sessions (
  id uuid primary key default gen_random_uuid(),
  visitor_id uuid references public.analytics_visitors(id) on delete set null,
  started_at timestamptz not null default now(),
  last_seen_at timestamptz not null default now(),
  entry_path text not null check (char_length(entry_path) <= 512),
  -- Hostname only (e.g. "www.google.com"), never a full referrer URL —
  -- a full URL can carry a third-party search query or other incidental
  -- data in its own right that we have no business capturing.
  referrer_host text check (referrer_host is null or char_length(referrer_host) <= 255),
  utm_source text check (utm_source is null or char_length(utm_source) <= 100),
  utm_medium text check (utm_medium is null or char_length(utm_medium) <= 100),
  utm_campaign text check (utm_campaign is null or char_length(utm_campaign) <= 100),
  device_type text check (device_type is null or device_type in ('mobile', 'tablet', 'desktop')),
  is_admin boolean not null default false
);

create table if not exists public.analytics_events (
  id uuid primary key default gen_random_uuid(),
  session_id uuid not null references public.analytics_sessions(id) on delete cascade,
  event_type text not null check (event_type in (
    'page_view', 'internal_link_click', 'related_content_click', 'navigation_click',
    'search', 'search_result_click', 'scroll_depth', 'cta_click',
    'outbound_link_click', 'affiliate_click'
  )),
  path text not null check (char_length(path) <= 512),
  entity_type text check (entity_type is null or entity_type in ('product', 'content', 'manufacturer', 'category')),
  product_id uuid references public.products(id) on delete set null,
  content_id uuid references public.content_items(id) on delete set null,
  manufacturer_id uuid references public.manufacturers(id) on delete set null,
  category_slug text check (category_slug is null or char_length(category_slug) <= 100),
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create index if not exists analytics_events_type_created_idx on public.analytics_events (event_type, created_at desc);
create index if not exists analytics_events_session_idx on public.analytics_events (session_id, created_at);
create index if not exists analytics_events_path_idx on public.analytics_events (path, created_at desc);
create index if not exists analytics_events_product_idx on public.analytics_events (product_id) where product_id is not null;
create index if not exists analytics_events_content_idx on public.analytics_events (content_id) where content_id is not null;
create index if not exists analytics_events_manufacturer_idx on public.analytics_events (manufacturer_id) where manufacturer_id is not null;
create index if not exists analytics_events_category_idx on public.analytics_events (category_slug) where category_slug is not null;
create index if not exists analytics_sessions_visitor_idx on public.analytics_sessions (visitor_id) where visitor_id is not null;
create index if not exists analytics_sessions_started_idx on public.analytics_sessions (started_at desc);

-- Pre-aggregated per-day, per-dimension rollups so the dashboard stays
-- fast as raw event volume grows — queries for a date range fully in the
-- past prefer this table; the current, still-accumulating day is always
-- computed live from analytics_events (a day is only rolled up once it
-- has fully elapsed). Populated by compute_analytics_rollup() below,
-- invoked once nightly via a Vercel Cron-triggered route — see
-- src/app/api/analytics/rollup/route.ts.
create table if not exists public.analytics_daily_rollups (
  day date not null,
  dimension_type text not null check (dimension_type in ('category', 'product', 'content', 'manufacturer', 'search_term', 'path', 'site')),
  dimension_key text not null check (char_length(dimension_key) <= 255),
  sessions integer not null default 0,
  page_views integer not null default 0,
  event_count integer not null default 0,
  outbound_clicks integer not null default 0,
  affiliate_clicks integer not null default 0,
  computed_at timestamptz not null default now(),
  primary key (day, dimension_type, dimension_key)
);

alter table public.analytics_visitors enable row level security;
alter table public.analytics_sessions enable row level security;
alter table public.analytics_events enable row level security;
alter table public.analytics_daily_rollups enable row level security;

drop policy if exists "anonymous can create a visitor record" on public.analytics_visitors;
create policy "anonymous can create a visitor record" on public.analytics_visitors
  for insert to anon, authenticated with check (true);
drop policy if exists "anonymous can update their own visitor last_seen_at" on public.analytics_visitors;
create policy "anonymous can update their own visitor last_seen_at" on public.analytics_visitors
  for update to anon, authenticated using (true) with check (true);
drop policy if exists "admins can read visitors" on public.analytics_visitors;
create policy "admins can read visitors" on public.analytics_visitors
  for select to authenticated using (public.is_admin());

drop policy if exists "anonymous can create a session" on public.analytics_sessions;
create policy "anonymous can create a session" on public.analytics_sessions
  for insert to anon, authenticated with check (true);
drop policy if exists "anonymous can update their own session last_seen_at" on public.analytics_sessions;
create policy "anonymous can update their own session last_seen_at" on public.analytics_sessions
  for update to anon, authenticated using (true) with check (true);
drop policy if exists "admins can read sessions" on public.analytics_sessions;
create policy "admins can read sessions" on public.analytics_sessions
  for select to authenticated using (public.is_admin());

drop policy if exists "anonymous can record an event" on public.analytics_events;
create policy "anonymous can record an event" on public.analytics_events
  for insert to anon, authenticated with check (true);
drop policy if exists "admins can read events" on public.analytics_events;
create policy "admins can read events" on public.analytics_events
  for select to authenticated using (public.is_admin());

drop policy if exists "admins can read rollups" on public.analytics_daily_rollups;
create policy "admins can read rollups" on public.analytics_daily_rollups
  for select to authenticated using (public.is_admin());
-- No anon/authenticated insert policy on rollups at all — the only writer
-- is compute_analytics_rollup() below, a SECURITY DEFINER function that
-- bypasses RLS internally by design (the standard, safe Postgres pattern
-- for "let a restricted caller trigger one specific, well-defined
-- privileged operation" without granting broad table access — no
-- service-role key is introduced or needed).

-- SECURITY DEFINER: runs with the privileges of the function owner
-- (effectively bypassing the RLS above for its own internal writes),
-- while the caller only needs EXECUTE — granted to authenticated, called
-- by the cron-triggered route using a normal admin-free request. Idempotent
-- per day (delete-then-insert for that day/dimension combination), so a
-- retried or re-run cron invocation for the same day never double-counts.
create or replace function public.compute_analytics_rollup(target_day date)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  delete from public.analytics_daily_rollups where day = target_day;

  insert into public.analytics_daily_rollups (day, dimension_type, dimension_key, sessions, page_views, event_count, outbound_clicks, affiliate_clicks)
  select
    target_day,
    'category',
    e.category_slug,
    count(distinct e.session_id),
    count(*) filter (where e.event_type = 'page_view'),
    count(*),
    count(*) filter (where e.event_type = 'outbound_link_click'),
    count(*) filter (where e.event_type = 'affiliate_click')
  from public.analytics_events e
  where e.created_at >= target_day and e.created_at < target_day + 1 and e.category_slug is not null
  group by e.category_slug;

  insert into public.analytics_daily_rollups (day, dimension_type, dimension_key, sessions, page_views, event_count, outbound_clicks, affiliate_clicks)
  select
    target_day,
    'product',
    e.product_id::text,
    count(distinct e.session_id),
    count(*) filter (where e.event_type = 'page_view'),
    count(*),
    count(*) filter (where e.event_type = 'outbound_link_click'),
    count(*) filter (where e.event_type = 'affiliate_click')
  from public.analytics_events e
  where e.created_at >= target_day and e.created_at < target_day + 1 and e.product_id is not null
  group by e.product_id;

  insert into public.analytics_daily_rollups (day, dimension_type, dimension_key, sessions, page_views, event_count, outbound_clicks, affiliate_clicks)
  select
    target_day,
    'content',
    e.content_id::text,
    count(distinct e.session_id),
    count(*) filter (where e.event_type = 'page_view'),
    count(*),
    count(*) filter (where e.event_type = 'outbound_link_click'),
    count(*) filter (where e.event_type = 'affiliate_click')
  from public.analytics_events e
  where e.created_at >= target_day and e.created_at < target_day + 1 and e.content_id is not null
  group by e.content_id;

  insert into public.analytics_daily_rollups (day, dimension_type, dimension_key, sessions, page_views, event_count, outbound_clicks, affiliate_clicks)
  select
    target_day,
    'manufacturer',
    e.manufacturer_id::text,
    count(distinct e.session_id),
    count(*) filter (where e.event_type = 'page_view'),
    count(*),
    count(*) filter (where e.event_type = 'outbound_link_click'),
    count(*) filter (where e.event_type = 'affiliate_click')
  from public.analytics_events e
  where e.created_at >= target_day and e.created_at < target_day + 1 and e.manufacturer_id is not null
  group by e.manufacturer_id;

  insert into public.analytics_daily_rollups (day, dimension_type, dimension_key, sessions, page_views, event_count, outbound_clicks, affiliate_clicks)
  select
    target_day,
    'search_term',
    lower(trim(e.metadata->>'query')),
    count(distinct e.session_id),
    0,
    count(*),
    0,
    0
  from public.analytics_events e
  where e.created_at >= target_day and e.created_at < target_day + 1
    and e.event_type = 'search' and e.metadata->>'query' is not null and trim(e.metadata->>'query') <> ''
  group by lower(trim(e.metadata->>'query'));

  insert into public.analytics_daily_rollups (day, dimension_type, dimension_key, sessions, page_views, event_count, outbound_clicks, affiliate_clicks)
  select
    target_day,
    'site',
    'all',
    count(distinct e.session_id),
    count(*) filter (where e.event_type = 'page_view'),
    count(*),
    count(*) filter (where e.event_type = 'outbound_link_click'),
    count(*) filter (where e.event_type = 'affiliate_click')
  from public.analytics_events e
  where e.created_at >= target_day and e.created_at < target_day + 1;
end;
$$;

grant execute on function public.compute_analytics_rollup(date) to authenticated;
