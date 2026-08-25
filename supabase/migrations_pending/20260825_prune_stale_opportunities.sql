-- Expire watchlist opportunities that a later run no longer finds.
--
-- THE DEFECT
-- ----------
-- engine_upsert_opportunity upserts on (subject_type, subject_key) and sets
-- computed_at. Nothing ever removes a row. A development that has passed, or
-- that a later corpus no longer contains, keeps its row and its score forever.
--
-- That became visible the moment ranking improved. After rankOpportunity
-- replaced the flat model, the table held 54 watchlist rows of which only 40
-- had been refreshed. The 14 stale ones still carried scores from the OLD
-- model — 100, 94.64, 91.96 — and therefore sat ABOVE every correctly-ranked
-- opportunity. The top of the list read:
--
--   100    Crazy report reveals Exynos 2700 could outperform Snapdragon
--   100    Updated Apple Developer Program License Agreement now available
--   95.3   (PR) Apple Introduces New Mac Studio with M5 Max and M5 Ultra
--
-- A better model made the list WORSE, because the improvement could not reach
-- rows it no longer wrote. Any read of this table is misleading until stale
-- rows are removed.
--
-- WHY AN RPC AND NOT A DELETE FROM THE JOB
-- ----------------------------------------
-- engine_opportunities is RLS-protected to is_admin(). The engine tick runs
-- unauthenticated and can only write through SECURITY DEFINER functions —
-- which is the correct posture and is not being weakened here. So the prune
-- has to be a function too.
--
-- SCOPE IS DELIBERATELY NARROW. It removes ONLY rows whose subject_key begins
-- with 'watchlist:' and whose computed_at is older than the cutoff. Category
-- opportunities, which are computed by a different stage on its own schedule,
-- are never touched — a broad "delete anything stale" would have silently
-- emptied them.
--
-- NOT YET APPLIED.

create or replace function public.engine_prune_watchlist_opportunities(p_before timestamptz)
returns integer
language plpgsql
security definer
set search_path = public
as $fn$
declare v_deleted integer;
begin
  -- A null or absurd cutoff must not become "delete everything".
  if p_before is null or p_before > now() then
    return -1;
  end if;

  delete from public.engine_opportunities
   where subject_type = 'topic'
     and subject_key like 'watchlist:%'
     and computed_at < p_before;

  get diagnostics v_deleted = row_count;
  return v_deleted;
end;
$fn$;

comment on function public.engine_prune_watchlist_opportunities is
  'Removes watchlist opportunities not refreshed since p_before. Returns the '
  'number deleted, or -1 when the cutoff is missing or in the future. Scoped to '
  'subject_key like ''watchlist:%'' so category opportunities are never touched. '
  'Exists because nothing else expired these rows, and stale ones carrying '
  'scores from a previous model outranked correctly-ranked current ones.';

revoke execute on function public.engine_prune_watchlist_opportunities(timestamptz) from public;
grant execute on function public.engine_prune_watchlist_opportunities(timestamptz) to anon, authenticated;
