-- APPLIED TO PRODUCTION 2026-08-20. Moved here from
-- supabase/migrations_pending/ after the user confirmed it was run.
--
-- Purpose: today there is no schema at all for "where to buy this product" /
-- retailer links — product pages have nothing to attach an outbound or
-- affiliate link to. This is the genuine gap behind Phase 20 (eBay/affiliate
-- readiness): the abstraction in src/lib/monetisation/affiliate.ts and the
-- <OutboundLink> component need real rows to render, and none exist.
--
-- Deliberately conservative:
--   * No live pricing. price_note is an optional, manually-entered free-text
--     hint (e.g. "around £450"), never presented as a real-time price feed —
--     this app does not integrate any retailer API yet (explicitly out of
--     scope for this batch) and must never imply it does.
--   * affiliate_status defaults to 'non_affiliate' — a row must be
--     deliberately marked 'affiliate' by an admin who has actually set up an
--     affiliate relationship with that retailer. Nothing here auto-assumes
--     affiliate status, so a plain outbound link never gets mislabelled (or
--     miscompensated-for) as one.
--   * is_active lets an admin unpublish a dead/expired offer without
--     deleting the row (keeps click-history FKs meaningful).
--   * Publicly readable only for products that are themselves published
--     (mirrors the existing "public can read published products" pattern in
--     supabase/migrations/20260819202305_rls_policies.sql); full read/write
--     for admins via public.is_admin(), consistent with every other table.

create table if not exists public.product_offers (
  id uuid primary key default gen_random_uuid(),
  product_id uuid not null references public.products(id) on delete cascade,
  retailer text not null check (char_length(retailer) between 1 and 40),
  url text not null check (char_length(url) between 1 and 2048),
  affiliate_status text not null default 'non_affiliate'
    check (affiliate_status in ('affiliate', 'non_affiliate', 'pending')),
  price_note text check (price_note is null or char_length(price_note) <= 80),
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists product_offers_product_id_idx on public.product_offers (product_id);

alter table public.product_offers enable row level security;

drop policy if exists "public can read active offers of published products" on public.product_offers;
create policy "public can read active offers of published products" on public.product_offers
  for select to anon, authenticated using (
    is_active
    and exists (
      select 1 from public.products p
      where p.id = product_offers.product_id and p.is_published = true
    )
  );

drop policy if exists "admins can read all offers" on public.product_offers;
create policy "admins can read all offers" on public.product_offers
  for select to authenticated using (public.is_admin());

drop policy if exists "admins can write offers" on public.product_offers;
create policy "admins can write offers" on public.product_offers
  for all to authenticated using (public.is_admin()) with check (public.is_admin());

-- Every other timestamped table in this schema (products, content_items,
-- seo_metadata) maintains updated_at via this trigger, defined in
-- 20260819202304_initial_schema.sql. This table declared the column but
-- was missing the trigger entirely — without it, updated_at would silently
-- stay pinned at its created_at-time default forever on every UPDATE.
-- Drop-then-create (not "if not exists" — Postgres triggers have no such
-- clause) for re-run safety.
drop trigger if exists set_updated_at on public.product_offers;
create trigger set_updated_at before update on public.product_offers
  for each row execute function public.set_updated_at();
