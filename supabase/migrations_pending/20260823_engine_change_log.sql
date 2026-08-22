-- ============================================================================
-- Durable change log, so a real engine run can actually be rolled back
-- NOT YET APPLIED. Drafted 2026-08-22.
-- ============================================================================
--
-- WHAT IS ALREADY TRUE WITHOUT THIS
-- ---------------------------------
-- src/lib/engine/rollback.ts exists, is unit tested, and has been PROVEN
-- against the production database (scripts/proof-rollback.ts, 11/11, with the
-- published-row and edited-row refusals genuinely induced rather than
-- simulated). The reversal logic, the ordering, and every refusal rule are
-- real and demonstrated.
--
-- WHAT IS NOT TRUE WITHOUT THIS, STATED PLAINLY
-- ---------------------------------------------
-- The engine does not RECORD what it wrote. The proof supplies the recorded
-- changes itself, because it made them itself. So today rollback can reverse a
-- change somebody hands it; it cannot reverse last Tuesday's engine run,
-- because nothing durable says what last Tuesday's run did.
--
-- That is the difference between a proven mechanism and an operable capability,
-- and it is why the readiness dashboard should not be read as "rollback is
-- finished". This migration is the missing half.
--
-- WHY A LOG RATHER THAN INFERENCE
-- -------------------------------
-- It is tempting to infer what a run created — engine-authored drafts are
-- status='draft' with attached source_records, engine-authored products are
-- is_published=false — and reverse that. Two reasons not to:
--
--   1. Inference cannot restore an UPDATE. engine_assemble_draft moves
--      engine_briefs.state; nothing in the row afterwards says what it was
--      before. A rollback that deletes the draft but leaves the brief stranded
--      in 'drafting' has not reversed the run, it has damaged it differently.
--   2. Inference cannot tell a row this run created from one an earlier run
--      created. Reversing "all unpublished engine drafts" would delete work
--      from passes nobody asked to reverse.
--
-- A before-image is the only thing that supports "restore the exact previous
-- state", which is the requirement.
--
-- WHAT THIS DOES NOT DO
-- ---------------------
--   * It grants no delete or update capability to anyone. It is an append-only
--     record. Rollback itself remains ADMIN-ONLY and is executed through the
--     admin's own RLS permissions — see the header of src/lib/engine/rollback.ts
--     for why a rollback path reachable as `anon` would be a worse hazard than
--     the one rollback exists to contain.
--   * It records no row contents beyond the columns the engine itself wrote.
--     Logging whole rows would make this table a second copy of the site's
--     content with different access rules.

begin;

create table if not exists public.engine_change_log (
  id uuid primary key default gen_random_uuid(),
  -- The run that made the change. engine_job_runs.id, so a rollback is scoped
  -- to exactly one pass.
  run_id uuid not null references public.engine_job_runs(id) on delete cascade,
  job_name text not null,
  -- Ascending within a run. Reversal walks this backwards.
  sequence integer not null,
  table_name text not null,
  row_id uuid not null,
  operation text not null check (operation in ('insert', 'update')),
  -- NULL for an insert: there was nothing before. Required for an update.
  before_image jsonb,
  -- What the engine wrote, so a later human edit is detectable by comparison.
  after_image jsonb,
  created_at timestamptz not null default now(),

  -- An update with no before-image cannot be reversed, so it is not accepted.
  -- Better to refuse the LOG entry than to discover the gap at rollback time,
  -- when the information is gone.
  constraint engine_change_log_update_needs_before
    check (operation <> 'update' or before_image is not null),
  -- One row per (run, table, row, sequence). A repeated write in the same pass
  -- gets its own sequence number.
  constraint engine_change_log_unique_step unique (run_id, sequence)
);

create index if not exists engine_change_log_run_idx on public.engine_change_log (run_id, sequence);
create index if not exists engine_change_log_row_idx on public.engine_change_log (table_name, row_id);

comment on table public.engine_change_log is
  'Append-only record of what each engine run wrote, so the run can be reversed exactly. before_image holds only the columns the engine itself wrote — restoring a column it never touched would overwrite an editor with a value that was never the engine''s to restore.';

alter table public.engine_change_log enable row level security;

-- Admin-only for reading. The log describes unpublished editorial work in
-- progress, which is the same class of information engine_briefs carries.
drop policy if exists engine_change_log_admin_read on public.engine_change_log;
create policy engine_change_log_admin_read on public.engine_change_log
  for select to authenticated using (public.is_admin());

-- No INSERT policy for anyone. Rows arrive only through the SECURITY DEFINER
-- function below, which is the same posture every other engine write has.

-- ---------------------------------------------------------------------------
-- Recording a change
-- ---------------------------------------------------------------------------
-- Returns text rather than void, deliberately. A `returns void` audit writer is
-- a blind write: nothing in the response can say whether the record landed, and
-- a rollback log that silently failed to record is worse than none, because it
-- would make a run look reversible when it is not.

create or replace function public.engine_record_change(
  p_run_id uuid,
  p_job_name text,
  p_sequence integer,
  p_table_name text,
  p_row_id uuid,
  p_operation text,
  p_before jsonb,
  p_after jsonb
)
returns text
language plpgsql
security definer
set search_path = public
as $fn$
declare v_id uuid;
begin
  if p_operation not in ('insert', 'update') then
    return 'rejected_invalid_operation';
  end if;
  if p_operation = 'update' and p_before is null then
    return 'rejected_missing_before_image';
  end if;
  if not exists (select 1 from public.engine_job_runs where id = p_run_id) then
    return 'rejected_unknown_run';
  end if;

  begin
    insert into public.engine_change_log (
      run_id, job_name, sequence, table_name, row_id, operation, before_image, after_image
    ) values (
      p_run_id, left(p_job_name, 100), p_sequence, left(p_table_name, 100),
      p_row_id, p_operation, p_before, p_after
    )
    returning id into v_id;
  exception when unique_violation then
    -- The same step recorded twice. Idempotent by design: a retried pass must
    -- not produce two log entries that would then be reversed twice.
    return 'deduped';
  end;

  return v_id::text;
end;
$fn$;

revoke execute on function public.engine_record_change(uuid, text, integer, text, uuid, text, jsonb, jsonb) from public;
grant execute on function public.engine_record_change(uuid, text, integer, text, uuid, text, jsonb, jsonb) to anon, authenticated;

-- ---------------------------------------------------------------------------
-- Reading a run's changes back
-- ---------------------------------------------------------------------------
-- authenticated ONLY, and admin-gated inside. anon has no reason to read this
-- and every reason not to: it is a map of unpublished editorial work.

create or replace function public.engine_changes_for_run(p_run_id uuid)
returns table (
  sequence integer,
  table_name text,
  row_id uuid,
  operation text,
  before_image jsonb,
  after_image jsonb
)
language plpgsql
security definer
set search_path = public
as $fn$
begin
  if not public.is_admin() then
    -- Refuse loudly rather than returning zero rows. RLS denies by returning
    -- nothing, and an empty result here would read as "this run changed
    -- nothing" — which is exactly the silent-success shape, applied to the
    -- mechanism meant to undo damage.
    raise exception 'engine_changes_for_run: admin only';
  end if;

  return query
    select c.sequence, c.table_name, c.row_id, c.operation, c.before_image, c.after_image
      from public.engine_change_log c
     where c.run_id = p_run_id
     order by c.sequence asc;
end;
$fn$;

revoke execute on function public.engine_changes_for_run(uuid) from public;
revoke execute on function public.engine_changes_for_run(uuid) from anon;
grant execute on function public.engine_changes_for_run(uuid) to authenticated;

commit;

-- ============================================================================
-- VERIFICATION AFTER APPLYING
-- ============================================================================
-- Do not trust the SQL editor's result message; two migrations in this project
-- have already reported one thing and done another.
--
--   -- 1. An update with no before-image is refused at RECORD time.
--   select public.engine_record_change(
--     (select id from public.engine_job_runs order by started_at desc limit 1),
--     'probe', 1, 'content_items', gen_random_uuid(), 'update', null, '{}'::jsonb);
--   -- MUST return 'rejected_missing_before_image'.
--
--   -- 2. An unknown run is refused.
--   select public.engine_record_change(
--     '00000000-0000-0000-0000-0000000000ff', 'probe', 1, 'content_items',
--     gen_random_uuid(), 'insert', null, '{}'::jsonb);
--   -- MUST return 'rejected_unknown_run'.
--
--   -- 3. anon cannot read the log.
--   --    curl as anon: rpc/engine_changes_for_run MUST answer 42501.
--
--   -- 4. Clean up any probe rows:
--   delete from public.engine_change_log where job_name = 'probe';
