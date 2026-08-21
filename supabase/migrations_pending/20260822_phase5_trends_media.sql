-- ============================================================================
-- Phase 5 — Trend engine, media acquisition, homepage trending
-- ============================================================================
-- Nothing here can publish. No function writes content_items.status,
-- products.is_published, or flips any media rights flag.
--
-- Central safety rule, repeated because it is the one most easily eroded:
-- MEDIA DISCOVERY and MEDIA REPUBLICATION are separate permissions. Finding an
-- image never implies the right to use it. Every candidate below defaults to
-- requiring human rights review.

-- ---------------------------------------------------------------------------
-- 1. Trends
-- ---------------------------------------------------------------------------
-- A trend is a MEASURED signal aggregate, deliberately distinct from an
-- editorial opportunity (engine_opportunities), which is an inference about
-- what we should therefore write. Keeping them in separate tables stops
-- "this is being talked about" quietly becoming "we should publish this".
create table if not exists public.engine_trends (
  id uuid primary key default gen_random_uuid(),
  topic_key text not null,
  label text not null,
  category_slug text,

  -- Measured
  trend_score numeric(5,2) check (trend_score is null or (trend_score >= 0 and trend_score <= 100)),
  confidence numeric(4,3) not null default 0 check (confidence >= 0 and confidence <= 1),
  velocity numeric(6,2),
  -- Named signals with their individual contributions, so a score can always
  -- be decomposed rather than taken on trust.
  contributing_signals jsonb not null default '{}'::jsonb,
  why_trending text not null,

  -- Observation window
  first_detected_at timestamptz not null default now(),
  last_observed_at timestamptz not null default now(),
  observation_count integer not null default 1,

  -- Editorial inference (explicitly separate from the measurement above)
  recommended_content_type text check (recommended_content_type is null or recommended_content_type in
    ('review', 'guide', 'comparison', 'news', 'troubleshooting')),
  related_product_ids uuid[] not null default '{}',
  related_content_ids uuid[] not null default '{}',
  has_published_coverage boolean not null default false,

  is_active boolean not null default true,
  updated_at timestamptz not null default now(),
  constraint engine_trends_topic_unique unique (topic_key)
);
create index if not exists engine_trends_score_idx on public.engine_trends (trend_score desc nulls last);
create index if not exists engine_trends_active_idx on public.engine_trends (is_active, last_observed_at desc);

-- ---------------------------------------------------------------------------
-- 2. Media asset roles
-- ---------------------------------------------------------------------------
-- Lets the library be filtered and reused properly instead of being an
-- undifferentiated pile. brand_role already exists for logo/mark/favicon; this
-- is the broader editorial role.
alter table public.media_assets
  add column if not exists asset_role text check (asset_role is null or asset_role in (
    'product_photo', 'article_hero', 'banner', 'category_hero', 'homepage_feature',
    'background', 'diagram', 'chart', 'comparison_graphic', 'social_og',
    'logo_brand', 'icon', 'screenshot'
  ));
create index if not exists media_assets_asset_role_idx on public.media_assets (asset_role);

-- ---------------------------------------------------------------------------
-- 3. Media source registry extensions
-- ---------------------------------------------------------------------------
-- media_browsing_permitted is deliberately a THIRD flag, distinct from both
-- discovery_permitted (may we read facts) and media_republication_permitted
-- (may we publish the image). Being allowed to look at an image library is not
-- permission to use what is in it.
alter table public.engine_sources
  add column if not exists media_browsing_permitted boolean not null default false,
  add column if not exists editorial_use_only boolean not null default false,
  add column if not exists registration_required boolean not null default false,
  add column if not exists last_reviewed_at timestamptz,
  add column if not exists reviewed_by text;

-- ---------------------------------------------------------------------------
-- 4. Media candidates
-- ---------------------------------------------------------------------------
-- The acquisition pipeline:
--   discovered -> rights_review -> approved -> ingested -> associated
--                              \-> rejected
-- Nothing may skip rights_review. `requires_human_review` defaults TRUE and is
-- only ever cleared for source classes whose terms are already established
-- (our own graphics, staff photography).
create table if not exists public.engine_media_candidates (
  id uuid primary key default gen_random_uuid(),
  media_requirement_id uuid references public.media_requirements(id) on delete cascade,
  product_id uuid references public.products(id) on delete cascade,
  content_id uuid references public.content_items(id) on delete cascade,

  source_id uuid references public.engine_sources(id) on delete set null,
  source_organisation text,
  source_url text,
  asset_url text,
  asset_type text check (asset_type is null or asset_type in ('image', 'video', 'generated')),
  width integer,
  height integer,

  potential_licence text,
  attribution_required boolean not null default false,
  attribution_text text,
  rights_status text not null default 'unverified' check (rights_status in (
    'unverified', 'confirmed_usable', 'requires_registration',
    'unclear_manual_review', 'no_source_found', 'prohibited'
  )),
  requires_human_review boolean not null default true,
  confidence numeric(4,3) not null default 0 check (confidence >= 0 and confidence <= 1),

  state text not null default 'discovered' check (state in (
    'discovered', 'rights_review', 'approved', 'rejected', 'ingested', 'associated'
  )),
  state_reason text,
  ingested_media_id uuid references public.media_assets(id) on delete set null,

  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists engine_media_candidates_state_idx on public.engine_media_candidates (state);
create index if not exists engine_media_candidates_req_idx on public.engine_media_candidates (media_requirement_id);

-- ---------------------------------------------------------------------------
-- 5. Homepage trending overrides
-- ---------------------------------------------------------------------------
-- Lets an admin pin or suppress a specific item without touching the ranking
-- algorithm. Kept as a tiny separate table so the homepage query stays
-- deterministic and the override is auditable.
create table if not exists public.homepage_overrides (
  id uuid primary key default gen_random_uuid(),
  content_id uuid not null references public.content_items(id) on delete cascade,
  mode text not null check (mode in ('pin_lead', 'pin_supporting', 'suppress')),
  note text,
  created_at timestamptz not null default now(),
  constraint homepage_overrides_unique unique (content_id)
);

-- ---------------------------------------------------------------------------
-- 6. RLS — admin-only for every new engine table
-- ---------------------------------------------------------------------------
alter table public.engine_trends enable row level security;
alter table public.engine_media_candidates enable row level security;
alter table public.homepage_overrides enable row level security;

do $$
declare t text;
begin
  foreach t in array array['engine_trends', 'engine_media_candidates', 'homepage_overrides'] loop
    execute format('drop policy if exists "admins read %1$s" on public.%1$I', t);
    execute format('drop policy if exists "admins insert %1$s" on public.%1$I', t);
    execute format('drop policy if exists "admins update %1$s" on public.%1$I', t);
    execute format('drop policy if exists "admins delete %1$s" on public.%1$I', t);
    execute format('create policy "admins read %1$s" on public.%1$I for select using (public.is_admin())', t);
    execute format('create policy "admins insert %1$s" on public.%1$I for insert with check (public.is_admin())', t);
    execute format('create policy "admins update %1$s" on public.%1$I for update using (public.is_admin())', t);
    execute format('create policy "admins delete %1$s" on public.%1$I for delete using (public.is_admin())', t);
    execute format('grant select, insert, update, delete on public.%1$I to authenticated', t);
  end loop;
end $$;

-- The homepage is PUBLIC and must be able to read overrides while rendering.
-- Read-only, and it contains no sensitive data (a content id and a mode).
drop policy if exists "public can read homepage overrides" on public.homepage_overrides;
create policy "public can read homepage overrides" on public.homepage_overrides
  for select using (true);
grant select on public.homepage_overrides to anon;

-- ---------------------------------------------------------------------------
-- 7. Trend computation inputs
-- ---------------------------------------------------------------------------
-- Returns per-topic measured signals. Counts only — no raw analytics rows
-- leave the database. Topics are keyed on category slug, because that is the
-- unit we can measure reliably today; finer-grained topic extraction can be
-- added later without changing the table.
create or replace function public.engine_trend_inputs(p_days integer default 14)
returns table (
  topic_key text,
  label text,
  category_slug text,
  recent_discoveries integer,
  relevant_discoveries integer,
  recent_views integer,
  prior_views integer,
  searches integer,
  zero_result_searches integer,
  commercial_clicks integer,
  published_coverage integer,
  newest_discovery_at timestamptz
)
language plpgsql
security definer
set search_path = public
as $fn$
declare
  v_days integer := greatest(coalesce(p_days, 14), 1);
  v_start timestamptz := now() - make_interval(days => v_days);
  v_prior timestamptz := now() - make_interval(days => v_days * 2);
begin
  if not public.engine_flag_enabled('opportunity') then
    return;
  end if;
  return query
  select
    c.slug::text,
    c.name::text,
    c.slug::text,
    (select count(*) from public.engine_discoveries d
      where d.category_slug = c.slug and d.first_seen_at >= v_start)::integer,
    (select count(*) from public.engine_discoveries d
      where d.category_slug = c.slug and d.first_seen_at >= v_start
        and d.relevance_verdict = 'relevant')::integer,
    (select count(*) from public.analytics_events e
      where e.category_slug = c.slug and e.event_type = 'page_view'
        and e.created_at >= v_start)::integer,
    (select count(*) from public.analytics_events e
      where e.category_slug = c.slug and e.event_type = 'page_view'
        and e.created_at >= v_prior and e.created_at < v_start)::integer,
    (select count(*) from public.analytics_events e
      where e.category_slug = c.slug and e.event_type = 'search'
        and e.created_at >= v_start)::integer,
    (select count(*) from public.analytics_events e
      where e.category_slug = c.slug and e.event_type = 'search'
        and coalesce((e.metadata->>'result_count')::int, -1) = 0
        and e.created_at >= v_start)::integer,
    (select count(*) from public.analytics_events e
      where e.category_slug = c.slug
        and e.event_type in ('outbound_link_click', 'affiliate_click')
        and e.created_at >= v_start)::integer,
    (select count(*) from public.content_items ci
      join public.taxonomy_categories tc on tc.id = ci.category_id
      where tc.slug = c.slug and ci.status = 'published'
        and ci.published_at >= v_start)::integer,
    (select max(d.first_seen_at) from public.engine_discoveries d
      where d.category_slug = c.slug and d.relevance_verdict = 'relevant')
  from public.taxonomy_categories c;
end;
$fn$;
revoke execute on function public.engine_trend_inputs(integer) from public;
grant execute on function public.engine_trend_inputs(integer) to anon, authenticated;

create or replace function public.engine_upsert_trend(
  p_topic_key text, p_label text, p_category text,
  p_score numeric, p_confidence numeric, p_velocity numeric,
  p_signals jsonb, p_why text, p_recommended_type text, p_has_coverage boolean
)
returns text
language plpgsql
security definer
set search_path = public
as $fn$
begin
  if p_topic_key is null or p_label is null then
    return 'rejected_invalid';
  end if;
  insert into public.engine_trends (
    topic_key, label, category_slug, trend_score, confidence, velocity,
    contributing_signals, why_trending, recommended_content_type,
    has_published_coverage, last_observed_at, updated_at
  ) values (
    left(p_topic_key, 200), left(p_label, 300), left(p_category, 100),
    p_score, least(greatest(coalesce(p_confidence, 0), 0), 1), p_velocity,
    coalesce(p_signals, '{}'::jsonb), left(p_why, 2000),
    nullif(p_recommended_type, ''), coalesce(p_has_coverage, false), now(), now()
  )
  on conflict (topic_key) do update set
    label = excluded.label,
    trend_score = excluded.trend_score,
    confidence = excluded.confidence,
    velocity = excluded.velocity,
    contributing_signals = excluded.contributing_signals,
    why_trending = excluded.why_trending,
    recommended_content_type = excluded.recommended_content_type,
    has_published_coverage = excluded.has_published_coverage,
    last_observed_at = now(),
    observation_count = public.engine_trends.observation_count + 1,
    updated_at = now();
  return 'ok';
end;
$fn$;
revoke execute on function public.engine_upsert_trend(text, text, text, numeric, numeric, numeric, jsonb, text, text, boolean) from public;
grant execute on function public.engine_upsert_trend(text, text, text, numeric, numeric, numeric, jsonb, text, text, boolean) to anon, authenticated;

-- ---------------------------------------------------------------------------
-- 8. Media acquisition RPCs
-- ---------------------------------------------------------------------------
-- Open requirements plus the target's identity, so the acquisition pass can
-- decide what kind of asset would satisfy each one.
create or replace function public.engine_open_media_requirements(p_limit integer default 50)
returns table (
  requirement_id uuid, kind text, entity_id uuid, slug text, label text,
  manufacturer text, category_slug text, existing_candidates integer
)
language plpgsql
security definer
set search_path = public
as $fn$
begin
  return query
  select r.id, 'product'::text, p.id, p.slug::text, p.name::text,
         m.name::text, tc.slug::text,
         (select count(*) from public.engine_media_candidates c where c.media_requirement_id = r.id)::integer
    from public.media_requirements r
    join public.products p on p.id = r.product_id
    left join public.manufacturers m on m.id = p.manufacturer_id
    left join public.taxonomy_categories tc on tc.id = p.category_id
   where r.sourcing_status in ('needed', 'sourcing')
  union all
  select r.id, 'content'::text, ci.id, ci.slug::text, ci.title::text,
         null::text, tc.slug::text,
         (select count(*) from public.engine_media_candidates c where c.media_requirement_id = r.id)::integer
    from public.media_requirements r
    join public.content_items ci on ci.id = r.content_id
    left join public.taxonomy_categories tc on tc.id = ci.category_id
   where r.sourcing_status in ('needed', 'sourcing')
  limit greatest(coalesce(p_limit, 50), 1);
end;
$fn$;
revoke execute on function public.engine_open_media_requirements(integer) from public;
grant execute on function public.engine_open_media_requirements(integer) to anon, authenticated;

-- Records a candidate. Deliberately CANNOT set state beyond 'discovered' or
-- 'rights_review': nothing reaches 'approved' through this path. Approval is a
-- human action in the admin UI.
create or replace function public.engine_record_media_candidate(
  p_requirement_id uuid, p_product_id uuid, p_content_id uuid,
  p_source_organisation text, p_source_url text, p_asset_url text,
  p_asset_type text, p_width integer, p_height integer,
  p_potential_licence text, p_rights_status text, p_confidence numeric,
  p_requires_human_review boolean, p_reason text
)
returns text
language plpgsql
security definer
set search_path = public
as $fn$
declare v_state text;
begin
  if p_rights_status is not null and p_rights_status not in (
    'unverified', 'confirmed_usable', 'requires_registration',
    'unclear_manual_review', 'no_source_found', 'prohibited'
  ) then
    return 'rejected_invalid';
  end if;

  -- Anything needing review enters rights_review; nothing bypasses it.
  v_state := case when coalesce(p_requires_human_review, true) then 'rights_review' else 'discovered' end;

  insert into public.engine_media_candidates (
    media_requirement_id, product_id, content_id, source_organisation, source_url,
    asset_url, asset_type, width, height, potential_licence, rights_status,
    confidence, requires_human_review, state, state_reason
  ) values (
    p_requirement_id, p_product_id, p_content_id, left(p_source_organisation, 200),
    left(p_source_url, 1000), left(p_asset_url, 1000), p_asset_type, p_width, p_height,
    left(p_potential_licence, 500), coalesce(p_rights_status, 'unverified'),
    least(greatest(coalesce(p_confidence, 0), 0), 1),
    coalesce(p_requires_human_review, true), v_state, left(p_reason, 1000)
  );
  return 'created';
end;
$fn$;
revoke execute on function public.engine_record_media_candidate(uuid, uuid, uuid, text, text, text, text, integer, integer, text, text, numeric, boolean, text) from public;
grant execute on function public.engine_record_media_candidate(uuid, uuid, uuid, text, text, text, text, integer, integer, text, text, numeric, boolean, text) to anon, authenticated;
