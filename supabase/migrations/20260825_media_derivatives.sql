-- DRAFTED, NOT APPLIED. Lives in migrations_pending/ specifically so no tooling
-- runs it. Move to supabase/migrations/ only after it has actually been run.
--
-- WHY THIS EXISTS
-- ---------------
-- The owned-photography pipeline (src/lib/media/derivatives.ts,
-- src/lib/media/upload-plan.ts) produces two things the schema has nowhere to
-- put:
--
--   1. A SET OF DERIVED OBJECTS per asset — responsive widths x formats x crops
--      — each of which may or may not carry a watermark, and each of which is
--      published separately from the master.
--   2. THE ANSWER TO "does this licence permit modification?", which today is
--      simply not recorded anywhere. `license` holds a licence NAME; nothing
--      says whether that licence allows altering the image, and the two are
--      routinely conflated. A licence permitting REUSE does not necessarily
--      permit MODIFICATION, and a watermark is a modification.
--
-- THE CODE WORKS WITHOUT THIS MIGRATION. `licence_permits_modification` reads
-- as undefined on every row until the column exists, and shouldWatermark()
-- treats undefined as "unknown", which is a REFUSAL. So the un-migrated state
-- is the safe state: nothing gets watermarked until a human records the answer.
-- This is an upgrade to fidelity, not a prerequisite.
--
-- WHAT THIS DELIBERATELY DOES NOT DO
-- ----------------------------------
-- It adds no path by which anything becomes publishable that was not
-- publishable before. It does not touch evaluatePublishEligibility's inputs
-- (rights_status, owned, source_type), any existing CHECK, any RLS policy on
-- media_assets, or either storage bucket policy. The new table's public-read
-- policy is strictly NARROWER than media_assets' own: it additionally requires
-- the derivative to have been copied to the public bucket.

begin;

-- ---------------------------------------------------------------------------
-- 1. media_assets.licence_permits_modification — the third state is the point
-- ---------------------------------------------------------------------------
--
-- NULLABLE BOOLEAN, DEFAULT NULL, and null means NOBODY HAS RECORDED IT — not
-- "no" and emphatically not "yes". Same lesson as products.owner_access,
-- engine_job_runs.stage_outcome and engine_discovery_evidence.origin_examined:
-- this project has been bitten repeatedly by unmeasured state reading as a
-- finding, so "assessed and forbidden" and "never assessed" stay
-- distinguishable. Both refuse the watermark; only one of them is a question
-- somebody still has to answer.
--
-- NOT a generated column and NOT derived from `license`. Whether a licence
-- permits alteration is a reading of its terms by a person, and parsing it out
-- of a free-text licence name would manufacture a fact.

alter table public.media_assets
  add column if not exists licence_permits_modification boolean,
  add column if not exists licence_modification_note text,
  add column if not exists licence_modification_assessed_at timestamptz,
  add column if not exists licence_modification_assessed_by uuid
    references public.admin_users(id) on delete set null;

comment on column public.media_assets.licence_permits_modification is
  'Whether the asset''s licence permits ALTERING the image (watermarking, cropping to a new ratio, '
  'overlaying). NULL means nobody has assessed it and is never treated as permission — see '
  'modificationPermission() in src/lib/media/derivatives.ts. Distinct from whether the licence '
  'permits reuse, which `license` and rights_status already cover.';

-- A recorded assessment must say who and when. An answer with no provenance is
-- indistinguishable from a guess three years later.
do $$
begin
  if not exists (
    select 1 from pg_constraint where conname = 'media_assets_licence_modification_attributed'
  ) then
    alter table public.media_assets
      add constraint media_assets_licence_modification_attributed
      check (
        licence_permits_modification is null
        or (licence_modification_assessed_at is not null and licence_modification_assessed_by is not null)
      );
  end if;
end $$;

-- ---------------------------------------------------------------------------
-- 2. media_derivatives — the derived objects, never the master
-- ---------------------------------------------------------------------------
--
-- THE MASTER IS NOT IN THIS TABLE AND CANNOT BE. It lives at
-- media_assets.storage_path and is the permanent archive/evidence record. The
-- `storage_path like 'derivatives/%'` CHECK is what makes that structural
-- rather than conventional: no row of this table can name an object outside
-- the derivatives namespace, so no derivative-writing code path can be pointed
-- at a master, whatever it computes. Mirrors DERIVATIVE_PATH_PREFIX and
-- assertMasterRetained() in src/lib/media/derivatives.ts.

create table if not exists public.media_derivatives (
  id uuid primary key default gen_random_uuid(),
  media_asset_id uuid not null references public.media_assets(id) on delete cascade,

  -- Which crop and size this is. Mirrors CropName / RESPONSIVE_WIDTHS.
  crop text not null check (crop in ('natural', 'square', 'og')),
  width integer not null check (width > 0),
  height integer check (height is null or height > 0),
  format text not null check (format in ('avif', 'webp', 'jpeg', 'png')),

  -- The private object, always under derivatives/. See the note above.
  storage_path text not null check (storage_path like 'derivatives/%'),
  -- The media-public copy, populated only by the publish action. Same
  -- private-until-explicitly-published contract as media_assets.
  public_storage_path text check (public_storage_path is null or public_storage_path like 'derivatives/%'),

  watermarked boolean not null default false,
  bytes bigint check (bytes is null or bytes >= 0),
  content_hash text,
  created_at timestamptz not null default now(),

  -- One object per (asset, crop, width, format). Re-running the pipeline
  -- replaces rather than accumulating.
  unique (media_asset_id, crop, width, format),
  unique (storage_path)
);

-- Same publication-consistency invariant media_assets already carries: a row
-- either has a public copy and is public, or has neither.
alter table public.media_derivatives drop constraint if exists media_derivatives_public_path_check;
alter table public.media_derivatives
  add constraint media_derivatives_public_path_check
  check (public_storage_path is null or public_storage_path = storage_path);

create index if not exists media_derivatives_asset_idx
  on public.media_derivatives (media_asset_id);
create index if not exists media_derivatives_public_idx
  on public.media_derivatives (media_asset_id) where public_storage_path is not null;
create index if not exists media_derivatives_hash_idx
  on public.media_derivatives (content_hash) where content_hash is not null;

comment on table public.media_derivatives is
  'Derived responsive/cropped/watermarked renditions of a media asset. Never contains the master, '
  'which stays at media_assets.storage_path — the CHECK on storage_path enforces that structurally. '
  'Written by the pipeline planned in src/lib/media/derivatives.ts.';

-- ---------------------------------------------------------------------------
-- 3. shouldWatermark(), enforced in the database
-- ---------------------------------------------------------------------------
--
-- The TypeScript gate is the primary enforcement point and this does not
-- replace it. But shouldWatermark() runs in application code, which means a
-- direct SQL insert, a future code path that forgets to call it, or a bulk
-- backfill can still write the state the gate exists to prevent — the same
-- reasoning behind media_assets_external_verified_needs_provenance in
-- 20260822_media_provenance_evidence.sql.
--
-- A cross-table condition cannot be a CHECK, so it is a trigger. It is
-- deliberately a SUBSET of the TypeScript rules (the ones expressible against
-- the parent row), so it can only ever refuse MORE than the code does, never
-- less: it does not know about filename heuristics or the legibility floor.

create or replace function public.media_derivative_watermark_guard()
returns trigger
language plpgsql
as $fn$
declare
  a public.media_assets%rowtype;
begin
  if new.watermarked is not true then
    return new;
  end if;

  select * into a from public.media_assets where id = new.media_asset_id;
  if not found then
    raise exception 'media_derivatives: parent asset % not found', new.media_asset_id;
  end if;

  if a.media_type is distinct from 'image' then
    raise exception 'Watermarking applies to still images only (asset %).', a.id;
  end if;
  if a.rights_status = 'restricted' then
    raise exception 'Asset % is restricted; nothing derived from it may be watermarked.', a.id;
  end if;
  if a.brand_role is not null or a.asset_role in ('logo_brand', 'icon') then
    raise exception 'Asset % is a brand/logo asset; a watermark would deface the mark itself.', a.id;
  end if;
  if a.asset_role in ('diagram', 'chart', 'comparison_graphic', 'screenshot', 'social_og', 'background')
     or a.asset_role is null then
    raise exception 'Asset % has role %; a watermark would obscure what the image is for (null = unassessed, which is not permission).', a.id, coalesce(a.asset_role, 'unrecorded');
  end if;
  if coalesce(a.ai_generated, false) then
    raise exception 'Asset % is machine-generated; a watermark would assert it is our photograph.', a.id;
  end if;
  if a.source_type is distinct from 'staff_photograph' then
    raise exception 'Asset % is not a staff photograph (source %); only our own photography is watermarked.', a.id, coalesce(a.source_type, 'unrecorded');
  end if;
  if coalesce(a.owned, false) is not true then
    raise exception 'Asset % is not recorded as owned; a watermark asserts ownership.', a.id;
  end if;
  if a.licence_permits_modification is false then
    raise exception 'Asset %: the recorded licence forbids modification, and a watermark is a modification.', a.id;
  end if;
  -- Unknown is a refusal, not a default-allow. An owned staff photograph with
  -- no external licence recorded needs no permission; anything else does.
  if a.licence_permits_modification is null and a.license is not null then
    raise exception 'Asset %: a licence is recorded but whether it permits modification is not. Record the assessment first.', a.id;
  end if;

  return new;
end;
$fn$;

drop trigger if exists media_derivatives_watermark_guard on public.media_derivatives;
create trigger media_derivatives_watermark_guard
  before insert or update on public.media_derivatives
  for each row execute function public.media_derivative_watermark_guard();

comment on function public.media_derivative_watermark_guard is
  'Refuses to store a watermarked derivative of anything that is not our own owned photograph in a '
  'role a mark does not damage. Mirrors shouldWatermark() in src/lib/media/derivatives.ts as a subset '
  '— it can only refuse more than the application gate, never less.';

-- ---------------------------------------------------------------------------
-- 4. RLS — strictly narrower than media_assets' own policy
-- ---------------------------------------------------------------------------

alter table public.media_derivatives enable row level security;

-- Public read requires BOTH that the parent asset is published AND that this
-- particular derivative has a public copy. The second condition is the one
-- media_assets cannot express: an asset can be published while some of its
-- derivatives (the unwatermarked ones, say) deliberately are not.
create policy "public can read published media derivatives" on public.media_derivatives
  for select to anon, authenticated
  using (
    public_storage_path is not null
    and exists (
      select 1 from public.media_assets m
      where m.id = media_asset_id and m.publication_status = 'published'
    )
  );

create policy "admins can read all media derivatives" on public.media_derivatives
  for select to authenticated
  using (public.is_admin());

create policy "admins can write media derivatives" on public.media_derivatives
  for all to authenticated
  using (public.is_admin()) with check (public.is_admin());

commit;

-- ---------------------------------------------------------------------------
-- Verification — run these; the success message is not evidence
-- ---------------------------------------------------------------------------
--   -- (a) The new column defaulted to NULL everywhere, not to a guess:
--   select licence_permits_modification, count(*)
--     from public.media_assets group by 1 order by 2 desc;
--   -- expect: a single row, NULL, equal to the full media_assets count (~112).
--
--   -- (b) The attribution constraint fires. Inside a transaction, then roll back:
--   begin;
--     update public.media_assets set licence_permits_modification = true
--       where id = (select id from public.media_assets limit 1);
--   rollback;
--   -- expect: 23514 media_assets_licence_modification_attributed, NOT success.
--
--   -- (c) The derivatives namespace CHECK actually rejects a master path:
--   begin;
--     insert into public.media_derivatives
--       (media_asset_id, crop, width, format, storage_path)
--     values ((select id from public.media_assets limit 1),
--             'natural', 1200, 'webp', 'image/some-master.jpg');
--   rollback;
--   -- expect: 23514 violating media_derivatives_storage_path_check, NOT success.
--
--   -- (d) The watermark guard refuses a third-party asset. Pick a real one first:
--   select id, source_type, owned, asset_role, rights_status
--     from public.media_assets where source_type <> 'staff_photograph' limit 1;
--   begin;
--     insert into public.media_derivatives
--       (media_asset_id, crop, width, format, storage_path, watermarked)
--     values ('<that id>', 'natural', 1200, 'webp',
--             'derivatives/<that id>/natural/1200.webp', true);
--   rollback;
--   -- expect: 'is not a staff photograph' (or an earlier, more specific refusal).
--   -- There are currently ZERO staff_photograph rows, so EVERY asset in the
--   -- library must be refused by this guard today. Confirm that:
--   select count(*) from public.media_assets where source_type = 'staff_photograph';
--   -- expect: 0. If it is not 0, re-check which rows changed and why.
--
--   -- (e) An unwatermarked derivative of the same asset inserts fine —
--   --     the guard gates the MARK, not the pipeline:
--   begin;
--     insert into public.media_derivatives
--       (media_asset_id, crop, width, format, storage_path)
--     values ('<that id>', 'natural', 1200, 'webp',
--             'derivatives/<that id>/natural/1200.webp');
--   rollback;
--   -- expect: INSERT 0 1.
--
--   -- (f) anon sees no derivative rows at all yet (none has a public copy):
--   --     GET /rest/v1/media_derivatives?select=id&limit=5    (as anon)
--   -- expect: []. And after a publish, only rows with public_storage_path set.
--
--   -- (g) Nothing about media_assets' own visibility changed:
--   --     GET /rest/v1/media_assets?select=id&limit=5         (as anon)
--   -- expect: the same published-only count as before this migration.

-- ---------------------------------------------------------------------------
-- NOT INCLUDED, and why
-- ---------------------------------------------------------------------------
-- * No change to publishMediaAsset()'s behaviour. It still copies the MASTER
--   into media-public. That is wrong once watermarking is live — publishing the
--   unmarked full-resolution original one URL away from the marked derivatives
--   defeats the exercise entirely — but changing the publish action is a code
--   change with its own review, not something to smuggle into a schema
--   migration. buildUploadPlan() emits a warning saying exactly this whenever it
--   plans a watermarked asset.
-- * No storage bucket or storage.objects policy change. Derivatives live under
--   `derivatives/` inside the EXISTING media-private and media-public buckets,
--   which the existing admin-only-write / public-read policies already cover.
-- * No backfill. Every existing row keeps licence_permits_modification = NULL,
--   which refuses the watermark. Filling that in is an editorial assessment per
--   asset, and inventing 112 of them in SQL is exactly the fabrication the
--   rights model exists to prevent.
