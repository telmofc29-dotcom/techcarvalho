-- ============================================================================
-- SILENT_SUCCESS telemetry and the RPCs that currently cannot be verified
-- NOT YET APPLIED. Drafted 2026-08-22. CORRECTED 2026-08-22 after the first
-- attempt failed in production. Do not move into migrations/ until it has
-- actually been run AND verified behaviourally (see VERIFICATION at the end).
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
-- src/lib/engine/postconditions.ts and src/lib/engine/silent-success.ts detect
-- this class in the application layer. Three things stop that detection being
-- as sharp as it should be, and all three are in the database:
--
--   A. engine_job_runs has nowhere to record how many of a pass's mutations
--      were VERIFIED versus silently no-op.
--   B. Several RPCs are `returns void`, so their effect cannot be observed from
--      the response AT ALL. No amount of caller-side checking can fix this —
--      the information is simply not sent.
--   C. engine_set_relevance returns 'ok' UNCONDITIONALLY after its UPDATE,
--      without checking FOUND. VERIFIED IN PRODUCTION 2026-08-22: calling it
--      with id 0000...00ff returned "ok". Incident #1's shape, in our own code.
--
-- ============================================================================
-- WHY THE FIRST ATTEMPT FAILED, AND WHAT ELSE WAS WRONG WITH IT
-- ============================================================================
-- Production rejected it with:
--   ERROR 42P13: cannot change return type of existing function
--   at public.engine_recent_job_runs(integer, integer)
--
-- CREATE OR REPLACE FUNCTION cannot change a function's return type. Fixing
-- only the function named in the error would have hit the same error four more
-- times, one round-trip each. The whole file was audited instead. Six defects
-- were found; only the first was the one Postgres reported.
--
--   1. [42P13] engine_recent_job_runs: RETURNS TABLE 9 cols -> 13 cols.
--   2. [42P13] engine_upsert_opportunity:       void -> text.
--   3. [42P13] engine_record_source_check:      void -> text.
--   4. [42P13] engine_record_entity_resolution: void -> text.
--   5. [42725, WOULD HAVE BROKEN THE AUDIT LOG] engine_record_job_run gained
--      four defaulted parameters. That does not replace the 8-arg function, it
--      creates a SECOND overload beside it. src/lib/engine/cron.ts:108 calls it
--      with exactly 8 named arguments, which would then match BOTH candidates —
--      "function is not unique" / PostgREST PGRST203. Every engine job would
--      have stopped recording audit rows, which starves health.ts, the circuit
--      breakers and the SILENT_SUCCESS detector simultaneously. The old
--      signature must be DROPPED, not replaced.
--   6. [SILENT BEHAVIOUR CHANGE — the worst one] The draft narrowed
--      engine_upsert_opportunity's guard list from
--        ('category','topic','product','content','search_term')
--      to
--        ('category','topic','query').
--      'product', 'content' and 'search_term' are all permitted by the table's
--      own CHECK constraint, so this would have made the RPC answer
--      'rejected_invalid' to legitimate calls — and 'query' is NOT in the CHECK,
--      so anything passing it would clear the guard and then die on the
--      constraint. This is EXACTLY the RPC-guard/table-CHECK drift that caused
--      incident #2 above. It would have been introduced by the very migration
--      written to prevent that class of bug.
--
-- Two further column-name errors would have failed at runtime rather than at
-- migration time, which is worse because the migration would have reported
-- success:
--   7. engine_record_entity_resolution inserted into (product_id, content_id,
--      score); the real columns are (matched_product_id, matched_content_id,
--      match_score).
--   8. engine_upsert_opportunity set `updated_at`; the real column is
--      `computed_at`.
--
-- Every function below therefore preserves the APPLIED behaviour exactly —
-- same guard lists, same left() truncation widths, same column names, same
-- parameter defaults — and changes only what the function REPORTS.
--
-- ============================================================================
-- WHAT THIS DOES NOT DO
-- ============================================================================
--   * It does not weaken any RLS policy, guard list, or grant. Every function
--     is re-granted to exactly the roles it already had: anon, authenticated.
--     No function gains a caller it did not already have.
--   * It does not add a publishing path. Nothing here can set
--     content_items.status or products.is_published.
--   * It does not change what any function DOES — only what it REPORTS. Every
--     write performs exactly the statement it performed before.
--
-- DEPENDENCY CHECK (done before drafting): no view, trigger, constraint or
-- other function in supabase/migrations/*.sql references any of the five
-- dropped functions. The only occurrences are their own definitions, their
-- grants, and two comments. Dropping them breaks nothing in the database.
--
-- ATOMIC. DDL is transactional in PostgreSQL. If any statement fails, the whole
-- file rolls back and production keeps the functions it has now. There is no
-- window in which the audit-log function does not exist.

begin;

-- ---------------------------------------------------------------------------
-- A. Postcondition counters on the audit log
-- ---------------------------------------------------------------------------
-- Nullable with NO default. A default of 0 would assert "this run had no silent
-- no-ops" for every historical row and every job not yet instrumented — turning
-- an absence of measurement into a clean result, which is the exact confusion
-- this whole effort exists to remove. NULL means unmeasured.

alter table public.engine_job_runs
  add column if not exists verified_writes   integer,
  add column if not exists silent_no_ops     integer,
  add column if not exists unverified_writes integer,
  add column if not exists blind_writes      integer;

comment on column public.engine_job_runs.verified_writes is
  'Mutations in this run whose postcondition was asserted and held. NULL means unmeasured.';
comment on column public.engine_job_runs.silent_no_ops is
  'Mutations in this run that returned no error and demonstrably changed nothing. NULL means the run predates postcondition instrumentation — it does NOT mean zero.';
comment on column public.engine_job_runs.unverified_writes is
  'Mutations that returned no error but sent back nothing that could confirm or deny the effect. NULL means unmeasured.';
comment on column public.engine_job_runs.blind_writes is
  'Writes through `returns void` RPCs, whose effect could not be observed. Not failures; unproven. NULL means unmeasured.';

-- ---------------------------------------------------------------------------
-- B. engine_record_job_run — DROP first (defect 5)
-- ---------------------------------------------------------------------------
-- Dropped rather than replaced for two independent reasons: the four new
-- parameters would otherwise leave a stale 8-arg overload that makes every
-- existing call ambiguous, and the return type changes void -> text.
--
-- Returning text matters more here than anywhere else in this file. This is the
-- function that writes the audit trail the entire safety layer reads. The
-- applied version answers an invalid status with a bare `return;` — it discards
-- the row and says nothing, which is a SILENT_SUCCESS inside the very mechanism
-- meant to detect them.
--
-- Parameter defaults are preserved exactly as the applied version had them, so
-- a caller passing fewer arguments keeps working.

drop function if exists public.engine_record_job_run(
  text, text, integer, integer, integer, integer, jsonb, text
);

create or replace function public.engine_record_job_run(
  p_job_name text,
  p_status text,
  p_items_examined integer default 0,
  p_items_created integer default 0,
  p_items_deduped integer default 0,
  p_items_failed integer default 0,
  p_detail jsonb default '{}'::jsonb,
  p_error text default null,
  p_verified_writes integer default null,
  p_silent_no_ops integer default null,
  p_unverified_writes integer default null,
  p_blind_writes integer default null
)
returns text
language plpgsql
security definer
set search_path = public
as $fn$
declare v_rows integer;
begin
  -- Same two guards as the applied version, with the same thresholds. The only
  -- change is that a rejection is now REPORTED instead of being swallowed.
  if p_job_name is null or char_length(p_job_name) > 100 then
    return 'rejected_invalid_job_name';
  end if;
  if p_status not in ('running', 'success', 'partial', 'failed', 'skipped') then
    return 'rejected_invalid_status';
  end if;

  insert into public.engine_job_runs (
    job_name, status, finished_at, items_examined, items_created,
    items_deduped, items_failed, detail, error,
    verified_writes, silent_no_ops, unverified_writes, blind_writes
  ) values (
    p_job_name, p_status, now(), coalesce(p_items_examined, 0), coalesce(p_items_created, 0),
    coalesce(p_items_deduped, 0), coalesce(p_items_failed, 0), coalesce(p_detail, '{}'::jsonb),
    left(p_error, 2000),
    p_verified_writes, p_silent_no_ops, p_unverified_writes, p_blind_writes
  );

  get diagnostics v_rows = row_count;
  if v_rows = 0 then
    return 'no_rows_affected';
  end if;
  return 'recorded';
end;
$fn$;

revoke execute on function public.engine_record_job_run(
  text, text, integer, integer, integer, integer, jsonb, text, integer, integer, integer, integer
) from public;
grant execute on function public.engine_record_job_run(
  text, text, integer, integer, integer, integer, jsonb, text, integer, integer, integer, integer
) to anon, authenticated;

-- ---------------------------------------------------------------------------
-- C. engine_recent_job_runs — DROP first (defect 1, the reported error)
-- ---------------------------------------------------------------------------
-- src/lib/engine/guard.ts:100 calls this with { p_hours, p_limit } and already
-- reads the four new columns optionally, mapping a missing one to null. So the
-- application needs no change when this lands.

drop function if exists public.engine_recent_job_runs(integer, integer);

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
     where r.started_at >= now() - make_interval(hours => greatest(coalesce(p_hours, 336), 1))
     order by r.started_at desc
     limit greatest(coalesce(p_limit, 800), 1);
end;
$fn$;

revoke execute on function public.engine_recent_job_runs(integer, integer) from public;
grant execute on function public.engine_recent_job_runs(integer, integer) to anon, authenticated;

-- ---------------------------------------------------------------------------
-- D. THE REAL BUG: engine_set_relevance reports 'ok' after changing nothing
-- ---------------------------------------------------------------------------
-- NO DROP NEEDED. This one already `returns text` with an identical signature,
-- so CREATE OR REPLACE is legal. Verified against the applied definition in
-- supabase/migrations/20260822_phase4_pipeline.sql.
--
-- The applied version runs an UPDATE with two predicates — the id, and
-- `relevance_overridden_by_admin = false` — then returns 'ok' whatever happened.
-- A discovery that was admin-overridden, deleted, or invisible under RLS
-- produces the identical answer to one that was genuinely re-classified.
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
-- E. Give the void RPCs something to say — each needs a DROP
-- ---------------------------------------------------------------------------
-- These three are the engine's remaining blind writes. Each performs exactly
-- the same statement as before against exactly the same columns; the only
-- change is that the caller can now tell whether it landed.

-- E1. engine_upsert_opportunity (defects 2, 6, 8)
--
-- The guard list below is copied VERBATIM from the applied function and matches
-- engine_opportunities' own CHECK constraint. Do not shorten it. If a new
-- subject_type is ever wanted, the CHECK and this list have to move together —
-- they have already drifted apart once in this project, and when they did the
-- RPC answered 'rejected_invalid' to every call while the job reported success.
--
-- left(p_label, 300) and `computed_at` also match the applied version. The
-- earlier draft used 200 and `updated_at`; the latter column does not exist.

drop function if exists public.engine_upsert_opportunity(
  text, text, text, numeric, jsonb, text
);

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
  if p_subject_type not in ('category', 'topic', 'product', 'content', 'search_term') then
    return 'rejected_invalid_subject_type';
  end if;
  if p_subject_key is null or length(trim(p_subject_key)) = 0 then
    return 'rejected_invalid_subject_key';
  end if;

  insert into public.engine_opportunities (
    subject_type, subject_key, label, score, inputs, explanation, computed_at
  ) values (
    p_subject_type, left(p_subject_key, 200), left(p_label, 300), p_score,
    coalesce(p_inputs, '{}'::jsonb), left(p_explanation, 2000), now()
  )
  on conflict (subject_type, subject_key) do update
    set score = excluded.score, label = excluded.label, inputs = excluded.inputs,
        explanation = excluded.explanation, computed_at = now();

  get diagnostics v_rows = row_count;
  if v_rows = 0 then
    return 'no_rows_affected';
  end if;
  return 'ok';
end;
$fn$;

revoke execute on function public.engine_upsert_opportunity(text, text, text, numeric, jsonb, text) from public;
grant execute on function public.engine_upsert_opportunity(text, text, text, numeric, jsonb, text) to anon, authenticated;

-- E2. engine_record_source_check (defect 3)

drop function if exists public.engine_record_source_check(uuid, boolean, text);

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
         last_success_at = case when p_success then now() else last_success_at end,
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

-- E3. engine_record_entity_resolution (defects 4, 7)
--
-- Column names below are the REAL ones: matched_product_id, matched_content_id,
-- match_score. The earlier draft used product_id / content_id / score, which do
-- not exist — it would have applied cleanly and then failed on every call.
-- left(p_explanation, 1000) matches the applied version.

drop function if exists public.engine_record_entity_resolution(
  uuid, text, text, uuid, uuid, numeric, text, text
);

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
    discovery_id, candidate_name, normalised_name, matched_product_id,
    matched_content_id, match_score, decision, explanation
  ) values (
    p_discovery_id, left(p_candidate_name, 300), left(p_normalised, 300),
    p_product_id, p_content_id, p_score, p_decision, left(p_explanation, 1000)
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
-- New function; nothing to drop.
--
-- runs_in_window and runs_instrumented are separate on purpose. A caller that
-- sees silent_no_ops = 0 must be able to ask "out of how many MEASURED runs?"
-- — because zero silent no-ops across zero instrumented runs is not a clean
-- bill of health, it is no information at all. all_measured makes that explicit
-- rather than leaving it to be inferred from two numbers.

create or replace function public.engine_silent_success_stats(p_hours integer default 168)
returns table (
  runs_in_window integer,
  runs_instrumented integer,
  all_measured boolean,
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
      (count(*) > 0 and count(*) = count(*) filter (where r.silent_no_ops is not null)),
      coalesce(sum(r.verified_writes), 0)::integer,
      coalesce(sum(r.silent_no_ops), 0)::integer,
      coalesce(sum(r.unverified_writes), 0)::integer,
      coalesce(sum(r.blind_writes), 0)::integer
    from public.engine_job_runs r
   where r.started_at >= now() - make_interval(hours => greatest(coalesce(p_hours, 168), 1))
     and r.status <> 'skipped';
end;
$fn$;

comment on function public.engine_silent_success_stats(integer) is
  'Aggregate postcondition outcomes. runs_instrumented < runs_in_window means some runs are UNMEASURED; a zero silent_no_ops count over uninstrumented runs proves nothing. all_measured is false whenever any run in the window lacks instrumentation, and false when the window is empty.';

revoke execute on function public.engine_silent_success_stats(integer) from public;
grant execute on function public.engine_silent_success_stats(integer) to anon, authenticated;

commit;

-- ============================================================================
-- VERIFICATION AFTER APPLYING
-- ============================================================================
-- Do NOT trust the SQL editor's result message. A migration in this project has
-- already reported "Success" without applying, and the previous run of THIS
-- file failed outright. Run these and check the actual answers.
--
--   -- 1. The real bug, fixed. MUST return 'no_matching_row', NOT 'ok'.
--   select public.engine_set_relevance(
--     '00000000-0000-0000-0000-0000000000ff', 'relevant', 0, 'probe', null);
--
--   -- 2. The four columns exist and resolve. MUST NOT error.
--   select verified_writes, silent_no_ops, unverified_writes, blind_writes
--     from public.engine_recent_job_runs(1, 1);
--
--   -- 3. The audit writer reports. MUST return 'rejected_invalid_status'.
--   select public.engine_record_job_run('probe', 'not_a_real_status');
--
--   -- 4. ...and still accepts the 8-argument call shape cron.ts uses, with no
--   --    ambiguity error. MUST return 'recorded'.
--   select public.engine_record_job_run(
--     'engine_migration_probe', 'skipped', 0, 0, 0, 0, '{}'::jsonb, null);
--   delete from public.engine_job_runs where job_name = 'engine_migration_probe';
--
--   -- 5. The guard list was NOT narrowed. Both MUST return 'ok'.
--   select public.engine_upsert_opportunity(
--     'search_term', 'zz-probe', 'zz-probe', null, '{}'::jsonb, 'probe');
--   select public.engine_upsert_opportunity(
--     'product', 'zz-probe-2', 'zz-probe-2', null, '{}'::jsonb, 'probe');
--   delete from public.engine_opportunities where subject_key like 'zz-probe%';
--
--   -- 6. Blind writes now speak. MUST return 'no_matching_source'.
--   select public.engine_record_source_check(
--     '00000000-0000-0000-0000-0000000000ff', true, null);
--
--   -- 7. Unmeasured is distinguishable from a measured zero.
--   select * from public.engine_silent_success_stats(168);
--   -- all_measured MUST be false while historical runs remain uninstrumented.
--
--   -- 8. Exactly ONE engine_record_job_run remains — no stale overload.
--   select count(*) from pg_proc p join pg_namespace n on n.oid = p.pronamespace
--    where n.nspname = 'public' and p.proname = 'engine_record_job_run';
--   -- MUST be 1.
