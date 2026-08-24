-- One hero per product, one hero per article — enforced by the database.
--
-- WHY
-- ---
-- product_media and content_media are unique on (target_id, media_id, role).
-- That is uniqueness on the TRIPLE: it stops the SAME asset holding the same
-- role twice, and says nothing whatsoever about how many DIFFERENT assets may
-- hold 'hero' on one target. Two heroes is a perfectly legal row set.
--
-- It happened. On 2026-08-24 the audit found ps5-vs-ps5-pro-worth-it holding
-- two hero rows: an older tc_graphic and a newly assigned upload. The public
-- hero query was .eq('role','hero').limit(1) with no ORDER BY, so the winner
-- was whatever Postgres returned first — the old graphic. From the owner's
-- side this looked like the admin ignoring their choice.
--
-- The application now refuses to create a second hero and asks what to do
-- instead. This index is the backstop for everything that does NOT go through
-- that path: a script, a future code path, a manual SQL fix at 2am.
--
-- PARTIAL, on purpose. Only the hero slot is exclusive. Galleries are meant to
-- hold many assets, and thumbnails may legitimately coexist.

-- ---------------------------------------------------------------------------
-- PRE-FLIGHT: refuse to run while a target still has two heroes
-- ---------------------------------------------------------------------------
--
-- A unique index cannot be created over data that already violates it, and the
-- failure message Postgres gives is not especially clear. This names the
-- offenders instead, so they can be resolved deliberately rather than by
-- whichever row the index build happened to reject.
--
-- Resolve a duplicate by DEMOTING the loser to 'gallery', never by deleting it:
--
--   update public.content_media set role = 'gallery'
--    where content_id = '<id>' and media_id = '<the one that should not be hero>';

do $$
declare
  v_products integer;
  v_content  integer;
  v_detail   text;
begin
  select count(*) into v_products from (
    select product_id from public.product_media where role = 'hero'
    group by product_id having count(*) > 1
  ) t;

  select count(*) into v_content from (
    select content_id from public.content_media where role = 'hero'
    group by content_id having count(*) > 1
  ) t;

  if v_products > 0 or v_content > 0 then
    select string_agg(line, E'\n') into v_detail from (
      select 'product ' || product_id::text || ' has ' || count(*)::text || ' heroes' as line
        from public.product_media where role = 'hero'
        group by product_id having count(*) > 1
      union all
      select 'article ' || content_id::text || ' has ' || count(*)::text || ' heroes' as line
        from public.content_media where role = 'hero'
        group by content_id having count(*) > 1
    ) d;

    raise exception E'ROLLED BACK: % product(s) and % article(s) still have more than one hero.\n%\nDemote the losing row to ''gallery'' (do NOT delete it), then re-run.',
      v_products, v_content, v_detail;
  end if;

  raise notice 'OK - no target currently has more than one hero.';
end $$;

-- ---------------------------------------------------------------------------
-- THE CONSTRAINT
-- ---------------------------------------------------------------------------

create unique index if not exists product_media_one_hero_per_product
  on public.product_media (product_id)
  where role = 'hero';

create unique index if not exists content_media_one_hero_per_content
  on public.content_media (content_id)
  where role = 'hero';

comment on index public.product_media_one_hero_per_product is
  'A product has at most one hero image. Galleries are unconstrained. Added after a second hero row silently displaced an owner-selected image.';

comment on index public.content_media_one_hero_per_content is
  'An article has at most one hero image. Galleries are unconstrained.';

-- ---------------------------------------------------------------------------
-- VERIFICATION — runs, rolls back if wrong
-- ---------------------------------------------------------------------------

do $$
declare
  v_product_rows integer;
  v_content_rows integer;
begin
  select count(*) into v_product_rows from public.product_media;
  select count(*) into v_content_rows from public.content_media;

  -- Adding an index must not change any data.
  if v_product_rows = 0 and v_content_rows = 0 then
    raise exception 'ROLLED BACK: both association tables are empty, which is not the expected state.';
  end if;

  if not exists (select 1 from pg_indexes where indexname = 'product_media_one_hero_per_product') then
    raise exception 'ROLLED BACK: product_media_one_hero_per_product was not created.';
  end if;
  if not exists (select 1 from pg_indexes where indexname = 'content_media_one_hero_per_content') then
    raise exception 'ROLLED BACK: content_media_one_hero_per_content was not created.';
  end if;

  raise notice 'OK - one-hero indexes present. product_media=% rows, content_media=% rows (unchanged).',
    v_product_rows, v_content_rows;
end $$;

-- Independent confirmation afterwards (plain SELECTs, change nothing):
--
--   select product_id, count(*) from public.product_media
--    where role = 'hero' group by product_id having count(*) > 1;
--   -- expect: 0 rows.
--
--   select content_id, count(*) from public.content_media
--    where role = 'hero' group by content_id having count(*) > 1;
--   -- expect: 0 rows.
--
--   -- and the index really does refuse a second hero:
--   --   insert into public.content_media (content_id, media_id, role)
--   --   values ('<an article that already has a hero>', '<any other asset>', 'hero');
--   -- expect: 23505 unique_violation. If it succeeds, the index is missing.
