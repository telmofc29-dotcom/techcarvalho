-- Normalise 98 double-encoded product_specs values. THIS ONE ACTUALLY RUNS.
--
-- READ THIS FIRST
-- ---------------
-- The earlier file, 20260825_normalise_double_encoded_specs.sql, was applied on
-- 2026-08-25 and did NOTHING. Every one of its 103 lines was a SQL comment: the
-- UPDATE was commented out behind an instruction to "read the preview first".
-- Postgres executed nothing, and Supabase correctly reported
-- "Success. No rows returned." That message was true and meaningless.
--
-- Verified after the fact: all 98 rows are still double-encoded, and the value
-- type distribution is byte-identical to before. My mistake, and a textbook case
-- of the thing this project keeps relearning — a success message is not evidence
-- that anything happened.
--
-- So this version has no commented-out steps. You run the file; it either
-- completes correctly or raises and rolls itself back. There is nothing to
-- uncomment and nothing to remember.
--
-- WHAT IS WRONG WITH THE DATA
-- ---------------------------
-- product_specs.value is jsonb. 98 of 582 rows across 22 products hold a JSON
-- string whose CONTENTS are themselves JSON — serialised twice on the way in:
--
--   stored  "\"A19 Pro\""                     should be  "A19 Pro"
--   stored  "\"6.3\\\"\""                     should be  "6.3\""
--   stored  "\"1/1.3\\\", 13.5 stops...\""    should be  "1/1.3\", 13.5 stops..."
--
-- MEASURED BASELINE, immediately before writing this (production):
--   total rows          582
--   string              495
--   number               79
--   boolean               8
--   double-encoded       98   across 22 products
--   numeric-looking STRINGS that must stay strings: 16  ('51200', '25600', '1099'…)
--
-- After this runs, the type distribution must be IDENTICAL — 495/79/8 — with
-- zero double-encoded rows. Unwrapping a JSON string yields a JSON string; if
-- any count moved, something was retyped and the migration is wrong. That is
-- asserted below and rolls back.
--
-- THE '256' PROBLEM
-- -----------------
-- A value stored as the jsonb string "256" must NOT become the number 256.
-- Retyping it changes its meaning, and this catalogue really does hold values
-- like '51200' (an ISO setting) and '1099' (a price) as strings.
--
-- Two independent protections:
--   1. The candidate must LOOK double-encoded — its extracted text must both
--      start and end with a double quote. The text of a plain "256" is 256,
--      which does not, so it is never a candidate in the first place.
--   2. Even for a candidate, the re-parsed value must be jsonb_typeof =
--      'string'. A row whose inner text parsed to a number, object, array or
--      boolean is skipped and counted, never written.
--
-- Malformed inner text is handled per row, not per statement: one bad value
-- cannot abort the batch or corrupt a neighbour.
--
-- The display layer (src/lib/public/spec-value.ts) already unwraps these at
-- render time, so the public pages are correct with or without this. Both are
-- wanted: this makes the STORED data mean what it says, for search, export, the
-- comparison builder and every future consumer that reads the column directly.

do $$
declare
  v_before_total    integer;
  v_before_string   integer;
  v_before_number   integer;
  v_before_boolean  integer;
  v_before_double   integer;
  v_after_total     integer;
  v_after_string    integer;
  v_after_number    integer;
  v_after_boolean   integer;
  v_after_double    integer;
  v_changed         integer := 0;
  v_skipped_type    integer := 0;
  v_skipped_parse   integer := 0;
  r                 record;
  v_inner           jsonb;
begin
  -- ---------------------------------------------------------------------
  -- BEFORE
  -- ---------------------------------------------------------------------
  select count(*),
         count(*) filter (where jsonb_typeof(value) = 'string'),
         count(*) filter (where jsonb_typeof(value) = 'number'),
         count(*) filter (where jsonb_typeof(value) = 'boolean')
    into v_before_total, v_before_string, v_before_number, v_before_boolean
    from public.product_specs;

  select count(*)
    into v_before_double
    from public.product_specs
   where jsonb_typeof(value) = 'string'
     and left(ltrim(value #>> '{}'), 1) = '"'
     and right(rtrim(value #>> '{}'), 1) = '"';

  raise notice 'BEFORE  total=% string=% number=% boolean=% double_encoded=%',
    v_before_total, v_before_string, v_before_number, v_before_boolean, v_before_double;

  -- ---------------------------------------------------------------------
  -- REWRITE, one row at a time so a single malformed value cannot abort the
  -- batch or leave the table half-converted.
  -- ---------------------------------------------------------------------
  for r in
    select id, value
      from public.product_specs
     where jsonb_typeof(value) = 'string'
       and left(ltrim(value #>> '{}'), 1) = '"'
       and right(rtrim(value #>> '{}'), 1) = '"'
  loop
    begin
      v_inner := (r.value #>> '{}')::jsonb;
    exception when others then
      -- Inner text is not valid JSON after all. Leave the row exactly as it is.
      v_skipped_parse := v_skipped_parse + 1;
      continue;
    end;

    -- PROTECTION 2. Only ever write back a STRING. This is what stops "256"
    -- becoming 256, and what stops an object or array being introduced.
    if jsonb_typeof(v_inner) is distinct from 'string' then
      v_skipped_type := v_skipped_type + 1;
      continue;
    end if;

    update public.product_specs set value = v_inner where id = r.id;
    v_changed := v_changed + 1;
  end loop;

  -- ---------------------------------------------------------------------
  -- AFTER — and refuse to commit if anything looks wrong.
  -- ---------------------------------------------------------------------
  select count(*),
         count(*) filter (where jsonb_typeof(value) = 'string'),
         count(*) filter (where jsonb_typeof(value) = 'number'),
         count(*) filter (where jsonb_typeof(value) = 'boolean')
    into v_after_total, v_after_string, v_after_number, v_after_boolean
    from public.product_specs;

  select count(*)
    into v_after_double
    from public.product_specs
   where jsonb_typeof(value) = 'string'
     and left(ltrim(value #>> '{}'), 1) = '"'
     and right(rtrim(value #>> '{}'), 1) = '"';

  raise notice 'AFTER   total=% string=% number=% boolean=% double_encoded=%',
    v_after_total, v_after_string, v_after_number, v_after_boolean, v_after_double;
  raise notice 'CHANGED % row(s); skipped % (inner not a string), % (inner not valid JSON)',
    v_changed, v_skipped_type, v_skipped_parse;

  if v_after_total <> v_before_total then
    raise exception 'ROLLED BACK: row count changed (% -> %). This is a rewrite, not a delete.',
      v_before_total, v_after_total;
  end if;

  -- The central assertion. Unwrapping a JSON string yields a JSON string, so
  -- every type count must be untouched. A single value retyped to a number
  -- would move both `string` and `number` and stop the migration here.
  if v_after_string <> v_before_string
     or v_after_number <> v_before_number
     or v_after_boolean <> v_before_boolean then
    raise exception 'ROLLED BACK: value TYPES changed. string %->%, number %->%, boolean %->%. Something was retyped.',
      v_before_string, v_after_string, v_before_number, v_after_number,
      v_before_boolean, v_after_boolean;
  end if;

  if v_after_double <> 0 then
    raise exception 'ROLLED BACK: % double-encoded row(s) still present after the rewrite.', v_after_double;
  end if;

  raise notice 'OK — % rows normalised, type distribution unchanged, 0 double-encoded remain.', v_changed;
end $$;

-- ---------------------------------------------------------------------------
-- INDEPENDENT CONFIRMATION
-- ---------------------------------------------------------------------------
-- The DO block above checks itself, but a migration marking its own homework is
-- still a migration marking its own homework. Run this separately afterwards;
-- it is a plain SELECT and changes nothing.
--
--   select jsonb_typeof(value) as kind,
--          count(*) as rows,
--          count(*) filter (
--            where jsonb_typeof(value) = 'string'
--              and left(ltrim(value #>> '{}'), 1) = '"'
--              and right(rtrim(value #>> '{}'), 1) = '"'
--          ) as still_double_encoded
--     from public.product_specs
--    group by 1
--    order by 2 desc;
--
--   -- expect exactly:  string 495 / 0,  number 79 / 0,  boolean 8 / 0
--
-- And spot-check that a numeric-looking string is still a string:
--
--   select value, jsonb_typeof(value)
--     from public.product_specs
--    where value #>> '{}' in ('51200', '25600', '1099')
--    limit 5;
--   -- expect: jsonb_typeof = 'string' on every row. If any says 'number',
--   --         an ISO setting or a price has been silently retyped.
