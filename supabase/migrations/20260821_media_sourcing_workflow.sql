-- Purpose: support the media-first publishing rule for the 43 existing
-- media-deficient records and all future catalogue/content expansion.
-- Smallest clean extension on top of the existing architecture — audited
-- first (see the accompanying report): reuses source_type, rights_status,
-- evaluatePublishEligibility(), and the awaiting_media content status
-- rather than duplicating any of them.
--
-- Two changes:
-- 1. Widen media_assets.source_type with the two legitimate source
--    categories the existing enum didn't distinguish: public-domain/CC
--    material (distinct from stock_licensed — different attribution norms,
--    genuinely free rather than paid-and-licensed) and TechCarvalho-created
--    graphics/diagrams (distinct from staff_photograph — an illustration,
--    not a photograph, though both are typically owned=true).
-- 2. A new media_requirements table — tracks the *pre-asset* sourcing
--    workflow (needed/sourcing/available/blocked/approved) for a
--    product/content record that doesn't have acceptable media yet. This
--    is a genuinely new concept: product_media/content_media are pure
--    join tables (media_id not null) with no way to represent "we need
--    one of these but don't have it yet" — rights_status/source_type only
--    describe an asset that already exists. One open requirement row per
--    product or content record; resolved by pointing resolved_media_id at
--    the media_assets row once it's uploaded, rights-verified, and
--    associated as that record's hero.

alter table public.media_assets drop constraint if exists media_assets_source_type_check;
alter table public.media_assets
  add constraint media_assets_source_type_check check (
    source_type is null or source_type in (
      'manufacturer', 'staff_photograph', 'stock_licensed', 'user_submitted', 'press_kit',
      'public_domain_or_cc', 'tc_graphic', 'other'
    )
  );

create table if not exists public.media_requirements (
  id uuid primary key default gen_random_uuid(),
  product_id uuid references public.products(id) on delete cascade,
  content_id uuid references public.content_items(id) on delete cascade,
  sourcing_status text not null default 'needed' check (
    sourcing_status in ('needed', 'sourcing', 'available', 'blocked', 'approved')
  ),
  -- Which of the legitimate source categories this requirement is expected
  -- to be satisfied from, if known yet — same vocabulary as
  -- media_assets.source_type so a requirement and its eventual asset speak
  -- the same language, but kept as a separate free-standing check (not a
  -- literal FK to an enum type) since a requirement may exist before
  -- anyone has decided which source it'll come from.
  target_source_type text check (
    target_source_type is null or target_source_type in (
      'manufacturer', 'staff_photograph', 'stock_licensed', 'user_submitted', 'press_kit',
      'public_domain_or_cc', 'tc_graphic', 'other'
    )
  ),
  notes text,
  resolved_media_id uuid references public.media_assets(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint media_requirements_one_target check (
    (product_id is not null and content_id is null) or (product_id is null and content_id is not null)
  )
);

create unique index if not exists media_requirements_one_open_per_product
  on public.media_requirements (product_id) where product_id is not null;
create unique index if not exists media_requirements_one_open_per_content
  on public.media_requirements (content_id) where content_id is not null;
create index if not exists media_requirements_sourcing_status_idx on public.media_requirements (sourcing_status);

alter table public.media_requirements enable row level security;

-- Admin-only in every direction, same pattern as every other admin-managed
-- table in this project (is_admin() defined in the base migration).
create policy "admins can read media requirements" on public.media_requirements
  for select using (public.is_admin());
create policy "admins can insert media requirements" on public.media_requirements
  for insert with check (public.is_admin());
create policy "admins can update media requirements" on public.media_requirements
  for update using (public.is_admin());
create policy "admins can delete media requirements" on public.media_requirements
  for delete using (public.is_admin());

grant select, insert, update, delete on public.media_requirements to authenticated;
