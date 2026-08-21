-- ============================================================================
-- Phase 4 — Relevance stage, brief enrichment, review queue, search intelligence
-- ============================================================================
-- Extends the Phase 3 engine. Nothing here can publish: no function below
-- writes to content_items, products, or media_assets.

-- ---------------------------------------------------------------------------
-- 1. Relevance stage on discoveries
-- ---------------------------------------------------------------------------
-- Discoveries are never deleted by the relevance filter — they are marked.
-- An admin can inspect why anything was accepted or rejected and override it,
-- which is why the explanation is stored rather than recomputed.
alter table public.engine_discoveries
  add column if not exists relevance_verdict text
    check (relevance_verdict is null or relevance_verdict in ('relevant', 'rejected', 'uncertain')),
  add column if not exists relevance_score integer,
  add column if not exists relevance_explanation text,
  add column if not exists suggested_angle text,
  add column if not exists relevance_overridden_by_admin boolean not null default false;

create index if not exists engine_discoveries_relevance_idx
  on public.engine_discoveries (relevance_verdict);

-- ---------------------------------------------------------------------------
-- 2. Brief enrichment (structured brief, not an article)
-- ---------------------------------------------------------------------------
-- A brief captures the QUESTION and the EVIDENCE, never prose. The
-- verified_facts/uncertainties split is the mechanism that stops an uncertain
-- claim from being laundered into an assertion downstream.
alter table public.engine_briefs
  add column if not exists primary_question text,
  add column if not exists supporting_questions text[] not null default '{}',
  add column if not exists verified_facts text[] not null default '{}',
  add column if not exists uncertainties text[] not null default '{}',
  add column if not exists source_urls text[] not null default '{}',
  add column if not exists suggested_structure text[] not null default '{}',
  add column if not exists freshness_sensitivity text
    check (freshness_sensitivity is null or freshness_sensitivity in ('breaking', 'time_sensitive', 'evergreen')),
  add column if not exists brief_kind text
    check (brief_kind is null or brief_kind in (
      'breaking', 'evergreen', 'product', 'comparison', 'troubleshooting',
      'buying_guide', 'explainer', 'update_existing'
    )),
  add column if not exists priority integer,
  add column if not exists review_state text not null default 'pending'
    check (review_state in ('pending', 'approved', 'rejected', 'snoozed', 'research_requested')),
  add column if not exists review_note text,
  add column if not exists snoozed_until timestamptz,
  add column if not exists reviewed_at timestamptz;

create index if not exists engine_briefs_review_state_idx on public.engine_briefs (review_state);
create index if not exists engine_briefs_priority_idx on public.engine_briefs (priority desc nulls last);

-- ---------------------------------------------------------------------------
-- 3. Internal search intelligence
-- ---------------------------------------------------------------------------
-- Aggregate ONLY. No visitor identifier, no session id, no IP — this table
-- deliberately cannot be joined back to a person. It stores the query text,
-- how often it was seen, whether it returned anything, and whether anyone
-- clicked a result. That is enough to find unmet demand and nothing more.
create table if not exists public.search_intelligence (
  id uuid primary key default gen_random_uuid(),
  normalised_query text not null,
  display_query text not null,
  search_count integer not null default 1,
  zero_result_count integer not null default 0,
  click_count integer not null default 0,
  last_seen_at timestamptz not null default now(),
  first_seen_at timestamptz not null default now(),
  constraint search_intelligence_query_unique unique (normalised_query)
);
create index if not exists search_intelligence_unmet_idx
  on public.search_intelligence (zero_result_count desc, search_count desc);

alter table public.search_intelligence enable row level security;
drop policy if exists "admins read search intelligence" on public.search_intelligence;
create policy "admins read search intelligence" on public.search_intelligence
  for select using (public.is_admin());
grant select on public.search_intelligence to authenticated;

-- Aggregation from analytics_events. SECURITY DEFINER so the cron path can run
-- it without any table access; it reads consent-gated analytics that already
-- exist and writes only aggregate counts.
create or replace function public.engine_aggregate_searches(p_days integer default 90)
returns integer
language plpgsql
security definer
set search_path = public
as $fn$
declare
  v_rows integer := 0;
begin
  with s as (
    select
      lower(btrim(e.metadata->>'query')) as nq,
      btrim(e.metadata->>'query') as dq,
      count(*)::integer as cnt,
      sum(case when coalesce((e.metadata->>'result_count')::int, -1) = 0 then 1 else 0 end)::integer as zeros,
      max(e.created_at) as last_at
    from public.analytics_events e
    where e.event_type = 'search'
      and e.created_at >= now() - make_interval(days => greatest(coalesce(p_days, 90), 1))
      and coalesce(btrim(e.metadata->>'query'), '') <> ''
    group by 1, 2
  ),
  clicks as (
    select lower(btrim(e.metadata->>'query')) as nq, count(*)::integer as clicks
    from public.analytics_events e
    where e.event_type = 'search_result_click'
      and e.created_at >= now() - make_interval(days => greatest(coalesce(p_days, 90), 1))
      and coalesce(btrim(e.metadata->>'query'), '') <> ''
    group by 1
  ),
  merged as (
    select s.nq, s.dq, s.cnt, s.zeros, coalesce(c.clicks, 0) as clicks, s.last_at
    from s left join clicks c on c.nq = s.nq
  ),
  upserted as (
    insert into public.search_intelligence
      (normalised_query, display_query, search_count, zero_result_count, click_count, last_seen_at)
    select left(nq, 300), left(dq, 300), cnt, zeros, clicks, last_at from merged
    on conflict (normalised_query) do update
      set search_count = excluded.search_count,
          zero_result_count = excluded.zero_result_count,
          click_count = excluded.click_count,
          display_query = excluded.display_query,
          last_seen_at = greatest(public.search_intelligence.last_seen_at, excluded.last_seen_at)
    returning 1
  )
  select count(*)::integer into v_rows from upserted;
  return v_rows;
end;
$fn$;
revoke execute on function public.engine_aggregate_searches(integer) from public;
grant execute on function public.engine_aggregate_searches(integer) to anon, authenticated;

-- ---------------------------------------------------------------------------
-- 4. Cron-path RPCs for the relevance and brief stages
-- ---------------------------------------------------------------------------
-- Discoveries still needing a relevance decision.
create or replace function public.engine_unclassified_discoveries(p_limit integer default 200)
returns table (id uuid, title text, summary text)
language plpgsql
security definer
set search_path = public
as $fn$
begin
  if not public.engine_flag_enabled('discovery') then
    return;
  end if;
  return query
    select d.id, d.title, d.summary
    from public.engine_discoveries d
    where d.relevance_verdict is null
    order by d.first_seen_at desc
    limit greatest(coalesce(p_limit, 200), 1);
end;
$fn$;
revoke execute on function public.engine_unclassified_discoveries(integer) from public;
grant execute on function public.engine_unclassified_discoveries(integer) to anon, authenticated;

create or replace function public.engine_set_relevance(
  p_id uuid, p_verdict text, p_score integer, p_explanation text, p_angle text
)
returns text
language plpgsql
security definer
set search_path = public
as $fn$
begin
  if p_verdict not in ('relevant', 'rejected', 'uncertain') then
    return 'rejected_invalid';
  end if;
  -- Never overwrite a human decision with a machine one.
  update public.engine_discoveries
     set relevance_verdict = p_verdict,
         relevance_score = p_score,
         relevance_explanation = left(p_explanation, 2000),
         suggested_angle = left(p_angle, 50),
         -- A rejected candidate is parked, not deleted, so it stays
         -- inspectable and overridable in the admin UI.
         state = case when p_verdict = 'rejected' then 'rejected' else state end,
         updated_at = now()
   where id = p_id
     and relevance_overridden_by_admin = false;
  return 'ok';
end;
$fn$;
revoke execute on function public.engine_set_relevance(uuid, text, integer, text, text) from public;
grant execute on function public.engine_set_relevance(uuid, text, integer, text, text) to anon, authenticated;

-- Relevant discoveries that do not yet have a live brief.
create or replace function public.engine_briefable_discoveries(p_limit integer default 20)
returns table (
  id uuid, title text, summary text, discovery_type text, category_slug text,
  claim_status text, suggested_angle text, sighting_count integer
)
language plpgsql
security definer
set search_path = public
as $fn$
begin
  if not public.engine_flag_enabled('research') then
    return;
  end if;
  return query
    select d.id, d.title, d.summary, d.discovery_type, d.category_slug,
           d.claim_status, d.suggested_angle, d.sighting_count
    from public.engine_discoveries d
    where d.relevance_verdict = 'relevant'
      and d.state not in ('rejected', 'published')
      and not exists (
        select 1 from public.engine_briefs b
        where b.discovery_id = d.id
          and b.state in ('planned', 'drafting', 'media_check', 'review_eligible')
      )
    order by d.sighting_count desc, d.first_seen_at desc
    limit greatest(coalesce(p_limit, 20), 1);
end;
$fn$;
revoke execute on function public.engine_briefable_discoveries(integer) from public;
grant execute on function public.engine_briefable_discoveries(integer) to anon, authenticated;

-- Evidence for a discovery, so the brief stage can carry provenance forward.
create or replace function public.engine_evidence_for(p_discovery_id uuid)
returns table (url text, publisher text, claim_status text, trust_level text, originates_from_url text)
language plpgsql
security definer
set search_path = public
as $fn$
begin
  return query
    select e.url, e.publisher, e.claim_status, e.trust_level, e.originates_from_url
    from public.engine_discovery_evidence e
    where e.discovery_id = p_discovery_id;
end;
$fn$;
revoke execute on function public.engine_evidence_for(uuid) from public;
grant execute on function public.engine_evidence_for(uuid) to anon, authenticated;

create or replace function public.engine_create_brief(
  p_discovery_id uuid,
  p_title text,
  p_rationale text,
  p_primary_question text,
  p_supporting_questions text[],
  p_verified_facts text[],
  p_uncertainties text[],
  p_source_urls text[],
  p_suggested_structure text[],
  p_brief_kind text,
  p_freshness text,
  p_category_slug text,
  p_content_type text,
  p_priority integer,
  p_media_note text
)
returns text
language plpgsql
security definer
set search_path = public
as $fn$
begin
  if p_title is null or p_rationale is null then
    return 'rejected_invalid';
  end if;
  -- Idempotent: engine_briefs_one_live_per_discovery already enforces one live
  -- brief per discovery, so a repeated pass collides and reports deduped
  -- rather than piling up duplicates.
  begin
    insert into public.engine_briefs (
      discovery_id, proposed_title, rationale, primary_question, supporting_questions,
      verified_facts, uncertainties, source_urls, suggested_structure, brief_kind,
      freshness_sensitivity, category_slug, content_type, priority,
      media_requirement_note, state, review_state
    ) values (
      p_discovery_id, left(p_title, 500), left(p_rationale, 2000), left(p_primary_question, 500),
      coalesce(p_supporting_questions, '{}'), coalesce(p_verified_facts, '{}'),
      coalesce(p_uncertainties, '{}'), coalesce(p_source_urls, '{}'),
      coalesce(p_suggested_structure, '{}'), p_brief_kind, p_freshness,
      left(p_category_slug, 100), p_content_type, p_priority,
      left(p_media_note, 1000), 'planned', 'pending'
    );
  exception when unique_violation then
    return 'deduped';
  end;
  return 'created';
end;
$fn$;
revoke execute on function public.engine_create_brief(uuid, text, text, text, text[], text[], text[], text[], text[], text, text, text, text, integer, text) from public;
grant execute on function public.engine_create_brief(uuid, text, text, text, text[], text[], text[], text[], text[], text, text, text, text, integer, text) to anon, authenticated;
