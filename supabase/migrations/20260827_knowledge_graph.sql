-- The knowledge graph: reusable technology concepts, evidenced relationships,
-- maturity states, and a source CLASS that is not a reliability tier.
--
-- WHY THIS SHAPE
-- --------------
-- The catalogue is about to grow from 44 products to several hundred, across
-- camera lenses, 3D printers and future-tech hardware. Four things are missing,
-- and each one would otherwise be worked around badly:
--
-- 1. CONCEPTS HAVE NOWHERE TO LIVE. "Canon Nano USM", "CoreXY", "PETG",
--    "RF mount" are not products and not tags. They are things a reader wants
--    explained once and linked from everywhere. Modelling them as taxonomy_tags
--    would give them no summary and no sources; modelling them as products would
--    put a focus motor in the catalogue next to a camera body. They get their
--    own table.
--
-- 2. RELATIONSHIPS CARRY NO EVIDENCE. product_relationships records that A
--    succeeds B and nothing about why anyone believes that. The brief is explicit
--    that a successor must not be inferred from matching focal lengths, so the
--    reason has to be storable and reviewable.
--
-- 3. "ANNOUNCED" AND "SHIPPING" ARE THE SAME ROW. products.status is
--    active/discontinued/rumored, which cannot distinguish a demonstrated
--    prototype from a product you can buy. For Tesla Optimus, Robotaxi and
--    half the 3D-printing market that distinction IS the story.
--
-- 4. A MANUFACTURER IS NOT A SOURCE CLASS. source_records.reliability_tier
--    (primary/secondary/community) answers "how much weight does this carry".
--    It does not answer "what KIND of thing is this" — a manufacturer spec page
--    and an independent lab test can both be primary and are not the same claim.
--    Conflating them is how ten syndicated copies become ten confirmations.
--
-- WHAT THIS DELIBERATELY DOES NOT DO
-- ----------------------------------
-- No lens-specific or printer-specific COLUMNS. CLAUDE.md's rule stands: specs
-- are spec_definitions + product_specs, category-scoped, so a lens's filter
-- diameter and a printer's nozzle temperature use the same mechanism. Nothing
-- below adds a `focal_length_mm` column, and nothing should.
--
-- Relationships stay ONE-DIRECTIONAL with the reverse inferred at query time,
-- exactly as product_relationships already works. Nothing here inserts a
-- reciprocal row.

-- ---------------------------------------------------------------------------
-- 1. Technology concepts
-- ---------------------------------------------------------------------------

create table if not exists public.technology_concepts (
  id uuid primary key default gen_random_uuid(),
  slug text not null unique,
  name text not null,
  -- Broad shape of the concept, so a page can group them sensibly. Text with a
  -- CHECK rather than an enum type: adding a kind should be one migration, and
  -- this list will grow as verticals are added.
  kind text not null check (kind in (
    'mount', 'focus_motor', 'stabilisation', 'lens_line', 'optical_design',
    'sensor', 'connectivity', 'printer_kinematics', 'printer_feature',
    'material', 'compute', 'autonomy', 'standard', 'other'
  )),
  -- Brand-specific concepts point at their maker; generic ones (CoreXY, PETG)
  -- do not. Nullable on purpose.
  manufacturer_id uuid references public.manufacturers(id) on delete set null,
  category_id uuid references public.taxonomy_categories(id) on delete set null,
  summary text,
  -- Only a concept with a real explanation is worth linking to a reader.
  -- Enforced at publish time by the app, not here, because a stub row is a
  -- legitimate intermediate state while research lands.
  is_published boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists technology_concepts_kind_idx on public.technology_concepts (kind);
create index if not exists technology_concepts_manufacturer_idx on public.technology_concepts (manufacturer_id);

comment on table public.technology_concepts is
  'Reusable explainable concepts (Canon Nano USM, RF mount, CoreXY, PETG). Not products, not tags: they carry a summary and their own sources, and products and articles both link to them.';

-- Products that use a concept.
create table if not exists public.product_technologies (
  product_id uuid not null references public.products(id) on delete cascade,
  technology_id uuid not null references public.technology_concepts(id) on delete cascade,
  note text,
  created_at timestamptz not null default now(),
  primary key (product_id, technology_id)
);

-- Articles that explain or reference a concept.
create table if not exists public.content_technologies (
  content_id uuid not null references public.content_items(id) on delete cascade,
  technology_id uuid not null references public.technology_concepts(id) on delete cascade,
  -- 'explains' is the pillar article for the concept; 'references' merely
  -- mentions it. The distinction is what stops every article that says "USM"
  -- claiming to be the USM explainer.
  role text not null default 'references' check (role in ('explains', 'references')),
  created_at timestamptz not null default now(),
  primary key (content_id, technology_id)
);
-- At most one article may be the explainer for a concept.
create unique index if not exists content_technologies_one_explainer
  on public.content_technologies (technology_id) where role = 'explains';

-- Concept-to-concept edges (Nano USM is a kind of USM; RF mount succeeds EF).
create table if not exists public.technology_relationships (
  id uuid primary key default gen_random_uuid(),
  technology_id uuid not null references public.technology_concepts(id) on delete cascade,
  related_technology_id uuid not null references public.technology_concepts(id) on delete cascade,
  relationship_type text not null check (relationship_type in (
    'kind_of', 'succeeds', 'related_to', 'competes_with', 'requires'
  )),
  basis text,
  source_url text,
  created_at timestamptz not null default now(),
  -- One direction only, and never to itself.
  constraint technology_relationships_not_self check (technology_id <> related_technology_id),
  unique (technology_id, related_technology_id, relationship_type)
);

-- ---------------------------------------------------------------------------
-- 2. Relationships gain evidence, and the vocabulary the catalogue needs
-- ---------------------------------------------------------------------------

alter table public.product_relationships
  -- WHY anyone believes this edge. The brief forbids inferring a successor from
  -- matching focal lengths, which is only enforceable if the reason is written
  -- down and can be reviewed.
  add column if not exists basis text,
  add column if not exists source_url text;

comment on column public.product_relationships.basis is
  'Why this edge is asserted. A successor must never be inferred from similar specifications alone — see the catalogue expansion brief.';

-- The existing five values stay exactly as they are; six are added. Nothing is
-- renamed or removed, so every existing row and every existing reader keeps
-- working.
--
-- `predecessor` is deliberately NOT added: relationships are stored one
-- directional and the reverse is inferred at query time, so successor_of
-- already expresses both. Adding predecessor would let the same fact be stored
-- twice and disagree with itself.
alter table public.product_relationships
  drop constraint if exists product_relationships_relationship_type_check;
alter table public.product_relationships
  add constraint product_relationships_relationship_type_check
  check (relationship_type in (
    'successor_of', 'alternative_to', 'accessory_for', 'compatible_with', 'requires',
    'same_family', 'modern_equivalent', 'mount_successor', 'requires_adapter',
    'supports_extender', 'competes_with'
  ));

-- ---------------------------------------------------------------------------
-- 3. Maturity — announced is not shipping
-- ---------------------------------------------------------------------------

alter table public.products
  add column if not exists maturity text not null default 'unknown'
    check (maturity in (
      'announced',              -- stated to exist, nothing shown
      'demonstrated',           -- shown working, in a controlled setting
      'prototype',              -- physical unit exists, not a product
      'pilot',                  -- limited real-world deployment
      'production',             -- being manufactured
      'commercially_available', -- a member of the public can buy it
      'discontinued',
      'unknown'                 -- NOBODY HAS ASSESSED IT
    ));

comment on column public.products.maturity is
  'How real this product is. Separate from `status`, which is a catalogue lifecycle field. Default ''unknown'' means NOBODY HAS ASSESSED IT, never ''does not exist''. For future-tech entries the gap between announced/demonstrated and commercially_available is frequently the entire story.';

-- ---------------------------------------------------------------------------
-- 4. Source CLASS, which is not reliability
-- ---------------------------------------------------------------------------

alter table public.source_records
  add column if not exists source_class text not null default 'unclassified'
    check (source_class in (
      'manufacturer_official',    -- the maker's own page. Authoritative for specs; NOT independent.
      'standards_body',           -- IEEE, Wi-Fi Alliance, regulator
      'primary_documentation',    -- manuals, datasheets, filings
      'independent_publication',  -- an outlet doing its own reporting
      'independent_test',         -- somebody who actually measured it
      'retailer',                 -- listing pages. Weak, and volatile.
      'community',                -- forums, enthusiast accounts
      'unclassified'
    ));

comment on column public.source_records.source_class is
  'What KIND of source this is. Orthogonal to reliability_tier, which is how much weight it carries. A manufacturer spec page and an independent lab test can both be primary and are not the same claim — collapsing them is how a manufacturer''s assertion is mistaken for verification.';

-- ---------------------------------------------------------------------------
-- 3b. How precisely a release date is actually known
-- ---------------------------------------------------------------------------
-- Canon, Nikon and Sony announce lenses with MONTH precision — "September 2019"
-- — and that is genuinely all that is known. release_date is a date column, so
-- storing that means writing 2019-09-01, and the site renders dates as
-- "1 Sep 2019". A fabricated day is a small lie printed on several hundred
-- pages.
--
-- The alternative of discarding month-precision dates is worse: it throws away
-- real information and leaves the release date empty on most of the catalogue.
--
-- So the date is stored at the first of the month and the PRECISION is stored
-- beside it, and the display layer renders only what is known.

alter table public.products
  add column if not exists release_date_precision text not null default 'day'
    check (release_date_precision in ('day', 'month', 'year', 'unknown'));

comment on column public.products.release_date_precision is
  'How precisely release_date is known. ''month'' means the day component is a storage artefact and MUST NOT be displayed. Defaults to ''day'' so existing rows, which were entered with real days, are unaffected.';

-- ---------------------------------------------------------------------------
-- 4b. Manufacturer claims, which are not evidence
-- ---------------------------------------------------------------------------
-- "Up to 8 stops of stabilisation." "600 mm/s." "16x faster." These are the
-- most quotable numbers in the catalogue and the least trustworthy, because
-- they are assertions by the party selling the product, under conditions
-- nobody states.
--
-- They must be STORED — they are what the box says, and a reader comparing two
-- lenses wants to see them — but they must not be stored as specifications,
-- because a spec row reads as a fact about the object.
--
-- And they must not go in evidence_records. That table is about TESTING:
-- test_type, conditions, tested_by, tested_at. A manufacturer claim has no
-- tester. Filing it there would make the site's own evidence count include
-- things nobody measured, which is precisely the distinction the catalogue
-- brief insists on keeping.

create table if not exists public.product_claims (
  id uuid primary key default gen_random_uuid(),
  product_id uuid not null references public.products(id) on delete cascade,
  -- The claim in the maker's own words. Not paraphrased: the wording is the
  -- evidence, and paraphrasing a marketing claim tends to launder it.
  claim text not null,
  claim_kind text not null default 'manufacturer_marketing' check (claim_kind in (
    'manufacturer_performance',    -- speed, stabilisation stops, battery life
    'manufacturer_compatibility',  -- "works with X"
    'manufacturer_marketing',      -- everything else the maker asserts
    'third_party_measured'         -- somebody actually measured it
  )),
  source_url text,
  retrieved_at date,
  -- FALSE means NOBODY HAS CHECKED, never "checked and found false". The same
  -- rule as owner_access and origin_examined elsewhere in this schema.
  independently_verified boolean not null default false,
  verification_note text,
  created_at timestamptz not null default now()
);
create index if not exists product_claims_product_idx on public.product_claims (product_id);

comment on table public.product_claims is
  'What the manufacturer says, in their words. NOT specifications and NOT evidence_records — a claim has no tester. independently_verified defaults false meaning nobody has checked, never "checked and found false".';

alter table public.product_claims enable row level security;
drop policy if exists "public can read claims of published products" on public.product_claims;
create policy "public can read claims of published products" on public.product_claims
  for select to anon, authenticated
  using (exists (
    select 1 from public.products p
     where p.id = product_claims.product_id and p.is_published
  ));
drop policy if exists "admins can write product claims" on public.product_claims;
create policy "admins can write product claims" on public.product_claims
  for all to authenticated using (public.is_admin()) with check (public.is_admin());
grant select on public.product_claims to anon, authenticated;
grant insert, update, delete on public.product_claims to authenticated;

-- ---------------------------------------------------------------------------
-- 5. RLS — reference data, world-readable, admin-written
-- ---------------------------------------------------------------------------
-- Exactly the shape manufacturers and taxonomy already use. The join tables
-- follow their parents.

alter table public.technology_concepts enable row level security;
alter table public.product_technologies enable row level security;
alter table public.content_technologies enable row level security;
alter table public.technology_relationships enable row level security;

drop policy if exists "public can read technology concepts" on public.technology_concepts;
create policy "public can read technology concepts" on public.technology_concepts
  for select to anon, authenticated using (true);
drop policy if exists "admins can write technology concepts" on public.technology_concepts;
create policy "admins can write technology concepts" on public.technology_concepts
  for all to authenticated using (public.is_admin()) with check (public.is_admin());

drop policy if exists "public can read product technologies" on public.product_technologies;
create policy "public can read product technologies" on public.product_technologies
  for select to anon, authenticated using (true);
drop policy if exists "admins can write product technologies" on public.product_technologies;
create policy "admins can write product technologies" on public.product_technologies
  for all to authenticated using (public.is_admin()) with check (public.is_admin());

-- content_technologies is the one join that must NOT be world-readable in full:
-- it would otherwise reveal which unpublished articles exist and what they are
-- about. Public reads are gated on the parent article being published, the same
-- rule source_records already follows.
drop policy if exists "public can read technologies of published content" on public.content_technologies;
create policy "public can read technologies of published content" on public.content_technologies
  for select to anon, authenticated
  using (exists (
    select 1 from public.content_items ci
     where ci.id = content_technologies.content_id
       and ci.status = 'published'
       and ci.published_at <= now()
  ));
drop policy if exists "admins can write content technologies" on public.content_technologies;
create policy "admins can write content technologies" on public.content_technologies
  for all to authenticated using (public.is_admin()) with check (public.is_admin());

drop policy if exists "public can read technology relationships" on public.technology_relationships;
create policy "public can read technology relationships" on public.technology_relationships
  for select to anon, authenticated using (true);
drop policy if exists "admins can write technology relationships" on public.technology_relationships;
create policy "admins can write technology relationships" on public.technology_relationships
  for all to authenticated using (public.is_admin()) with check (public.is_admin());

grant select on public.technology_concepts to anon, authenticated;
grant select on public.product_technologies to anon, authenticated;
grant select on public.content_technologies to anon, authenticated;
grant select on public.technology_relationships to anon, authenticated;
grant insert, update, delete on public.technology_concepts to authenticated;
grant insert, update, delete on public.product_technologies to authenticated;
grant insert, update, delete on public.content_technologies to authenticated;
grant insert, update, delete on public.technology_relationships to authenticated;

-- ---------------------------------------------------------------------------
-- 6. VERIFICATION — runs, does not need uncommenting, rolls back if wrong
-- ---------------------------------------------------------------------------
do $$
declare
  v_products     integer;
  v_unknown      integer;
  v_sources      integer;
  v_unclassified integer;
  v_rel          integer;
  v_bad_rel      integer;
begin
  -- Nothing may be silently reclassified by adding a column.
  select count(*), count(*) filter (where maturity = 'unknown') into v_products, v_unknown
    from public.products;
  if v_unknown <> v_products then
    raise exception 'ROLLED BACK: only % of % products took the default maturity. Something guessed.',
      v_unknown, v_products;
  end if;

  select count(*), count(*) filter (where source_class = 'unclassified') into v_sources, v_unclassified
    from public.source_records;
  if v_unclassified <> v_sources then
    raise exception 'ROLLED BACK: only % of % source_records took the default class.',
      v_unclassified, v_sources;
  end if;

  -- Every pre-existing relationship must still satisfy the widened CHECK.
  select count(*) into v_rel from public.product_relationships;
  select count(*) into v_bad_rel from public.product_relationships
   where relationship_type not in (
     'successor_of','alternative_to','accessory_for','compatible_with','requires',
     'same_family','modern_equivalent','mount_successor','requires_adapter',
     'supports_extender','competes_with');
  if v_bad_rel <> 0 then
    raise exception 'ROLLED BACK: % existing relationship rows fall outside the new CHECK.', v_bad_rel;
  end if;

  -- The new tables must exist and be empty.
  if (select count(*) from public.technology_concepts) <> 0 then
    raise exception 'ROLLED BACK: technology_concepts is not empty on creation.';
  end if;

  if (select count(*) from public.products where release_date_precision <> 'day') <> 0 then
    raise exception 'ROLLED BACK: existing products did not keep day precision.';
  end if;

  raise notice 'OK — % products default to maturity unknown, % source_records to unclassified, % relationships preserved.',
    v_unknown, v_unclassified, v_rel;
end $$;

-- Independent confirmation afterwards (plain SELECTs, change nothing):
--
--   select maturity, count(*) from public.products group by 1;
--   -- expect: unknown = every product.
--
--   select source_class, count(*) from public.source_records group by 1;
--   -- expect: unclassified = every row.
--
--   select relationship_type, count(*) from public.product_relationships group by 1;
--   -- expect: only the ORIGINAL five values present, with their original counts.
--
--   -- anon must read concepts but not the technologies of an unpublished article:
--   --   GET /rest/v1/technology_concepts?select=slug&limit=1      -> 200, readable
--   --   GET /rest/v1/content_technologies?select=content_id       -> 200, only published parents
