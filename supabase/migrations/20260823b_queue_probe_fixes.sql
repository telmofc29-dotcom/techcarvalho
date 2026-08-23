-- STATUS 2026-08-23: APPLIED IN PRODUCTION AND VERIFIED BEHAVIOURALLY.
-- 17/17 checks: npx tsx scripts/verify-changelog-queueprobe.ts
-- The SQL editor's message was not treated as evidence -- this file's first
-- two companions applied cleanly and still carried three defects that only
-- fire when the functions are CALLED.
-- ============================================================================
-- Corrections to the two 2026-08-23 migrations, found by verifying them
-- ============================================================================
--
-- Both migrations applied cleanly and were then verified behaviourally with
-- scripts/verify-changelog-queueprobe.ts. 11 of 14 checks passed. The three
-- failures are real, and two of them are defects that a SQL editor could never
-- have reported, because they only fire when the function is CALLED.
--
--   1. engine_queue_probe's `engine_due_sources` branch references
--      `s.approval_status`, a column that HAS NEVER EXISTED on engine_sources.
--      Calling it returns `42703 column s.approval_status does not exist`. The
--      real eligibility rule, taken from engine_due_sources itself, is
--      is_active AND discovery_permitted AND the check-frequency window.
--
--   2. `engine_freshness_candidates` is a real engine queue and has no branch at
--      all, so probing it raises "unknown queue". Four of six queues answered;
--      two did not.
--
--   3. engine_change_log has a SELECT policy and NO DELETE policy. So an admin
--      cannot remove a row, and — because RLS denies by returning zero rows
--      rather than an error — the delete REPORTS SUCCESS AND REMOVES NOTHING.
--      Verified: 1 row before, `delete` returned no error and claimed 0 rows,
--      1 row after.
--
--      That is this project's signature failure class, sitting inside the table
--      built to make rollback possible. The table that exists so damage can be
--      undone could not itself be corrected, and lied about it.
--
-- ALSO CLOSED HERE: the explicit TODO the queue-probe migration left behind.
-- It added engine_job_runs.stage_outcome and .outcome_ambiguity and then said,
-- correctly, that threading them through engine_record_job_run and
-- engine_recent_job_runs was left undone. Columns nothing writes and nothing
-- reads are not observability; they are two more places for a value to be
-- silently absent. Both functions are updated below.
--
-- ATOMIC. DDL is transactional in PostgreSQL: if any statement fails the whole
-- file rolls back and production keeps what it has now.

begin;

-- ---------------------------------------------------------------------------
-- 1 + 2. engine_queue_probe — fix the broken branch, add the missing one
-- ---------------------------------------------------------------------------
-- Same signature and same return type as the applied version, so CREATE OR
-- REPLACE is legal and no DROP is needed. Verified against the deployed
-- function before drafting.

create or replace function public.engine_queue_probe(p_queue text)
returns table (
  queue text,
  total bigint,
  eligible bigint,
  eligibility text
)
language plpgsql
security definer
set search_path = public
as $fn$
begin
  case p_queue

    when 'engine_assemblable_briefs' then
      return query
        select p_queue,
               (select count(*) from public.engine_briefs),
               (select count(*) from public.engine_briefs b
                 where b.review_state = 'approved'
                   and b.assembled_content_id is null
                   and b.state not in ('rejected', 'published')),
               'review_state = approved, not yet assembled, state not rejected/published'::text;

    when 'engine_briefable_discoveries' then
      return query
        select p_queue,
               (select count(*) from public.engine_discoveries),
               (select count(*) from public.engine_discoveries d
                 where d.relevance_verdict = 'relevant'
                   and d.state = 'new'),
               'relevance_verdict = relevant and state = new'::text;

    when 'engine_unclassified_discoveries' then
      return query
        select p_queue,
               (select count(*) from public.engine_discoveries),
               (select count(*) from public.engine_discoveries d
                 where d.relevance_verdict is null),
               'relevance_verdict is null'::text;

    when 'engine_open_media_requirements' then
      return query
        select p_queue,
               (select count(*) from public.media_requirements),
               (select count(*) from public.media_requirements m
                 where m.sourcing_status in ('needed', 'sourcing')),
               'sourcing_status in (needed, sourcing)'::text;

    -- FIXED. Was `s.approval_status = 'approved'`, a column that has never
    -- existed on engine_sources. The rule below is copied from
    -- engine_due_sources' own WHERE clause, which is the only definition of
    -- "due" that matters — a probe whose eligibility rule disagrees with the
    -- queue it is probing would be worse than no probe, because it would
    -- confidently report the wrong kind of empty.
    when 'engine_due_sources' then
      return query
        select p_queue,
               (select count(*) from public.engine_sources),
               (select count(*) from public.engine_sources s
                 where s.is_active
                   and s.discovery_permitted
                   and (s.last_checked_at is null
                        or s.last_checked_at
                             < now() - make_interval(hours => s.check_frequency_hours))),
               'is_active and discovery_permitted and past its check-frequency window'::text;

    -- ADDED. A real engine queue with no branch at all, so probing it raised
    -- "unknown queue" and the freshness stage had no way to tell an empty
    -- queue from a denied read.
    --
    -- The table is engine_freshness_reviews, NOT freshness_reviews. The latter
    -- does not exist, and I wrote it here first — then caught it by checking
    -- the schema rather than by running the migration. Worth recording: an
    -- earlier probe of mine queried that same nonexistent table through a
    -- `.catch(() => [])`, which swallowed the error and reported "0 rows". The
    -- conclusion happened to be right (both real freshness tables are empty)
    -- but the method produced a fabricated measurement, which is the exact
    -- thing this function exists to prevent.
    when 'engine_freshness_candidates' then
      return query
        select p_queue,
               (select count(*) from public.content_items where status = 'published')
                 + (select count(*) from public.products where is_published),
               (select count(*) from public.content_items c
                 where c.status = 'published'
                   and not exists (
                     select 1 from public.engine_freshness_reviews f
                      where f.content_id = c.id and f.state = 'open'))
                 + (select count(*) from public.products p
                     where p.is_published
                       and not exists (
                         select 1 from public.engine_freshness_reviews f
                          where f.product_id = p.id and f.state = 'open')),
               'published content or product with no OPEN freshness review'::text;

    else
      -- Deliberately raises rather than returning zero rows. A zero for a queue
      -- nobody knows about would be a fabricated measurement, and this whole
      -- function exists to stop fabricated measurements.
      raise exception 'engine_queue_probe: unknown queue %', p_queue;
  end case;
end;
$fn$;

revoke execute on function public.engine_queue_probe(text) from public;
grant execute on function public.engine_queue_probe(text) to anon, authenticated;

-- ---------------------------------------------------------------------------
-- 3. engine_change_log — an admin must be able to correct it
-- ---------------------------------------------------------------------------
-- WHY A DELETE POLICY AT ALL, given rollback depends on this log.
--
-- The argument against is real: an admin who can delete change rows can make a
-- run look unreversible. But the alternative, which is what shipped, is a table
-- that can never be corrected AND whose deletes report success while doing
-- nothing. A silent no-op is strictly worse than a permitted operation: it
-- teaches an operator that a cleanup worked when it did not, and it does so
-- inside the mechanism meant to undo damage.
--
-- No UPDATE policy. The log stays append-only in the sense that matters — a
-- recorded before-image can be removed but never rewritten, so a change entry
-- can be missing but never quietly wrong.

drop policy if exists engine_change_log_admin_delete on public.engine_change_log;
create policy engine_change_log_admin_delete on public.engine_change_log
  for delete to authenticated using (public.is_admin());

-- ---------------------------------------------------------------------------
-- 4. Thread stage_outcome through the audit writer and reader
-- ---------------------------------------------------------------------------
-- The queue-probe migration added both columns and left this as an explicit
-- TODO. Left undone, they are columns nothing writes and nothing reads.
--
-- engine_record_job_run must be DROPPED, not replaced: two more defaulted
-- parameters would create a 14-argument overload beside the existing 12, and
-- src/lib/engine/cron.ts calls it with named arguments — which would then match
-- both candidates and raise "function is not unique". That exact hazard was hit
-- once already in 20260822_silent_success_telemetry.sql.
--
-- engine_recent_job_runs must be DROPPED too: RETURNS TABLE gains two columns,
-- and CREATE OR REPLACE cannot change a return type (42P13).

drop function if exists public.engine_record_job_run(
  text, text, integer, integer, integer, integer, jsonb, text, integer, integer, integer, integer
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
  p_blind_writes integer default null,
  p_stage_outcome text default null,
  p_outcome_ambiguity text default null
)
returns text
language plpgsql
security definer
set search_path = public
as $fn$
declare v_rows integer;
begin
  if p_job_name is null or char_length(p_job_name) > 100 then
    return 'rejected_invalid_job_name';
  end if;
  if p_status not in ('running', 'success', 'partial', 'failed', 'skipped') then
    return 'rejected_invalid_status';
  end if;

  insert into public.engine_job_runs (
    job_name, status, finished_at, items_examined, items_created,
    items_deduped, items_failed, detail, error,
    verified_writes, silent_no_ops, unverified_writes, blind_writes,
    stage_outcome, outcome_ambiguity
  ) values (
    p_job_name, p_status, now(), coalesce(p_items_examined, 0), coalesce(p_items_created, 0),
    coalesce(p_items_deduped, 0), coalesce(p_items_failed, 0), coalesce(p_detail, '{}'::jsonb),
    left(p_error, 2000),
    p_verified_writes, p_silent_no_ops, p_unverified_writes, p_blind_writes,
    left(p_stage_outcome, 60), left(p_outcome_ambiguity, 60)
  );

  get diagnostics v_rows = row_count;
  if v_rows = 0 then
    return 'no_rows_affected';
  end if;
  return 'recorded';
end;
$fn$;

revoke execute on function public.engine_record_job_run(
  text, text, integer, integer, integer, integer, jsonb, text,
  integer, integer, integer, integer, text, text
) from public;
grant execute on function public.engine_record_job_run(
  text, text, integer, integer, integer, integer, jsonb, text,
  integer, integer, integer, integer, text, text
) to anon, authenticated;

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
  blind_writes integer,
  stage_outcome text,
  outcome_ambiguity text
)
language plpgsql
security definer
set search_path = public
as $fn$
begin
  return query
    select r.job_name, r.status, r.started_at, r.finished_at,
           r.items_examined, r.items_created, r.items_deduped, r.items_failed,
           -- The error TEXT is still not exposed to anon; only whether one
           -- existed. Unchanged from every prior version.
           (r.error is not null) as has_error,
           r.verified_writes, r.silent_no_ops, r.unverified_writes, r.blind_writes,
           r.stage_outcome, r.outcome_ambiguity
      from public.engine_job_runs r
     where r.started_at >= now() - make_interval(hours => greatest(coalesce(p_hours, 336), 1))
     order by r.started_at desc
     limit greatest(coalesce(p_limit, 800), 1);
end;
$fn$;

revoke execute on function public.engine_recent_job_runs(integer, integer) from public;
grant execute on function public.engine_recent_job_runs(integer, integer) to anon, authenticated;

commit;

-- ============================================================================
-- VERIFICATION AFTER APPLYING
-- ============================================================================
-- Re-run the whole battery, which now covers all of this:
--   npx tsx scripts/verify-changelog-queueprobe.ts     -- expect 14/14
--   npx tsx scripts/verify-silent-success-migration.ts -- expect 16/16 still
--
-- Spot checks if you want them by hand:
--
--   select * from public.engine_queue_probe('engine_due_sources');
--   -- MUST return a row, not 42703.
--
--   select * from public.engine_queue_probe('engine_freshness_candidates');
--   -- MUST return a row, not "unknown queue".
--
--   select public.engine_record_job_run('probe','skipped',0,0,0,0,'{}'::jsonb,null);
--   -- MUST return 'recorded' with the 8-argument shape still resolving
--   -- unambiguously. Then: delete from public.engine_job_runs where job_name='probe';
--
--   select stage_outcome from public.engine_recent_job_runs(1, 1);
--   -- MUST resolve, even if null.
