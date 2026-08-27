-- Record WHO chose a media slot.
--
-- WHY THE EXISTING SCHEMA CANNOT EXPRESS THIS
-- -------------------------------------------
-- content_media holds (content_id, media_id, role, sort_order). There is no
-- column saying whether a slot was filled by a person or by the engine.
--
-- suggestion-service.ts already documents the consequence and takes the only
-- safe option available: it treats EVERY occupied hero and thumbnail as
-- human-selected, because the alternative is silently overwriting a choice
-- somebody made on purpose.
--
-- That is correct today and it blocks automatic media association entirely.
-- The Phase 5 brief requires both halves of a distinction the table cannot
-- make:
--
--     "Machine-selected media can be reconsidered."
--     "Human-selected media should be protected."
--
-- Without provenance, auto-attaching is self-defeating: the engine's own guess
-- becomes indistinguishable from an editorial decision the moment it is
-- written, and is then protected from ever being reconsidered — including by
-- the re-matching pass that is supposed to improve it when better media
-- arrives. The engine would be permanently locked into its first guess, and
-- the owner would have no way to tell which images they actually chose.
--
-- WHAT THIS ADDS
-- --------------
--   selected_by     uuid  -> the admin who chose it; NULL for engine choices
--   selection_kind  text  -> 'human' | 'engine' | 'unknown'
--   selected_at     timestamptz
--
-- Existing rows become 'unknown', NOT 'human'. That is deliberate: 136 links
-- already exist and nobody can now say which were deliberate. Calling them
-- human would be inventing a fact about the owner's decisions; calling them
-- engine would licence the machine to overwrite images the owner did choose.
-- 'unknown' is the truth, and the matcher treats unknown exactly as it treats
-- human — protected — so applying this migration changes NO current behaviour.
-- It only makes future writes distinguishable.
--
-- WHY NOT A BOOLEAN
-- -----------------
-- Because 'unknown' is a real third state that must not collapse into either
-- answer, and because a future 'imported' or 'migrated' state is plausible.
--
-- NOT YET APPLIED. Nothing writes these columns until it is: PostgREST answers
-- PGRST204 for an unknown column rather than ignoring it, so writing them
-- early would break media association in the admin.

alter table public.content_media
  add column if not exists selected_by uuid references auth.users(id) on delete set null,
  add column if not exists selection_kind text not null default 'unknown',
  add column if not exists selected_at timestamptz;

alter table public.content_media
  drop constraint if exists content_media_selection_kind_check;

alter table public.content_media
  add constraint content_media_selection_kind_check
  check (selection_kind in ('human', 'engine', 'unknown'));

-- A human selection must name the human. An engine selection must not claim
-- one. This is the same shape as engine_briefs.reviewed_by, and for the same
-- reason: a provenance field nothing enforces drifts into decoration.
alter table public.content_media
  drop constraint if exists content_media_human_needs_actor;

alter table public.content_media
  add constraint content_media_human_needs_actor
  check (
    (selection_kind = 'human' and selected_by is not null)
    or (selection_kind <> 'human' and selected_by is null)
  );

comment on column public.content_media.selection_kind is
  'Who filled this slot: human (an admin chose it, selected_by names them), '
  'engine (the matcher attached it and it may be reconsidered), or unknown '
  '(predates provenance tracking; treated as protected, exactly like human).';

-- Same for product media, so the two paths cannot diverge.
alter table public.product_media
  add column if not exists selected_by uuid references auth.users(id) on delete set null,
  add column if not exists selection_kind text not null default 'unknown',
  add column if not exists selected_at timestamptz;

alter table public.product_media
  drop constraint if exists product_media_selection_kind_check;

alter table public.product_media
  add constraint product_media_selection_kind_check
  check (selection_kind in ('human', 'engine', 'unknown'));

alter table public.product_media
  drop constraint if exists product_media_human_needs_actor;

alter table public.product_media
  add constraint product_media_human_needs_actor
  check (
    (selection_kind = 'human' and selected_by is not null)
    or (selection_kind <> 'human' and selected_by is null)
  );

-- ---------------------------------------------------------------------------
-- VERIFICATION — run these, do not read them
-- ---------------------------------------------------------------------------
-- Every existing row should be 'unknown', and therefore still protected:
--   select selection_kind, count(*) from public.content_media group by 1;
--
-- A human selection without an actor must be refused:
--   insert into public.content_media (content_id, media_id, role, selection_kind)
--   values ('<some-content-id>', '<some-media-id>', 'gallery', 'human');
--   -- expected: violates content_media_human_needs_actor
