-- ============================================================================
-- SILENT_SUCCESS telemetry and the RPCs that currently cannot be verified
-- NOT YET APPLIED. Drafted 2026-08-22. Do not move into migrations/ until it
-- has actually been run AND verified behaviourally (see VERIFICATION below).
-- ============================================================================
--
-- WHY
-- ---
-- SILENT_SUCCESS is an operation that reports success while not doing the thing
-- it exists to do. This project has shipped it twice:
--
--   1. A DELETE against analytics_events returned "0 rows deleted" with no
--      error, because RLS denies by returning zero rows.
--   2. engine_upsert_update_proposal answered 'rejected_invalid' to every
--      'stale_content' call; the freshness job discarded the answer; the run
--      recorded status: success. The bridge never worked once.
--
-- src/lib/engine/postconditions.ts and src/lib/engine/silent-success.ts now
-- detect this class in the application layer. Three things stop that detection
-- being as sharp as it should be, and all three are in the database:
--
--   A. engine_job_runs has nowhere to record how many of a pass's mutations
--      were VERIFIED versus silently no-op. Without it the detector can only
--      use the coarse cross-run shapes.
--   B. Several RPCs are `returns void`, so their effect cannot be observed from
--      the response AT ALL. No amount of caller-side checking can fix this —
--      the information is simply not sent. Every such call is currently
--      recorded as a "blind write" and counted against readiness.
--   C. engine_set_relevance returns 'ok' UNCONDITIONALLY after its UPDATE,
--      without checking FOUND. So 'ok' means "the statement ran", not "a row
--      changed" — a silent no-op living inside a function that reports success.
--      This is incident #1's shape, in our own code, today.
--
-- WHAT THIS DOES NOT DO
-- ---------------------
--   * It does not weaken any RLS policy, grant, or guard list.
--   * It does not add a publishing path. Nothing here can set
--     content_items.status or products.is_published.
--   * It does not change what any function DOES — only what it REPORTS. Every
--     write below performs exactly the statement it performed before.
--
-- VERIFICATION AFTER APPLYING (do not trust the SQL editor's result message —
-- a migration in this project has already reported "Success" without applying):
--
--   select public.engine_set_relevance(
--     '00000000-0000-0000-0000-000000000000', 'relevant', 0, 'probe', null);
--   -- MUST return 'no_matching_row', NOT 'ok'.
--
--   select public.engine_upsert_opportunity(
--     'category', 'zz-probe', 'zz-probe', null, '{}'::jsonb, 'probe');
--   -- MUST return a status string, not null.
--   -- Then: delete from engine_opportunities where subject_key = 'zz-probe';
--
--   select silent_no_ops from public.engine_recent_job_runs(1, 1);
--   -- MUST resolve (column exists), even if null.

-- ---------------------------------------------------------------------------
-- A. Postcondition counters on the audit log
-- ---------------------------------------------------------------------------
-- Nullable with NO default. A default of 0 would assert "this run had no
-- silent no-ops" for every historical row and every job that has not been
-- instrumented yet — turning an absence of measurement into a clean result,
-- which is the exact confusion this whole effort exists to remove. NULL means
-- unmeasured, and silent-success.ts reads it as unmeasured.

alter table public.engine_job_runs
  add column if not exists verified_writes   integer,
  add column if not exists silent_no_ops     integer,
  add column if not exists unverified_writes integer,
  add column if not exists blind_writes      integer;

comment on column public.engine_job_runs.silent_no_ops is
  'Mutations in this run that returned no error and demonstrably changed nothing. NULL means the run predates postcondition instrumentation — it does NOT mean zero.';
comment on column public.engine_job_runs.blind_writes is
  'Writes through `returns void` RPCs, whose effect could not be observed. Not failures; unproven. NULL means unmeasured.';

-- ---------------------------------------------------------------------------
-- B. Record them — engine_record_job_run
-- ---------------------------------------------------------------------------
-- New parameters are added with DEFAULTS at the END of the signature, so every
-- existing caller keeps working unchanged and PostgREST resolves the old shape.

create or replace function public.engine_record_job_run(
  p_job_name text,
  p_status text,
  p_items_examined integer,
  p_items_created integer,
  p_items_deduped integer,
  p_items_failed integer,
  p_detail jsonb,
  p_error text default null,
  p_verified_writes integer default null,
  p_silent_no_ops integer default null,
  p_unverified_writes integer default null,
  p_blind_writes integer default null
)
returns void
language plpgsql
security definer
set search_path = public
as $fn$
begin
  if p_status not in ('running', 'success', 'partial', 'failed', 'skipped') then
    raise exception 'engine_record_job_run: unknown status %', p_status;
  end if;

  insert into public.engine_job_runs (
    job_name, status, started_at, finished_at,
    items_examined, items_created, items_deduped, items_failed,
    detail, error,
    verified_writes, silent_no_ops, unverified_writes, blind_writes
  ) values (
    p_job_name, p_status, now(), now(),
    coalesce(p_items_examined, 0), coalesce(p_items_created, 0),
    coalesce(p_items_deduped, 0), coalesce(p_items_failed, 0),
    coalesce(p_detail, '{}'::jsonb), p_error,
    p_verified_writes, p_silent_no_ops, p_unverified_writes, p_blind_writes
  );
end;
$fn$;

revoke execute on function public.engine_record_job_run(text, text, integer, integer, integer, integer, jsonb, text, integer, integer, integer, integer) from public;
grant execute on function public.engine_record_job_run(text, text, integer, integer, integer, integer, jsonb, text, integer, integer, integer, integer) to anon, authenticated;

-- ---------------------------------------------------------------------------
-- C. Expose them — engine_recent_job_runs
-- ---------------------------------------------------------------------------
-- src/lib/engine/guard.ts already reads these four columns optionally and maps
-- a missing one to null, so applying this changes detection resolution without
-- needing an application change.

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
  has_error boolean,
  verified_writes integer,
  silent_no_ops integer,
  unverified_writes integer,
  blind_writes integer
)
language plpgsql
security definer
set search_path = public
as $fn$
begin
  return query
    select r.job_name, r.status, r.started_at, r.finished_at,
           r.items_examined, r.items_created, r.items_deduped, r.items_failed,
           -- The error TEXT is deliberately still not exposed to anon; only
           -- whether one existed. Unchanged from the applied version.
           (r.error is not null) as has_error,
           r.verified_writes, r.silent_no_ops, r.unverified_writes, r.blind_writes
      from public.engine_job_runs r
     where r.started_at > now() - make_interval(hours => greatest(coalesce(p_hours, 336), 1))
     order by r.started_at desc
     limit least(greatest(coalesce(p_limit, 800), 1), 2000);
end;
$fn$;

revoke execute on function public.engine_recent_job_runs(integer, integer) from public;
grant execute on function public.engine_recent_job_runs(integer, integer) to anon, authenticated;

-- ---------------------------------------------------------------------------
-- D. THE REAL BUG: engine_set_relevance reports 'ok' after changing nothing
-- ---------------------------------------------------------------------------
-- The applied version runs an UPDATE with two predicates — the id, and
-- `relevance_overridden_by_admin = false` — and then returns 'ok' whatever
-- happened. A discovery that was admin-overridden, deleted, or invisible under
-- RLS produces the identical answer to one that was genuinely re-classified.
--
-- src/lib/engine/jobs/relevance-job.ts already accepts 'updated' and treats
-- 'human_override' as benign, so no application change is needed when this
-- lands. 'ok' is kept in its accepted list only until this is applied.

create or replace function public.engine_set_relevance(
  p_id uuid, p_verdict text, p_score integer, p_explanation text, p_angle text
)
returns text
language plpgsql
security definer
set search_path = public
as $fn$
declare
  v_overridden boolean;
  v_updated integer;
begin
  if p_verdict not in ('relevant', 'rejected', 'uncertain') then
    return 'rejected_invalid';
  end if;

  select relevance_overridden_by_admin into v_overridden
    from public.engine_discoveries where id = p_id;

  if not found then
    -- Says so, rather than reporting a successful classification of a row that
    -- is not there.
    return 'no_matching_row';
  end if;
  if v_overridden then
    -- Genuine, intended non-work: never overwrite a human decision.
    return 'human_override';
  end if;

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

  get diagnostics v_updated = row_count;
  -- The whole point of this file: assert the postcondition rather than assume
  -- it. A statement that matched nothing does not get to say 'updated'.
  if v_updated = 0 then
    return 'no_matching_row';
  end if;
  return 'updated';
end;
$fn$;

revoke execute on function public.engine_set_relevance(uuid, text, integer, text, text) from public;
grant execute on function public.engine_set_relevance(uuid, text, integer, text, text) to anon, authenticated;

-- ---------------------------------------------------------------------------
-- E. Give the void RPCs something to say
-- ---------------------------------------------------------------------------
-- These three are the engine's remaining blind writes. Each performs exactly
-- the same statement as before; the only change is that the caller can now tell
-- whether it landed. Return type changes from void to text, which PostgREST
-- handles transparently for existing callers that ignore the body.

create or replace function public.engine_upsert_opportunity(
  p_subject_type text, p_subject_key text, p_label text,
  p_score numeric, p_inputs jsonb, p_explanation text
)
returns text
language plpgsql
security definer
set search_path = public
as $fn$
declare v_rows integer;
begin
  if p_subject_type not in ('category', 'topic', 'query') then
    return 'rejected_invalid';
  end if;
  if p_subject_key is null or length(trim(p_subject_key)) = 0 then
    return 'rejected_invalid';
  end if;

  insert into public.engine_opportunities (
    subject_type, subject_key, label, score, inputs, explanation, updated_at
  ) values (
    p_subject_type, left(p_subject_key, 200), left(p_label, 200),
    p_score, coalesce(p_inputs, '{}'::jsonb), left(p_explanation, 2000), now()
  )
  on conflict (subject_type, subject_key) do update
    set label = excluded.label,
        score = excluded.score,
        inputs = excluded.inputs,
        explanation = excluded.explanation,
        updated_at = now();

  get diagnostics v_rows = row_count;
  if v_rows = 0 then
    return 'no_rows_affected';
  end if;
  return 'ok';
end;
$fn$;

revoke execute on function public.engine_upsert_opportunity(text, text, text, numeric, jsonb, text) from public;
grant execute on function public.engine_upsert_opportunity(text, text, text, numeric, jsonb, text) to anon, authenticated;

create or replace function public.engine_record_source_check(
  p_source_id uuid, p_success boolean, p_error text default null
)
returns text
language plpgsql
security definer
set search_path = public
as $fn$
declare v_rows integer;
begin
  update public.engine_sources
     set last_checked_at = now(),
         consecutive_failures =
           case when p_success then 0 else consecutive_failures + 1 end,
         last_error = case when p_success then null else left(p_error, 1000) end
   where id = p_source_id;

  get diagnostics v_rows = row_count;
  -- Source health feeds the source_failures circuit breaker. A no-op here would
  -- leave that breaker reading a permanently healthy registry no matter how
  -- many sources had died, so it must be reportable.
  if v_rows = 0 then
    return 'no_matching_source';
  end if;
  return 'ok';
end;
$fn$;

revoke execute on function public.engine_record_source_check(uuid, boolean, text) from public;
grant execute on function public.engine_record_source_check(uuid, boolean, text) to anon, authenticated;

create or replace function public.engine_record_entity_resolution(
  p_discovery_id uuid, p_candidate_name text, p_normalised text,
  p_product_id uuid, p_content_id uuid, p_score numeric,
  p_decision text, p_explanation text
)
returns text
language plpgsql
security definer
set search_path = public
as $fn$
declare v_id uuid;
begin
  if p_decision not in ('matched_existing', 'new_entity', 'ambiguous', 'ignored') then
    return 'rejected_invalid';
  end if;

  insert into public.engine_entity_resolutions (
    discovery_id, candidate_name, normalised_name, product_id, content_id,
    score, decision, explanation
  ) values (
    p_discovery_id, left(p_candidate_name, 300), left(p_normalised, 300),
    p_product_id, p_content_id, p_score, p_decision, left(p_explanation, 2000)
  )
  returning id into v_id;

  -- This is the audit trail for "why didn't this create an article?". Returning
  -- the row id is what lets a caller prove the explanation was actually stored
  -- rather than assume it.
  return v_id::text;
end;
$fn$;

revoke execute on function public.engine_record_entity_resolution(uuid, text, text, uuid, uuid, numeric, text, text) from public;
grant execute on function public.engine_record_entity_resolution(uuid, text, text, uuid, uuid, numeric, text, text) to anon, authenticated;

-- ---------------------------------------------------------------------------
-- F. Aggregate view for the breaker, so it does not have to scan every run
-- ---------------------------------------------------------------------------

create or replace function public.engine_silent_success_stats(p_hours integer default 168)
returns table (
  runs_measured integer,
  runs_instrumented integer,
  verified_writes integer,
  silent_no_ops integer,
  unverified_writes integer,
  blind_writes integer
)
language plpgsql
security definer
set search_path = public
as $fn$
begin
  return query
    select
      count(*)::integer,
      count(*) filter (where r.silent_no_ops is not null)::integer,
      coalesce(sum(r.verified_writes), 0)::integer,
      coalesce(sum(r.silent_no_ops), 0)::integer,
      coalesce(sum(r.unverified_writes), 0)::integer,
      coalesce(sum(r.blind_writes), 0)::integer
    from public.engine_job_runs r
   where r.started_at > now() - make_interval(hours => greatest(coalesce(p_hours, 168), 1))
     and r.status <> 'skipped';
end;
$fn$;

comment on function public.engine_silent_success_stats(integer) is
  'Aggregate postcondition outcomes. runs_instrumented < runs_measured means some runs are UNMEASURED; a zero silent_no_ops count over uninstrumented runs proves nothing.';

revoke execute on function public.engine_silent_success_stats(integer) from public;
grant execute on function public.engine_silent_success_stats(integer) to anon, authenticated;
