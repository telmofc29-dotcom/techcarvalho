-- STATUS: NOT YET APPLIED. Drafted 2026-08-23.
-- Lives in migrations_pending/ deliberately so no tooling picks it up; move it
-- into supabase/migrations/ only once it has actually been run in production.
-- Verify after applying with:
--   npx tsx scripts/verify-evidence-provenance.ts     -- expect 12/12
-- Do NOT treat the SQL editor's "Success" message as evidence. Two migrations
-- in this project reported success while carrying defects that only fire when
-- the function is CALLED, and one reported success without applying at all.
-- ============================================================================
-- Evidence provenance: give engine_upsert_discovery the columns it never had
-- ============================================================================
--
-- WHY
-- ---
-- engine_discovery_evidence has five columns that exist to make evidence
-- traceable and independence computable:
--
--     source_id            -> the registry row that authorised this sighting
--     excerpt              -> the claim as this source actually worded it
--     originates_from_url  -> whose claim this source is repeating
--     claim_status         -> populated
--     trust_level          -> populated
--
-- The first three are NULL on ALL 118 evidence rows in production, and not
-- because the data was unavailable. `engine_upsert_discovery` — the SOLE
-- writer of this table — names five columns in its INSERT
-- (discovery_id, url, publisher, claim_status, trust_level) and its signature
-- has no p_source_id, p_excerpt or p_originates_from_url parameter at all.
-- The discovery job iterates `engine_due_sources()` and therefore knows
-- exactly which source it polled, and it parses a summary out of every feed
-- item and then throws it away. The information was in hand at write time and
-- had nowhere to go.
--
-- The consequences are not cosmetic:
--
--   * src/lib/engine/confidence.ts splits evidence on `originates_from_url`.
--     Because it is always NULL, 100% of evidence read as "independent" and
--     the corroboration bonus has never contributed a single point since the
--     engine was built.
--   * Media republication permission, attribution requirements and discovery
--     permission all live on engine_sources and are unreachable from an
--     evidence row without source_id. shadow-io.ts recovers them by matching
--     the evidence host against engine_sources.url and documents that as a
--     workaround for exactly this gap — it left 5 of 118 rows unresolved.
--   * With no excerpt, nothing records what a source actually SAID, so a later
--     source rewording a claim cannot be distinguished from confirming it.
--
-- ============================================================================
-- LESSONS FROM THIS PROJECT'S OWN MIGRATION FAILURES, APPLIED HERE
-- ============================================================================
--
--  1. [42P13] CREATE OR REPLACE cannot change a function's return type.
--     engine_upsert_discovery keeps `returns text` and keeps returning exactly
--     'created' / 'deduped' / 'rejected_invalid', so this hazard does not
--     apply — and it is stated rather than assumed, because
--     20260822_silent_success_telemetry.sql was rejected by production for
--     precisely this on a function nobody had checked.
--
--  2. [42725 / PGRST203] Adding DEFAULTED parameters does not replace a
--     function; it creates a SECOND overload beside it. src/lib/engine/jobs/
--     discovery.ts calls this RPC with NAMED arguments, which would then match
--     both candidates and raise "function is not unique". Every discovery
--     would stop recording. So the 10-argument signature is DROPPED first,
--     explicitly, with its full argument-type list.
--
--  3. [GUARD DRIFT — the one that has actually shipped here twice] A guard
--     list inside an RPC that disagrees with the table's CHECK constraint
--     produces either a spurious 'rejected_invalid' for a legitimate value, or
--     a value that clears the guard and then dies on the constraint. Every
--     guard list below was copied from the CHECK constraint in
--     20260821_growth_engine.sql and is annotated with where it came from:
--
--       discovery_type  <- engine_discoveries.discovery_type CHECK (7 values)
--       claim_status    <- engine_discoveries.claim_status CHECK (6 values),
--                          identical to engine_discovery_evidence.claim_status
--       trust_level     <- engine_discovery_evidence.trust_level CHECK (3)
--
--     claim_status and trust_level were NOT previously guarded at all: a bad
--     value reached the CHECK constraint and raised, turning a single bad feed
--     item into a job error. They are guarded now, and answer the RPC's own
--     'rejected_invalid' — which discovery.ts already handles, because
--     log.rpc() treats any status outside accepted/benign as a failure rather
--     than letting the item evaporate.
--
--  4. [COLUMN NAMES VERIFIED AGAINST THE REAL SCHEMA] Every column named below
--     was checked against 20260821_growth_engine.sql PART 4:
--       engine_discovery_evidence(id, discovery_id, source_id, url, publisher,
--       excerpt, claim_status, trust_level, originates_from_url, retrieved_at,
--       created_at) with unique (discovery_id, url).
--     Two runtime-only column-name errors got through review once before
--     (product_id/content_id/score vs matched_product_id/matched_content_id/
--     match_score, and updated_at vs computed_at) and both would have reported
--     a successful migration.
--
--  5. [DEPENDENCY CHECK] grep over supabase/migrations/*.sql: the only
--     occurrences of engine_upsert_discovery are its own two definitions
--     (20260821_growth_engine.sql, 20260822_engine_safety.sql), their
--     grants, and one comment in 20260822_engine_shadow_evaluation.sql. No
--     view, trigger, constraint or other function depends on it, so dropping
--     the old signature breaks nothing.
--
--  6. [TRANSACTION] The whole file is one transaction. A partial application
--     that dropped the function and failed before recreating it would stop
--     discovery entirely.
--
-- ============================================================================
-- WHAT THIS DOES NOT DO
-- ============================================================================
--   * No RLS policy is weakened. engine_discovery_evidence stays admin-only
--     for direct table access; the new column inherits the table's policies.
--   * No grant is widened. The function is re-granted to exactly the roles it
--     already had (anon, authenticated) and to nobody else.
--   * No publishing path is added. Nothing here can set content_items.status
--     or products.is_published, and there is still no parameter capable of it.
--   * Confidence is still written as 0 by the caller and is still computed
--     from evidence elsewhere. This migration adds inputs to that computation;
--     it does not compute anything.
--   * It does not backfill. Existing rows keep their NULLs until
--     scripts/backfill-evidence-provenance.ts recovers what is genuinely
--     recoverable, and the rest stay NULL rather than being invented.

begin;

-- ---------------------------------------------------------------------------
-- 1. origin_examined — "nobody looked" is not the same as "nothing to find"
-- ---------------------------------------------------------------------------
-- `originates_from_url IS NULL` has two completely different meanings: this
-- source is original, or nobody ever checked. Reading the first from a column
-- that only ever records the second is how the corroboration bonus came to be
-- computed from a column with no writer.
--
-- src/lib/engine/independence.ts therefore counts an unexamined voice at HALF
-- the corroboration weight of one that was checked and found original. That
-- distinction has to survive a round trip through this table or it is
-- decorative, so it gets a column.
--
-- `not null default false` is correct for the existing 118 rows: nothing
-- examined them, and false is exactly that statement.
alter table public.engine_discovery_evidence
  add column if not exists origin_examined boolean not null default false;

comment on column public.engine_discovery_evidence.origin_examined is
  'True only when something actually LOOKED for an upstream citation on this row. '
  'false means unknown, never "confirmed original" — independence scoring counts an '
  'unexamined source at half weight so that an absence of measurement can never read '
  'as evidence of independence.';

comment on column public.engine_discovery_evidence.source_id is
  'The engine_sources row that authorised this sighting. Written by '
  'engine_upsert_discovery from the source the discovery job actually polled. '
  'NULL means the link was never recorded (every row written before 2026-08-23) or '
  'the source has since been deleted — it does not mean the sighting was unsourced.';

-- ---------------------------------------------------------------------------
-- 2. engine_upsert_discovery — persist source_id, excerpt, originates_from_url
-- ---------------------------------------------------------------------------
-- DROP FIRST. See lesson 2 above: three defaulted parameters would create a
-- second overload, and the named-argument call in discovery.ts would then
-- resolve to neither.
drop function if exists public.engine_upsert_discovery(
  text, text, text, text, text, text, numeric, text, text, text
);

create or replace function public.engine_upsert_discovery(
  p_dedupe_key text,
  p_title text,
  p_summary text,
  p_discovery_type text,
  p_category_slug text,
  p_claim_status text,
  p_confidence numeric,
  p_source_url text,
  p_publisher text,
  p_trust_level text,
  -- New, all defaulted so a deploy that lands BEFORE this migration keeps
  -- working against the old signature, and a deploy that lands AFTER it can
  -- still call the 10-argument shape. src/lib/engine/jobs/discovery.ts carries
  -- a fallback ladder for the reverse window, matching cron.ts.
  p_source_id uuid default null,
  p_excerpt text default null,
  p_originates_from_url text default null,
  p_origin_examined boolean default false
)
returns text
language plpgsql
security definer
set search_path = public
as $fn$
declare
  v_id uuid;
  v_created boolean;
  v_claim text;
  v_trust text;
  v_source_id uuid;
  v_origin text;
begin
  if p_dedupe_key is null or p_title is null then
    return 'rejected_invalid';
  end if;

  -- Guard list copied verbatim from engine_discoveries.discovery_type CHECK.
  if p_discovery_type not in (
    'product_launch', 'product_update', 'spec_change', 'firmware_release',
    'technology_news', 'recall_or_security', 'new_topic'
  ) then
    return 'rejected_invalid';
  end if;

  -- Guard list copied verbatim from engine_discoveries.claim_status CHECK,
  -- which is character-for-character the same as
  -- engine_discovery_evidence.claim_status CHECK. Both rows below use it.
  v_claim := coalesce(nullif(p_claim_status, ''), 'unverified');
  if v_claim not in (
    'confirmed_primary', 'reported_secondary', 'estimate', 'leak', 'rumour', 'unverified'
  ) then
    return 'rejected_invalid';
  end if;

  -- Guard list copied verbatim from engine_discovery_evidence.trust_level CHECK.
  v_trust := coalesce(nullif(p_trust_level, ''), 'secondary');
  if v_trust not in ('primary', 'secondary', 'community') then
    return 'rejected_invalid';
  end if;

  -- source_id fails SOFT. engine_discovery_evidence.source_id is a foreign key,
  -- so an id for a source deleted between engine_due_sources() and this call
  -- would raise foreign_key_violation and destroy the whole sighting. Losing
  -- the provenance link is bad; losing the evidence row is worse. An id that
  -- does not resolve is recorded as NULL, which is the same "unknown" the
  -- pre-migration rows carry and which every reader already fails closed on.
  v_source_id := null;
  if p_source_id is not null then
    select s.id into v_source_id from public.engine_sources s where s.id = p_source_id;
  end if;

  -- An "upstream" that is the citing page itself is not an upstream. Recording
  -- it would make a source derivative of itself and silently delete its own
  -- corroboration weight. Same-host self-citation is filtered in
  -- src/lib/engine/independence.ts, which can compare registrable domains;
  -- here only the exact-same-document case is cheap and certain.
  v_origin := nullif(btrim(coalesce(p_originates_from_url, '')), '');
  if v_origin is not null and v_origin !~* '^https?://' then
    v_origin := null;
  end if;
  if v_origin is not null and p_source_url is not null and v_origin = btrim(p_source_url) then
    v_origin := null;
  end if;

  insert into public.engine_discoveries (
    dedupe_key, title, summary, discovery_type, category_slug, claim_status, confidence
  ) values (
    left(p_dedupe_key, 400), left(p_title, 500), left(p_summary, 4000), p_discovery_type,
    left(p_category_slug, 100),
    v_claim,
    least(greatest(coalesce(p_confidence, 0), 0), 1)
  )
  on conflict (dedupe_key) do update
    set last_seen_at = now(),
        sighting_count = public.engine_discoveries.sighting_count + 1,
        updated_at = now()
  -- xmax = 0 is true only for a row this statement inserted, which is how an
  -- upsert reports which branch it took.
  returning id, (xmax = 0) into v_id, v_created;

  if p_source_url is not null then
    insert into public.engine_discovery_evidence (
      discovery_id, source_id, url, publisher, excerpt,
      claim_status, trust_level, originates_from_url, origin_examined
    ) values (
      v_id, v_source_id, left(p_source_url, 1000), left(p_publisher, 200),
      left(p_excerpt, 4000),
      v_claim, v_trust,
      left(v_origin, 1000),
      coalesce(p_origin_examined, false)
    )
    -- WAS `do nothing`. That made a re-poll unable to add anything an earlier
    -- poll had not recorded, which would have left every pre-migration row
    -- NULL forever even though the feed still serves the same item.
    --
    -- This is a FILL, not an overwrite: coalesce keeps whatever is already
    -- stored and only writes into a NULL. The evidence table's whole purpose
    -- is that "a later source rewording a claim can't silently overwrite what
    -- was originally claimed", and an excerpt that could be replaced on every
    -- re-poll would break exactly that. origin_examined ORs rather than
    -- coalescing: once something has genuinely examined this row, a later
    -- unexamined write must not un-examine it.
    on conflict (discovery_id, url) do update
      set source_id = coalesce(public.engine_discovery_evidence.source_id, excluded.source_id),
          excerpt = coalesce(public.engine_discovery_evidence.excerpt, excluded.excerpt),
          originates_from_url = coalesce(
            public.engine_discovery_evidence.originates_from_url,
            excluded.originates_from_url
          ),
          origin_examined = public.engine_discovery_evidence.origin_examined
                            or excluded.origin_examined;
  end if;

  return case when v_created then 'created' else 'deduped' end;
end;
$fn$;

-- Same two roles as before. No caller is added.
revoke execute on function public.engine_upsert_discovery(
  text, text, text, text, text, text, numeric, text, text, text,
  uuid, text, text, boolean
) from public;
grant execute on function public.engine_upsert_discovery(
  text, text, text, text, text, text, numeric, text, text, text,
  uuid, text, text, boolean
) to anon, authenticated;

commit;

-- ============================================================================
-- VERIFICATION AFTER APPLYING
-- ============================================================================
--   npx tsx scripts/verify-evidence-provenance.ts    -- expect 12/12
--
-- Spot checks by hand if you want them:
--
--   select count(*) from pg_proc where proname = 'engine_upsert_discovery';
--   -- MUST be 1. A 2 means the drop did not take and PostgREST will answer
--   -- PGRST203 ("function is not unique") to every discovery call.
--
--   select column_name, is_nullable, column_default
--     from information_schema.columns
--    where table_name = 'engine_discovery_evidence'
--      and column_name = 'origin_examined';
--   -- MUST exist, NO, false.
--
--   select public.engine_upsert_discovery(
--     'probe:evidence-provenance', 'Probe', null, 'technology_news', null,
--     'unverified', 0, 'https://probe.example/a', 'Probe', 'secondary',
--     null, 'the excerpt', 'https://upstream.example/x', true);
--   -- MUST return 'created'. Then:
--   select source_id, excerpt, originates_from_url, origin_examined
--     from public.engine_discovery_evidence
--    where url = 'https://probe.example/a';
--   -- MUST show NULL / 'the excerpt' / 'https://upstream.example/x' / true.
--   -- source_id NULL here is correct: null was passed.
--   delete from public.engine_discoveries where dedupe_key = 'probe:evidence-provenance';
--   -- cascades to the evidence row.
--
--   select public.engine_upsert_discovery(
--     'probe:guards', 'Probe', null, 'technology_news', null,
--     'not_a_status', 0, null, null, null);
--   -- MUST return 'rejected_invalid', NOT raise a check_violation, and MUST
--   -- resolve unambiguously with only 10 arguments supplied.
