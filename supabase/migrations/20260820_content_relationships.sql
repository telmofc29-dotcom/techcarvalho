-- APPLIED TO PRODUCTION 2026-08-20. Moved here from
-- supabase/migrations_pending/ after the user confirmed it was run.
--
-- Purpose: there is currently no content-to-content relationship table.
-- product_relationships (products <-> products) and content_products
-- (content <-> products) both already exist; content <-> content does not.
-- This is the genuine gap behind Phase 13 (content clusters — pillar,
-- supporting, long-tail) and part of Phase 15 (internal journeys): without
-- it, "this guide supports that pillar page" has nowhere to be recorded,
-- and the public "related content" surfacing (see
-- src/components/public/related-content-tracker.tsx and the `related`
-- queries in src/lib/public/{article,product}-detail.ts) is limited to what
-- content_products already encodes (shared product association) rather
-- than genuine editorial content-to-content structure.
--
-- Design mirrors product_relationships exactly: one directional row per
-- relationship, reverse direction inferred at query time (same pattern as
-- src/lib/public/product-detail.ts querying both product_id = X and
-- related_product_id = X) — never insert the reciprocal row manually.

create table if not exists public.content_relationships (
  id uuid primary key default gen_random_uuid(),
  content_id uuid not null references public.content_items(id) on delete cascade,
  related_content_id uuid not null references public.content_items(id) on delete cascade,
  relationship_type text not null check (relationship_type in ('pillar_of', 'supporting_of', 'related_to')),
  created_at timestamptz not null default now(),
  constraint content_relationships_not_self check (content_id <> related_content_id),
  constraint content_relationships_unique unique (content_id, related_content_id, relationship_type)
);

-- Only related_content_id gets its own index, matching product_relationships'
-- exact pattern (20260819202304_initial_schema.sql) — the unique constraint
-- above already provides an implicit b-tree index leading with content_id,
-- so a separate content_id index would just be redundant write overhead.
create index if not exists content_relationships_related_content_id_idx on public.content_relationships (related_content_id);

alter table public.content_relationships enable row level security;

-- Mirrors the exact predicate of "public can read published content" in
-- 20260819202305_rls_policies.sql (status = 'published' AND published_at <=
-- now()) — a relationship must not be publicly visible before either side
-- of it would independently be.
drop policy if exists "public can read relationships between published content" on public.content_relationships;
create policy "public can read relationships between published content" on public.content_relationships
  for select to anon, authenticated using (
    exists (
      select 1 from public.content_items c
      where c.id = content_relationships.content_id and c.status = 'published' and c.published_at <= now()
    )
    and exists (
      select 1 from public.content_items c
      where c.id = content_relationships.related_content_id and c.status = 'published' and c.published_at <= now()
    )
  );

drop policy if exists "admins can write content relationships" on public.content_relationships;
create policy "admins can write content relationships" on public.content_relationships
  for all to authenticated using (public.is_admin()) with check (public.is_admin());
