-- One explicit card image per product, one per article — enforced by the database.
--
-- WHY
-- ---
-- 20260824_one_hero_per_target.sql made the hero slot exclusive. The card /
-- thumbnail slot is exclusive in exactly the same way — "explicit thumbnail ->
-- hero -> fallback" only means anything if there is at most ONE explicit
-- thumbnail — and it was left unconstrained.
--
-- Proven by probe on 2026-08-24: inserting a second thumbnail row for the same
-- article was ACCEPTED. The application refuses it and asks the owner to choose
-- (Replace / Keep / Cancel), so the admin path is safe, but a script, an import
-- or a manual SQL fix could still produce two — and resolveCardImage() would
-- then pick one of them by sort order, which is precisely the arbitrary
-- behaviour the one-hero work existed to remove.
--
-- PARTIAL, on purpose. Only hero and thumbnail are exclusive. Galleries are
-- meant to hold many assets and are untouched.
--
-- NOTE: one asset may still hold hero AND thumbnail AND gallery on the same
-- target. That is deliberate and unaffected here: the base unique key is on the
-- TRIPLE (target, media, role), and these indexes constrain the SLOT, not the
-- pairing.

-- ---------------------------------------------------------------------------
-- PRE-FLIGHT: refuse to run while a target still has two card images
-- ---------------------------------------------------------------------------
do $$
declare
  v_products integer;
  v_content  integer;
  v_detail   text;
begin
  select count(*) into v_products from (
    select product_id from public.product_media where role = 'thumbnail'
    group by product_id having count(*) > 1
  ) t;

  select count(*) into v_content from (
    select content_id from public.content_media where role = 'thumbnail'
    group by content_id having count(*) > 1
  ) t;

  if v_products > 0 or v_content > 0 then
    select string_agg(line, E'\n') into v_detail from (
      select 'product ' || product_id::text || ' has ' || count(*)::text || ' card images' as line
        from public.product_media where role = 'thumbnail'
        group by product_id having count(*) > 1
      union all
      select 'article ' || content_id::text || ' has ' || count(*)::text || ' card images' as line
        from public.content_media where role = 'thumbnail'
        group by content_id having count(*) > 1
    ) d;

    raise exception E'ROLLED BACK: % product(s) and % article(s) have more than one explicit card image.\n%\nDELETE the unwanted thumbnail ROW (this removes only the card-image role; the asset and its other slots are untouched), then re-run.',
      v_products, v_content, v_detail;
  end if;

  raise notice 'OK - no target currently has more than one explicit card image.';
end $$;

-- ---------------------------------------------------------------------------
-- THE CONSTRAINT
-- ---------------------------------------------------------------------------

create unique index if not exists product_media_one_thumbnail_per_product
  on public.product_media (product_id)
  where role = 'thumbnail';

create unique index if not exists content_media_one_thumbnail_per_content
  on public.content_media (content_id)
  where role = 'thumbnail';

comment on index public.product_media_one_thumbnail_per_product is
  'A product has at most one EXPLICIT card image. Cards fall back to the hero when none is set. Galleries are unconstrained, and one asset may still hold hero + thumbnail + gallery simultaneously.';

comment on index public.content_media_one_thumbnail_per_content is
  'An article has at most one EXPLICIT card image. Cards fall back to the hero when none is set.';

-- ---------------------------------------------------------------------------
-- VERIFICATION — runs, rolls back if wrong
-- ---------------------------------------------------------------------------
do $$
declare
  v_product_rows integer;
  v_content_rows integer;
  v_multi_slot   integer;
begin
  select count(*) into v_product_rows from public.product_media;
  select count(*) into v_content_rows from public.content_media;

  if not exists (select 1 from pg_indexes where indexname = 'product_media_one_thumbnail_per_product') then
    raise exception 'ROLLED BACK: product_media_one_thumbnail_per_product was not created.';
  end if;
  if not exists (select 1 from pg_indexes where indexname = 'content_media_one_thumbnail_per_content') then
    raise exception 'ROLLED BACK: content_media_one_thumbnail_per_content was not created.';
  end if;

  -- The multi-slot capability must survive. Count assets holding more than one
  -- role on the same target; adding a SLOT constraint must not reduce it.
  select count(*) into v_multi_slot from (
    select content_id, media_id from public.content_media group by content_id, media_id having count(*) > 1
    union all
    select product_id, media_id from public.product_media group by product_id, media_id having count(*) > 1
  ) m;

  raise notice 'OK - card-image indexes present. product_media=% rows, content_media=% rows, % asset/target pairs still hold multiple slots.',
    v_product_rows, v_content_rows, v_multi_slot;
end $$;

-- Independent confirmation afterwards (plain SELECTs, change nothing):
--
--   select content_id, count(*) from public.content_media
--    where role = 'thumbnail' group by content_id having count(*) > 1;
--   -- expect: 0 rows.
--
--   -- and one asset may STILL hold several slots on one target:
--   select content_id, media_id, count(*) from public.content_media
--    group by content_id, media_id having count(*) > 1;
--   -- expect: rows here are fine and must not be removed.
