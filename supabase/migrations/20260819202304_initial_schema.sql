-- Tech Carvalho — Milestone 1 initial schema
--
-- Design notes:
-- * FK-backed integrity is preferred throughout. Instead of a generic
--   subject_type/subject_id polymorphic pattern, tables that can attach to
--   more than one parent (evidence, sourcing, freshness, SEO) use multiple
--   *nullable* FK columns plus a CHECK (num_nonnulls(...) = 1) constraint.
--   Each column is a real, enforced foreign key — Postgres guarantees the
--   referenced row exists — while still allowing one table to serve
--   several parent types.
-- * Enumerated-ish fields (status, relationship_type, role, ...) are plain
--   `text` + CHECK constraints rather than native Postgres ENUM types, so
--   new values can be added later with a simple constraint change instead
--   of an ALTER TYPE migration dance.
-- * This migration is intentionally scoped to what was approved for
--   Milestone 1. Deferred to a later milestone: compatibility_rules,
--   known_issues, solutions (the "future problems/solutions" tables) —
--   product_relationships already covers basic compatibility edges for now.

create extension if not exists pgcrypto;

-- ============================================================================
-- Admin identity
-- ============================================================================

create table public.admin_users (
  id uuid primary key references auth.users (id) on delete cascade,
  display_name text,
  created_at timestamptz not null default now()
);

comment on table public.admin_users is
  'Authorized admins. Rows are provisioned manually (SQL/dashboard) — there is no public signup.';

-- ============================================================================
-- Media registry
-- ============================================================================

create table public.media_assets (
  id uuid primary key default gen_random_uuid(),
  storage_path text not null,
  media_type text not null check (media_type in ('image', 'video')),
  alt_text text,
  width integer,
  height integer,
  license text,
  attribution text,
  created_at timestamptz not null default now()
);

-- ============================================================================
-- Taxonomy
-- ============================================================================

create table public.taxonomy_categories (
  id uuid primary key default gen_random_uuid(),
  parent_id uuid references public.taxonomy_categories (id) on delete cascade,
  name text not null,
  slug text not null unique,
  description text,
  sort_order integer not null default 0,
  created_at timestamptz not null default now()
);

create index taxonomy_categories_parent_id_idx on public.taxonomy_categories (parent_id);

create table public.taxonomy_tags (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  slug text not null unique,
  created_at timestamptz not null default now()
);

-- ============================================================================
-- Manufacturer registry
-- ============================================================================

create table public.manufacturers (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  slug text not null unique,
  website text,
  description text,
  logo_media_id uuid references public.media_assets (id) on delete set null,
  created_at timestamptz not null default now()
);

-- ============================================================================
-- Product registry
-- ============================================================================

create table public.product_families (
  id uuid primary key default gen_random_uuid(),
  category_id uuid references public.taxonomy_categories (id) on delete set null,
  name text not null,
  slug text not null unique,
  description text,
  created_at timestamptz not null default now()
);

create table public.products (
  id uuid primary key default gen_random_uuid(),
  manufacturer_id uuid not null references public.manufacturers (id) on delete restrict,
  category_id uuid not null references public.taxonomy_categories (id) on delete restrict,
  family_id uuid references public.product_families (id) on delete set null,
  name text not null,
  slug text not null unique,
  model_number text,
  release_date date,
  status text not null default 'active' check (status in ('active', 'discontinued', 'rumored')),
  summary text,
  is_published boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index products_manufacturer_id_idx on public.products (manufacturer_id);
create index products_category_id_idx on public.products (category_id);
create index products_family_id_idx on public.products (family_id);
create index products_is_published_idx on public.products (is_published);

create table public.product_relationships (
  id uuid primary key default gen_random_uuid(),
  product_id uuid not null references public.products (id) on delete cascade,
  related_product_id uuid not null references public.products (id) on delete cascade,
  relationship_type text not null check (
    relationship_type in ('successor_of', 'alternative_to', 'accessory_for', 'compatible_with', 'requires')
  ),
  created_at timestamptz not null default now(),
  check (product_id <> related_product_id),
  unique (product_id, related_product_id, relationship_type)
);

create index product_relationships_related_product_id_idx on public.product_relationships (related_product_id);

create table public.product_tags (
  product_id uuid not null references public.products (id) on delete cascade,
  tag_id uuid not null references public.taxonomy_tags (id) on delete cascade,
  primary key (product_id, tag_id)
);

-- ============================================================================
-- Extensible product specifications (EAV)
-- ============================================================================

create table public.spec_definitions (
  id uuid primary key default gen_random_uuid(),
  category_id uuid references public.taxonomy_categories (id) on delete cascade,
  name text not null,
  slug text not null unique,
  data_type text not null check (data_type in ('text', 'number', 'boolean', 'enum')),
  unit text,
  created_at timestamptz not null default now()
);

create table public.product_specs (
  id uuid primary key default gen_random_uuid(),
  product_id uuid not null references public.products (id) on delete cascade,
  spec_definition_id uuid not null references public.spec_definitions (id) on delete restrict,
  value jsonb not null,
  created_at timestamptz not null default now(),
  unique (product_id, spec_definition_id)
);

-- ============================================================================
-- Content registry
-- ============================================================================

create table public.content_items (
  id uuid primary key default gen_random_uuid(),
  type text not null check (type in ('review', 'guide', 'comparison', 'news')),
  title text not null,
  slug text not null unique,
  body text,
  status text not null default 'draft' check (status in ('draft', 'published')),
  author_id uuid references public.admin_users (id) on delete set null,
  published_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index content_items_status_idx on public.content_items (status);

create table public.content_tags (
  content_id uuid not null references public.content_items (id) on delete cascade,
  tag_id uuid not null references public.taxonomy_tags (id) on delete cascade,
  primary key (content_id, tag_id)
);

create table public.content_products (
  id uuid primary key default gen_random_uuid(),
  content_id uuid not null references public.content_items (id) on delete cascade,
  product_id uuid not null references public.products (id) on delete cascade,
  role text not null check (role in ('primary_subject', 'mentioned', 'compared_against')),
  created_at timestamptz not null default now(),
  unique (content_id, product_id)
);

create index content_products_product_id_idx on public.content_products (product_id);

-- ============================================================================
-- Media relationships (explicit FK join tables, not polymorphic)
-- ============================================================================

create table public.product_media (
  id uuid primary key default gen_random_uuid(),
  product_id uuid not null references public.products (id) on delete cascade,
  media_id uuid not null references public.media_assets (id) on delete cascade,
  role text not null check (role in ('hero', 'gallery', 'thumbnail')),
  sort_order integer not null default 0,
  unique (product_id, media_id, role)
);

create table public.content_media (
  id uuid primary key default gen_random_uuid(),
  content_id uuid not null references public.content_items (id) on delete cascade,
  media_id uuid not null references public.media_assets (id) on delete cascade,
  role text not null check (role in ('hero', 'gallery', 'thumbnail')),
  sort_order integer not null default 0,
  unique (content_id, media_id, role)
);

-- ============================================================================
-- Editorial evidence / testing records
-- Attaches to exactly one of product or content, via real FKs.
-- ============================================================================

create table public.evidence_records (
  id uuid primary key default gen_random_uuid(),
  product_id uuid references public.products (id) on delete cascade,
  content_id uuid references public.content_items (id) on delete cascade,
  test_type text not null,
  conditions text,
  result_summary text not null,
  raw_data jsonb,
  tested_by uuid references public.admin_users (id) on delete set null,
  tested_at timestamptz not null default now(),
  check (num_nonnulls(product_id, content_id) = 1)
);

create index evidence_records_product_id_idx on public.evidence_records (product_id);
create index evidence_records_content_id_idx on public.evidence_records (content_id);

-- ============================================================================
-- Factual source / provenance records
-- Attaches to exactly one of product, content, or a specific product spec.
-- ============================================================================

create table public.source_records (
  id uuid primary key default gen_random_uuid(),
  product_id uuid references public.products (id) on delete cascade,
  content_id uuid references public.content_items (id) on delete cascade,
  product_spec_id uuid references public.product_specs (id) on delete cascade,
  url text not null,
  publisher text,
  retrieved_at timestamptz not null default now(),
  reliability_tier text not null default 'secondary' check (reliability_tier in ('primary', 'secondary', 'community')),
  created_at timestamptz not null default now(),
  check (num_nonnulls(product_id, content_id, product_spec_id) = 1)
);

create index source_records_product_id_idx on public.source_records (product_id);
create index source_records_content_id_idx on public.source_records (content_id);
create index source_records_product_spec_id_idx on public.source_records (product_spec_id);

-- ============================================================================
-- Freshness / update tracking
-- Attaches to exactly one of product or content.
-- ============================================================================

create table public.freshness_log (
  id uuid primary key default gen_random_uuid(),
  product_id uuid references public.products (id) on delete cascade,
  content_id uuid references public.content_items (id) on delete cascade,
  reviewed_by uuid references public.admin_users (id) on delete set null,
  reviewed_at timestamptz not null default now(),
  reason text not null,
  check (num_nonnulls(product_id, content_id) = 1)
);

create index freshness_log_product_id_idx on public.freshness_log (product_id);
create index freshness_log_content_id_idx on public.freshness_log (content_id);

-- ============================================================================
-- SEO metadata
-- Attaches to exactly one of product, content, or taxonomy category.
-- ============================================================================

create table public.seo_metadata (
  id uuid primary key default gen_random_uuid(),
  product_id uuid unique references public.products (id) on delete cascade,
  content_id uuid unique references public.content_items (id) on delete cascade,
  category_id uuid unique references public.taxonomy_categories (id) on delete cascade,
  meta_title text,
  meta_description text,
  canonical_url text,
  og_media_id uuid references public.media_assets (id) on delete set null,
  noindex boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (num_nonnulls(product_id, content_id, category_id) = 1)
);

-- ============================================================================
-- updated_at maintenance
-- ============================================================================

create function public.set_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

create trigger set_updated_at before update on public.products
  for each row execute function public.set_updated_at();

create trigger set_updated_at before update on public.content_items
  for each row execute function public.set_updated_at();

create trigger set_updated_at before update on public.seo_metadata
  for each row execute function public.set_updated_at();

-- ============================================================================
-- Admin helper
-- ============================================================================

create function public.is_admin()
returns boolean
language sql
stable
security invoker
as $$
  select exists (
    select 1 from public.admin_users where id = auth.uid()
  );
$$;
