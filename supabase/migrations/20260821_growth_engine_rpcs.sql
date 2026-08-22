-- ============================================================================
-- Growth Engine — cron-path RPCs (companion to 20260821_growth_engine.sql)
-- Apply AFTER 20260821_growth_engine.sql.
-- ============================================================================
--
-- The scheduled jobs run as `anon` (a Vercel Cron invocation carries no
-- cookies — this is exactly what broke the analytics rollup and is fixed in
-- PART 0 of the companion migration). Rather than granting anon table access
-- to engine or analytics tables, each job goes through a narrow SECURITY
-- DEFINER function returning only the fields that job needs. Same approach the
-- first-party analytics ingestion already uses (record_analytics_touch etc.).
--
-- Every function here re-checks the relevant engine flag internally, so the
-- kill switch cannot be bypassed by calling an endpoint directly.

-- Sources that are active, permitted for discovery, and actually due a check.
create or replace function public.engine_due_sources()
returns table (
  id uuid, organisation text, url text, source_type text,
  trust_level text, categories text[]
)
language plpgsql
security definer
set search_path = public
as $fn$
begin
  if not public.engine_flag_enabled('discovery') then
    return;
  end if;
  return query
    select s.id, s.organisation, s.url, s.source_type, s.trust_level, s.categories
    from public.engine_sources s
    where s.is_active
      and s.discovery_permitted
      and (s.last_checked_at is null
           or s.last_checked_at < now() - make_interval(hours => s.check_frequency_hours))
    order by s.last_checked_at asc nulls first
    limit 25;
end;
$fn$;
revoke execute on function public.engine_due_sources() from public;
grant execute on function public.engine_due_sources() to anon, authenticated;

-- Health bookkeeping after a source is polled.
create or replace function public.engine_record_source_check(
  p_source_id uuid, p_success boolean, p_error text default null
)
returns void
language plpgsql
security definer
set search_path = public
as $fn$
begin
  update public.engine_sources
    set last_checked_at = now(),
        last_success_at = case when p_success then now() else last_success_at end,
        consecutive_failures = case when p_success then 0 else consecutive_failures + 1 end,
        last_error = case when p_success then null else left(p_error, 1000) end,
        updated_at = now()
    where id = p_source_id;
end;
$fn$;
revoke execute on function public.engine_record_source_check(uuid, boolean, text) from public;
grant execute on function public.engine_record_source_check(uuid, boolean, text) to anon, authenticated;

-- Aggregated opportunity inputs per category. Returns only counts — no raw
-- analytics rows ever leave the database through this path.
create or replace function public.engine_opportunity_inputs(p_days integer default 28)
returns table (
  category_slug text,
  search_volume integer,
  zero_result_searches integer,
  views integer,
  previous_views integer,
  existing_content_count integer,
  commercial_clicks integer,
  days_since_freshest integer
)
language plpgsql
security definer
set search_path = public
as $fn$
declare
  v_days integer := greatest(coalesce(p_days, 28), 1);
  v_start timestamptz := now() - make_interval(days => v_days);
  v_prev_start timestamptz := now() - make_interval(days => v_days * 2);
begin
  if not public.engine_flag_enabled('opportunity') then
    return;
  end if;
  return query
  with cats as (
    select tc.slug from public.taxonomy_categories tc
  ),
  ev as (
    select e.category_slug as cs, e.event_type, e.created_at, e.metadata
    from public.analytics_events e
    where e.created_at >= v_prev_start
      and e.category_slug is not null
  )
  select
    c.slug::text,
    coalesce(sum(case when ev.event_type = 'search' and ev.created_at >= v_start then 1 else 0 end), 0)::integer,
    coalesce(sum(case when ev.event_type = 'search' and ev.created_at >= v_start
      and coalesce((ev.metadata->>'result_count')::int, -1) = 0 then 1 else 0 end), 0)::integer,
    coalesce(sum(case when ev.event_type = 'page_view' and ev.created_at >= v_start then 1 else 0 end), 0)::integer,
    coalesce(sum(case when ev.event_type = 'page_view' and ev.created_at < v_start then 1 else 0 end), 0)::integer,
    (select count(*) from public.content_items ci
       join public.taxonomy_categories tc2 on tc2.id = ci.category_id
      where tc2.slug = c.slug and ci.status = 'published')::integer,
    coalesce(sum(case when ev.event_type in ('outbound_link_click', 'affiliate_click')
      and ev.created_at >= v_start then 1 else 0 end), 0)::integer,
    (select coalesce(extract(day from now() - max(ci.published_at))::integer, 9999)
       from public.content_items ci
       join public.taxonomy_categories tc3 on tc3.id = ci.category_id
      where tc3.slug = c.slug and ci.status = 'published')::integer
  from cats c
  left join ev on ev.cs = c.slug
  group by c.slug;
end;
$fn$;
revoke execute on function public.engine_opportunity_inputs(integer) from public;
grant execute on function public.engine_opportunity_inputs(integer) to anon, authenticated;

create or replace function public.engine_upsert_opportunity(
  p_subject_type text, p_subject_key text, p_label text,
  p_score numeric, p_inputs jsonb, p_explanation text
)
returns void
language plpgsql
security definer
set search_path = public
as $fn$
begin
  if p_subject_type not in ('category', 'topic', 'product', 'content', 'search_term') then
    return;
  end if;
  insert into public.engine_opportunities (subject_type, subject_key, label, score, inputs, explanation, computed_at)
  values (p_subject_type, left(p_subject_key, 200), left(p_label, 300), p_score,
          coalesce(p_inputs, '{}'::jsonb), left(p_explanation, 2000), now())
  on conflict (subject_type, subject_key) do update
    set score = excluded.score, label = excluded.label, inputs = excluded.inputs,
        explanation = excluded.explanation, computed_at = now();
end;
$fn$;
revoke execute on function public.engine_upsert_opportunity(text, text, text, numeric, jsonb, text) from public;
grant execute on function public.engine_upsert_opportunity(text, text, text, numeric, jsonb, text) to anon, authenticated;

-- Freshness: published records whose sources may have rotted or whose facts
-- may have aged. Returns identifiers + age only.
create or replace function public.engine_freshness_candidates(p_stale_days integer default 180)
returns table (
  kind text, entity_id uuid, slug text, title text, age_days integer, source_count integer
)
language plpgsql
security definer
set search_path = public
as $fn$
declare
  v_stale integer := greatest(coalesce(p_stale_days, 180), 1);
begin
  if not public.engine_flag_enabled('freshness') then
    return;
  end if;
  return query
    select 'content'::text, ci.id, ci.slug::text, ci.title::text,
           extract(day from now() - coalesce(ci.published_at, ci.created_at))::integer,
           (select count(*) from public.source_records sr where sr.content_id = ci.id)::integer
    from public.content_items ci
    where ci.status = 'published'
      and coalesce(ci.published_at, ci.created_at) < now() - make_interval(days => v_stale)
    union all
    select 'product'::text, p.id, p.slug::text, p.name::text,
           extract(day from now() - p.updated_at)::integer,
           (select count(*) from public.source_records sr where sr.product_id = p.id)::integer
    from public.products p
    where p.is_published
      and p.updated_at < now() - make_interval(days => v_stale)
    limit 200;
end;
$fn$;
revoke execute on function public.engine_freshness_candidates(integer) from public;
grant execute on function public.engine_freshness_candidates(integer) to anon, authenticated;

create or replace function public.engine_upsert_freshness(
  p_kind text, p_entity_id uuid, p_reason text, p_detail text, p_severity text
)
returns text
language plpgsql
security definer
set search_path = public
as $fn$
declare v_existing uuid;
begin
  if p_reason not in ('spec_changed','successor_released','discontinued','firmware_changed',
                      'stale_facts','stale_pricing','broken_source_link','outdated_comparison','missing_internal_links') then
    return 'rejected_invalid';
  end if;
  -- Idempotent: one open review per (entity, reason). Re-running the job does
  -- not pile up duplicates.
  select id into v_existing from public.engine_freshness_reviews
   where reason = p_reason and state = 'open'
     and ((p_kind = 'product' and product_id = p_entity_id)
       or (p_kind = 'content' and content_id = p_entity_id));
  if v_existing is not null then
    return 'deduped';
  end if;
  insert into public.engine_freshness_reviews (product_id, content_id, reason, detail, severity)
  values (
    case when p_kind = 'product' then p_entity_id end,
    case when p_kind = 'content' then p_entity_id end,
    p_reason, left(p_detail, 2000), coalesce(nullif(p_severity, ''), 'low')
  );
  return 'created';
end;
$fn$;
revoke execute on function public.engine_upsert_freshness(text, uuid, text, text, text) from public;
grant execute on function public.engine_upsert_freshness(text, uuid, text, text, text) to anon, authenticated;
