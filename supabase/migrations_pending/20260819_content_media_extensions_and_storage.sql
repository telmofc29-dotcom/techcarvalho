-- DRAFT — NOT APPLIED. Reviewed by nobody yet, not run against production.
--
-- This file lives outside supabase/migrations/ specifically so it is not
-- picked up by `supabase db push` or any other automated migration runner.
-- It exists to make the schema changes the admin UI is currently deferring
-- concrete and reviewable. If approved, move it into supabase/migrations/
-- with a fresh timestamped filename and apply it deliberately.
--
-- Covers three gaps found while building the admin CRUD/content/media
-- registries against the Milestone 1 schema:
--
-- 1. content_items is missing fields the Content Registry brief asked for:
--    primary category, search intent, primary query, intent fingerprint —
--    plus a distinct "archived" status (schema currently only allows
--    draft/published).
-- 2. media_assets is missing fields the Media Registry brief asked for:
--    caption, source type, creator, source URL, attribution-required flag,
--    AI-generated flag, owned flag.
-- 3. No Storage bucket or storage.objects RLS policies exist yet for the
--    Media Registry's upload feature to work at all.
--
-- All additions are nullable/defaulted and additive — nothing here drops or
-- narrows existing data. Still, it touches production tables and adds
-- public.is_admin()-gated storage policies, so it should be reviewed line
-- by line before being applied, not applied automatically.

-- ============================================================================
-- 1. content_items extensions
-- ============================================================================

alter table public.content_items
  add column if not exists category_id uuid references public.taxonomy_categories (id) on delete set null,
  add column if not exists search_intent text,
  add column if not exists primary_query text,
  add column if not exists intent_fingerprint text;

create index if not exists content_items_category_id_idx on public.content_items (category_id);

alter table public.content_items drop constraint if exists content_items_status_check;
alter table public.content_items
  add constraint content_items_status_check check (status in ('draft', 'published', 'archived'));

-- ============================================================================
-- 2. media_assets extensions
-- ============================================================================

alter table public.media_assets
  add column if not exists caption text,
  add column if not exists source_type text,
  add column if not exists creator text,
  add column if not exists source_url text,
  add column if not exists attribution_required boolean not null default false,
  add column if not exists ai_generated boolean not null default false,
  add column if not exists owned boolean not null default false;

-- ============================================================================
-- 3. Storage bucket + RLS for the Media Registry
-- ============================================================================

insert into storage.buckets (id, name, public)
values ('media', 'media', true)
on conflict (id) do nothing;

-- media_assets itself is world-readable with no publish gating (see
-- rls_policies.sql design notes), so the backing bucket mirrors that: public
-- read, admin-only write.

drop policy if exists "public can read media bucket" on storage.objects;
create policy "public can read media bucket" on storage.objects
  for select to anon, authenticated
  using (bucket_id = 'media');

drop policy if exists "admins can write media bucket" on storage.objects;
create policy "admins can write media bucket" on storage.objects
  for all to authenticated
  using (bucket_id = 'media' and public.is_admin())
  with check (bucket_id = 'media' and public.is_admin());
