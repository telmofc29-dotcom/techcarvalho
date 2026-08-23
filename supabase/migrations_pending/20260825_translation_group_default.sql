-- Fix: new content_items rows cannot be created.
--
-- WHAT BROKE
-- ----------
-- 20260824_translation_model.sql backfilled `translation_group_id = id` for the
-- 81 existing rows and then set the column NOT NULL. The backfill covered every
-- row that existed at the time, so the migration applied cleanly and every
-- schema inspection looks correct.
--
-- Nothing supplies the value for a row created AFTERWARDS. Since the migration
-- was applied, every insert into content_items has failed with:
--
--   23502  null value in column "translation_group_id" violates not-null
--
-- which breaks all three creation paths at once:
--
--   * createContentItem  — the admin "new article" form
--   * scripts/ingest-content.ts
--   * engine_promote_draft — the SECURITY DEFINER RPC that turns an approved
--     engine draft into a content row
--
-- Found by scripts/verify-provenance-i18n.ts, which could not create a throwaway
-- draft to test the revision trigger on. The failure was NOT visible from the
-- schema: a NOT NULL column with a completed backfill reads as correct.
--
-- WHY A TRIGGER AND NOT A COLUMN DEFAULT
-- --------------------------------------
-- `default` cannot reference another column of the row being inserted, so
-- `default id` is not expressible. A BEFORE INSERT trigger is the only way to
-- say "your own id, unless you were told otherwise".
--
-- WHY NOT DROP THE NOT NULL
-- -------------------------
-- Because nullable is the wrong shape. A content row with no translation group
-- is invisible to content_translation_status() and to every locale-scoped
-- query — it would silently drop out of the coverage report rather than fail.
-- The constraint is right; what was missing is the value.

-- ---------------------------------------------------------------------------
-- 1. Give every new row its own family by default
-- ---------------------------------------------------------------------------

create or replace function public.default_translation_group()
returns trigger
language plpgsql
as $fn$
begin
  -- An explicit group wins: that is how a translation joins its source's
  -- family. Only an unsupplied group falls back to self-rooting.
  if new.translation_group_id is null then
    -- A source-language row is the root of its own family.
    -- A translation inherits the family of the row it came from, so a caller
    -- that names source_content_id does not also have to know the group.
    if new.source_content_id is not null then
      select c.translation_group_id
        into new.translation_group_id
        from public.content_items c
       where c.id = new.source_content_id;
    end if;

    -- Still null: either no source was named (a source-language row) or the
    -- named source does not exist, in which case the FK will reject the row
    -- anyway and self-rooting keeps THAT the error the caller sees rather than
    -- a confusing not-null on a column they never heard of.
    if new.translation_group_id is null then
      new.translation_group_id := new.id;
    end if;
  end if;

  return new;
end;
$fn$;

drop trigger if exists content_items_default_group on public.content_items;
create trigger content_items_default_group
  before insert on public.content_items
  for each row execute function public.default_translation_group();

-- ---------------------------------------------------------------------------
-- 2. Verification — run these, do not trust the success message
-- ---------------------------------------------------------------------------
-- The whole reason this migration exists is that the previous one applied
-- cleanly while leaving inserts broken. Checking the trigger EXISTS repeats
-- that mistake; these check that an insert WORKS.
--
--   -- (a) A plain insert now succeeds and self-roots:
--   with made as (
--     insert into public.content_items (type, title, slug, body, status)
--     values ('news', 'group default probe', 'tc-group-default-probe',
--             'probe', 'draft')
--     returning id, translation_group_id, locale
--   )
--   select id = translation_group_id as self_rooted, locale from made;
--   -- expect: self_rooted = true, locale = 'en'
--
--   -- (b) An explicitly supplied group is NOT overwritten:
--   update public.content_items set title = title where false;  -- no-op guard
--   -- (insert a second row naming the first row's group and confirm it kept it)
--
--   -- (c) Clean up:
--   delete from public.content_items where slug like 'tc-group-default-probe%';
--
--   -- (d) No row escaped the constraint:
--   select count(*) from public.content_items where translation_group_id is null;
--   -- expect: 0
