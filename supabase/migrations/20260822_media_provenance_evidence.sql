-- DRAFTED, NOT APPLIED. Lives in migrations_pending/ specifically so no tooling
-- runs it. Move to supabase/migrations/ only after it has actually been run.
--
-- WHY THIS EXISTS
-- ---------------
-- The provider pipeline in src/lib/media/providers/ produces something the
-- schema currently has nowhere to put: a STRUCTURED EVIDENCE BUNDLE. For each
-- candidate it records the licence template as read from the source's own
-- wikitext, the licence as reported by structured metadata, the author and
-- permission fields, the embedded EXIF, the file's content hash, and where each
-- of those was read from.
--
-- Today all of that is flattened into engine_media_candidates.state_reason,
-- which engine_record_media_candidate truncates at 1000 characters. That is
-- enough for a human to act on and NOT enough to re-verify against later — and
-- re-verification is the whole point of recording provenance. A licence that
-- changed at source, a file page that was deleted, a creator renamed: none of
-- those are detectable without the original evidence to compare against.
--
-- The code works WITHOUT this migration. Nothing in src/ depends on any column
-- added here; the pipeline degrades to the truncated summary. This is an
-- upgrade to fidelity, not a prerequisite.
--
-- WHAT THIS DELIBERATELY DOES NOT DO
-- ----------------------------------
-- It does not add any path by which automated code can reach
-- rights_status='verified'. The new RPC below hard-rejects that value, which is
-- stricter than the existing engine_record_media_candidate. It does not weaken
-- any RLS policy, any CHECK, or any grant.

begin;

-- ---------------------------------------------------------------------------
-- 1. media_assets: evidence that survives the session that gathered it
-- ---------------------------------------------------------------------------

alter table public.media_assets
  -- SHA-256 of the bytes we actually stored, e.g. "sha256:abc…". Two jobs:
  -- detecting that the file at source has been replaced since acquisition, and
  -- detecting that the same photograph reached us twice through two providers.
  add column if not exists content_hash text,

  -- The full provenance bundle as produced by
  -- src/lib/media/providers/types.ts ProvenanceRecord — every evidence item
  -- with the origin it was read from. jsonb rather than columns because the
  -- shape is per-provider: Commons contributes a wikitext licence template,
  -- another source will contribute something else, and flattening that into
  -- fixed columns would either lose evidence or invent empty ones.
  add column if not exists provenance_evidence jsonb,

  -- When a HUMAN confirmed the licence at its source, and which admin. Distinct
  -- from published_at/published_by: verification is the act that authorises
  -- publication, publication is a later editorial decision, and conflating them
  -- means an asset verified once and published three times looks like three
  -- verifications.
  add column if not exists rights_verified_at timestamptz,
  add column if not exists rights_verified_by uuid references public.admin_users(id) on delete set null,

  -- When the source was last re-checked for drift (licence changed, page gone).
  -- Null means never re-checked since acquisition.
  add column if not exists source_checked_at timestamptz,

  -- What the last re-check found, from detectRightsDrift() in
  -- src/lib/media/providers/rights-verification.ts.
  add column if not exists source_check_result text;

do $$
begin
  if not exists (
    select 1 from pg_constraint where conname = 'media_assets_source_check_result_check'
  ) then
    alter table public.media_assets
      add constraint media_assets_source_check_result_check
      check (source_check_result is null or source_check_result in (
        'unchanged', 'licence_changed', 'creator_changed', 'content_changed', 'source_gone'
      ));
  end if;
end $$;

-- The provenance invariant, at the database level.
--
-- src/lib/media/provenance.ts already refuses to classify an asset
-- rights_verified without a source URL, a recognised licence and — where the
-- licence requires attribution — a creator. That check runs in application
-- code, which means a direct SQL update or a future code path that forgets to
-- call it can still write the state the check exists to prevent.
--
-- Deliberately scoped to externally-sourced assets. An owned original or a
-- TechCarvalho graphic has no external licence and legitimately carries none of
-- these fields.
do $$
begin
  if not exists (
    select 1 from pg_constraint where conname = 'media_assets_external_verified_needs_provenance'
  ) then
    alter table public.media_assets
      add constraint media_assets_external_verified_needs_provenance
      check (
        rights_status <> 'verified'
        or owned = true
        or source_type in ('staff_photograph', 'tc_graphic')
        or (source_url is not null and license is not null and (creator is not null or attribution is not null))
      );
  end if;
end $$;

comment on constraint media_assets_external_verified_needs_provenance on public.media_assets is
  'An externally-sourced asset cannot be marked rights_status=''verified'' without the provenance '
  'needed to rely on and render its licence. Mirrors classifyRights() in src/lib/media/provenance.ts '
  'so the invariant survives a code path that forgets to call it.';

-- ---------------------------------------------------------------------------
-- 2. engine_media_candidates: room for the evidence, and for WHY
-- ---------------------------------------------------------------------------

alter table public.engine_media_candidates
  -- Which approved provider produced this, e.g. 'wikimedia_commons'. Distinct
  -- from source_organisation, which is free text and also used for
  -- "TechCarvalho (original graphic)".
  add column if not exists provider_id text,

  -- Structured evidence bundle, same shape as media_assets.provenance_evidence.
  add column if not exists evidence jsonb,

  -- Entity/media match confidence, kept SEPARATE from `confidence`.
  -- They answer different questions: "is this the right product?" and "how
  -- good a candidate is it?". A file can be certainly the right product and a
  -- poor photograph, or a beautiful photograph of something else, and one
  -- number cannot say which.
  add column if not exists entity_match_confidence numeric(4,3)
    check (entity_match_confidence is null or (entity_match_confidence >= 0 and entity_match_confidence <= 1)),

  add column if not exists content_hash text,

  -- The ranking narrative: why this candidate beat the alternatives, criterion
  -- by criterion. Untruncated, unlike state_reason.
  add column if not exists ranking_rationale text,

  -- Every candidate that was examined and refused, with its reason. A negative
  -- result is a finding, and it is only a finding if it is written down.
  add column if not exists rejected_candidates jsonb;

create index if not exists engine_media_candidates_provider_idx
  on public.engine_media_candidates (provider_id) where provider_id is not null;

create index if not exists engine_media_candidates_hash_idx
  on public.engine_media_candidates (content_hash) where content_hash is not null;

-- ---------------------------------------------------------------------------
-- 3. The RPC
-- ---------------------------------------------------------------------------

-- Same contract as engine_record_media_candidate plus the evidence, and one
-- rule that function does not have: p_rights_status may NEVER be
-- 'confirmed_usable'. That value means "we have established we may use this",
-- and no automated path establishes that about a third party's photograph. The
-- engine's strongest honest answer is 'unclear_manual_review'.
create or replace function public.engine_record_provider_media_candidate(
  p_requirement_id uuid,
  p_product_id uuid,
  p_content_id uuid,
  p_provider_id text,
  p_source_organisation text,
  p_source_url text,
  p_asset_url text,
  p_width integer,
  p_height integer,
  p_potential_licence text,
  p_attribution_required boolean,
  p_attribution_text text,
  p_rights_status text,
  p_confidence numeric,
  p_entity_match_confidence numeric,
  p_content_hash text,
  p_reason text,
  p_ranking_rationale text,
  p_evidence jsonb,
  p_rejected_candidates jsonb
)
returns text
language plpgsql
security definer
set search_path = public
as $fn$
begin
  -- The hard boundary, enforced in the database rather than only in TypeScript.
  if p_rights_status = 'confirmed_usable' then
    return 'rejected_engine_cannot_confirm';
  end if;

  if p_rights_status is not null and p_rights_status not in (
    'unverified', 'requires_registration', 'unclear_manual_review', 'no_source_found', 'prohibited'
  ) then
    return 'rejected_invalid';
  end if;

  if (p_product_id is null) = (p_content_id is null) then
    return 'rejected_invalid_target';
  end if;

  begin
    insert into public.engine_media_candidates (
      media_requirement_id, product_id, content_id, provider_id, source_organisation,
      source_url, asset_url, asset_type, width, height, potential_licence,
      attribution_required, attribution_text, rights_status, confidence,
      entity_match_confidence, content_hash, requires_human_review, state, state_reason,
      ranking_rationale, evidence, rejected_candidates
    ) values (
      p_requirement_id, p_product_id, p_content_id, left(p_provider_id, 64),
      left(p_source_organisation, 200), left(p_source_url, 1000), left(p_asset_url, 1000),
      'image', p_width, p_height, left(p_potential_licence, 500),
      coalesce(p_attribution_required, true), left(p_attribution_text, 500),
      coalesce(p_rights_status, 'unclear_manual_review'),
      least(greatest(coalesce(p_confidence, 0), 0), 1),
      least(greatest(coalesce(p_entity_match_confidence, 0), 0), 1),
      left(p_content_hash, 128),
      -- Not a parameter. Always true. There is no argument a caller can pass
      -- to skip human review of a third party's photograph.
      true,
      'rights_review',
      left(p_reason, 1000), p_ranking_rationale, p_evidence, p_rejected_candidates
    );
  exception when unique_violation then
    return 'deduped';
  end;

  return 'created';
end;
$fn$;

revoke execute on function public.engine_record_provider_media_candidate(
  uuid, uuid, uuid, text, text, text, text, integer, integer, text, boolean, text,
  text, numeric, numeric, text, text, text, jsonb, jsonb
) from public;
grant execute on function public.engine_record_provider_media_candidate(
  uuid, uuid, uuid, text, text, text, text, integer, integer, text, boolean, text,
  text, numeric, numeric, text, text, text, jsonb, jsonb
) to anon, authenticated;

comment on function public.engine_record_provider_media_candidate is
  'Records a media candidate discovered by an approved provider, with the primary evidence read from '
  'the asset''s own source page. Hard-rejects rights_status=''confirmed_usable'' and forces '
  'requires_human_review=true: "approved provider" means the engine may SEARCH the source, never that '
  'its assets are approved. See src/lib/media/providers/.';

commit;

-- ---------------------------------------------------------------------------
-- NOT INCLUDED, and why
-- ---------------------------------------------------------------------------
-- * No change to the media_requirements uniqueness indexes. They are named
--   "one_open_per_product" but the predicate is "one per product EVER", so a
--   resolved requirement can never be superseded by a new one. That is a real
--   defect and it is NOT fixed here: changing a unique index on a live table is
--   a separate, riskier migration that deserves its own review, and quietly
--   bundling it into a metadata addition is how a migration nobody read breaks
--   something nobody expected.
-- * No relaxation of media_assets_rights_restricted_not_published_check, or of
--   any RLS policy. Nothing in this file widens what anon or authenticated can
--   do.
