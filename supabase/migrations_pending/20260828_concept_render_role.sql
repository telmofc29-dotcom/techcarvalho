-- A role for imagery of things that do not exist yet.
--
-- WHY `ai_generated` IS NOT ENOUGH
-- -------------------------------
-- media_assets already carries `ai_generated`, and it answers a different
-- question. It says an image was machine-made. It does not say the image
-- DEPICTS SOMETHING THAT DOES NOT EXIST.
--
-- An AI-upscaled photograph of a real Canon EOS R5 and an imagined PlayStation
-- 6 are both ai_generated = true. One documents a real object; the other is
-- speculation. Treating them as the same thing is how a concept render ends up
-- on a product page as though it were a photograph, and how it ends up cited
-- for dimensions and port layouts of hardware nobody has seen.
--
-- So the distinction gets a value of its own.
--
-- WHAT THIS UNLOCKS, DELIBERATELY
-- -------------------------------
-- TechCarvalho SHOULD be able to illustrate "PlayStation 6: What We Know So
-- Far" with high-quality original concept art. Refusing all such imagery would
-- leave future-hardware articles with nothing but title cards, which is the
-- problem this whole phase exists to fix. The requirement is not that the
-- imagery be banned — it is that it can never be mistaken for the product.
--
-- WHAT ENFORCES THAT
-- ------------------
-- src/lib/media/classification.ts, which is unit-tested:
--   * classifyMedia() -> 'generated_concept', decided BEFORE ownership or
--     rights are considered, so owning it and verifying it cannot upgrade it.
--   * isDepictionOfRealProduct() -> false. Product pages and galleries ask this.
--   * isUsableAsEvidence() -> false. It supports no factual claim.
--   * requiredDisclosure() -> a mandatory public label, DERIVED not typed,
--     because a caption an editor has to remember is one that will be missing
--     on the page where it mattered.
--   * canTakeRole(asset, 'product_photo') -> refused server-side.

alter table public.media_assets
  drop constraint if exists media_assets_asset_role_check;

alter table public.media_assets
  add constraint media_assets_asset_role_check
  check (asset_role is null or asset_role in (
    'product_photo', 'article_hero', 'banner', 'category_hero', 'homepage_feature',
    'background', 'diagram', 'chart', 'comparison_graphic', 'social_og',
    'logo_brand', 'icon', 'screenshot',
    -- NEW. Imagery of an unreleased or unrevealed product.
    'concept_render'
  ));

comment on column public.media_assets.asset_role is
  'Editorial role. ''concept_render'' means the image depicts something that does not exist or has not been revealed — it can never be product photography or evidence, and always carries a public disclosure. See src/lib/media/classification.ts.';

-- ---------------------------------------------------------------------------
-- VERIFICATION — runs, rolls back if wrong
-- ---------------------------------------------------------------------------
do $$
declare
  v_total   integer;
  v_concept integer;
begin
  select count(*), count(*) filter (where asset_role = 'concept_render')
    into v_total, v_concept
    from public.media_assets;

  -- Nothing may be reclassified by widening a CHECK.
  if v_concept <> 0 then
    raise exception 'ROLLED BACK: % existing assets became concept_render. Widening a CHECK must reclassify nothing.', v_concept;
  end if;

  -- Every existing row must still satisfy the constraint.
  if exists (
    select 1 from public.media_assets
     where asset_role is not null
       and asset_role not in (
         'product_photo','article_hero','banner','category_hero','homepage_feature',
         'background','diagram','chart','comparison_graphic','social_og',
         'logo_brand','icon','screenshot','concept_render')
  ) then
    raise exception 'ROLLED BACK: existing rows fall outside the new CHECK.';
  end if;

  raise notice 'OK — % media assets, 0 reclassified, concept_render now accepted.', v_total;
end $$;

-- Independent confirmation afterwards (plain SELECTs, change nothing):
--
--   select asset_role, count(*) from public.media_assets group by 1 order by 2 desc;
--   -- expect: the SAME distribution as before, with no concept_render row.
--
--   -- and the constraint really does still refuse an invented role:
--   --   update public.media_assets set asset_role = 'definitely_not_a_role'
--   --    where id = (select id from public.media_assets limit 1);
--   -- expect: 23514. If it succeeds, the CHECK was dropped and not re-added.
