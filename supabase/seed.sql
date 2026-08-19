-- Tech Carvalho — local development seed data.
--
-- This file is only executed by the Supabase CLI against a LOCAL database
-- (`supabase start` / `supabase db reset`). It is never run automatically
-- against a linked remote project. Do not run this against production —
-- everything below is placeholder demo content, clearly not real reviews,
-- ratings, or traffic.
--
-- Note: this does not create an admin user. admin_users.id must reference a
-- real row in auth.users, which only exists once someone signs up/is
-- invited in the local Supabase Auth instance. Create that user first (via
-- the local Studio or `supabase auth`), then insert into admin_users
-- manually with that user's id.

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

insert into public.products (manufacturer_id, category_id, family_id, name, slug, model_number, status, summary, is_published)
select
  m.id,
  c.id,
  f.id,
  'Demo Product (seed data — not real)',
  'demo-product',
  'DEMO-001',
  'active',
  'Placeholder seed product for exercising the local admin and public UI. Not a real product.',
  true
from public.manufacturers m, public.taxonomy_categories c, public.product_families f
where m.slug = 'demo-manufacturer' and c.slug = 'computing' and f.slug = 'demo-product-line'
on conflict (slug) do nothing;
