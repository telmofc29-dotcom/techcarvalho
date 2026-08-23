-- Attribute the existing articles to the publisher. THE OWNER'S DECISION.
--
-- NOT APPLIED, and unlike its two companions this one is not merely
-- "not applied yet" — it is not mine to decide. Read the paragraph below
-- before running it.
--
-- WHAT RUNNING THIS FILE CLAIMS
-- -----------------------------
-- It sets content_items.author_id on every row that has none, which makes
-- every article on the site render "By Telmo Carvalho" and emit
-- author: { "@type": "Person", name: "Telmo Carvalho" } in its structured
-- data. That is a public statement of authorship over 81 published pieces.
--
-- Why it was not run for you: /editorial-policy states that "Research and
-- drafting are assisted by automated systems" and that "a person reviews and
-- publishes every piece". Those two sentences together make "edited and
-- published by" unarguable and make "written by" a judgement only the person
-- who did the work can make. An agent cannot check who wrote 81 articles, so
-- it did not assert it. The mechanism is built and verified
-- (20260825_author_profiles.sql); this is the one statement left for you.
--
-- If the answer is yes — you are the author of these pieces in the sense your
-- own editorial policy describes — run this file. If the answer is "some of
-- them", edit the WHERE clause; it is written so that narrowing it is a
-- one-line change. If the answer is no, delete this file and leave the byline
-- unrendered: no byline is honest, and a wrong byline is not.
--
-- REVERSING IT
-- ------------
--   update public.content_items set author_id = null where author_id is not null;
-- Reversible in the database, NOT reversible in a search index or an archive
-- that has already crawled the page.

do $backfill$
declare
  v_author uuid;
  v_updated integer;
  v_remaining integer;
begin
  -- The author must be a real, published editorial identity. If
  -- 20260825_author_profiles.sql has not been run, or the profile is still
  -- private, this stops here rather than writing an author_id that resolves to
  -- nothing readable and therefore renders no byline while claiming one in the
  -- database.
  select id into v_author from public.author_profiles where is_public order by created_at limit 1;
  if v_author is null then
    raise exception
      'No published author_profiles row exists. Run 20260825_author_profiles.sql first; without it this backfill would set an author_id that no reader can resolve.';
  end if;

  if (select count(*) from public.author_profiles where is_public) <> 1 then
    raise exception
      'More than one published author profile exists. Which one wrote these articles is not a question this file can answer — set author_id per row instead.';
  end if;

  -- Narrow HERE if only some pieces are yours. e.g. add
  --   and type in ('guide', 'comparison')
  -- or
  --   and published_at >= '2026-08-22'
  update public.content_items
  set author_id = v_author
  where author_id is null;
  get diagnostics v_updated = row_count;

  select count(*) into v_remaining from public.content_items where author_id is null;

  -- Zero updated means the WHERE clause matched nothing — a silent no-op is
  -- the one outcome that must not look like success.
  if v_updated = 0 then
    raise exception 'Backfill matched no rows. Nothing was attributed; check the WHERE clause.';
  end if;

  -- Not an error: narrowing the WHERE clause deliberately leaves rows
  -- unattributed, and those simply render no byline.
  raise notice 'Attributed % content rows to author_profiles %. % rows still have no author_id and will render no byline.',
    v_updated, v_author, v_remaining;
end
$backfill$;
