-- STATUS 2026-08-22: APPLIED IN PRODUCTION.
-- Verified BEHAVIOURALLY (probed as `anon` against production), not from this
-- filename and not from an SQL-editor result message. Both have been wrong in
-- this project before: a migration once reported "Success" without applying,
-- and these headers said NOT APPLIED while the functions were live -- which
-- cost real time during the 2026-08-22 security audit.
-- ============================================================================
-- (An earlier revision of this header claimed it was not applied. It is.)
-- ============================================================================
-- Drafted, not run. Move into migrations/ only once it has actually executed.
--
-- WHAT THIS IS FOR
-- ----------------
-- An audit on 2026-08-22 found that of 81 published articles, 49 led with a
-- generated title card and 29 with a data graphic — only 3 showed real
-- imagery. A reader arriving at an article about the PS5 saw a styled card
-- reading "Gaming" rather than a PlayStation.
--
-- Fixing those by hand fixes today. This is the standing check: every engine
-- pass classifies each published page's hero against the media hierarchy in
-- src/lib/media/hierarchy.ts and records the ones where a better tier is
-- realistically obtainable, so weak heroes surface continuously in the admin
-- Media Requirements surface instead of accumulating unnoticed.
--
-- WHY AN RPC
-- ----------
-- Engine jobs run as `anon` (a Vercel Cron request carries no cookies — see
-- src/lib/engine/cron.ts) and media_requirements is admin-only under RLS,
-- which denies by returning ZERO ROWS rather than an error. A direct insert
-- from the job would silently affect nothing, forever, with nothing in the
-- logs. Every engine write in this project goes through a narrow SECURITY
-- DEFINER function for exactly that reason.
--
-- WHAT IT DELIBERATELY DOES NOT DO
-- --------------------------------
--   * It never unpublishes anything. A weak hero is a quality issue, not a
--     rights or safety issue, and the page stays live.
--   * It never touches an EXISTING requirement row. A product genuinely
--     blocked on having no photograph at all must not be overwritten with
--     "has a photo, wants a better one" — those are different problems and
--     the first is more urgent.
--   * sourcing_status is 'sourcing', never 'needed'. 'needed' means there is
--     no usable media; here there IS media and we are looking for better.
--     Collapsing the two would make the blocked-product count meaningless.

create or replace function public.engine_flag_weak_hero(
  p_content_id uuid,
  p_product_id uuid,
  p_tier text,
  p_reason text
)
returns text
language plpgsql
security definer
set search_path = public
as $fn$
declare
  v_existing uuid;
begin
  -- Exactly one target, mirroring media_requirements' own check constraint.
  if (p_content_id is null) = (p_product_id is null) then
    return 'rejected_invalid';
  end if;

  -- Only the tiers that represent a substitute for showing the subject. A
  -- caller asking us to flag real imagery is confused, and honouring it would
  -- fill the queue with pages that are already correct.
  if p_tier not in ('generic_graphic', 'data_graphic', 'original_render', 'missing') then
    return 'rejected_invalid';
  end if;

  select id into v_existing
    from public.media_requirements
   where (p_content_id is not null and content_id = p_content_id)
      or (p_product_id is not null and product_id = p_product_id)
   limit 1;

  -- Never overwrite. A row already here is either a real block or an earlier
  -- flag; both are more informative than replacing them with this one.
  if v_existing is not null then
    return 'already_tracked';
  end if;

  insert into public.media_requirements (content_id, product_id, sourcing_status, notes)
  values (
    p_content_id,
    p_product_id,
    'sourcing',
    left('Hero-media upgrade candidate (' || p_tier || '). ' || coalesce(p_reason, ''), 2000)
  );

  return 'created';
end;
$fn$;

revoke execute on function public.engine_flag_weak_hero(uuid, uuid, text, text) from public;
grant execute on function public.engine_flag_weak_hero(uuid, uuid, text, text) to anon, authenticated;

comment on function public.engine_flag_weak_hero(uuid, uuid, text, text) is
  'Records a published page whose hero image substitutes a graphic for imagery of the subject. Never unpublishes, never overwrites an existing requirement, and uses sourcing_status=''sourcing'' so it stays distinguishable from genuinely blocked media.';
