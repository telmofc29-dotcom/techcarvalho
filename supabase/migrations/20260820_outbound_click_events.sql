-- APPLIED TO PRODUCTION 2026-08-20. Moved here from
-- supabase/migrations_pending/ after the user confirmed it was run.
--
-- Purpose: first-party record of outbound/affiliate link clicks, independent
-- of GA4 (which may not be configured, and which visitors may decline via
-- consent). This is deliberately narrow — a write-mostly event log, not a
-- general-purpose analytics warehouse. See src/lib/analytics/events.ts for
-- the corresponding client-side event taxonomy (affiliate_click /
-- outbound_link_click), which this table complements rather than replaces.
--
-- Security design (this table is written to by anonymous visitors, so it is
-- a genuine public attack surface — treated accordingly):
--   * RLS enabled. Anonymous role may only INSERT, never SELECT/UPDATE/DELETE
--     — a visitor's own click event is never readable back, preventing this
--     table from being used to enumerate other visitors' activity.
--   * Only admins (public.is_admin(), the same function used everywhere else
--     in this schema) may SELECT, for the admin analytics dashboard.
--   * No UPDATE or DELETE policy for anyone except admins — events are
--     immutable once written.
--   * link_position and kind are constrained to the same closed vocabulary
--     as the analytics event taxonomy (CHECK constraints), so this can never
--     become a free-text injection point.
--   * retailer and destination_domain are free text but length-capped via
--     CHECK, and the application layer (not this migration) is responsible
--     for normalizing/allowlisting them before insert — see
--     src/lib/monetisation/affiliate.ts.
--   * No IP address, no user agent, no cookie/session identifier, no free-
--     text field of any kind is stored here — nothing that constitutes PII.
--   * product_id/content_id are nullable FKs with ON DELETE SET NULL, so a
--     later product/content deletion can't be blocked by, or leak through,
--     old click history.
--   * Deliberately no rate limiting inside SQL (Postgres can't do that) —
--     the future insert endpoint is responsible for basic abuse mitigation
--     (e.g. Vercel's own request limits, a short per-IP rate limit at the
--     edge/route-handler level). This migration only makes sure a flood of
--     inserts can't do anything worse than add narrow, harmless rows: no
--     column here can carry a payload large enough to be a meaningful
--     storage-amplification vector, and nothing written is ever readable by
--     the anonymous role that wrote it.

create table if not exists public.outbound_click_events (
  id uuid primary key default gen_random_uuid(),
  created_at timestamptz not null default now(),
  kind text not null check (kind in ('affiliate', 'outbound')),
  retailer text check (retailer is null or char_length(retailer) between 1 and 40),
  destination_domain text not null check (char_length(destination_domain) between 1 and 255),
  link_position text not null check (
    link_position in (
      'article_top', 'article_body', 'article_end', 'sidebar', 'product_page',
      'manufacturer_page', 'category_page', 'nav', 'footer', 'search_results', 'related_content'
    )
  ),
  product_id uuid references public.products(id) on delete set null,
  content_id uuid references public.content_items(id) on delete set null,
  constraint outbound_click_events_retailer_requires_affiliate
    check (kind = 'affiliate' or retailer is null)
);

create index if not exists outbound_click_events_created_at_idx on public.outbound_click_events (created_at desc);
create index if not exists outbound_click_events_product_id_idx on public.outbound_click_events (product_id) where product_id is not null;
create index if not exists outbound_click_events_content_id_idx on public.outbound_click_events (content_id) where content_id is not null;

alter table public.outbound_click_events enable row level security;

-- `to anon, authenticated` (not anon-only): a signed-in admin browsing the
-- public site should still have their clicks recorded like any other
-- visitor — is_admin() plays no role in this policy either way, so this
-- doesn't grant anything privileged, just doesn't arbitrarily exclude
-- authenticated sessions from a policy meant for "whoever clicked".
drop policy if exists "anonymous can record their own click" on public.outbound_click_events;
create policy "anonymous can record their own click" on public.outbound_click_events
  for insert to anon, authenticated with check (true);

-- `to authenticated` made explicit (functionally already correct without
-- it — is_admin() fails closed for anon regardless — but every other
-- admin-only policy in this schema states the role explicitly, and this
-- should match).
drop policy if exists "admins can read click events" on public.outbound_click_events;
create policy "admins can read click events" on public.outbound_click_events
  for select to authenticated using (public.is_admin());

drop policy if exists "admins can delete click events" on public.outbound_click_events;
create policy "admins can delete click events" on public.outbound_click_events
  for delete to authenticated using (public.is_admin());

-- No update policy at all — events are append-only/immutable by design.
--
-- Re-run safety: every create policy above is now preceded by a matching
-- drop policy if exists, so this file can be safely re-executed against a
-- database where it was already applied (create table/index already used
-- if not exists; CREATE POLICY has no such clause in Postgres, so without
-- the drop-first pattern a re-run would fail on the first policy).
