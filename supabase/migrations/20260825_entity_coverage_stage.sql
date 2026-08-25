-- Register the `entity_coverage` engine stage.
--
-- WHY A MIGRATION IS NEEDED FOR WHAT LOOKS LIKE A CODE CHANGE
-- -----------------------------------------------------------
-- The set of valid stage names is enforced in the DATABASE, by the
-- engine_settings CHECK constraint that calls engine_stage_modes_valid(). A
-- stage added only in TypeScript would compile and run, and then any attempt to
-- set a mode for it would be rejected by the constraint with no obvious cause.
--
-- stage-modes.test.ts parses this file and asserts the array below matches
-- ENGINE_STAGE_NAMES exactly, so the two cannot drift silently.
--
-- WHAT THE STAGE DOES
-- -------------------
-- For each company on the editorial watchlist it measures which developments
-- the corpus contains that TechCarvalho does not cover, and records them as
-- opportunities. It creates no drafts, changes no content, and publishes
-- nothing. Its only write is engine_upsert_opportunity.
--
-- APPLIED IN PRODUCTION 2026-08-25.
--
-- Verified after the fact rather than trusted: engine_stage_modes_valid was
-- called against the live database and confirmed to accept 'entity_coverage'
-- and every other name in ENGINE_STAGE_NAMES, while still refusing an unknown
-- stage and an invalid mode. The constraint was widened by exactly one name,
-- not loosened.
--
-- CREATE OR REPLACE FUNCTION, so re-running it is harmless — but it lives in
-- migrations/ now precisely so nothing treats it as outstanding work.

create or replace function public.engine_stage_modes_valid(p_modes jsonb)
returns boolean
language sql
immutable
security invoker
set search_path = public
as $fn$
  select case
    when p_modes is null then true
    when jsonb_typeof(p_modes) <> 'object' then false
    else coalesce(
      (
        select bool_and(
          e.value is not null
          and e.key = any (array[
            'discovery',
            'relevance',
            'entity_coverage',
            'research',
            'update_proposals',
            'product_assembly',
            'briefs',
            'draft_assembly',
            'search_intelligence',
            'opportunities',
            'trends',
            'media_acquisition',
            'freshness',
            'internal_links',
            'hero_media',
            'spotlight',
            'shadow_evaluation'
          ])
          and e.value = any (array['MANUAL', 'ASSISTED', 'AUTOMATIC'])
        )
        from jsonb_each_text(p_modes) as e
      ),
      true
    )
  end;
$fn$;

comment on function public.engine_stage_modes_valid is
  'True when stage_modes is an object mapping known engine stage names to one '
  'of MANUAL / ASSISTED / AUTOMATIC. Used by the engine_settings CHECK '
  'constraint. IMMUTABLE because PostgreSQL requires it for CHECK. Keep the '
  'stage array in sync with ENGINE_STAGE_NAMES in src/lib/engine/stages.ts -- '
  'stage-modes.test.ts parses this file and asserts it.';
