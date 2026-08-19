-- Tech Carvalho — Milestone 1 Row Level Security
--
-- Rules applied uniformly:
-- * RLS is enabled on every public-schema table.
-- * Structural/reference data (taxonomy, manufacturers, product families,
--   spec definitions, media assets) is world-readable — it carries no
--   editorial judgement or draft state.
-- * Editorial data (products, content_items) is world-readable only when
--   explicitly published (products.is_published, content_items.status).
-- * Tables that hang off products/content (specs, tags, relationships,
--   media joins, evidence, sources, freshness, SEO) are world-readable
--   only when their published parent(s) are visible.
-- * All writes (insert/update/delete) require public.is_admin().
-- * admin_users is never publicly readable; an admin may only read their
--   own row. There is no public write policy at all — provisioning is a
--   manual, service-role/dashboard operation.

alter table public.admin_users enable row level security;
alter table public.media_assets enable row level security;
alter table public.taxonomy_categories enable row level security;
alter table public.taxonomy_tags enable row level security;
alter table public.manufacturers enable row level security;
alter table public.product_families enable row level security;
alter table public.products enable row level security;
alter table public.product_relationships enable row level security;
alter table public.product_tags enable row level security;
alter table public.spec_definitions enable row level security;
alter table public.product_specs enable row level security;
alter table public.content_items enable row level security;
alter table public.content_tags enable row level security;
alter table public.content_products enable row level security;
alter table public.product_media enable row level security;
alter table public.content_media enable row level security;
alter table public.evidence_records enable row level security;
alter table public.source_records enable row level security;
alter table public.freshness_log enable row level security;
alter table public.seo_metadata enable row level security;

-- ----------------------------------------------------------------------------
-- admin_users — self read only, no public policy, no client write policy
-- ----------------------------------------------------------------------------

create policy "admins can read own row" on public.admin_users
  for select to authenticated
  using (id = auth.uid());

-- ----------------------------------------------------------------------------
-- Structural / reference data — public read, admin write
-- ----------------------------------------------------------------------------

create policy "public can read media assets" on public.media_assets
  for select to anon, authenticated
  using (true);
create policy "admins can write media assets" on public.media_assets
  for all to authenticated
  using (public.is_admin()) with check (public.is_admin());

create policy "public can read taxonomy categories" on public.taxonomy_categories
  for select to anon, authenticated
  using (true);
create policy "admins can write taxonomy categories" on public.taxonomy_categories
  for all to authenticated
  using (public.is_admin()) with check (public.is_admin());

create policy "public can read taxonomy tags" on public.taxonomy_tags
  for select to anon, authenticated
  using (true);
create policy "admins can write taxonomy tags" on public.taxonomy_tags
  for all to authenticated
  using (public.is_admin()) with check (public.is_admin());

create policy "public can read manufacturers" on public.manufacturers
  for select to anon, authenticated
  using (true);
create policy "admins can write manufacturers" on public.manufacturers
  for all to authenticated
  using (public.is_admin()) with check (public.is_admin());

create policy "public can read product families" on public.product_families
  for select to anon, authenticated
  using (true);
create policy "admins can write product families" on public.product_families
  for all to authenticated
  using (public.is_admin()) with check (public.is_admin());

create policy "public can read spec definitions" on public.spec_definitions
  for select to anon, authenticated
  using (true);
create policy "admins can write spec definitions" on public.spec_definitions
  for all to authenticated
  using (public.is_admin()) with check (public.is_admin());

-- ----------------------------------------------------------------------------
-- products — public read only when published, admin write always
-- ----------------------------------------------------------------------------

create policy "public can read published products" on public.products
  for select to anon, authenticated
  using (is_published = true);
create policy "admins can read all products" on public.products
  for select to authenticated
  using (public.is_admin());
create policy "admins can write products" on public.products
  for all to authenticated
  using (public.is_admin()) with check (public.is_admin());

create policy "public can read relationships between published products" on public.product_relationships
  for select to anon, authenticated
  using (
    exists (select 1 from public.products p where p.id = product_id and p.is_published)
    and exists (select 1 from public.products p where p.id = related_product_id and p.is_published)
  );
create policy "admins can write product relationships" on public.product_relationships
  for all to authenticated
  using (public.is_admin()) with check (public.is_admin());

create policy "public can read tags of published products" on public.product_tags
  for select to anon, authenticated
  using (exists (select 1 from public.products p where p.id = product_id and p.is_published));
create policy "admins can write product tags" on public.product_tags
  for all to authenticated
  using (public.is_admin()) with check (public.is_admin());

create policy "public can read specs of published products" on public.product_specs
  for select to anon, authenticated
  using (exists (select 1 from public.products p where p.id = product_id and p.is_published));
create policy "admins can write product specs" on public.product_specs
  for all to authenticated
  using (public.is_admin()) with check (public.is_admin());

-- ----------------------------------------------------------------------------
-- content_items — public read only when published, admin write always
-- ----------------------------------------------------------------------------

create policy "public can read published content" on public.content_items
  for select to anon, authenticated
  using (status = 'published' and published_at <= now());
create policy "admins can read all content" on public.content_items
  for select to authenticated
  using (public.is_admin());
create policy "admins can write content" on public.content_items
  for all to authenticated
  using (public.is_admin()) with check (public.is_admin());

create policy "public can read tags of published content" on public.content_tags
  for select to anon, authenticated
  using (
    exists (
      select 1 from public.content_items c
      where c.id = content_id and c.status = 'published' and c.published_at <= now()
    )
  );
create policy "admins can write content tags" on public.content_tags
  for all to authenticated
  using (public.is_admin()) with check (public.is_admin());

create policy "public can read content-product links when both published" on public.content_products
  for select to anon, authenticated
  using (
    exists (
      select 1 from public.content_items c
      where c.id = content_id and c.status = 'published' and c.published_at <= now()
    )
    and exists (select 1 from public.products p where p.id = product_id and p.is_published)
  );
create policy "admins can write content products" on public.content_products
  for all to authenticated
  using (public.is_admin()) with check (public.is_admin());

-- ----------------------------------------------------------------------------
-- Media joins — public read only when the owning product/content is published
-- ----------------------------------------------------------------------------

create policy "public can read media of published products" on public.product_media
  for select to anon, authenticated
  using (exists (select 1 from public.products p where p.id = product_id and p.is_published));
create policy "admins can write product media" on public.product_media
  for all to authenticated
  using (public.is_admin()) with check (public.is_admin());

create policy "public can read media of published content" on public.content_media
  for select to anon, authenticated
  using (
    exists (
      select 1 from public.content_items c
      where c.id = content_id and c.status = 'published' and c.published_at <= now()
    )
  );
create policy "admins can write content media" on public.content_media
  for all to authenticated
  using (public.is_admin()) with check (public.is_admin());

-- ----------------------------------------------------------------------------
-- Evidence / sourcing / freshness / SEO — public read only via published parent
-- ----------------------------------------------------------------------------

create policy "public can read evidence of published parents" on public.evidence_records
  for select to anon, authenticated
  using (
    exists (select 1 from public.products p where p.id = product_id and p.is_published)
    or exists (
      select 1 from public.content_items c
      where c.id = content_id and c.status = 'published' and c.published_at <= now()
    )
  );
create policy "admins can write evidence records" on public.evidence_records
  for all to authenticated
  using (public.is_admin()) with check (public.is_admin());

create policy "public can read sources of published parents" on public.source_records
  for select to anon, authenticated
  using (
    exists (select 1 from public.products p where p.id = product_id and p.is_published)
    or exists (
      select 1 from public.content_items c
      where c.id = content_id and c.status = 'published' and c.published_at <= now()
    )
    or exists (
      select 1 from public.product_specs ps
      join public.products p on p.id = ps.product_id
      where ps.id = product_spec_id and p.is_published
    )
  );
create policy "admins can write source records" on public.source_records
  for all to authenticated
  using (public.is_admin()) with check (public.is_admin());

create policy "public can read freshness of published parents" on public.freshness_log
  for select to anon, authenticated
  using (
    exists (select 1 from public.products p where p.id = product_id and p.is_published)
    or exists (
      select 1 from public.content_items c
      where c.id = content_id and c.status = 'published' and c.published_at <= now()
    )
  );
create policy "admins can write freshness log" on public.freshness_log
  for all to authenticated
  using (public.is_admin()) with check (public.is_admin());

create policy "public can read seo metadata of published parents" on public.seo_metadata
  for select to anon, authenticated
  using (
    exists (select 1 from public.products p where p.id = product_id and p.is_published)
    or exists (
      select 1 from public.content_items c
      where c.id = content_id and c.status = 'published' and c.published_at <= now()
    )
    or category_id is not null
  );
create policy "admins can write seo metadata" on public.seo_metadata
  for all to authenticated
  using (public.is_admin()) with check (public.is_admin());
