-- Tech Carvalho — initial taxonomy_categories rows.
--
-- NOT a schema change (the table/columns/RLS already exist and are
-- unmodified — see supabase/migrations/20260819202304_initial_schema.sql
-- and 20260819202305_rls_policies.sql), so this does not belong in
-- supabase/migrations/. NOT local-dev demo data either (unlike
-- supabase/seed.sql, which is explicitly fake and never run against
-- production) — every value below is real, live navigation copy already
-- shipped in the app. This is a one-off data script, meant to be pasted
-- into the Supabase SQL editor and run manually once, because no admin
-- account exists yet to create these rows through /admin/taxonomy-categories
-- the normal way.
--
-- Every name/slug/description below is copied verbatim from
-- src/lib/public/categories.ts (PLANNED_CATEGORIES) — the app's own
-- authoritative list of its 7 initial subject areas, already live in the
-- homepage's "Subject areas" navigation. Nothing here is guessed. All 7
-- are included (not just the 5 the prepared catalogue/content currently
-- reference) so the initial taxonomy is established completely in one
-- pass — Drones & FPV and Action Cameras have no prepared data yet, but
-- the category rows themselves cost nothing to create now and match the
-- navigation that's already live in production.
--
-- sort_order mirrors PLANNED_CATEGORIES' array order (0-6) — the same
-- order these already display in on the homepage — not an arbitrary
-- choice. All 7 are top-level (parent_id left at its default, null):
-- PLANNED_CATEGORIES treats them as flat siblings today, so this doesn't
-- invent a hierarchy the app doesn't already have.
--
-- Idempotent: safe to paste and run more than once. `on conflict (slug)
-- do nothing` means a re-run touches zero rows if these already exist —
-- it will never overwrite a description/sort_order you've since edited
-- by hand through the admin UI.

insert into public.taxonomy_categories (name, slug, description, sort_order) values
  ('Cameras & Photography', 'cameras-photography', 'Cameras, lenses, and the gear behind them.', 0),
  ('Astrophotography',      'astrophotography',    'Imaging the night sky, from mounts to stacking.', 1),
  ('Drones & FPV',          'drones-fpv',          'Aerial platforms, FPV builds, and flight gear.', 2),
  ('Action Cameras',        'action-cameras',      'Rugged cameras built for motion and the outdoors.', 3),
  ('Computing',             'computing',           'PCs, components, and the software that runs on them.', 4),
  ('Networking',            'networking',          'Routers, mesh systems, and home network infrastructure.', 5),
  ('Gaming',                'gaming',              'Hardware and peripherals for playing games.', 6)
on conflict (slug) do nothing;

-- Optional verification — run separately after the insert above to confirm
-- the result. Expected: 7 rows, one per slug above, each with parent_id null.
-- select id, name, slug, sort_order, parent_id, created_at
-- from public.taxonomy_categories
-- order by sort_order;
