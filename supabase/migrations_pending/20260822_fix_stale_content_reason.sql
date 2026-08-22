-- ============================================================================
-- Fix: engine_upsert_update_proposal has never accepted 'stale_content'
-- NOT YET APPLIED
-- ============================================================================
-- Drafted, not run. Move into migrations/ only once it has actually executed.
--
-- THE BUG
-- -------
-- 20260822_phase6_draft_assembly.sql added 'stale_content' to the
-- engine_update_proposals.reason CHECK constraint, with a comment explaining
-- why it exists ("age alone, with no new evidence behind it"). The RPC's OWN
-- guard list was never updated to match:
--
--   if p_reason not in ('firmware_update','successor_released','discontinued',
--                       'spec_change','price_change','newer_evidence',
--                       'broken_source') then
--     return 'rejected_invalid';
--
-- freshness-job.ts passes exactly 'stale_content' for every high-severity
-- stale page. Verified against production:
--
--   stale_content    -> "rejected_invalid"
--   newer_evidence   -> "created"
--   broken_source    -> "created"
--
-- So the freshness -> editor bridge has silently never worked. Not once.
--
-- WHY IT WENT UNNOTICED — this is the important part
-- --------------------------------------------------
-- The job did not inspect the return value. The RPC returned a string saying
-- "I rejected this", the job discarded it, no exception was raised, no counter
-- incremented, and engine_job_runs recorded `status: success`.
--
-- This is the same failure class as the silent RLS no-op: an operation that
-- reports success while doing nothing. The database was not even the problem
-- here — the function answered honestly and the caller was not listening.
-- src/lib/engine/jobs/freshness-job.ts now checks the result.

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
  -- Kept deliberately in sync with the table's CHECK constraint. If these two
  -- lists ever disagree again, the symptom is silence, not an error.
  if p_reason not in ('firmware_update','successor_released','discontinued',
                      'spec_change','price_change','newer_evidence',
                      'broken_source','stale_content') then
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
