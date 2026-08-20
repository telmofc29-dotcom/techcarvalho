-- APPLIED TO PRODUCTION 2026-08-20. This is v3 of a migration reviewed
-- twice before application (see conversation record) — storage architecture
-- revised from v1 after review, rights-verification safeguard added in v3.
-- Moved here from supabase/migrations_pending/ now that it's live; kept
-- under its original filename rather than renumbered, since Supabase
-- tracks applied migrations by filename and renaming would make it look
-- unapplied to the CLI/dashboard history.
--
-- v3 changes from v2:
--   * media_assets gains rights_status ('unknown' | 'pending_verification' |
--     'verified' | 'restricted', default 'unknown') plus a CHECK and index.
--     Publication eligibility based on this is enforced in the
--     publishMediaAsset() Server Action (src/app/admin/(dashboard)/media/
--     actions.ts via src/lib/media/rights.ts) — this migration only adds
--     the column; a new CHECK also guarantees at the DB level that a
--     'restricted' asset can never be in a 'published' state, as
--     defense-in-depth under the same publication_consistency_check
--     pattern already used for public_storage_path.
--
-- v2 changes from v1:
--   * Storage architecture replaced: one public bucket with unconditional
--     anon read -> two buckets (media-private, media-public). Upload always
--     lands in media-private. An explicit, admin-only "publish" action
--     copies the object into media-public. Nothing is world-readable by
--     default; publication is a deliberate, separate step from upload.
--   * media_assets gains publication_status + public_storage_path +
--     published_at/published_by, and its own RLS is tightened from
--     unconditionally-public-read to published-only (mirroring how
--     products/content_items already work). This changes the behavior of
--     an already-applied policy from rls_policies.sql, not just additive.
--   * product_media/content_media public-read policies are tightened to
--     also require the linked media_assets row to be published, so
--     publishing a product/article can't incidentally expose a still-
--     private image through the join.
--   * source_type and search_intent get CHECK constraints; a data-
--     integrity CHECK ties publication_status to public_storage_path.
--
-- Still covers the two content_items gaps from v1 (primary category/search
-- fields, archived status) unchanged.

-- ============================================================================
-- 1. content_items extensions
-- ============================================================================

alter table public.content_items
  add column if not exists category_id uuid references public.taxonomy_categories (id) on delete set null,
  add column if not exists search_intent text,
  add column if not exists primary_query text,
  add column if not exists intent_fingerprint text;

create index if not exists content_items_category_id_idx on public.content_items (category_id);
create index if not exists content_items_intent_fingerprint_idx on public.content_items (intent_fingerprint);

alter table public.content_items drop constraint if exists content_items_status_check;
alter table public.content_items
  add constraint content_items_status_check check (status in ('draft', 'published', 'archived'));

alter table public.content_items drop constraint if exists content_items_search_intent_check;
alter table public.content_items
  add constraint content_items_search_intent_check check (
    search_intent is null or search_intent in ('informational', 'commercial', 'transactional', 'navigational')
  );

-- Note: the existing public-read policy on content_items already reads
-- `status = 'published' and published_at <= now()`, which excludes
-- 'archived' by construction — no RLS change needed for the new status.

-- ============================================================================
-- 2. media_assets extensions
-- ============================================================================
--
-- storage_path is now specifically the media-private object path — always
-- present, the permanent working/archive copy. public_storage_path is only
-- populated once an admin explicitly publishes the asset, and points at the
-- media-public copy. Deleting/unpublishing never touches storage_path; it's
-- the source of truth an admin can always get back to.

alter table public.media_assets
  add column if not exists caption text,
  add column if not exists source_type text,
  add column if not exists creator text,
  add column if not exists source_url text,
  add column if not exists attribution_required boolean not null default false,
  add column if not exists ai_generated boolean not null default false,
  add column if not exists owned boolean not null default false,
  add column if not exists publication_status text not null default 'private',
  add column if not exists public_storage_path text,
  add column if not exists published_at timestamptz,
  add column if not exists published_by uuid references public.admin_users (id) on delete set null,
  add column if not exists rights_status text not null default 'unknown';

alter table public.media_assets drop constraint if exists media_assets_publication_status_check;
alter table public.media_assets
  add constraint media_assets_publication_status_check check (publication_status in ('private', 'published'));

-- Rights verification safeguard. 'unknown' (default) and 'pending_verification'
-- both mean "not yet cleared" — publishMediaAsset() only allows publishing
-- when rights_status='verified', or the asset is owned=true, or it's a
-- staff_photograph (see src/lib/media/rights.ts for the full, single source
-- of truth for this decision). 'restricted' always blocks publication
-- regardless of any other field.
alter table public.media_assets drop constraint if exists media_assets_rights_status_check;
alter table public.media_assets
  add constraint media_assets_rights_status_check check (
    rights_status in ('unknown', 'pending_verification', 'verified', 'restricted')
  );

create index if not exists media_assets_rights_status_idx on public.media_assets (rights_status);

-- Defense-in-depth: a restricted asset can never be published, even via a
-- direct SQL update that bypasses the Server Action's own check.
alter table public.media_assets drop constraint if exists media_assets_rights_restricted_not_published_check;
alter table public.media_assets
  add constraint media_assets_rights_restricted_not_published_check check (
    not (rights_status = 'restricted' and publication_status = 'published')
  );

-- source_type deliberately excludes an 'ai_generated' value: whether media
-- is AI-generated is tracked by the ai_generated boolean below, orthogonal
-- to where it came from (e.g. a manufacturer photo that was later
-- AI-upscaled is source_type='manufacturer', ai_generated=true).
alter table public.media_assets drop constraint if exists media_assets_source_type_check;
alter table public.media_assets
  add constraint media_assets_source_type_check check (
    source_type is null or source_type in (
      'manufacturer', 'staff_photograph', 'stock_licensed', 'user_submitted', 'press_kit', 'other'
    )
  );

-- Data-integrity guarantee: a row has a public-bucket path if and only if
-- it's marked published. Keeps the two columns from drifting out of sync.
alter table public.media_assets drop constraint if exists media_assets_publication_consistency_check;
alter table public.media_assets
  add constraint media_assets_publication_consistency_check check (
    (publication_status = 'published') = (public_storage_path is not null)
  );

create index if not exists media_assets_publication_status_idx on public.media_assets (publication_status);
create index if not exists media_assets_source_type_idx on public.media_assets (source_type);
create index if not exists media_assets_published_at_idx on public.media_assets (published_at desc)
  where publication_status = 'published';

-- ============================================================================
-- 3. media_assets RLS — tightened from unconditional public read
-- ============================================================================
--
-- This REPLACES an already-applied policy from rls_policies.sql. Today
-- (pre-migration) every media_assets row is publicly readable regardless of
-- draft/evidence status — only the actual file bytes are protected, by
-- whatever Storage policy exists. That's not enough on its own: row
-- metadata (captions, evidence filenames, creator names) can itself be
-- sensitive, and per requirement, draft/private media must not be
-- world-readable at all, including metadata.

drop policy if exists "public can read media assets" on public.media_assets;

create policy "public can read published media assets" on public.media_assets
  for select to anon, authenticated
  using (publication_status = 'published');

create policy "admins can read all media assets" on public.media_assets
  for select to authenticated
  using (public.is_admin());

-- "admins can write media assets" (already applied, unaffected) continues
-- to gate all inserts/updates/deletes on public.is_admin().

-- ============================================================================
-- 4. product_media / content_media — close the join-table gap
-- ============================================================================
--
-- Previously these only checked that the PARENT product/content was
-- published, not that the linked media_assets row was. That meant
-- publishing a product could incidentally expose the fact that some
-- still-private media was attached to it (and, via a join, its metadata).
-- Now both conditions are required.

drop policy if exists "public can read media of published products" on public.product_media;
create policy "public can read media of published products" on public.product_media
  for select to anon, authenticated
  using (
    exists (select 1 from public.products p where p.id = product_id and p.is_published)
    and exists (select 1 from public.media_assets m where m.id = media_id and m.publication_status = 'published')
  );

drop policy if exists "public can read media of published content" on public.content_media;
create policy "public can read media of published content" on public.content_media
  for select to anon, authenticated
  using (
    exists (
      select 1 from public.content_items c
      where c.id = content_id and c.status = 'published' and c.published_at <= now()
    )
    and exists (select 1 from public.media_assets m where m.id = media_id and m.publication_status = 'published')
  );

-- ============================================================================
-- 5. Storage: two buckets, upload always private, publish is explicit
-- ============================================================================

insert into storage.buckets (id, name, public)
values ('media-private', 'media-private', false)
on conflict (id) do nothing;

insert into storage.buckets (id, name, public)
values ('media-public', 'media-public', true)
on conflict (id) do nothing;

-- media-private: admin-only for every operation, including read. No
-- anon/authenticated-non-admin access exists at all — this is where
-- drafts, evidence, defect photos, and permanently-private reference media
-- live, indefinitely if needed.
drop policy if exists "admins can access private media bucket" on storage.objects;
create policy "admins can access private media bucket" on storage.objects
  for all to authenticated
  using (bucket_id = 'media-private' and public.is_admin())
  with check (bucket_id = 'media-private' and public.is_admin());

-- media-public: world-readable (this bucket's public=true flag already
-- makes the plain object URL bypass RLS entirely for GET requests; the
-- policy below covers SDK-mediated reads, e.g. listing). Only admins can
-- write to it, and only ever via the publish action copying from
-- media-private — nothing should upload here directly.
drop policy if exists "public can read public media bucket" on storage.objects;
create policy "public can read public media bucket" on storage.objects
  for select to anon, authenticated
  using (bucket_id = 'media-public');

drop policy if exists "admins can write public media bucket" on storage.objects;
create policy "admins can write public media bucket" on storage.objects
  for all to authenticated
  using (bucket_id = 'media-public' and public.is_admin())
  with check (bucket_id = 'media-public' and public.is_admin());
