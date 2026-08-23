-- ============================================================================
-- Translation model: one factual record, four languages
-- NOT YET APPLIED. Drafted 2026-08-24.
-- ============================================================================
--
-- THE ORGANISING PRINCIPLE
-- -----------------------
-- Split every row into IDENTITY/FACT (one copy, never translated) and PROSE
-- (one copy per language), and put the prose where identity cannot reach it.
--
-- That is not tidiness. It is the only structural way to guarantee that
-- "Canon EOS 60D", "RTX 5090" and "Wi-Fi 7" survive translation: if there is no
-- per-locale column for a product name, a translator cannot translate one even
-- by trying. Every other approach relies on a rule somebody has to remember.
--
-- WHAT IS DELIBERATELY NOT TOUCHED
-- --------------------------------
-- products, manufacturers, spec_definitions, product_specs, media_assets get
-- ZERO columns added. A product's name, a spec's unit, a manufacturer's name
-- and every rights field stay single-valued for the whole site.
--
-- Shared facts need no schema change either: source_records, content_products,
-- content_media, content_tags and content_relationships keep pointing at the
-- SOURCE row and resolve through translation_group_id at query time — the same
-- "infer at query time" pattern CLAUDE.md already mandates for product
-- relationships. The 158 content_relationships rows are not quadrupled, and a
-- translated article cites exactly the same sources as its original because it
-- IS the same evidence.
--
-- STALENESS IS DERIVED, NOT STORED
-- --------------------------------
-- A translation is stale iff
--     source.translatable_revision > translation.source_revision_seen
-- and the counter is bumped by trigger ONLY when title or body change.
--
-- updated_at would be the wrong signal and it is worth saying why: flipping a
-- status, adding a tag or re-running a backfill all touch updated_at, and any
-- of those would falsely mark all three translations stale. A publication that
-- cries stale on every unrelated edit trains its editors to ignore the flag.
--
-- CANNIBALISATION
-- ---------------
-- Two items compete only if
--     a.locale = b.locale AND a.translation_group_id <> b.translation_group_id
-- Without that scoping the failure is immediate rather than subtle: a PT
-- translation carrying its source's intent_fingerprint trips the duplicate-
-- intent rule against its OWN English original, and publication-gate.ts raises
-- a hard intent_cannibalisation blocker that stops it publishing. The call
-- sites are listed at the foot of this file.
--
-- HONESTY CONSTRAINT
-- ------------------
-- Never render English body text under a /pt/ URL. That is precisely Google's
-- documented condition for treating localised pages as duplicates ("only
-- considered duplicates if the main content remains untranslated"), and it is
-- also just dishonest. A missing translation must 404, and hreflang must list
-- only locales that genuinely exist — see hreflangMap() in
-- src/lib/i18n/locales.ts.

begin;

-- ---------------------------------------------------------------------------
-- 1. The locale vocabulary, as data
-- ---------------------------------------------------------------------------
-- A table rather than an enum: adding a language must not require an ALTER TYPE
-- on a live database, and this fits the existing generic reference-table admin
-- CRUD system (see CLAUDE.md's note on the five simple reference tables).

create table if not exists public.locales (
  code text primary key check (code ~ '^[a-z]{2}$'),
  label text not null,
  -- The BCP-47 tag for hreflang and <html lang>. Unregioned on purpose: 'pt-PT'
  -- would be a claim about which Portuguese this site is written in.
  bcp47 text not null,
  is_source boolean not null default false,
  sort_order integer not null default 0
);

insert into public.locales (code, label, bcp47, is_source, sort_order) values
  ('en', 'English',    'en', true,  0),
  ('pt', 'Português',  'pt', false, 1),
  ('es', 'Español',    'es', false, 2),
  ('fr', 'Français',   'fr', false, 3)
on conflict (code) do nothing;

-- Exactly one source language.
create unique index if not exists locales_single_source_idx
  on public.locales ((is_source)) where is_source;

alter table public.locales enable row level security;
drop policy if exists locales_public_read on public.locales;
create policy locales_public_read on public.locales for select using (true);
drop policy if exists locales_admin_write on public.locales;
create policy locales_admin_write on public.locales for all to authenticated
  using (public.is_admin()) with check (public.is_admin());

-- ---------------------------------------------------------------------------
-- 2. content_items gains its locale identity
-- ---------------------------------------------------------------------------

alter table public.content_items
  add column if not exists locale text not null default 'en'
    references public.locales(code) on update cascade,
  -- The editorial family. Every language variant of one piece shares this.
  -- Defaults to the row's own id for existing rows via the backfill below, so
  -- each current article becomes the source of its own single-member family.
  add column if not exists translation_group_id uuid,
  -- The row this was translated FROM. NULL on a source-language row.
  add column if not exists source_content_id uuid
    references public.content_items(id) on delete set null,
  -- Bumped by trigger when title or body change. NOT updated_at — see header.
  add column if not exists translatable_revision integer not null default 1,
  -- The source revision this translation was made from.
  add column if not exists source_revision_seen integer,
  add column if not exists translation_state text
    check (translation_state is null or translation_state in
      ('draft', 'needs_review', 'ready', 'published', 'failed')),
  add column if not exists translated_at timestamptz,
  add column if not exists translation_reviewed_by uuid references auth.users(id) on delete set null;

-- Every existing row is its own family root.
update public.content_items
   set translation_group_id = id
 where translation_group_id is null;

alter table public.content_items
  alter column translation_group_id set not null;

-- A slug is unique WITHIN a locale, not globally: the Portuguese version of an
-- article may legitimately keep the same slug.
alter table public.content_items drop constraint if exists content_items_slug_key;
create unique index if not exists content_items_locale_slug_idx
  on public.content_items (locale, slug);

create index if not exists content_items_translation_group_idx
  on public.content_items (translation_group_id, locale);

-- A source-language row must not claim to be a translation of something, and a
-- translation must name what it came from. Structural, so it cannot drift.
alter table public.content_items drop constraint if exists content_items_translation_shape;
alter table public.content_items add constraint content_items_translation_shape check (
  (locale = 'en' and source_content_id is null)
  or (locale <> 'en' and source_content_id is not null)
);

comment on column public.content_items.translatable_revision is
  'Incremented ONLY when title or body change. updated_at is deliberately not used: a status flip or tag change would falsely stale every translation.';

-- ---------------------------------------------------------------------------
-- 3. The revision trigger
-- ---------------------------------------------------------------------------

create or replace function public.bump_translatable_revision()
returns trigger
language plpgsql
as $fn$
begin
  -- `is distinct from` rather than <> so a NULL body behaves.
  if new.title is distinct from old.title or new.body is distinct from old.body then
    new.translatable_revision := coalesce(old.translatable_revision, 1) + 1;
  end if;
  return new;
end;
$fn$;

drop trigger if exists content_items_bump_revision on public.content_items;
create trigger content_items_bump_revision
  before update on public.content_items
  for each row execute function public.bump_translatable_revision();

-- ---------------------------------------------------------------------------
-- 4. Reading translation coverage
-- ---------------------------------------------------------------------------
-- Staleness is computed here rather than stored, so it can never be wrong in
-- the way a cached boolean can.

create or replace function public.content_translation_status()
returns table (
  translation_group_id uuid,
  source_id uuid,
  source_title text,
  source_slug text,
  source_status text,
  locale text,
  translation_id uuid,
  translation_state text,
  is_stale boolean,
  translated_at timestamptz
)
language plpgsql
security definer
set search_path = public
as $fn$
begin
  if not public.is_admin() then
    -- Raises rather than returning zero rows. An empty result here would read
    -- as "everything is translated", which is the silent-success shape applied
    -- to a coverage report.
    raise exception 'content_translation_status: admin only';
  end if;

  return query
    select src.translation_group_id,
           src.id,
           src.title,
           src.slug,
           src.status,
           l.code,
           t.id,
           t.translation_state,
           -- Stale iff the source moved on since this translation was made.
           case
             when t.id is null then null
             else src.translatable_revision > coalesce(t.source_revision_seen, 0)
           end,
           t.translated_at
      from public.content_items src
      cross join public.locales l
      left join public.content_items t
        on t.translation_group_id = src.translation_group_id
       and t.locale = l.code
       and t.id <> src.id
     where src.locale = 'en'
       and l.code <> 'en'
     order by src.title, l.sort_order;
end;
$fn$;

revoke execute on function public.content_translation_status() from public;
revoke execute on function public.content_translation_status() from anon;
grant execute on function public.content_translation_status() to authenticated;

commit;

-- ============================================================================
-- VERIFICATION AFTER APPLYING
-- ============================================================================
--   select count(*) from public.locales;                      -- MUST be 4
--   select count(*) from public.content_items where translation_group_id is null;
--                                                             -- MUST be 0
--   select count(*) from public.content_items where locale <> 'en';
--                                                             -- 0 until a real translation exists
--
--   -- The revision trigger fires on prose, not on housekeeping:
--   -- (pick any draft id; do NOT run this against a published row)
--   --   update content_items set status = status where id = '<draft>';
--   --   -> translatable_revision UNCHANGED
--   --   update content_items set title = title || ' ' where id = '<draft>';
--   --   -> translatable_revision +1
--
--   select * from public.content_translation_status() limit 5;  -- admin only
--   -- as anon it MUST raise, not return zero rows.
--
-- STILL TO DO AFTER THIS LANDS (deliberately not in this migration):
--   * scope the cannibalisation checks by locale + translation_group_id. The
--     call sites are engine_shadow_content_signals(), publication-gate.ts's
--     intent_cannibalisation rule, dedupe.ts buildDedupeKey, and the duplicate
--     -intent rules in shadow-pipeline.ts. Without this a PT translation
--     competes with its own English original and is blocked from publishing.
--   * seo_metadata is per content_id already, so translated metadata needs no
--     schema change — but nothing writes it per locale yet.
