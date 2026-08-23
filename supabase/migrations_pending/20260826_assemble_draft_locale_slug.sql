-- engine_assemble_draft's duplicate-slug guard does not understand locales.
--
-- WHAT IS WRONG
-- -------------
-- 20260824_translation_model.sql dropped the global unique constraint on
-- content_items.slug and replaced it with a unique index on (locale, slug),
-- deliberately, so a Portuguese article can carry its own slug independently of
-- the English namespace.
--
-- engine_assemble_draft still asks:
--
--     if exists (select 1 from public.content_items where slug = p_slug)
--
-- with no locale filter. So once ANY translation exists, its slug is treated as
-- occupied for English too, and the engine refuses to create a legitimate
-- English article with 'duplicate_slug'.
--
-- The failure direction is safe — it over-rejects rather than over-writes — but
-- it is silent. The engine would simply stop being able to create certain
-- articles, reporting a duplicate that a human looking at the English corpus
-- could not find.
--
-- VERIFIED BEHAVIOURALLY, not inferred (scripts/verify-engine-assemble.ts):
--   * a Portuguese row was created with slug X
--   * an approved brief asked the engine to assemble an ENGLISH article at X
--   * result: 'duplicate_slug'  <- wrong; the English namespace was free
--   * a genuine English collision correctly returned 'duplicate_slug'
--
-- This cannot fire today, because there are zero translations. It fires the
-- moment the first one is created — which is the next thing planned. Hence
-- fixing it before, not after.
--
-- WHY THE WHOLE FUNCTION IS REPLACED
-- ----------------------------------
-- Postgres has no way to patch one line of a function body. The body below is
-- taken verbatim from 20260822_engine_rpc_least_privilege.sql, which was
-- confirmed to be the LIVE definition behaviourally — it is the only one of the
-- three historical definitions that returns 'rejected_unknown_brief', and that
-- is exactly what production returned when probed. Every brief-approval guard
-- it added is preserved below unchanged. The ONLY difference is the two added
-- words `and locale = 'en'`.
--
-- (This project has previously shipped a migration that silently narrowed a
-- guard list while "just" replacing a function. The verification block at the
-- foot re-checks every guard, not only the one being changed.)

create or replace function public.engine_assemble_draft(
  p_brief_id uuid,
  p_title text,
  p_slug text,
  p_body text,
  p_content_type text,
  p_category_slug text,
  p_search_intent text,
  p_primary_query text,
  p_source_urls text[],
  p_meta_title text default null,
  p_meta_description text default null
)
returns text
language plpgsql
security definer
set search_path = public
as $fn$
declare
  v_category uuid;
  v_content uuid;
  v_url text;
  v_brief record;
begin
  if p_title is null or p_slug is null or p_body is null then
    return 'rejected_invalid';
  end if;
  if p_content_type not in ('review', 'guide', 'comparison', 'news', 'troubleshooting') then
    return 'rejected_invalid';
  end if;

  -- Nothing is created without a real, approved, unassembled brief. Human
  -- approval is the gate on assembly; it must be enforced HERE, in the write,
  -- not only in the query that feeds the job. UNCHANGED.
  select id, review_state, assembled_content_id, state
    into v_brief
    from public.engine_briefs
   where id = p_brief_id;

  if not found then
    return 'rejected_unknown_brief';
  end if;
  if v_brief.review_state is distinct from 'approved' then
    return 'rejected_brief_not_approved';
  end if;
  if v_brief.assembled_content_id is not null then
    return 'rejected_already_assembled';
  end if;
  if v_brief.state in ('rejected', 'published') then
    return 'rejected_brief_closed';
  end if;

  -- THE FIX, and the only change in this file.
  --
  -- The engine only ever creates English source articles (the insert below has
  -- no locale column, so the row takes the 'en' default), so the collision it
  -- must check for is an English one. A Portuguese or Spanish row holding this
  -- slug does not occupy the English namespace — the unique index is
  -- (locale, slug) — and treating it as though it did makes the engine refuse
  -- work it should do.
  if exists (
    select 1 from public.content_items
     where slug = p_slug
       and locale = 'en'
  ) then
    return 'duplicate_slug';
  end if;

  select id into v_category from public.taxonomy_categories where slug = p_category_slug;

  insert into public.content_items (type, title, slug, body, status, category_id, search_intent, primary_query)
  values (p_content_type, left(p_title, 300), left(p_slug, 200), p_body,
          'draft',  -- never anything else
          v_category, nullif(p_search_intent, ''), left(p_primary_query, 200))
  returning id into v_content;

  foreach v_url in array coalesce(p_source_urls, '{}') loop
    insert into public.source_records (content_id, url, publisher, reliability_tier, retrieved_at)
    values (v_content, left(v_url, 1000), null, 'secondary', now())
    on conflict do nothing;
  end loop;

  if p_meta_title is not null or p_meta_description is not null then
    insert into public.seo_metadata (content_id, meta_title, meta_description)
    values (v_content, left(p_meta_title, 200), left(p_meta_description, 300))
    on conflict (content_id) do nothing;
  end if;

  insert into public.media_requirements (content_id, sourcing_status, notes)
  values (v_content, 'needed', 'Auto-created for an engine-assembled draft. Media required before publication.')
  on conflict do nothing;

  update public.engine_briefs
     set assembled_content_id = v_content,
         assembled_at = now(),
         state = 'drafting',
         updated_at = now()
   where id = p_brief_id;

  return v_content::text;
end;
$fn$;

-- Grants are unchanged by CREATE OR REPLACE, but restated so this file is
-- self-contained and a future reader does not have to go looking.
revoke all on function public.engine_assemble_draft(uuid, text, text, text, text, text, text, text, text[], text, text) from public;
grant execute on function public.engine_assemble_draft(uuid, text, text, text, text, text, text, text, text[], text, text) to anon, authenticated;

-- ---------------------------------------------------------------------------
-- VERIFICATION
-- ---------------------------------------------------------------------------
-- Run, do not read. There is nothing to uncomment in this file — but the guard
-- behaviours cannot be asserted in SQL without creating briefs and content, so
-- they are checked by a script instead:
--
--     npx tsx scripts/verify-engine-assemble.ts
--
-- It creates a real approved brief, drives the function all the way through,
-- asserts the row is self-rooted / English / draft, proves a Portuguese slug no
-- longer blocks an English one, proves a GENUINE English collision is still
-- refused, and deletes everything it made. Expect 6/6.
--
-- A quick schema-level sanity check, if you want one in the editor:
--
--   select count(*) as overloads
--     from pg_proc where proname = 'engine_assemble_draft';
--   -- expect: 1. More than one means CREATE OR REPLACE created a second
--   --         signature instead of replacing the first, and every existing
--   --         caller is now ambiguous.
