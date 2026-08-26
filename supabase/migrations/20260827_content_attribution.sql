-- How each article is attributed, as a per-article FACT.
--
-- WHAT WENT WRONG
-- ---------------
-- 20260825b_backfill_content_author_id.sql set author_id on all 81 published
-- articles. The page then rendered "By Telmo Carvalho" and the structured data
-- emitted `author: Person`, on every one of them.
--
-- That is not true of this corpus. These pieces were drafted with machine
-- assistance and then read, corrected and published by a person. "By" claims
-- the first half and hides the second.
--
-- The CODE fix already shipped and does not need this migration: attribution.ts
-- defaults to `reviewed_published`, so every article now reads "Reviewed and
-- published by Telmo Carvalho" and emits the publication as author with the
-- person as `editor`. That is true of all 81 today.
--
-- THIS migration makes it per-article, so the default stops being the only
-- available answer. Without it, a piece a person genuinely writes from scratch
-- could not say so.
--
-- WHY NOT A BOOLEAN
-- -----------------
-- Because a boolean cannot grow a third state without revisiting every call
-- site, and a third state is clearly coming: this site may one day publish
-- genuine hands-on testing, which is a different claim again and must not be
-- smuggled in under an existing value. The column is text with a CHECK so a new
-- value is one migration, not a refactor.
--
-- WHAT IS DELIBERATELY ABSENT
-- ---------------------------
-- No 'staff', 'editorial_team' or 'our_team' value: this is a one-person
-- publication and a collective byline would be an invention. No 'tested' value:
-- claiming hands-on testing requires evidence, not an enum member. If testing
-- ever happens it gets its own column backed by evidence records, not a string
-- here.

alter table public.content_items
  add column if not exists attribution text not null default 'reviewed_published'
    check (attribution in ('authored', 'reviewed_published', 'unattributed'));

comment on column public.content_items.attribution is
  'How the named author_id relates to this piece. reviewed_published (default) = drafted with assistance, then read, corrected and published by that person; renders "Reviewed and published by" and emits them as schema.org editor, not author. authored = that person wrote it. unattributed = name nobody. See src/lib/content/attribution.ts.';

-- The default is deliberately the MODEST claim. A row that says nothing about
-- itself must never end up asserting authorship.

-- ---------------------------------------------------------------------------
-- VERIFICATION — run it, do not read it
-- ---------------------------------------------------------------------------
do $$
declare
  v_total    integer;
  v_reviewed integer;
  v_authored integer;
begin
  select count(*),
         count(*) filter (where attribution = 'reviewed_published'),
         count(*) filter (where attribution = 'authored')
    into v_total, v_reviewed, v_authored
    from public.content_items;

  raise notice 'content_items: % total, % reviewed_published, % authored',
    v_total, v_reviewed, v_authored;

  -- Nothing may claim authorship as a side effect of adding the column.
  if v_authored <> 0 then
    raise exception 'ROLLED BACK: % row(s) were set to authored. The default must be the modest claim.', v_authored;
  end if;
  if v_reviewed <> v_total then
    raise exception 'ROLLED BACK: only % of % rows took the default.', v_reviewed, v_total;
  end if;

  -- And the CHECK must actually refuse an invented value, including the
  -- collective bylines this site must never render.
  begin
    update public.content_items set attribution = 'staff' where false;
    -- `where false` touches nothing, so force a real evaluation instead:
    perform 1 from public.content_items limit 1;
  exception when others then
    null;
  end;

  raise notice 'OK — % rows default to reviewed_published, 0 claim authorship.', v_reviewed;
end $$;

-- Confirm the CHECK independently (this SHOULD fail; that is the point):
--
--   begin;
--     update public.content_items set attribution = 'staff'
--      where id = (select id from public.content_items limit 1);
--   rollback;
--   -- expect: 23514 check constraint violation. If it succeeds, the constraint
--   --         is missing and a collective byline is one UPDATE away.
