-- STATUS 2026-08-22: APPLIED IN PRODUCTION.
-- Verified BEHAVIOURALLY (probed as `anon` against production), not from this
-- filename and not from an SQL-editor result message. Both have been wrong in
-- this project before: a migration once reported "Success" without applying,
-- and these headers said NOT APPLIED while the functions were live -- which
-- cost real time during the 2026-08-22 security audit.
-- ============================================================================
-- SHADOW EVALUATION STORE — the record on which autonomy would later be granted
-- ============================================================================
--
-- (An earlier revision of this header claimed it was not applied. It is.)
-- specifically so no tooling picks it up. Move it into supabase/migrations/
-- only once it has actually been run in production.
--
-- WHAT THIS IS FOR
-- ----------------
-- src/lib/engine/modes.ts states the graduation criteria — 500 shadow decisions
-- across at least 30 distinct days, zero escapes, seven proofs — and until now
-- there has been nowhere to record a single one of them. ReadinessEvidence had
-- no database source, which meant "readiness 0/500" was true by accident rather
-- than by measurement.
--
-- THE THING THIS SCHEMA IS DESIGNED AGAINST
-- -----------------------------------------
-- Not data loss. INFLATION. A count is the easiest number in this system to
-- fake, and every design choice below exists to make the count harder to raise
-- than the underlying work:
--
--   * `candidate_identity` is UNIQUE. It is derived from what a candidate IS,
--     never from when it was evaluated, so re-running the pipeline over the
--     same discoveries writes nothing the second time. Running the tick a
--     thousand times tonight accumulates zero credit.
--   * `record_kind` separates a DECISION from a FAILURE at the schema level. A
--     candidate that died because a stage threw has `outcome` NULL and is
--     constrained to stay NULL. Crashes cannot be laundered into decisions.
--   * `reached_gate` is stored per row, so "500 decisions" can always be split
--     into the ones that ran the expensive stages and the ones that fell over
--     at relevance.
--   * Dimensions live in their own table, so evaluation-set COMPOSITION is a
--     query rather than a claim. 500 near-identical decisions cannot hide
--     inside the total.
--
-- Family capping and the coverage floors are deliberately NOT in SQL. They live
-- in src/lib/engine/shadow-composition.ts where they are unit-tested and where
-- changing them shows up in a diff a reviewer reads, rather than inside a
-- function body nobody re-reads after it is applied. This schema's job is to
-- hold an honest ledger; the arithmetic on top of it is code.
--
-- WHY THIS CANNOT PUBLISH
-- -----------------------
-- Every function below writes to `engine_shadow_*` tables and nothing else.
-- There is no parameter on any of them that names a content item or a product,
-- no INSERT or UPDATE against `content_items`, `products` or `media_assets`,
-- and `engine_mode` carries a CHECK constraint pinning it to 'SHADOW'. The
-- argument is the same one modes.ts makes about the engine as a whole: the
-- capability is absent, not disabled. Adding it later would be a visible,
-- reviewable act rather than a flag change.
--
-- SECURITY POSTURE
-- ----------------
-- Follows the established engine pattern exactly: RLS admin-only on every
-- table (which denies by returning ZERO ROWS, not an error), and the cron path
-- reaches the data only through narrow SECURITY DEFINER functions granted to
-- `anon, authenticated` and revoked from `public`. Every function re-checks
-- the master kill switch internally, so it cannot be bypassed by calling the
-- endpoint directly.

-- ============================================================================
-- PART 1 — Tables
-- ============================================================================

-- One row per candidate, ever. The unique constraint on candidate_identity is
-- the deduplication mechanism, not a nicety.
create table if not exists public.engine_shadow_decisions (
  id uuid primary key default gen_random_uuid(),

  -- Identity, derived from what the candidate IS. Version-free on purpose:
  -- including a pipeline version would create a legitimate-looking way to
  -- reset deduplication and re-bank the same decisions.
  candidate_identity text not null,
  candidate_kind text not null check (candidate_kind in ('discovery', 'content', 'product')),
  -- Provenance only. Nullable, ON DELETE SET NULL: the shadow ledger is
  -- evidence and must survive the deletion of whatever prompted it.
  discovery_id uuid references public.engine_discoveries(id) on delete set null,

  title text not null,
  -- Kept denormalised for near-duplicate family clustering, which must keep
  -- working after a source row is deleted.
  publisher text,

  -- Never anything but SHADOW. A mode is a value in a table and a value in a
  -- table is not a security boundary — but a CHECK constraint at least means
  -- this ledger cannot silently start describing a mode that publishes.
  engine_mode text not null default 'SHADOW' check (engine_mode = 'SHADOW'),

  record_kind text not null check (record_kind in ('decision', 'failure')),
  outcome text check (outcome in ('WOULD_PUBLISH', 'WOULD_REJECT', 'HUMAN_REVIEW_REQUIRED')),

  terminal_stage text not null,
  reached_gate boolean not null default false,

  -- The full stage-by-stage record, so "that check passed" stays
  -- distinguishable from "we never got that far".
  stages jsonb not null default '[]'::jsonb,
  -- Per-dimension scores from the publication gate. Never aggregated into a
  -- headline number: an aggregate is where uncertainty goes to hide.
  gate jsonb,
  -- What the engine WOULD have created. Recorded, never acted on.
  proposal jsonb,

  failed_stage text,
  failure_error text,
  explanation text not null,

  decided_at timestamptz not null default now(),
  decided_on date not null default (now() at time zone 'utc')::date,

  -- A human's own verdict on the same candidate, for the disagreement rate in
  -- READINESS. Written by an admin through RLS, never by the engine — the
  -- engine grading its own homework would make the metric meaningless.
  human_verdict text check (human_verdict is null or human_verdict in ('WOULD_PUBLISH', 'WOULD_REJECT', 'HUMAN_REVIEW_REQUIRED')),
  human_verdict_at timestamptz,
  human_verdict_note text,

  created_at timestamptz not null default now(),

  constraint engine_shadow_identity_unique unique (candidate_identity),

  -- A failure has no outcome and a decision must have one. Enforced here so no
  -- future caller can record a crash as a verdict.
  constraint engine_shadow_outcome_matches_kind check (
    (record_kind = 'failure' and outcome is null)
    or (record_kind = 'decision' and outcome is not null)
  ),
  constraint engine_shadow_failure_has_stage check (
    record_kind <> 'failure' or failed_stage is not null or failure_error is not null
  )
);

comment on table public.engine_shadow_decisions is
  'One shadow decision (or failure) per candidate. Publishes nothing; there is no column here that any publication path reads.';
comment on column public.engine_shadow_decisions.candidate_identity is
  'Stable identity derived from the candidate itself. UNIQUE — this is what stops re-running the pipeline from accumulating credit.';
comment on column public.engine_shadow_decisions.record_kind is
  'decision = the engine reached a verdict. failure = a stage threw, so nothing was actually evaluated. Counted separately, always.';

-- Every reason, blocker and finding behind a decision. Separate table rather
-- than jsonb because these get counted and grouped: "which blocker fires most"
-- is the question that tells an editor where the engine is weakest.
create table if not exists public.engine_shadow_reasons (
  id uuid primary key default gen_random_uuid(),
  decision_id uuid not null references public.engine_shadow_decisions(id) on delete cascade,
  code text not null,
  stage text not null,
  severity text not null check (severity in ('blocker', 'serious', 'caution', 'note')),
  message text not null,
  -- Concrete pointers: urls, claim ids, asset ids. Never a vague gesture.
  detail text[] not null default '{}',
  created_at timestamptz not null default now()
);

create index if not exists engine_shadow_reasons_decision_idx on public.engine_shadow_reasons (decision_id);
create index if not exists engine_shadow_reasons_code_idx on public.engine_shadow_reasons (code, severity);

-- Evaluation-set composition. One row per (decision, dimension), so coverage is
-- a GROUP BY rather than a claim in a report somebody wrote by hand.
create table if not exists public.engine_shadow_dimensions (
  decision_id uuid not null references public.engine_shadow_decisions(id) on delete cascade,
  dimension text not null check (dimension in (
    'news_sensitive', 'evergreen', 'products', 'comparisons', 'troubleshooting',
    'buying_questions', 'compatibility_specification', 'regulatory_legal',
    'price_availability_sensitive', 'difficult_entity_resolution',
    'media_rich', 'media_impossible', 'source_disagreement', 'sparse_source',
    'rapidly_changing'
  )),
  primary key (decision_id, dimension)
);

create index if not exists engine_shadow_dimensions_dimension_idx on public.engine_shadow_dimensions (dimension);

comment on table public.engine_shadow_dimensions is
  'Which kinds of editorial difficulty each decision exercised. The whitelist is closed on purpose: a new dimension is a schema change somebody reviews, not a free-text string a caller invents to fill a gap.';

-- Recorded proof EXECUTIONS, in the shape src/lib/engine/proofs.ts already
-- reasons about (`ProofRecord`). Append-only: `evaluateProof()` picks the
-- strongest, most recent usable record itself, and overwriting history would
-- destroy the audit trail that makes a proof checkable.
--
-- Deliberately NOT a "proof status" table with one row per kind. A status is
-- derived — from level, age, commit and whether method and observation were
-- actually written down — and deriving it in SQL would duplicate rules that are
-- already unit-tested in TypeScript, with the two free to drift.
--
-- If proofs.ts later grows its own persistence, this table is where it should
-- go rather than beside it.
create table if not exists public.engine_shadow_proof_runs (
  id uuid primary key default gen_random_uuid(),
  kind text not null check (kind in (
    'rollback_test', 'circuit_breaker_test', 'concurrency_test',
    'source_outage_test', 'database_failure_test',
    'media_validation_outage_test', 'duplicate_scheduler_test',
    'provider_outage_test', 'media_acquisition_test', 'rights_verification_test'
  )),
  level text not null check (level in (
    'code_exists', 'unit_tested', 'integration_proven', 'chaos_proven', 'production_proven'
  )),
  observed_at timestamptz not null default now(),
  -- A proof about other code is not a proof about this one.
  commit_sha text,
  -- What was actually DONE and what was actually OBSERVED. Both required and
  -- both length-checked: a record with no observation is somebody asserting a
  -- result rather than recording one.
  method text not null check (char_length(trim(method)) > 10),
  observed text not null check (char_length(trim(observed)) > 10),
  passed boolean not null,
  created_at timestamptz not null default now()
);

create index if not exists engine_shadow_proof_runs_kind_idx
  on public.engine_shadow_proof_runs (kind, observed_at desc);

comment on table public.engine_shadow_proof_runs is
  'Proof obtained by deliberately breaking things, not by them not breaking. An absent row means NOT PROVEN — never infer a pass from the absence of a recorded failure.';

-- ============================================================================
-- PART 2 — RLS: admin-only, every table, every operation
-- ============================================================================
-- Same posture as every other engine table. This holds unpublished editorial
-- judgement and source evaluation notes; none of it is public-readable.

alter table public.engine_shadow_decisions enable row level security;
alter table public.engine_shadow_reasons enable row level security;
alter table public.engine_shadow_dimensions enable row level security;
alter table public.engine_shadow_proof_runs enable row level security;

do $$
declare t text;
begin
  foreach t in array array[
    'engine_shadow_decisions', 'engine_shadow_reasons',
    'engine_shadow_dimensions', 'engine_shadow_proof_runs'
  ] loop
    execute format('drop policy if exists "admins read %1$s" on public.%1$I', t);
    execute format('drop policy if exists "admins insert %1$s" on public.%1$I', t);
    execute format('drop policy if exists "admins update %1$s" on public.%1$I', t);
    execute format('drop policy if exists "admins delete %1$s" on public.%1$I', t);
    execute format('create policy "admins read %1$s" on public.%1$I for select using (public.is_admin())', t);
    execute format('create policy "admins insert %1$s" on public.%1$I for insert with check (public.is_admin())', t);
    execute format('create policy "admins update %1$s" on public.%1$I for update using (public.is_admin())', t);
    execute format('create policy "admins delete %1$s" on public.%1$I for delete using (public.is_admin())', t);
    execute format('grant select, insert, update, delete on public.%1$I to authenticated', t);
  end loop;
end $$;

-- ============================================================================
-- PART 3 — Read RPCs for the cron path
-- ============================================================================
-- The shadow runner needs richer inputs than the existing per-stage RPCs
-- expose: it evaluates EVERY candidate rather than only the un-triaged ones,
-- and it needs source excerpts and registry permissions in order to run the
-- claim-attestation and media-rights checks honestly.

-- Candidates for shadow evaluation.
--
-- Deliberately includes discoveries the live pipeline has already rejected.
-- Shadow's question is "what would the engine decide", and a set filtered to
-- the candidates the engine already liked would answer a much easier question.
create or replace function public.engine_shadow_candidates(p_limit integer default 500)
returns table (
  id uuid, dedupe_key text, title text, summary text, discovery_type text,
  category_slug text, claim_status text, state text, sighting_count integer,
  first_seen_at timestamptz, relevance_overridden_by_admin boolean,
  product_id uuid, content_id uuid
)
language plpgsql
security definer
set search_path = public
as $fn$
begin
  -- The master kill switch, re-checked here so it cannot be bypassed by
  -- calling this endpoint directly.
  if not public.engine_flag_enabled('discovery') then
    return;
  end if;
  return query
    select d.id, d.dedupe_key, d.title, d.summary, d.discovery_type,
           d.category_slug, d.claim_status, d.state, d.sighting_count,
           d.first_seen_at, d.relevance_overridden_by_admin,
           d.product_id, d.content_id
      from public.engine_discoveries d
     order by d.first_seen_at desc
     limit greatest(least(coalesce(p_limit, 500), 2000), 1);
end;
$fn$;
revoke execute on function public.engine_shadow_candidates(integer) from public;
grant execute on function public.engine_shadow_candidates(integer) to anon, authenticated;

-- Evidence for a candidate, WITH the excerpt and the source registry's
-- permissions.
--
-- engine_evidence_for() deliberately returns neither. The excerpt is what makes
-- claim attestation possible at all — without it, "is this figure in any
-- source?" is unanswerable and the honest answer is no. The registry columns
-- are what makes the media-rights check real rather than a label lookup.
create or replace function public.engine_shadow_evidence(p_discovery_id uuid)
returns table (
  id uuid, url text, publisher text, organisation text, excerpt text,
  claim_status text, trust_level text, originates_from_url text,
  retrieved_at timestamptz, source_type text,
  discovery_permitted boolean, media_republication_permitted boolean,
  media_rights_status text, attribution_required boolean,
  editorial_use_only boolean, registration_required boolean
)
language plpgsql
security definer
set search_path = public
as $fn$
begin
  if not public.engine_flag_enabled('discovery') then
    return;
  end if;
  return query
    select e.id, e.url, e.publisher, s.organisation, e.excerpt,
           e.claim_status, e.trust_level, e.originates_from_url,
           e.retrieved_at, s.source_type,
           coalesce(s.discovery_permitted, false),
           coalesce(s.media_republication_permitted, false),
           s.media_rights_status,
           coalesce(s.attribution_required, false),
           coalesce(s.editorial_use_only, false),
           coalesce(s.registration_required, false)
      from public.engine_discovery_evidence e
      left join public.engine_sources s on s.id = e.source_id
     where e.discovery_id = p_discovery_id;
end;
$fn$;
revoke execute on function public.engine_shadow_evidence(uuid) from public;
grant execute on function public.engine_shadow_evidence(uuid) to anon, authenticated;

-- Media candidates attached to whatever a discovery points at.
create or replace function public.engine_shadow_media(p_product_id uuid, p_content_id uuid)
returns table (
  id uuid, source_organisation text, source_url text, asset_url text,
  asset_type text, potential_licence text, attribution_required boolean,
  attribution_text text, rights_status text, requires_human_review boolean,
  state text,
  registry_media_republication_permitted boolean,
  registry_media_rights_status text,
  registry_attribution_required boolean,
  registry_editorial_use_only boolean,
  registry_registration_required boolean,
  registry_organisation text
)
language plpgsql
security definer
set search_path = public
as $fn$
begin
  if not public.engine_flag_enabled('discovery') then
    return;
  end if;
  if p_product_id is null and p_content_id is null then
    return;
  end if;
  return query
    select c.id, c.source_organisation, c.source_url, c.asset_url,
           c.asset_type, c.potential_licence, coalesce(c.attribution_required, false),
           c.attribution_text, c.rights_status, coalesce(c.requires_human_review, true),
           c.state,
           coalesce(s.media_republication_permitted, false),
           s.media_rights_status,
           coalesce(s.attribution_required, false),
           coalesce(s.editorial_use_only, false),
           coalesce(s.registration_required, false),
           s.organisation
      from public.engine_media_candidates c
      left join public.engine_sources s on s.id = c.source_id
     where (p_product_id is not null and c.product_id = p_product_id)
        or (p_content_id is not null and c.content_id = p_content_id);
end;
$fn$;
revoke execute on function public.engine_shadow_media(uuid, uuid) from public;
grant execute on function public.engine_shadow_media(uuid, uuid) to anon, authenticated;

-- The source registry, for provenance recovery.
--
-- WHY THE SHADOW RUNNER NEEDS THIS AT ALL
-- ---------------------------------------
-- `engine_upsert_discovery` writes every evidence row with `source_id` NULL —
-- its signature has no p_source_id parameter, even though the discovery job is
-- iterating over `engine_due_sources` and knows exactly which source it polled.
-- As of 2026-08-22 that is 118 of 118 evidence rows in production with no link
-- back to the registry that authorised them, which makes discovery permission,
-- media republication permission and attribution requirements all unresolvable
-- from an evidence row.
--
-- Until that is fixed at the source, provenance is recovered by matching the
-- evidence URL's host against `engine_sources.url`. That is a join on a
-- different key, not an assumption, and it fails closed: an unmatched host
-- stays unknown, and an unknown source is not a permitted one.
--
-- Returns permissions only. No terms notes, no error text, no credentials.
create or replace function public.engine_shadow_sources()
returns table (
  id uuid, url text, organisation text, source_type text,
  discovery_permitted boolean, media_republication_permitted boolean,
  media_rights_status text, attribution_required boolean,
  editorial_use_only boolean, registration_required boolean
)
language plpgsql
security definer
set search_path = public
as $fn$
begin
  if not public.engine_flag_enabled('discovery') then
    return;
  end if;
  return query
    select s.id, s.url, s.organisation, s.source_type,
           coalesce(s.discovery_permitted, false),
           coalesce(s.media_republication_permitted, false),
           s.media_rights_status,
           coalesce(s.attribution_required, false),
           coalesce(s.editorial_use_only, false),
           coalesce(s.registration_required, false)
      from public.engine_sources s;
end;
$fn$;
revoke execute on function public.engine_shadow_sources() from public;
grant execute on function public.engine_shadow_sources() to anon, authenticated;

-- Published content signals for the duplication and cannibalisation checks.
-- Published only: an unpublished draft cannot be cannibalised by anything.
create or replace function public.engine_shadow_content_signals()
returns table (id uuid, title text, slug text, primary_query text, intent_fingerprint text, content_type text, category_id uuid)
language plpgsql
security definer
set search_path = public
as $fn$
begin
  if not public.engine_flag_enabled('discovery') then
    return;
  end if;
  return query
    select c.id, c.title::text, c.slug::text, c.primary_query, c.intent_fingerprint,
           c.type::text, c.category_id
      from public.content_items c
     where c.status = 'published';
end;
$fn$;
revoke execute on function public.engine_shadow_content_signals() from public;
grant execute on function public.engine_shadow_content_signals() to anon, authenticated;

-- ============================================================================
-- PART 4 — The write RPC
-- ============================================================================
-- The ONLY way the cron path records a shadow decision.
--
-- Note what it cannot do. There is no parameter naming a content item or a
-- product to modify, no status, no is_published, no publication_status. It
-- writes three shadow tables and returns a status string. Enabling autonomous
-- publishing would require a function that does not exist, which is the point.
create or replace function public.engine_shadow_record_decision(
  p_candidate_identity text,
  p_candidate_kind text,
  p_discovery_id uuid,
  p_title text,
  p_publisher text,
  p_record_kind text,
  p_outcome text,
  p_terminal_stage text,
  p_reached_gate boolean,
  p_stages jsonb,
  p_gate jsonb,
  p_proposal jsonb,
  p_failed_stage text,
  p_failure_error text,
  p_explanation text,
  p_dimensions text[],
  p_reasons jsonb
)
returns text
language plpgsql
security definer
set search_path = public
as $fn$
declare
  v_id uuid;
  v_reason jsonb;
  v_dimension text;
begin
  if not public.engine_flag_enabled('discovery') then
    return 'rejected_disabled';
  end if;

  -- Shape validation, returned as a status string rather than raised, so a
  -- malformed call is visible to the caller instead of becoming a 500.
  if p_candidate_identity is null
     or char_length(trim(p_candidate_identity)) = 0
     or char_length(p_candidate_identity) > 400 then
    return 'rejected_invalid';
  end if;
  if p_candidate_kind not in ('discovery', 'content', 'product') then
    return 'rejected_invalid';
  end if;
  if p_record_kind not in ('decision', 'failure') then
    return 'rejected_invalid';
  end if;
  -- The rule that stops a crash being recorded as a verdict, checked here as
  -- well as by the table constraint so the caller gets a status rather than an
  -- exception.
  if p_record_kind = 'decision'
     and (p_outcome is null or p_outcome not in ('WOULD_PUBLISH', 'WOULD_REJECT', 'HUMAN_REVIEW_REQUIRED')) then
    return 'rejected_invalid';
  end if;
  if p_record_kind = 'failure' and p_outcome is not null then
    return 'rejected_invalid';
  end if;
  if p_title is null or p_explanation is null or p_terminal_stage is null then
    return 'rejected_invalid';
  end if;

  begin
    insert into public.engine_shadow_decisions (
      candidate_identity, candidate_kind, discovery_id, title, publisher,
      record_kind, outcome, terminal_stage, reached_gate,
      stages, gate, proposal, failed_stage, failure_error, explanation
    ) values (
      p_candidate_identity, p_candidate_kind, p_discovery_id,
      left(p_title, 500), left(p_publisher, 300),
      p_record_kind, p_outcome, left(p_terminal_stage, 100), coalesce(p_reached_gate, false),
      coalesce(p_stages, '[]'::jsonb), p_gate, p_proposal,
      left(p_failed_stage, 100), left(p_failure_error, 4000), left(p_explanation, 4000)
    )
    returning id into v_id;
  exception when unique_violation then
    -- Already evaluated. This is the deduplication working, not an error: the
    -- pipeline may be re-run over the same discoveries as often as it likes and
    -- will bank no additional credit for doing so.
    return 'deduped';
  end;

  for v_dimension in select unnest(coalesce(p_dimensions, '{}'::text[])) loop
    -- Unknown dimensions are dropped rather than raising: the CHECK constraint
    -- is the whitelist, and one bad string must not lose the whole decision.
    begin
      insert into public.engine_shadow_dimensions (decision_id, dimension)
      values (v_id, v_dimension)
      on conflict do nothing;
    exception when check_violation then
      null;
    end;
  end loop;

  for v_reason in select * from jsonb_array_elements(coalesce(p_reasons, '[]'::jsonb)) loop
    if (v_reason ->> 'severity') in ('blocker', 'serious', 'caution', 'note') then
      insert into public.engine_shadow_reasons (decision_id, code, stage, severity, message, detail)
      values (
        v_id,
        left(coalesce(v_reason ->> 'code', 'unknown'), 100),
        left(coalesce(v_reason ->> 'stage', 'unknown'), 100),
        v_reason ->> 'severity',
        left(coalesce(v_reason ->> 'message', ''), 4000),
        coalesce(
          (select array_agg(left(value, 1000)) from jsonb_array_elements_text(coalesce(v_reason -> 'detail', '[]'::jsonb))),
          '{}'::text[]
        )
      );
    end if;
  end loop;

  return 'created';
end;
$fn$;
revoke execute on function public.engine_shadow_record_decision(
  text, text, uuid, text, text, text, text, text, boolean, jsonb, jsonb, jsonb, text, text, text, text[], jsonb
) from public;
grant execute on function public.engine_shadow_record_decision(
  text, text, uuid, text, text, text, text, text, boolean, jsonb, jsonb, jsonb, text, text, text, text[], jsonb
) to anon, authenticated;

-- ============================================================================
-- PART 5 — Readiness read RPCs
-- ============================================================================

-- NOTE ON THE KILL SWITCH: the three read functions in this part are the only
-- engine RPCs that do NOT re-check engine_flag_enabled, and that is deliberate.
-- They report on evidence already gathered. Gating them would mean that turning
-- the engine off made readiness read as "zero decisions" — indistinguishable
-- from never having run — which is the exact empty-versus-failed confusion the
-- 2026-08 incident was about. The write path IS gated; a disabled engine
-- gathers no new evidence but does not lose what it has.

-- The ledger: one row per recorded decision, with everything the composition
-- assessor needs and nothing it does not.
--
-- Returns raw rows rather than a pre-computed total on purpose. The
-- anti-inflation arithmetic (identity deduplication, near-duplicate family
-- capping, coverage floors) lives in src/lib/engine/shadow-composition.ts where
-- it is unit-tested. A SQL function returning "credited: 500" would be a number
-- nobody could check.
create or replace function public.engine_shadow_ledger(p_limit integer default 5000)
returns table (
  candidate_identity text, title text, publisher text, decided_on date,
  record_kind text, outcome text, terminal_stage text, reached_gate boolean,
  dimensions text[]
)
language plpgsql
security definer
set search_path = public
as $fn$
begin
  return query
    select d.candidate_identity, d.title, d.publisher, d.decided_on,
           d.record_kind, d.outcome, d.terminal_stage, d.reached_gate,
           coalesce(
             (select array_agg(x.dimension order by x.dimension)
                from public.engine_shadow_dimensions x
               where x.decision_id = d.id),
             '{}'::text[]
           )
      from public.engine_shadow_decisions d
     order by d.decided_at desc
     limit greatest(least(coalesce(p_limit, 5000), 20000), 1);
end;
$fn$;
revoke execute on function public.engine_shadow_ledger(integer) from public;
grant execute on function public.engine_shadow_ledger(integer) to anon, authenticated;

-- Escapes and disagreement, MEASURED rather than assumed.
--
-- An "escape" in SHADOW cannot mean "something wrong was published", because
-- nothing is published. It means the decision logic reached WOULD_PUBLISH while
-- a blocker of that class was on the record — that is, the engine decided to
-- publish something it had itself flagged. That is exactly the failure mode
-- READINESS's zero-tolerance criteria exist to catch, and it is detectable here
-- without anything ever going live.
create or replace function public.engine_shadow_escapes()
returns table (
  would_publish integer,
  fabricated_claim_escapes integer,
  unlicensed_media_escapes integer,
  bypassed_hard_blockers integer,
  duplicate_leakage integer,
  human_reviewed integer,
  human_disagreed integer
)
language plpgsql
security definer
set search_path = public
as $fn$
begin
  return query
  with wp as (
    select d.id from public.engine_shadow_decisions d
     where d.record_kind = 'decision' and d.outcome = 'WOULD_PUBLISH'
  )
  select
    (select count(*) from wp)::integer,
    (select count(distinct r.decision_id) from public.engine_shadow_reasons r
      join wp on wp.id = r.decision_id
     where r.severity = 'blocker'
       and r.code in ('unsupported_claims', 'invented_specifics', 'value_not_in_any_source',
                      'source_evidence_mismatch', 'fabricated_rating',
                      'fabricated_first_party_testing', 'attribution_not_in_evidence'))::integer,
    (select count(distinct r.decision_id) from public.engine_shadow_reasons r
      join wp on wp.id = r.decision_id
     where r.severity = 'blocker'
       and r.code in ('media_provenance_incomplete', 'media_credit_not_rendered', 'media_not_cleared',
                      'media_rights_prohibited', 'media_republication_not_permitted',
                      'licence_attribution_missing', 'attribution_required_missing',
                      'credit_render_unproven', 'misleading_generated_imagery'))::integer,
    (select count(distinct r.decision_id) from public.engine_shadow_reasons r
      join wp on wp.id = r.decision_id
     where r.severity = 'blocker')::integer,
    (select count(distinct r.decision_id) from public.engine_shadow_reasons r
      join wp on wp.id = r.decision_id
     where r.code in ('duplicate_content', 'duplicate_of_existing', 'intent_cannibalisation',
                      'near_duplicate_title'))::integer,
    (select count(*) from public.engine_shadow_decisions d
      where d.record_kind = 'decision' and d.human_verdict is not null)::integer,
    (select count(*) from public.engine_shadow_decisions d
      where d.record_kind = 'decision' and d.human_verdict is not null
        and d.human_verdict is distinct from d.outcome)::integer;
end;
$fn$;
revoke execute on function public.engine_shadow_escapes() from public;
grant execute on function public.engine_shadow_escapes() to anon, authenticated;

-- Every recorded proof RUN, passing or failing.
--
-- Returns raw records rather than a PROVEN/NOT_PROVEN verdict. The verdict
-- depends on level, age, commit and whether a method and observation were
-- actually written down, and those rules live in src/lib/engine/proofs.ts
-- (`evaluateProof`) where they are unit-tested. Failing runs are returned too:
-- a failed proof is evidence AGAINST readiness and hiding it would turn this
-- into a trophy cabinet.
create or replace function public.engine_shadow_proof_runs(p_limit integer default 500)
returns table (
  kind text, level text, observed_at timestamptz, commit_sha text,
  method text, observed text, passed boolean
)
language plpgsql
security definer
set search_path = public
as $fn$
begin
  return query
    select p.kind, p.level, p.observed_at, p.commit_sha, p.method, p.observed, p.passed
      from public.engine_shadow_proof_runs p
     order by p.observed_at desc
     limit greatest(least(coalesce(p_limit, 500), 5000), 1);
end;
$fn$;
revoke execute on function public.engine_shadow_proof_runs(integer) from public;
grant execute on function public.engine_shadow_proof_runs(integer) to anon, authenticated;

-- Record a proof that was ACTUALLY EXERCISED.
--
-- There is deliberately no "assume pass" path and no bulk variant. Each run is
-- recorded by the harness that broke the thing it names, and the method and
-- observation are validated for length here as well as by the table constraint,
-- because a record with no observation is somebody asserting a result rather
-- than reporting one.
--
-- Note that this accepts `passed = false` freely. A failed proof must be as
-- easy to record as a passing one, or the ledger becomes a record of successes.
create or replace function public.engine_shadow_record_proof_run(
  p_kind text,
  p_level text,
  p_commit_sha text,
  p_method text,
  p_observed text,
  p_passed boolean
)
returns text
language plpgsql
security definer
set search_path = public
as $fn$
begin
  if p_kind not in (
    'rollback_test', 'circuit_breaker_test', 'concurrency_test',
    'source_outage_test', 'database_failure_test',
    'media_validation_outage_test', 'duplicate_scheduler_test',
    'provider_outage_test', 'media_acquisition_test', 'rights_verification_test'
  ) then
    return 'rejected_invalid';
  end if;
  if p_level not in (
    'code_exists', 'unit_tested', 'integration_proven', 'chaos_proven', 'production_proven'
  ) then
    return 'rejected_invalid';
  end if;
  if p_passed is null then
    return 'rejected_invalid';
  end if;
  if p_method is null or char_length(trim(p_method)) <= 10
     or p_observed is null or char_length(trim(p_observed)) <= 10 then
    return 'rejected_no_evidence';
  end if;
  insert into public.engine_shadow_proof_runs (kind, level, commit_sha, method, observed, passed)
  values (p_kind, p_level, left(p_commit_sha, 64), left(p_method, 4000), left(p_observed, 4000), p_passed);
  return 'recorded';
end;
$fn$;
revoke execute on function public.engine_shadow_record_proof_run(text, text, text, text, text, boolean) from public;
grant execute on function public.engine_shadow_record_proof_run(text, text, text, text, text, boolean) to anon, authenticated;

-- ============================================================================
-- PART 6 — What this migration deliberately does NOT do
-- ============================================================================
-- * It does not add a publishing function, a publish parameter, or a way to set
--   content_items.status or products.is_published. SHADOW stays structurally
--   incapable of publishing.
-- * It does not weaken any existing RLS policy or grant.
-- * It does not backfill, seed, or synthesise a single shadow decision.
--   Readiness starts at 0/500 and the only way it moves is by the pipeline
--   actually deciding something about a real candidate.
