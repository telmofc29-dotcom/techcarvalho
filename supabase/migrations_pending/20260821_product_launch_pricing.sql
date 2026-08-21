-- DRAFTED, NOT YET APPLIED TO PRODUCTION. Lives in migrations_pending/ per
-- this project's convention until the coordinator confirms it has actually
-- been run — move to supabase/migrations/ only after that.
--
-- Purpose: historical launch-MSRP pricing, structured per currency
-- (USD/GBP/EUR), replacing the ad-hoc single "launch-msrp-usd" spec_definition
-- (src/lib/catalogue/camera-specs.ts) as the ONLY place going forward that
-- gets genuinely structured multi-currency pricing with provenance. The old
-- spec is left entirely alone — this is additive, not a migration of that
-- data, and the existing 22 live products are unaffected until an admin (or
-- a future ingestion batch) explicitly adds rows here.
--
-- Why a new table instead of two more spec_definitions
-- (launch-msrp-gbp/-eur): specs are flat single-value facts with no room to
-- express "this specific figure is a flagged approximate FX conversion, not
-- a sourced price" or a dedicated source_url/publisher per value. The
-- existing precedent for "pricing-shaped data gets its own table" is
-- product_offers (current retailer pricing) — this follows that precedent
-- for historical launch pricing, a distinct concept: product_offers is
-- live/current and retailer-specific, this is fixed-at-launch and
-- region-specific. Never merge the two.
--
-- Deliberately conservative, mirroring product_offers' own design notes:
--   * is_estimated defaults to false. A row is only ever an approximate/
--     derived FX conversion when an admin explicitly marks it so — nothing
--     here auto-computes or auto-fills a converted figure. The application
--     layer must always visibly label is_estimated=true rows as approximate,
--     never presented as if they were as reliable as a sourced price.
--   * One row per (product_id, currency) — a product has at most one launch
--     price on record per currency, not a history of edits (an admin
--     editing a mistaken value should UPDATE the row, not accumulate rows).
--   * Publicly readable only for products that are themselves published
--     (mirrors "public can read specs of published products" in
--     supabase/migrations/20260819202305_rls_policies.sql); full read/write
--     for admins via public.is_admin(), consistent with every other table.

create table if not exists public.product_launch_pricing (
  id uuid primary key default gen_random_uuid(),
  product_id uuid not null references public.products(id) on delete cascade,
  currency text not null check (currency in ('USD', 'GBP', 'EUR')),
  amount numeric(10, 2) not null check (amount > 0),
  is_estimated boolean not null default false,
  source_url text check (source_url is null or char_length(source_url) <= 2048),
  source_publisher text check (source_publisher is null or char_length(source_publisher) <= 120),
  note text check (note is null or char_length(note) <= 280),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (product_id, currency)
);

create index if not exists product_launch_pricing_product_id_idx on public.product_launch_pricing (product_id);

alter table public.product_launch_pricing enable row level security;

drop policy if exists "public can read launch pricing of published products" on public.product_launch_pricing;
create policy "public can read launch pricing of published products" on public.product_launch_pricing
  for select to anon, authenticated using (
    exists (
      select 1 from public.products p
      where p.id = product_launch_pricing.product_id and p.is_published
    )
  );

drop policy if exists "admins can read all launch pricing" on public.product_launch_pricing;
create policy "admins can read all launch pricing" on public.product_launch_pricing
  for select to authenticated using (public.is_admin());

drop policy if exists "admins can write launch pricing" on public.product_launch_pricing;
create policy "admins can write launch pricing" on public.product_launch_pricing
  for all to authenticated using (public.is_admin()) with check (public.is_admin());

-- Reuses the shared trigger function every other timestamped table in this
-- schema uses (defined in 20260819202304_initial_schema.sql) rather than
-- declaring a new one. Drop-then-create for re-run safety (Postgres
-- triggers have no "if not exists" clause).
drop trigger if exists set_updated_at on public.product_launch_pricing;
create trigger set_updated_at before update on public.product_launch_pricing
  for each row execute function public.set_updated_at();
