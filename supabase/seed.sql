-- Tech Carvalho — local development seed data.
--
-- This file is only executed by the Supabase CLI against a LOCAL database
-- (`supabase start` / `supabase db reset`). It is never run automatically
-- against a linked remote project. Do not run this against production —
-- everything below is placeholder demo content, clearly not real reviews,
-- ratings, or traffic. Every seeded name/slug/summary says "Demo" or "seed
-- data" so it can never be mistaken for real published content.
--
-- Note: this does not create an admin user. admin_users.id must reference a
-- real row in auth.users, which only exists once someone signs up/is
-- invited in the local Supabase Auth instance. Create that user first (via
-- the local Studio or `supabase auth`), then insert into admin_users
-- manually with that user's id.
--
-- Covers: one category, one manufacturer, one product family, three spec
-- definitions (with values set on the product), two products with a
-- predecessor/successor relationship, tags, one article with a product
-- association, and a freshness log entry — enough to exercise every admin
-- screen and every public detail-page section against real relational data.

insert into public.taxonomy_categories (name, slug, description, sort_order) values
  ('Computing', 'computing', 'PCs, components, and the software that runs on them.', 10)
on conflict (slug) do nothing;

insert into public.taxonomy_tags (name, slug) values
  ('Budget pick', 'budget-pick'),
  ('Editor favorite', 'editor-favorite')
on conflict (slug) do nothing;

insert into public.manufacturers (name, slug, website, description)
values ('Demo Manufacturer', 'demo-manufacturer', 'https://example.com', 'Seed-only placeholder manufacturer for local development.')
on conflict (slug) do nothing;

insert into public.product_families (category_id, name, slug, description)
select id, 'Demo Product Line', 'demo-product-line', 'Seed-only placeholder product family.'
from public.taxonomy_categories where slug = 'computing'
on conflict (slug) do nothing;

insert into public.spec_definitions (category_id, name, slug, data_type, unit)
select id, 'Weight', 'weight', 'number', 'g'
from public.taxonomy_categories where slug = 'computing'
on conflict (slug) do nothing;

insert into public.spec_definitions (category_id, name, slug, data_type, unit)
select id, 'Storage', 'storage', 'text', null
from public.taxonomy_categories where slug = 'computing'
on conflict (slug) do nothing;

insert into public.spec_definitions (category_id, name, slug, data_type, unit)
select id, 'Wireless', 'wireless', 'boolean', null
from public.taxonomy_categories where slug = 'computing'
on conflict (slug) do nothing;

insert into public.products (manufacturer_id, category_id, family_id, name, slug, model_number, status, summary, is_published)
select
  m.id, c.id, f.id,
  'Demo Product (seed data — not real)',
  'demo-product',
  'DEMO-001',
  'discontinued',
  'Placeholder seed product for exercising the local admin and public UI. Not a real product.',
  true
from public.manufacturers m, public.taxonomy_categories c, public.product_families f
where m.slug = 'demo-manufacturer' and c.slug = 'computing' and f.slug = 'demo-product-line'
on conflict (slug) do nothing;

insert into public.products (manufacturer_id, category_id, family_id, name, slug, model_number, status, summary, is_published)
select
  m.id, c.id, f.id,
  'Demo Product Mark II (seed data — not real)',
  'demo-product-mark-ii',
  'DEMO-002',
  'active',
  'Successor to the seed demo product, for exercising predecessor/successor relationships locally.',
  true
from public.manufacturers m, public.taxonomy_categories c, public.product_families f
where m.slug = 'demo-manufacturer' and c.slug = 'computing' and f.slug = 'demo-product-line'
on conflict (slug) do nothing;

insert into public.product_relationships (product_id, related_product_id, relationship_type)
select p2.id, p1.id, 'successor_of'
from public.products p1, public.products p2
where p1.slug = 'demo-product' and p2.slug = 'demo-product-mark-ii'
on conflict (product_id, related_product_id, relationship_type) do nothing;

insert into public.product_tags (product_id, tag_id)
select p.id, t.id
from public.products p, public.taxonomy_tags t
where p.slug = 'demo-product-mark-ii' and t.slug = 'editor-favorite'
on conflict do nothing;

insert into public.product_specs (product_id, spec_definition_id, value)
select p.id, s.id, '450'::jsonb
from public.products p, public.spec_definitions s
where p.slug = 'demo-product-mark-ii' and s.slug = 'weight'
on conflict (product_id, spec_definition_id) do update set value = excluded.value;

insert into public.product_specs (product_id, spec_definition_id, value)
select p.id, s.id, '"512GB SSD"'::jsonb
from public.products p, public.spec_definitions s
where p.slug = 'demo-product-mark-ii' and s.slug = 'storage'
on conflict (product_id, spec_definition_id) do update set value = excluded.value;

insert into public.product_specs (product_id, spec_definition_id, value)
select p.id, s.id, 'true'::jsonb
from public.products p, public.spec_definitions s
where p.slug = 'demo-product-mark-ii' and s.slug = 'wireless'
on conflict (product_id, spec_definition_id) do update set value = excluded.value;

insert into public.content_items (type, title, slug, body, status, published_at)
values (
  'review',
  'Demo Product Mark II review (seed data — not real)',
  'demo-product-mark-ii-review',
  'This is placeholder seed body text for local development only. It exists to exercise the article detail page layout — hero image slot, product association, tags, freshness — against real relational data instead of an empty table.',
  'published',
  now()
)
on conflict (slug) do nothing;

insert into public.content_products (content_id, product_id, role)
select c.id, p.id, 'primary_subject'
from public.content_items c, public.products p
where c.slug = 'demo-product-mark-ii-review' and p.slug = 'demo-product-mark-ii'
on conflict (content_id, product_id) do nothing;

insert into public.content_tags (content_id, tag_id)
select c.id, t.id
from public.content_items c, public.taxonomy_tags t
where c.slug = 'demo-product-mark-ii-review' and t.slug = 'editor-favorite'
on conflict do nothing;

insert into public.freshness_log (product_id, reason)
select id, 'Seed data: initial local freshness record.'
from public.products where slug = 'demo-product-mark-ii';
