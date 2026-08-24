-- SPOTLIGHT ROTATION: MAKE A DAY'S ROTATION REPLACEABLE, AND ENFORCE ONE LEAD
--
-- NOT YET APPLIED.
--
-- THE DEFECT, REPRODUCED IN PRODUCTION
-- ------------------------------------
-- 20260824_spotlight_rotation.sql gives homepage_record_spotlight an upsert on
-- (rotation_date, content_id). That correctly stops the SAME item being
-- recorded twice, and I reasoned about it only in those terms. It does not stop
-- a DIFFERENT set being recorded for the same day.
--
-- So a second run of the stage for one date does not replace that date's
-- rotation, it ADDS to it. Live verification on 2026-08-24 took the row count
-- from 5 to 11 and produced THREE rows with role='lead', because rotation
-- memory had shifted between runs and the second pass legitimately chose
-- different content.
--
-- This is not an exotic path. A cron retry, a manual trigger, a redeploy that
-- re-fires the tick, or an operator re-running a failed pass all do it, and
-- every one of them silently widens the front page and multiplies the lead.
--
-- WHY THE EXISTING TABLE COULD NOT SELF-CORRECT
-- ---------------------------------------------
-- homepage_spotlight_log has an admin SELECT policy and no write policy, so
-- writes go only through the SECURITY DEFINER RPC. That is the right design --
-- but it means there was NO WAY AT ALL to remove a row, from the application or
-- from a script. Recording was possible and un-recording was not, which is what
-- turned a small mistake into a state nobody could clean up.
--
-- TWO FIXES
-- ---------
--   1. A partial unique index making a second lead for one date IMPOSSIBLE,
--      rather than merely unintended. Same pattern as the one-hero-per-target
--      index already in this schema.
--
--   2. homepage_clear_spotlight(date), so a rotation can be REPLACED. The stage
--      clears the day and then records, which makes re-running it idempotent in
--      the way it was always assumed to be.
--
-- Applying this changes no behaviour on its own. It makes a class of corruption
-- impossible and gives the stage the operation it needed.

-- ---------------------------------------------------------------------------
-- 1. One lead per rotation
-- ---------------------------------------------------------------------------
--
-- Deliberately an index, not a CHECK: a CHECK cannot see other rows. A partial
-- unique index is how this schema already expresses "at most one X per Y"
-- (see 20260824_one_hero_per_target.sql).
--
-- Any existing duplicate leads must be resolved before this can be created, so
-- the migration demotes them first -- keeping the lowest slot_position, which
-- is the one the homepage was already treating as the lead.

update public.homepage_spotlight_log l
   set role = 'supporting'
 where l.role = 'lead'
   and exists (
     select 1 from public.homepage_spotlight_log k
      where k.rotation_date = l.rotation_date
        and k.role = 'lead'
        and (k.slot_position < l.slot_position
             or (k.slot_position = l.slot_position and k.id < l.id))
   );

create unique index if not exists homepage_spotlight_log_one_lead
  on public.homepage_spotlight_log (rotation_date)
  where role = 'lead';

comment on index public.homepage_spotlight_log_one_lead is
  'At most one lead per rotation. Live verification produced three by recording '
  'two different selections for the same date; the upsert on (rotation_date, '
  'content_id) prevented duplicate ITEMS but not a duplicate ROLE.';

-- ---------------------------------------------------------------------------
-- 2. Clearing a day, so a rotation can be replaced
-- ---------------------------------------------------------------------------

create or replace function public.homepage_clear_spotlight(p_rotation_date date)
returns integer
language plpgsql
security definer
set search_path = public
as $fn$
declare
  v_deleted integer;
begin
  if p_rotation_date is null then
    return 0;
  end if;

  delete from public.homepage_spotlight_log
   where rotation_date = p_rotation_date;

  get diagnostics v_deleted = row_count;
  return v_deleted;
end;
$fn$;

revoke execute on function public.homepage_clear_spotlight(date) from public;
grant execute on function public.homepage_clear_spotlight(date) to anon, authenticated;

comment on function public.homepage_clear_spotlight is
  'Remove a rotation so it can be re-recorded. The stage calls this before '
  'recording, which makes re-running a pass replace the day rather than append '
  'to it. Scoped to one date: it cannot wipe the history the rotation memory '
  'depends on.';

-- ---------------------------------------------------------------------------
-- 3. Self-check
-- ---------------------------------------------------------------------------
--
-- RAISE, not ASSERT: plpgsql compiles ASSERT out when plpgsql.check_asserts is
-- off, so a migration verifying itself with ASSERT can be applied with its
-- verification silently skipped.

do $verify$
declare
  v_dupes integer;
  v_cleared integer;
begin
  select count(*) into v_dupes
    from (
      select rotation_date from public.homepage_spotlight_log
       where role = 'lead'
       group by rotation_date having count(*) > 1
    ) d;
  if v_dupes > 0 then
    raise exception 'ROLLED BACK: % rotation date(s) still have multiple leads after the demotion.', v_dupes;
  end if;

  if to_regprocedure('public.homepage_clear_spotlight(date)') is null then
    raise exception 'ROLLED BACK: homepage_clear_spotlight was not created.';
  end if;

  -- Clearing a date with no rotation must be a no-op, not an error: the stage
  -- calls it unconditionally before recording.
  select public.homepage_clear_spotlight('1999-01-01'::date) into v_cleared;
  if v_cleared <> 0 then
    raise exception 'ROLLED BACK: clearing an empty date deleted % rows.', v_cleared;
  end if;

  raise notice 'spotlight replace: one-lead index live, clear function verified';
end
$verify$;
