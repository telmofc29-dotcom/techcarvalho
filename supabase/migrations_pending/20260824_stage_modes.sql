-- PER-STAGE OPERATING MODES
--
-- NOT YET APPLIED. Lives in migrations_pending/ deliberately so no tooling
-- picks it up. Move it into migrations/ only once it has actually been run.
--
-- WHAT THIS ADDS
-- --------------
-- One jsonb column on the single-row engine_settings table, mapping an engine
-- stage name to 'MANUAL' | 'ASSISTED' | 'AUTOMATIC'.
--
-- WHY JSONB RATHER THAN FOURTEEN BOOLEAN COLUMNS
-- ----------------------------------------------
-- The stage list is not stable. It has grown from a handful to fourteen and
-- will grow again, and every growth would otherwise mean another migration and
-- another column nobody remembers to add to the settings form. A map keyed by
-- stage name means adding a stage requires no migration at all: the code
-- already resolves an absent key to the default.
--
-- The usual objection to jsonb — that it loses type safety — does not apply
-- here, because the safety is not in the column. src/lib/engine/stage-modes.ts
-- resolves every value through `resolveStageMode`, which is total over the
-- stage list, fails closed to ASSISTED on anything it does not recognise, and
-- is exhaustively tested. A malformed or hand-edited value cannot produce an
-- unsafe mode; it produces ASSISTED.
--
-- WHY THE DEFAULT IS AN EMPTY OBJECT
-- ----------------------------------
-- Not a fully-populated map of 'ASSISTED'. An empty object means "nothing has
-- been configured", and the code supplies ASSISTED for every absent key. Those
-- are behaviourally identical today, and different later: a populated default
-- would silently pin every stage to whatever the map said at migration time,
-- including stages added afterwards, which is how a new stage ends up running
-- in a mode nobody chose.
--
-- APPLYING THIS CHANGES NO BEHAVIOUR.
-- Every stage resolves to ASSISTED before and after, which is exactly what the
-- engine already does. Behaviour changes only when a human edits a setting.

alter table public.engine_settings
  add column if not exists stage_modes jsonb not null default '{}'::jsonb;

comment on column public.engine_settings.stage_modes is
  'Per-stage operating mode: {"<stage_name>": "MANUAL"|"ASSISTED"|"AUTOMATIC"}. '
  'Absent keys mean ASSISTED. Values are resolved through '
  'src/lib/engine/stage-modes.ts resolveStageMode(), which fails closed to '
  'ASSISTED on anything unrecognised and refuses AUTOMATIC for stages whose '
  'follow-up decision is an editorial or legal judgement rather than a '
  'mechanical one. Publishing is NOT governed here -- the engine has no '
  'publishing RPC to call in any mode.';

-- A value-shape guard. Deliberately permissive about KEYS (a stage added in
-- code must not require a migration) and strict about VALUES (an unrecognised
-- mode is a typo, and a typo that silently means ASSISTED is harder to notice
-- than one that is refused at write time).
alter table public.engine_settings
  drop constraint if exists engine_settings_stage_modes_valid;

alter table public.engine_settings
  add constraint engine_settings_stage_modes_valid check (
    jsonb_typeof(stage_modes) = 'object'
    and not exists (
      select 1
      from jsonb_each_text(stage_modes) as m(key, value)
      where m.value not in ('MANUAL', 'ASSISTED', 'AUTOMATIC')
    )
  );
