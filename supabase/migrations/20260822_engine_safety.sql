-- ============================================================================
-- Growth Engine safety layer — circuit breakers, self-monitoring, idempotency
-- NOT YET APPLIED. Drafted only. Move into supabase/migrations/ once it has
-- actually been run.
-- ============================================================================
--
-- Companion to:
--   src/lib/engine/circuit-breaker.ts   (breaker rules, pure)
--   src/lib/engine/health.ts            (self-monitoring, pure)
--   src/lib/engine/postconditions.ts    (silent-no-op detection, pure)
--   src/lib/engine/budgets.ts           (daily caps, pure)
--   src/lib/engine/concurrency.ts       (lease + idempotency audit, pure)
--   src/lib/engine/guard.ts             (the I/O that stitches them together)
--
-- WHY ANY OF THIS NEEDS SQL
-- -------------------------
-- Scheduled jobs run as `anon` (a Vercel Cron request carries no cookies) and
-- every engine table is admin-only under RLS. RLS denies by returning ZERO ROWS
-- rather than an error, so a job that reads its own audit log directly would
-- see an empty history and conclude that everything is fine — a blind monitor
-- that looks identical to a healthy one. Every read below is therefore a narrow
-- SECURITY DEFINER function returning counts and status values only.
--
-- WHAT IS DELIBERATELY NOT EXPOSED
-- --------------------------------
-- engine_recent_job_runs returns `has_error boolean`, never the error text, and
-- never the `detail` jsonb. Those carry unpublished editorial intent (titles,
-- source names, rejection reasons) and anon has no business reading them. The
-- boolean is all the breakers need.
--
-- PART 6 IS A REGRESSION FIX and should be read first if you are short of time.
--
-- Until this is applied:
--   * the tick cannot take a run lease, so creation, media acquisition and
--     publication stay HALTED (see decideLease('unavailable')). Measurement and
--     maintenance stages continue — they are idempotent and change nothing on a
--     second run;
--   * self-monitoring reports "telemetry unavailable" rather than "healthy".

-- ============================================================================
-- PART 1 — Telemetry reads for self-monitoring
-- ============================================================================

-- Recent job runs, counts only. This is what src/lib/engine/health.ts compares
-- each job against ITS OWN history with — which is why it returns a window of
-- runs rather than a pre-computed verdict. The thresholds belong in tested
-- TypeScript, not in SQL nobody can unit-test.
create or replace function public.engine_recent_job_runs(
  p_hours integer default 336,
  p_limit integer default 800
)
returns table (
  job_name text,
  status text,
  started_at timestamptz,
  finished_at timestamptz,
  items_examined integer,
  items_created integer,
  items_deduped integer,
  items_failed integer,
  has_error boolean
)
language plpgsql
security definer
set search_path = public
as $fn$
begin
  return query
    select r.job_name, r.status, r.started_at, r.finished_at,
           r.items_examined, r.items_created, r.items_deduped, r.items_failed,
           (r.error is not null) as has_error
      from public.engine_job_runs r
     where r.started_at >= now() - make_interval(hours => greatest(coalesce(p_hours, 336), 1))
     order by r.started_at desc
     limit greatest(coalesce(p_limit, 800), 1);
end;
$fn$;
revoke execute on function public.engine_recent_job_runs(integer, integer) from public;
grant execute on function public.engine_recent_job_runs(integer, integer) to anon, authenticated;

-- Source health in aggregate. Counts only — no URLs, no organisation names, no
-- error text leaves the database through this path.
create or replace function public.engine_source_health()
returns table (checked integer, failed integer, max_consecutive_failures integer)
language plpgsql
security definer
set search_path = public
as $fn$
begin
  return query
    select count(*)::integer,
           count(*) filter (where s.consecutive_failures > 0)::integer,
           coalesce(max(s.consecutive_failures), 0)::integer
      from public.engine_sources s
     where s.is_active and s.discovery_permitted;
end;
$fn$;
revoke execute on function public.engine_source_health() from public;
grant execute on function public.engine_source_health() to anon, authenticated;

-- Relevance-classification outcomes, current window vs the preceding 30 days.
-- This is what feeds the "spike in rejected validations" breaker. A rejection
-- rate is only meaningful against the engine's own baseline, so both are
-- returned and the caller computes the ratio.
create or replace function public.engine_validation_stats(p_hours integer default 24)
returns table (
  evaluated integer,
  rejected integer,
  baseline_evaluated integer,
  baseline_rejected integer
)
language plpgsql
security definer
set search_path = public
as $fn$
declare
  v_hours integer := greatest(coalesce(p_hours, 24), 1);
  v_start timestamptz := now() - make_interval(hours => v_hours);
  v_baseline_start timestamptz := now() - interval '30 days';
begin
  return query
    select
      count(*) filter (where d.updated_at >= v_start and d.relevance_verdict is not null)::integer,
      count(*) filter (where d.updated_at >= v_start and d.relevance_verdict = 'rejected')::integer,
      count(*) filter (where d.updated_at >= v_baseline_start and d.updated_at < v_start
                         and d.relevance_verdict is not null)::integer,
      count(*) filter (where d.updated_at >= v_baseline_start and d.updated_at < v_start
                         and d.relevance_verdict = 'rejected')::integer
      from public.engine_discoveries d
     where d.updated_at >= v_baseline_start;
end;
$fn$;
revoke execute on function public.engine_validation_stats(integer) from public;
grant execute on function public.engine_validation_stats(integer) to anon, authenticated;

-- ============================================================================
-- PART 2 — Run lease: two workers must not act on the same opportunity
-- ============================================================================
--
-- engine_job_runs has carried a partial unique index on
-- (job_name, idempotency_key) where idempotency_key is not null and status in
-- ('success','running') since Phase 3 — and nothing has ever populated
-- idempotency_key, so the index has protected exactly nothing. These two
-- functions are what finally use it.
--
-- Semantics that follow from the index predicate, and are all deliberate:
--   * a live 'running' row blocks a second worker in the same window;
--   * a completed 'success' row ALSO blocks, so a window that already did its
--     work is not redone;
--   * a 'failed' row does not block, so a genuine failure is retryable within
--     the same window;
--   * an expired lease is demoted to 'failed' (removing it from the index) and
--     the new worker takes over, so a killed function does not wedge the engine
--     until the window rolls.

create or replace function public.engine_begin_run(
  p_job_name text,
  p_idempotency_key text,
  p_lease_seconds integer default 900
)
returns text
language plpgsql
security definer
set search_path = public
as $fn$
declare
  v_id uuid;
  v_taken_over integer := 0;
begin
  if p_job_name is null or char_length(p_job_name) > 100 then
    return 'rejected_invalid';
  end if;
  if p_idempotency_key is null or char_length(p_idempotency_key) > 200 then
    return 'rejected_invalid';
  end if;

  -- Reap leases that cannot still be held. Vercel's function ceiling is far
  -- below the default lease, so a 'running' row this old is a dead worker, not
  -- a slow one. It is demoted rather than deleted: the evidence that a run was
  -- abandoned is worth keeping.
  update public.engine_job_runs
     set status = 'failed',
         finished_at = now(),
         error = left(coalesce(error || ' ', '') ||
           '[lease of ' || greatest(coalesce(p_lease_seconds, 900), 1) ||
           's expired; run abandoned and taken over by a later worker]', 2000)
   where job_name = p_job_name
     and status = 'running'
     and started_at < now() - make_interval(secs => greatest(coalesce(p_lease_seconds, 900), 1));
  get diagnostics v_taken_over = row_count;

  begin
    insert into public.engine_job_runs (job_name, idempotency_key, status, started_at)
    values (p_job_name, p_idempotency_key, 'running', now())
    returning id into v_id;
  exception when unique_violation then
    return 'already_running';
  end;

  return case when v_taken_over > 0 then 'took_over:' else 'acquired:' end || v_id::text;
end;
$fn$;
revoke execute on function public.engine_begin_run(text, text, integer) from public;
grant execute on function public.engine_begin_run(text, text, integer) to anon, authenticated;

create or replace function public.engine_complete_run(
  p_run_id uuid,
  p_status text,
  p_items_examined integer default 0,
  p_items_created integer default 0,
  p_items_deduped integer default 0,
  p_items_failed integer default 0,
  p_detail jsonb default '{}'::jsonb,
  p_error text default null
)
returns text
language plpgsql
security definer
set search_path = public
as $fn$
declare v_rows integer;
begin
  if p_status not in ('success', 'partial', 'failed', 'skipped') then
    return 'rejected_invalid';
  end if;

  update public.engine_job_runs
     set status = p_status,
         finished_at = now(),
         items_examined = coalesce(p_items_examined, 0),
         items_created = coalesce(p_items_created, 0),
         items_deduped = coalesce(p_items_deduped, 0),
         items_failed = coalesce(p_items_failed, 0),
         detail = coalesce(p_detail, '{}'::jsonb),
         error = left(p_error, 2000)
   where id = p_run_id
     and status = 'running';
  get diagnostics v_rows = row_count;

  -- Reporting how many rows were actually updated is the point: 'not_running'
  -- means this worker's lease had already been reaped, which the caller needs
  -- to know rather than assume its completion landed.
  return case when v_rows > 0 then 'completed' else 'not_running' end;
end;
$fn$;
revoke execute on function public.engine_complete_run(uuid, text, integer, integer, integer, integer, jsonb, text) from public;
grant execute on function public.engine_complete_run(uuid, text, integer, integer, integer, integer, jsonb, text) to anon, authenticated;

-- ============================================================================
-- PART 3 — Idempotency: constraints the RPCs' own comments already assumed
-- ============================================================================

-- ---------------------------------------------------------------------------
-- 3a. engine_freshness_reviews — one OPEN review per (target, reason)
-- ---------------------------------------------------------------------------
-- engine_upsert_freshness is commented "Idempotent: one open review per
-- (entity, reason)" and implements that as select-then-insert with NO unique
-- index underneath. That is idempotent when run twice in sequence and races
-- when run twice in parallel: both workers see no existing row and both insert.
-- Three stages write through this function (freshness, internal links, hero
-- media), so it is the most-exercised read-then-write path in the engine.

-- Existing duplicates would block index creation. Demote the newer copies
-- rather than deleting them — they are identical recommendations, and the
-- evidence of the duplication is worth keeping in the record.
update public.engine_freshness_reviews r
   set state = 'dismissed',
       detail = left(coalesce(r.detail || ' ', '') ||
         '[Duplicate open review, superseded by the earliest one for this target/reason. ' ||
         'Dismissed by 20260822_engine_safety.sql before adding the uniqueness constraint.]', 2000)
 where r.state = 'open'
   and exists (
     select 1 from public.engine_freshness_reviews o
      where o.state = 'open'
        and o.reason = r.reason
        and o.id <> r.id
        and (o.detected_at, o.id) < (r.detected_at, r.id)
        and (o.content_id is not distinct from r.content_id)
        and (o.product_id is not distinct from r.product_id)
   );

create unique index if not exists engine_freshness_one_open_per_content
  on public.engine_freshness_reviews (content_id, reason)
  where content_id is not null and state = 'open';
create unique index if not exists engine_freshness_one_open_per_product
  on public.engine_freshness_reviews (product_id, reason)
  where product_id is not null and state = 'open';

create or replace function public.engine_upsert_freshness(
  p_kind text, p_entity_id uuid, p_reason text, p_detail text, p_severity text
)
returns text
language plpgsql
security definer
set search_path = public
as $fn$
begin
  if p_reason not in ('spec_changed','successor_released','discontinued','firmware_changed',
                      'stale_facts','stale_pricing','broken_source_link','outdated_comparison','missing_internal_links') then
    return 'rejected_invalid';
  end if;
  if p_kind not in ('product', 'content') then
    return 'rejected_invalid';
  end if;
  if p_entity_id is null then
    return 'rejected_invalid';
  end if;

  -- The constraint, not the read, is now what enforces uniqueness. The insert
  -- is attempted unconditionally and the database arbitrates, so two workers
  -- racing produce one row and one honest 'deduped'.
  begin
    insert into public.engine_freshness_reviews (product_id, content_id, reason, detail, severity)
    values (
      case when p_kind = 'product' then p_entity_id end,
      case when p_kind = 'content' then p_entity_id end,
      p_reason, left(p_detail, 2000), coalesce(nullif(p_severity, ''), 'low')
    );
  exception when unique_violation then
    return 'deduped';
  end;
  return 'created';
end;
$fn$;
revoke execute on function public.engine_upsert_freshness(text, uuid, text, text, text) from public;
grant execute on function public.engine_upsert_freshness(text, uuid, text, text, text) to anon, authenticated;

-- ---------------------------------------------------------------------------
-- 3b. engine_media_candidates — the one genuinely non-idempotent write
-- ---------------------------------------------------------------------------
-- engine_record_media_candidate has no uniqueness constraint of any kind and
-- always inserts. The job guards on the requirement's existing candidate count
-- read at the start of the pass, which means: two concurrent workers both read
-- zero and both insert, and a requirement whose candidates were all rejected
-- drops back to a zero count and collects a fresh duplicate set.
--
-- One live candidate per (requirement, source organisation, asset type).
-- Rejected and ingested candidates are outside the predicate on purpose — a
-- rejected proposal should not permanently block re-proposing that route later
-- if a human changes the source's rights status.
update public.engine_media_candidates c
   set state = 'rejected',
       state_reason = left(coalesce(c.state_reason || ' ', '') ||
         '[Duplicate live candidate, superseded by the earliest one for this requirement/source/type. ' ||
         'Rejected by 20260822_engine_safety.sql before adding the uniqueness constraint.]', 1000)
 where c.state in ('discovered', 'rights_review')
   and c.media_requirement_id is not null
   and exists (
     select 1 from public.engine_media_candidates o
      where o.state in ('discovered', 'rights_review')
        and o.media_requirement_id = c.media_requirement_id
        and coalesce(o.source_organisation, '') = coalesce(c.source_organisation, '')
        and coalesce(o.asset_type, '') = coalesce(c.asset_type, '')
        and o.id <> c.id
        and (o.created_at, o.id) < (c.created_at, c.id)
   );

create unique index if not exists engine_media_candidates_one_live
  on public.engine_media_candidates (
    media_requirement_id,
    coalesce(source_organisation, ''),
    coalesce(asset_type, '')
  )
  where media_requirement_id is not null and state in ('discovered', 'rights_review');

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

  -- Unchanged and non-negotiable: anything needing review enters rights_review,
  -- and nothing reaches 'approved' through this path.
  v_state := case when coalesce(p_requires_human_review, true) then 'rights_review' else 'discovered' end;

  begin
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
  exception when unique_violation then
    return 'deduped';
  end;
  return 'created';
end;
$fn$;
revoke execute on function public.engine_record_media_candidate(uuid, uuid, uuid, text, text, text, text, integer, integer, text, text, numeric, boolean, text) from public;
grant execute on function public.engine_record_media_candidate(uuid, uuid, uuid, text, text, text, text, integer, integer, text, text, numeric, boolean, text) to anon, authenticated;

-- ---------------------------------------------------------------------------
-- 3c. engine_upsert_discovery — let the unique index arbitrate
-- ---------------------------------------------------------------------------
-- The dedupe_key unique constraint already makes duplicate discoveries
-- impossible, so this was never a correctness hole — but the select-then-insert
-- means the losing worker in a race raises unique_violation, which surfaces as
-- a job error rather than an honest 'deduped'. A repeat sighting still raises
-- corroboration only: confidence and claim_status are untouched, exactly as
-- before, because many outlets repeating one claim is not evidence.
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
  v_created boolean;
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

  insert into public.engine_discoveries (
    dedupe_key, title, summary, discovery_type, category_slug, claim_status, confidence
  ) values (
    left(p_dedupe_key, 400), left(p_title, 500), left(p_summary, 4000), p_discovery_type,
    left(p_category_slug, 100),
    coalesce(nullif(p_claim_status, ''), 'unverified'),
    least(greatest(coalesce(p_confidence, 0), 0), 1)
  )
  on conflict (dedupe_key) do update
    set last_seen_at = now(),
        sighting_count = public.engine_discoveries.sighting_count + 1,
        updated_at = now()
  -- xmax = 0 is true only for a row this statement inserted, which is how an
  -- upsert reports which branch it took.
  returning id, (xmax = 0) into v_id, v_created;

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

-- ============================================================================
-- PART 4 — Assembly races: report 'duplicate_slug' instead of raising
-- ============================================================================
-- content_items.slug and products.slug are already unique, so no duplicate page
-- or product can be created. The exists() check in front of each insert is a
-- TOCTOU window that the constraint closes — but the loser currently raises
-- unique_violation, which the job counts as a failure rather than as the
-- correct 'this already exists' answer. Publication safety is unchanged: both
-- functions are still hard-wired to status='draft' / is_published=false and
-- still have no parameter capable of publishing.

create or replace function public.engine_assemble_draft(
  p_brief_id uuid,
  p_title text,
  p_slug text,
  p_body text,
  p_content_type text,
  p_category_slug text,
  p_search_intent text,
  p_primary_query text,
  p_source_urls text[],
  p_meta_title text default null,
  p_meta_description text default null
)
returns text
language plpgsql
security definer
set search_path = public
as $fn$
declare
  v_category uuid;
  v_content uuid;
  v_url text;
begin
  if p_title is null or p_slug is null or p_body is null then
    return 'rejected_invalid';
  end if;
  if p_content_type not in ('review', 'guide', 'comparison', 'news', 'troubleshooting') then
    return 'rejected_invalid';
  end if;
  if exists (select 1 from public.content_items where slug = p_slug) then
    return 'duplicate_slug';
  end if;

  select id into v_category from public.taxonomy_categories where slug = p_category_slug;

  begin
    insert into public.content_items (type, title, slug, body, status, category_id, search_intent, primary_query)
    values (p_content_type, left(p_title, 300), left(p_slug, 200), p_body,
            'draft',  -- never anything else
            v_category, nullif(p_search_intent, ''), left(p_primary_query, 200))
    returning id into v_content;
  exception when unique_violation then
    -- Another worker claimed this slug between the check above and here.
    return 'duplicate_slug';
  end;

  foreach v_url in array coalesce(p_source_urls, '{}') loop
    insert into public.source_records (content_id, url, publisher, reliability_tier, retrieved_at)
    values (v_content, left(v_url, 1000), null, 'secondary', now())
    on conflict do nothing;
  end loop;

  if p_meta_title is not null or p_meta_description is not null then
    insert into public.seo_metadata (content_id, meta_title, meta_description)
    values (v_content, left(p_meta_title, 200), left(p_meta_description, 300))
    on conflict (content_id) do nothing;
  end if;

  insert into public.media_requirements (content_id, sourcing_status, notes)
  values (v_content, 'needed', 'Auto-created for an engine-assembled draft. Media required before publication.')
  on conflict do nothing;

  -- Stamping the brief is what stops a second worker selecting it again, so it
  -- is scoped to briefs that have not already been stamped. Without the
  -- predicate, two workers that both got past the slug check would each
  -- overwrite the other's assembled_content_id and one draft would be orphaned.
  update public.engine_briefs
     set assembled_content_id = v_content,
         assembled_at = now(),
         state = 'drafting',
         updated_at = now()
   where id = p_brief_id
     and assembled_content_id is null;

  return v_content::text;
end;
$fn$;
revoke execute on function public.engine_assemble_draft(uuid, text, text, text, text, text, text, text, text[], text, text) from public;
grant execute on function public.engine_assemble_draft(uuid, text, text, text, text, text, text, text, text[], text, text) to anon, authenticated;

create or replace function public.engine_assemble_product(
  p_discovery_id uuid,
  p_name text,
  p_slug text,
  p_manufacturer_slug text,
  p_category_slug text,
  p_status text,
  p_source_urls text[]
)
returns text
language plpgsql
security definer
set search_path = public
as $fn$
declare
  v_manufacturer uuid;
  v_category uuid;
  v_product uuid;
  v_url text;
begin
  if p_name is null or p_slug is null then
    return 'rejected_invalid';
  end if;
  if p_status not in ('active', 'rumored') then
    return 'rejected_invalid';
  end if;
  if exists (select 1 from public.products where slug = p_slug) then
    return 'duplicate_slug';
  end if;

  select id into v_manufacturer from public.manufacturers where slug = p_manufacturer_slug;
  if v_manufacturer is null then
    return 'unknown_manufacturer';
  end if;

  select id into v_category from public.taxonomy_categories where slug = p_category_slug;
  if v_category is null then
    return 'unknown_category';
  end if;

  begin
    insert into public.products (manufacturer_id, category_id, name, slug, status, is_published)
    values (v_manufacturer, v_category, left(p_name, 300), left(p_slug, 200), p_status,
            false)  -- never anything else
    returning id into v_product;
  exception when unique_violation then
    return 'duplicate_slug';
  end;

  foreach v_url in array coalesce(p_source_urls, '{}') loop
    insert into public.source_records (product_id, url, publisher, reliability_tier, retrieved_at)
    values (v_product, left(v_url, 1000), null, 'secondary', now())
    on conflict do nothing;
  end loop;

  insert into public.media_requirements (product_id, sourcing_status, notes)
  values (v_product, 'needed',
          'Auto-created for an engine-assembled product. Legitimately-licensed photography required before publication.')
  on conflict do nothing;

  return v_product::text;
end;
$fn$;
revoke execute on function public.engine_assemble_product(uuid, text, text, text, text, text, text[]) from public;
grant execute on function public.engine_assemble_product(uuid, text, text, text, text, text, text[]) to anon, authenticated;

-- ============================================================================
-- PART 5 — Job-run audit rows must be attributable to a lease
-- ============================================================================
-- engine_record_job_run keeps working exactly as before for per-stage rows.
-- Only the tick's own summary row goes through engine_begin_run/complete_run,
-- because the lease is a property of the whole pass, not of each stage.
-- No change is needed here; this comment exists so the next reader does not
-- "fix" the asymmetry by accident.

-- ============================================================================
-- PART 6 — REGRESSION FIX: freshness has never been able to raise an update
--          proposal for a stale page
-- ============================================================================
--
-- 20260822_phase6_draft_assembly.sql added 'stale_content' to the
-- engine_update_proposals.reason CHECK constraint, with a comment explaining
-- exactly why it exists — but the guard inside engine_upsert_update_proposal
-- was never widened to match:
--
--   if p_reason not in ('firmware_update','successor_released','discontinued',
--                       'spec_change','price_change','newer_evidence','broken_source')
--
-- src/lib/engine/jobs/freshness-job.ts passes 'stale_content' for every
-- high-severity stale page. Every one of those calls has been returning
-- 'rejected_invalid' and doing nothing, and the job never inspected the return
-- value — so the bridge from "this page is old" to the editor's actionable
-- queue has silently never worked. No error, no failed count, no sign of it in
-- engine_job_runs. Exactly the failure class this migration is about.
create or replace function public.engine_upsert_update_proposal(
  p_content_id uuid, p_product_id uuid, p_discovery_id uuid,
  p_reason text, p_summary text, p_changes text[], p_evidence text[], p_confidence numeric
)
returns text
language plpgsql
security definer
set search_path = public
as $fn$
begin
  -- Now mirrors the table's own CHECK constraint exactly. If a reason is ever
  -- added to the table, it must be added here in the same migration.
  if p_reason not in ('firmware_update','successor_released','discontinued','spec_change',
                      'price_change','newer_evidence','broken_source','stale_content') then
    return 'rejected_invalid';
  end if;
  if (p_content_id is null) = (p_product_id is null) then
    -- The table's engine_update_one_target check would reject this anyway;
    -- returning a status is more useful to the caller than an exception.
    return 'rejected_invalid';
  end if;
  begin
    insert into public.engine_update_proposals (
      content_id, product_id, discovery_id, reason, summary,
      proposed_changes, evidence_urls, confidence
    ) values (
      p_content_id, p_product_id, p_discovery_id, p_reason, left(p_summary, 2000),
      coalesce(p_changes, '{}'), coalesce(p_evidence, '{}'),
      least(greatest(coalesce(p_confidence, 0), 0), 1)
    );
  exception when unique_violation then
    update public.engine_update_proposals
       set summary = left(p_summary, 2000),
           proposed_changes = coalesce(p_changes, '{}'),
           evidence_urls = coalesce(p_evidence, '{}'),
           confidence = least(greatest(coalesce(p_confidence, 0), 0), 1),
           updated_at = now()
     where reason = p_reason and state = 'open'
       and ((p_content_id is not null and content_id = p_content_id)
         or (p_product_id is not null and product_id = p_product_id));
    return 'refreshed';
  end;
  return 'created';
end;
$fn$;
revoke execute on function public.engine_upsert_update_proposal(uuid, uuid, uuid, text, text, text[], text[], numeric) from public;
grant execute on function public.engine_upsert_update_proposal(uuid, uuid, uuid, text, text, text[], text[], numeric) to anon, authenticated;
