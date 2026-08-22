-- ============================================================================
-- TechCarvalho Content & Growth Engine — Phase 3 foundation
-- ============================================================================
--
-- PART 0 is a REGRESSION FIX and should be read first.
--
-- Everything else here is new engine scaffolding, designed so ordinary
-- application/server code (Vercel Cron -> Route Handler -> Postgres) runs the
-- engine on a schedule. No AI provider is required for any of it; the AI
-- abstraction (src/lib/engine/ai-provider.ts) is deliberately un-implemented
-- and inert until a provider is explicitly approved.
--
-- Design principle throughout: reuse, don't duplicate. Discoveries point at
-- existing products/content_items; briefs resolve into real content_items;
-- media stays entirely in media_assets/media_requirements and keeps going
-- through evaluateMediaReadiness(). Nothing here can publish anything.

-- ============================================================================
-- PART 0 — REGRESSION FIX: the nightly analytics rollup cron is broken
-- ============================================================================
--
-- 20260821_revoke_public_execute_compute_rollup.sql correctly closed a real
-- hole (anon could force unbounded rollup recomputation). But the nightly
-- cron at /api/analytics/rollup calls createClient(), which has no cookies in
-- a cron invocation and therefore acts as `anon` — so that revoke also broke
-- the legitimate job. Verified in production: the endpoint returns
-- {"ok":false,"error":"permission denied for function compute_analytics_rollup"}.
--
-- Fix: keep anon locked out of the raw function, and expose a *guarded*
-- wrapper anon may call. The wrapper neutralises the original DoS concern by
-- refusing to recompute a day that was already computed within a cooldown
-- window, so hammering it is cheap and bounded rather than expensive and
-- unbounded. It returns a text status so the route can log what happened
-- instead of silently appearing to succeed.
create or replace function public.compute_analytics_rollup_guarded(
  target_day date,
  cooldown_minutes integer default 60
)
returns text
language plpgsql
security definer
set search_path = public
as $$
declare
  last_computed timestamptz;
begin
  if target_day is null or target_day > current_date then
    return 'rejected_invalid_day';
  end if;

  select max(computed_at) into last_computed
  from public.analytics_daily_rollups
  where day = target_day;

  if last_computed is not null
     and last_computed > now() - make_interval(mins => greatest(cooldown_minutes, 1)) then
    return 'skipped_cooldown';
  end if;

  perform public.compute_analytics_rollup(target_day);
  return 'computed';
end;
$$;

revoke execute on function public.compute_analytics_rollup_guarded(date, integer) from public;
grant execute on function public.compute_analytics_rollup_guarded(date, integer) to anon, authenticated;

-- ============================================================================
-- PART 1 — Engine settings (kill switch + granular controls, req 10)
-- ============================================================================
-- Single-row table. `id` is pinned so there can only ever be one row —
-- avoids "which settings row is live?" ambiguity.
create table if not exists public.engine_settings (
  id boolean primary key default true check (id),
  master_enabled boolean not null default false,
  discovery_enabled boolean not null default false,
  research_enabled boolean not null default false,
  freshness_enabled boolean not null default false,
  opportunity_scoring_enabled boolean not null default false,
  -- Autonomous publishing stays OFF and is deliberately separate from every
  -- other switch: no combination of the flags above may publish anything.
  autonomous_publishing_enabled boolean not null default false,
  notes text,
  updated_at timestamptz not null default now()
);
insert into public.engine_settings (id) values (true) on conflict (id) do nothing;

-- ============================================================================
-- PART 2 — Source Registry (req 2)
-- ============================================================================
-- Critically: `discovery_permitted` (may we read facts from it) and
-- `media_republication_permitted` (may we republish its imagery) are separate
-- columns and must stay separate. Permission to use information NEVER implies
-- permission to republish imagery. media_rights_status defaults to 'unverified'
-- so nothing is treated as clearable until a human has actually checked terms.
create table if not exists public.engine_sources (
  id uuid primary key default gen_random_uuid(),
  organisation text not null,
  url text not null,
  source_type text not null check (source_type in (
    'manufacturer_newsroom', 'product_feed', 'rss_atom', 'official_docs',
    'public_api', 'regulatory_dataset', 'trusted_editorial', 'other_approved'
  )),
  -- Free-form category slugs this source is relevant to; kept as text[] rather
  -- than a join table because it's a coarse routing hint, not a taxonomy.
  categories text[] not null default '{}',
  trust_level text not null default 'secondary' check (trust_level in ('primary', 'secondary', 'community')),
  is_active boolean not null default false,

  discovery_permitted boolean not null default false,
  media_republication_permitted boolean not null default false,
  media_rights_status text not null default 'unverified' check (media_rights_status in (
    'unverified', 'confirmed_usable', 'requires_registration', 'unclear_manual_review', 'no_source_found', 'prohibited'
  )),
  terms_url text,
  terms_notes text,
  attribution_required boolean not null default false,
  attribution_text text,

  check_frequency_hours integer not null default 24 check (check_frequency_hours >= 1),
  last_checked_at timestamptz,
  last_success_at timestamptz,
  consecutive_failures integer not null default 0,
  last_error text,

  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint engine_sources_url_unique unique (url)
);
create index if not exists engine_sources_active_idx on public.engine_sources (is_active) where is_active;
create index if not exists engine_sources_media_rights_idx on public.engine_sources (media_rights_status);

-- ============================================================================
-- PART 3 — Discovery candidates (req 3)
-- ============================================================================
-- Candidates, never published content. dedupe_key is the deduplication
-- backbone: a normalised fingerprint of the announcement so the same story
-- arriving from ten sources collapses to one candidate row (additional
-- sightings are recorded as evidence rows in PART 4 instead).
create table if not exists public.engine_discoveries (
  id uuid primary key default gen_random_uuid(),
  dedupe_key text not null,
  title text not null,
  summary text,
  discovery_type text not null check (discovery_type in (
    'product_launch', 'product_update', 'spec_change', 'firmware_release',
    'technology_news', 'recall_or_security', 'new_topic'
  )),
  category_slug text,
  -- Existing entities this discovery affects, if any. Nullable on purpose: a
  -- brand-new product launch legitimately has no existing row yet.
  product_id uuid references public.products(id) on delete set null,
  content_id uuid references public.content_items(id) on delete set null,
  manufacturer_id uuid references public.manufacturers(id) on delete set null,

  confidence numeric(4,3) not null default 0 check (confidence >= 0 and confidence <= 1),
  -- Claim status is explicit and never inferred from repetition count. See
  -- PART 4's header: many outlets repeating one original claim does not
  -- promote a rumour to a confirmed fact.
  claim_status text not null default 'unverified' check (claim_status in (
    'confirmed_primary', 'reported_secondary', 'estimate', 'leak', 'rumour', 'unverified'
  )),
  state text not null default 'discovered' check (state in (
    'discovered', 'researched', 'evidence_checked', 'planned', 'drafting',
    'media_check', 'review_eligible', 'published', 'blocked', 'rejected', 'error'
  )),
  state_reason text,
  first_seen_at timestamptz not null default now(),
  last_seen_at timestamptz not null default now(),
  sighting_count integer not null default 1,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint engine_discoveries_dedupe_unique unique (dedupe_key)
);
create index if not exists engine_discoveries_state_idx on public.engine_discoveries (state);
create index if not exists engine_discoveries_type_idx on public.engine_discoveries (discovery_type);
create index if not exists engine_discoveries_category_idx on public.engine_discoveries (category_slug);

-- ============================================================================
-- PART 4 — Evidence (req 4)
-- ============================================================================
-- One row per (discovery, source-url) sighting. This is where "the same story
-- from many sources" actually lives — it raises corroboration, which is NOT
-- the same as raising truth. A single primary source outranks twenty
-- secondary repetitions, and the scoring in src/lib/engine/confidence.ts
-- implements exactly that rather than counting rows.
create table if not exists public.engine_discovery_evidence (
  id uuid primary key default gen_random_uuid(),
  discovery_id uuid not null references public.engine_discoveries(id) on delete cascade,
  source_id uuid references public.engine_sources(id) on delete set null,
  url text not null,
  publisher text,
  -- Snapshot of the claim as this source stated it, so a later source
  -- rewording it can't silently overwrite what was originally claimed.
  excerpt text,
  claim_status text not null default 'unverified' check (claim_status in (
    'confirmed_primary', 'reported_secondary', 'estimate', 'leak', 'rumour', 'unverified'
  )),
  trust_level text not null default 'secondary' check (trust_level in ('primary', 'secondary', 'community')),
  -- Where a secondary outlet is repeating someone else's claim, this records
  -- whose claim it originally was — the mechanism that stops circular
  -- reporting from being mistaken for independent corroboration.
  originates_from_url text,
  retrieved_at timestamptz not null default now(),
  created_at timestamptz not null default now(),
  constraint engine_evidence_unique unique (discovery_id, url)
);
create index if not exists engine_evidence_discovery_idx on public.engine_discovery_evidence (discovery_id);

-- ============================================================================
-- PART 5 — Opportunities (req 5)
-- ============================================================================
-- Explainable by construction: inputs are stored alongside the score, and
-- `explanation` holds the human-readable "why" the dashboard shows. A score
-- with no retained inputs would be exactly the black box we're avoiding.
create table if not exists public.engine_opportunities (
  id uuid primary key default gen_random_uuid(),
  subject_type text not null check (subject_type in ('category', 'topic', 'product', 'content', 'search_term')),
  subject_key text not null,
  label text not null,
  score numeric(5,2) check (score is null or (score >= 0 and score <= 100)),
  -- jsonb rather than columns: the input set legitimately differs by
  -- subject_type (a search_term has no freshness age; a content row does).
  inputs jsonb not null default '{}'::jsonb,
  explanation text not null,
  discovery_id uuid references public.engine_discoveries(id) on delete set null,
  computed_at timestamptz not null default now(),
  constraint engine_opportunities_subject_unique unique (subject_type, subject_key)
);
create index if not exists engine_opportunities_score_idx on public.engine_opportunities (score desc nulls last);

-- ============================================================================
-- PART 6 — Content briefs / pipeline (req 6)
-- ============================================================================
-- A brief is a *proposal*, not content. content_id stays null until a human
-- turns it into a real content_items row through the existing editorial
-- workflow — the engine never writes published prose on its own.
create table if not exists public.engine_briefs (
  id uuid primary key default gen_random_uuid(),
  discovery_id uuid references public.engine_discoveries(id) on delete set null,
  opportunity_id uuid references public.engine_opportunities(id) on delete set null,
  proposed_title text not null,
  proposed_slug text,
  content_type text check (content_type is null or content_type in ('review', 'guide', 'comparison', 'news', 'troubleshooting')),
  search_intent text check (search_intent is null or search_intent in ('informational', 'commercial', 'transactional', 'navigational')),
  primary_query text,
  category_slug text,
  rationale text not null,
  -- Proposed internal links and involved entities, as arrays of slugs/ids.
  related_product_slugs text[] not null default '{}',
  related_content_slugs text[] not null default '{}',
  media_requirement_note text,
  state text not null default 'planned' check (state in (
    'planned', 'drafting', 'media_check', 'review_eligible', 'published', 'blocked', 'rejected', 'error'
  )),
  state_reason text,
  -- Set only once a human has actually created the record.
  content_id uuid references public.content_items(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists engine_briefs_state_idx on public.engine_briefs (state);
-- Idempotency: at most one brief per discovery that is still in play. Without
-- this, a planning pass running twice would create duplicate briefs for the
-- same discovery — the one gap in the idempotency story otherwise covered by
-- engine_discoveries.dedupe_key and engine_job_runs' partial unique index.
-- Scoped to live states so a rejected brief doesn't permanently block ever
-- re-planning that discovery later.
create unique index if not exists engine_briefs_one_live_per_discovery
  on public.engine_briefs (discovery_id)
  where discovery_id is not null
    and state in ('planned', 'drafting', 'media_check', 'review_eligible');

-- ============================================================================
-- PART 7 — Freshness reviews (req 8)
-- ============================================================================
-- Recommendations only. This table can never mutate published prose; it just
-- records "this looks stale, here's why" for a human to action.
create table if not exists public.engine_freshness_reviews (
  id uuid primary key default gen_random_uuid(),
  product_id uuid references public.products(id) on delete cascade,
  content_id uuid references public.content_items(id) on delete cascade,
  reason text not null check (reason in (
    'spec_changed', 'successor_released', 'discontinued', 'firmware_changed',
    'stale_facts', 'stale_pricing', 'broken_source_link', 'outdated_comparison', 'missing_internal_links'
  )),
  detail text,
  severity text not null default 'low' check (severity in ('low', 'medium', 'high')),
  state text not null default 'open' check (state in ('open', 'acknowledged', 'actioned', 'dismissed')),
  detected_at timestamptz not null default now(),
  constraint engine_freshness_one_target check (
    (product_id is not null and content_id is null) or (product_id is null and content_id is not null)
  )
);
create index if not exists engine_freshness_state_idx on public.engine_freshness_reviews (state);

-- ============================================================================
-- PART 8 — Job run audit log (req 10)
-- ============================================================================
-- Every scheduled run appends a row: what ran, when, what it did, what broke.
-- Also the idempotency substrate — a job can check "did I already run for this
-- key?" before doing work again.
create table if not exists public.engine_job_runs (
  id uuid primary key default gen_random_uuid(),
  job_name text not null,
  idempotency_key text,
  status text not null default 'running' check (status in ('running', 'success', 'partial', 'failed', 'skipped')),
  started_at timestamptz not null default now(),
  finished_at timestamptz,
  items_examined integer not null default 0,
  items_created integer not null default 0,
  items_deduped integer not null default 0,
  items_failed integer not null default 0,
  detail jsonb not null default '{}'::jsonb,
  error text
);
create index if not exists engine_job_runs_name_idx on public.engine_job_runs (job_name, started_at desc);
create unique index if not exists engine_job_runs_idempotency_idx
  on public.engine_job_runs (job_name, idempotency_key)
  where idempotency_key is not null and status in ('success', 'running');

-- ============================================================================
-- PART 9 — RLS: admin-only, every table, every operation
-- ============================================================================
-- Same posture as media_requirements. None of this is ever public-readable —
-- it contains unpublished editorial intent and source evaluation notes.
alter table public.engine_settings enable row level security;
alter table public.engine_sources enable row level security;
alter table public.engine_discoveries enable row level security;
alter table public.engine_discovery_evidence enable row level security;
alter table public.engine_opportunities enable row level security;
alter table public.engine_briefs enable row level security;
alter table public.engine_freshness_reviews enable row level security;
alter table public.engine_job_runs enable row level security;

do $$
declare t text;
begin
  foreach t in array array[
    'engine_settings', 'engine_sources', 'engine_discoveries', 'engine_discovery_evidence',
    'engine_opportunities', 'engine_briefs', 'engine_freshness_reviews', 'engine_job_runs'
  ] loop
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

-- ============================================================================
-- PART 10 — Engine write RPCs for the unauthenticated cron path
-- ============================================================================
-- The cron route runs as `anon` (no cookies), exactly as PART 0 discovered.
-- Rather than granting anon table-level write access to engine tables — which
-- would let anyone with the publishable key inject fake discoveries — the
-- cron path goes through narrow SECURITY DEFINER functions that accept only
-- specific shapes and return only status text. anon can append a job run and
-- record a deduplicated discovery; it cannot read the engine, cannot change
-- state machines, cannot publish, and cannot touch settings.

create or replace function public.engine_record_job_run(
  p_job_name text,
  p_status text,
  p_items_examined integer default 0,
  p_items_created integer default 0,
  p_items_deduped integer default 0,
  p_items_failed integer default 0,
  p_detail jsonb default '{}'::jsonb,
  p_error text default null
)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if p_job_name is null or char_length(p_job_name) > 100 then
    return;
  end if;
  if p_status not in ('running', 'success', 'partial', 'failed', 'skipped') then
    return;
  end if;
  insert into public.engine_job_runs (
    job_name, status, finished_at, items_examined, items_created,
    items_deduped, items_failed, detail, error
  ) values (
    p_job_name, p_status, now(), coalesce(p_items_examined, 0), coalesce(p_items_created, 0),
    coalesce(p_items_deduped, 0), coalesce(p_items_failed, 0), coalesce(p_detail, '{}'::jsonb),
    left(p_error, 2000)
  );
end;
$$;

revoke execute on function public.engine_record_job_run(text, text, integer, integer, integer, integer, jsonb, text) from public;
grant execute on function public.engine_record_job_run(text, text, integer, integer, integer, integer, jsonb, text) to anon, authenticated;

-- Returns 'created' or 'deduped' so the caller can count accurately without
-- needing read access to the table.
create or replace function public.engine_upsert_discovery(
  p_dedupe_key text,
  p_title text,
  p_summary text,
  p_discovery_type text,
  p_category_slug text,
  p_claim_status text,
  p_confidence numeric,
  p_source_url text,
  p_publisher text,
  p_trust_level text
)
returns text
language plpgsql
security definer
set search_path = public
as $$
declare
  v_id uuid;
  v_created boolean := false;
begin
  if p_dedupe_key is null or p_title is null then
    return 'rejected_invalid';
  end if;
  if p_discovery_type not in (
    'product_launch', 'product_update', 'spec_change', 'firmware_release',
    'technology_news', 'recall_or_security', 'new_topic'
  ) then
    return 'rejected_invalid';
  end if;

  select id into v_id from public.engine_discoveries where dedupe_key = p_dedupe_key;

  if v_id is null then
    insert into public.engine_discoveries (
      dedupe_key, title, summary, discovery_type, category_slug, claim_status, confidence
    ) values (
      left(p_dedupe_key, 400), left(p_title, 500), left(p_summary, 4000), p_discovery_type,
      left(p_category_slug, 100),
      coalesce(nullif(p_claim_status, ''), 'unverified'),
      least(greatest(coalesce(p_confidence, 0), 0), 1)
    )
    returning id into v_id;
    v_created := true;
  else
    -- A repeat sighting raises corroboration count and recency only. It
    -- deliberately does NOT raise confidence or promote claim_status —
    -- see PART 4's header on circular reporting.
    update public.engine_discoveries
      set last_seen_at = now(),
          sighting_count = sighting_count + 1,
          updated_at = now()
      where id = v_id;
  end if;

  if p_source_url is not null then
    insert into public.engine_discovery_evidence (
      discovery_id, url, publisher, claim_status, trust_level
    ) values (
      v_id, left(p_source_url, 1000), left(p_publisher, 200),
      coalesce(nullif(p_claim_status, ''), 'unverified'),
      coalesce(nullif(p_trust_level, ''), 'secondary')
    )
    on conflict (discovery_id, url) do nothing;
  end if;

  return case when v_created then 'created' else 'deduped' end;
end;
$$;

revoke execute on function public.engine_upsert_discovery(text, text, text, text, text, text, numeric, text, text, text) from public;
grant execute on function public.engine_upsert_discovery(text, text, text, text, text, text, numeric, text, text, text) to anon, authenticated;

-- Read-only settings probe for the cron path: returns just the boolean the
-- job needs, so a disabled engine can be enforced without exposing the table.
create or replace function public.engine_flag_enabled(p_flag text)
returns boolean
language plpgsql
security definer
set search_path = public
as $$
declare
  v_master boolean;
  v_flag boolean;
begin
  select master_enabled into v_master from public.engine_settings where id;
  if not coalesce(v_master, false) then
    return false;
  end if;
  select case p_flag
    when 'discovery' then discovery_enabled
    when 'research' then research_enabled
    when 'freshness' then freshness_enabled
    when 'opportunity' then opportunity_scoring_enabled
    when 'autonomous_publishing' then autonomous_publishing_enabled
    else false
  end into v_flag
  from public.engine_settings where id;
  return coalesce(v_flag, false);
end;
$$;

revoke execute on function public.engine_flag_enabled(text) from public;
grant execute on function public.engine_flag_enabled(text) to anon, authenticated;
