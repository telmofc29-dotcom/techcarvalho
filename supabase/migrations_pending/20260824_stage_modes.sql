-- PER-STAGE OPERATING MODES  (corrected — v2)
--
-- NOT YET APPLIED.
--
-- WHY v1 FAILED
-- -------------
-- v1 validated the map with:
--
--   check (... and not exists (select 1 from jsonb_each_text(stage_modes) ...))
--
-- PostgreSQL refuses that: ERROR 0A000, "cannot use subquery in check
-- constraint". A CHECK expression must be a scalar expression over the row —
-- no subqueries, no set-returning functions in a FROM clause — because the
-- constraint has to be evaluated row-by-row without a query plan.
--
-- The mistake was reaching for relational syntax to express a per-element rule
-- over a JSON value.
--
-- THE FIX, AND WHY THIS SHAPE
-- ---------------------------
-- A CHECK constraint MAY call a function, and the function body may contain
-- whatever it likes. The prohibition is on subqueries in the constraint
-- EXPRESSION, not inside a function that expression calls. So the whole rule
-- moves into one IMMUTABLE function and the constraint becomes a single call.
--
-- I first wrote this with jsonpath predicates (`stage_modes @? '$.* ? (...)'`),
-- which are operators and therefore also legal in CHECK. I abandoned that,
-- deliberately, for a reason worth recording: jsonpath defaults to LAX mode,
-- which auto-unwraps arrays inside filters. Under lax semantics
-- {"briefs": ["MANUAL"]} plausibly passes a per-value check, because the filter
-- is applied to the array's ELEMENTS rather than to the array. Getting that
-- right needs `strict` mode plus knowledge of how `@?` suppresses structural
-- errors — and I have no PostgreSQL available in this environment to test
-- against, so I am not willing to ship a constraint whose correctness rests on
-- semantics I cannot execute.
--
-- Plain SQL over `jsonb_each_text` has no such ambiguity. It is longer and
-- duller and I can be sure of what it does by reading it.
--
-- WHAT IS ENFORCED
-- ----------------
--   * shape: must be a JSON object
--   * keys:  must name a real engine stage
--   * values: must be exactly MANUAL, ASSISTED or AUTOMATIC
--   * a JSON null value is REFUSED (see the `is not null` guard below)
--   * the empty object {} is ACCEPTED — it is the default and means
--     "nothing configured", which resolves to ASSISTED everywhere
--
-- THE COST OF VALIDATING KEYS IN THE DATABASE, STATED HONESTLY
-- ------------------------------------------------------------
-- v1 deliberately did NOT validate keys so that adding an engine stage needed
-- no migration. This version does, because an unknown stage name should be
-- refused rather than accepted-and-ignored. The price is that adding a stage
-- now requires a one-line CREATE OR REPLACE FUNCTION.
--
-- That price is paid with a guard: src/lib/engine/stage-modes.test.ts parses
-- the stage array out of THIS FILE and asserts it matches ENGINE_STAGE_NAMES
-- exactly. The two cannot drift without a test failing.
--
-- APPLYING THIS CHANGES NO BEHAVIOUR. The column defaults to '{}', every absent
-- key resolves to ASSISTED, and ASSISTED is what every stage already does. The
-- existing engine_settings row acquires '{}' and is otherwise untouched.

-- ---------------------------------------------------------------------------
-- 1. The column
-- ---------------------------------------------------------------------------

alter table public.engine_settings
  add column if not exists stage_modes jsonb not null default '{}'::jsonb;

comment on column public.engine_settings.stage_modes is
  'Per-stage operating mode: {"<stage_name>": "MANUAL"|"ASSISTED"|"AUTOMATIC"}. '
  'Absent keys mean ASSISTED. Resolved through src/lib/engine/stage-modes.ts '
  'resolveStageMode(), which fails closed to ASSISTED and refuses AUTOMATIC for '
  'stages whose follow-up decision is an editorial or legal judgement. '
  'Publishing is NOT governed here -- the engine has no publishing RPC to call '
  'in any mode.';

-- ---------------------------------------------------------------------------
-- 2. Validation, as one IMMUTABLE function
-- ---------------------------------------------------------------------------
--
-- IMMUTABLE is required: PostgreSQL will not accept a VOLATILE or STABLE
-- function in a CHECK constraint, and rightly so — a constraint that could
-- change its answer without the row changing is not a constraint.
--
-- STAGE LIST — keep in sync with ENGINE_STAGE_NAMES in
-- src/lib/engine/stages.ts. stage-modes.test.ts asserts this.

create or replace function public.engine_stage_modes_valid(p_modes jsonb)
returns boolean
language sql
immutable
parallel safe
set search_path = public
as $fn$
  select case
    -- The column is NOT NULL, so this is belt-and-braces for direct calls.
    when p_modes is null then true
    -- Anything that is not an object is refused before jsonb_each_text is
    -- reached; calling it on a scalar or array would raise rather than return
    -- false, and a constraint that ERRORS is harder to diagnose than one that
    -- simply rejects.
    when jsonb_typeof(p_modes) <> 'object' then false
    else coalesce(
      (
        select bool_and(
          -- A JSON null becomes SQL NULL here, and NULL = any(...) is NULL,
          -- which bool_and would swallow into a NULL result and coalesce would
          -- then turn into TRUE. {"briefs": null} would be accepted. This guard
          -- is what closes that.
          e.value is not null
          and e.key = any (array[
            'discovery',
            'relevance',
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
            'shadow_evaluation'
          ])
          -- jsonb_each_text renders every value as text, so a number, an
          -- object or an array arrives as its text form and simply fails to
          -- match any of the three modes. Type checking is implicit and total.
          and e.value = any (array['MANUAL', 'ASSISTED', 'AUTOMATIC'])
        )
        from jsonb_each_text(p_modes) as e
      ),
      -- No rows: the empty object. Valid, and the default.
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

-- ---------------------------------------------------------------------------
-- 3. The constraint
-- ---------------------------------------------------------------------------
--
-- A single function call: no subquery in the constraint expression, which is
-- exactly what v1 got wrong.

alter table public.engine_settings
  drop constraint if exists engine_settings_stage_modes_valid;

alter table public.engine_settings
  add constraint engine_settings_stage_modes_valid
  check (public.engine_stage_modes_valid(stage_modes));

comment on constraint engine_settings_stage_modes_valid on public.engine_settings is
  'stage_modes must map known engine stage names to a known mode. An unknown '
  'stage name or an unrecognised mode is refused at write time rather than '
  'accepted and silently ignored.';

-- ---------------------------------------------------------------------------
-- 4. Self-check — run BEFORE trusting the constraint
-- ---------------------------------------------------------------------------
--
-- These are assertions, not examples. If the function is wrong, applying this
-- migration raises here and the transaction rolls back, so a broken constraint
-- cannot be left installed. Every case the owner asked to see is covered.

do $verify$
begin
  -- valid stage + each mode
  assert public.engine_stage_modes_valid('{"briefs":"MANUAL"}'::jsonb),        'MANUAL must be accepted';
  assert public.engine_stage_modes_valid('{"briefs":"ASSISTED"}'::jsonb),      'ASSISTED must be accepted';
  assert public.engine_stage_modes_valid('{"briefs":"AUTOMATIC"}'::jsonb),     'AUTOMATIC must be accepted';
  assert public.engine_stage_modes_valid('{"research":"MANUAL","trends":"AUTOMATIC"}'::jsonb),
         'several stages at once must be accepted';

  -- empty object
  assert public.engine_stage_modes_valid('{}'::jsonb), 'the empty object must be accepted';

  -- invalid mode
  assert not public.engine_stage_modes_valid('{"briefs":"BOGUS"}'::jsonb),     'an unknown mode must be refused';
  assert not public.engine_stage_modes_valid('{"briefs":"manual"}'::jsonb),    'lowercase must be refused';
  assert not public.engine_stage_modes_valid('{"briefs":""}'::jsonb),          'an empty mode must be refused';

  -- invalid stage
  assert not public.engine_stage_modes_valid('{"not_a_stage":"MANUAL"}'::jsonb),
         'an unknown stage name must be refused';
  assert not public.engine_stage_modes_valid('{"briefs":"MANUAL","nope":"MANUAL"}'::jsonb),
         'one bad key must reject the whole map';

  -- wrong value types
  assert not public.engine_stage_modes_valid('{"briefs":1}'::jsonb),           'a number must be refused';
  assert not public.engine_stage_modes_valid('{"briefs":true}'::jsonb),        'a boolean must be refused';
  assert not public.engine_stage_modes_valid('{"briefs":null}'::jsonb),        'a JSON null must be refused';
  assert not public.engine_stage_modes_valid('{"briefs":["MANUAL"]}'::jsonb),  'an array must be refused';
  assert not public.engine_stage_modes_valid('{"briefs":{"a":1}}'::jsonb),     'a nested object must be refused';

  -- wrong shape
  assert not public.engine_stage_modes_valid('[]'::jsonb),                     'an array root must be refused';
  assert not public.engine_stage_modes_valid('"MANUAL"'::jsonb),               'a scalar root must be refused';
  assert not public.engine_stage_modes_valid('7'::jsonb),                      'a number root must be refused';

  raise notice 'engine_stage_modes_valid: all 18 assertions passed';
end
$verify$;

-- The existing settings row must have survived, and must be at the default.
do $verify_row$
declare v_modes jsonb;
begin
  select stage_modes into v_modes from public.engine_settings where id = true;
  assert v_modes is not null, 'the engine_settings row must still exist';
  assert v_modes = '{}'::jsonb,
         'the existing row must be at the empty default, so behaviour is unchanged';
  raise notice 'engine_settings row intact, stage_modes = %', v_modes;
end
$verify_row$;
