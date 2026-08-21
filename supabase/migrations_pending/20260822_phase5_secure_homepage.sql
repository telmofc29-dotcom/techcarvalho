-- ============================================================================
-- Phase 5 security hardening — remove public read on homepage_overrides
-- ============================================================================
--
-- 20260822_phase5_trends_media.sql gave homepage_overrides a public read
-- policy plus an anon grant, because the public homepage renders with the anon
-- key and needs to honour pins and suppressions.
--
-- That was the wrong trade. It exposes administrative editorial intent: a
-- `suppress` row publicly reveals that an admin chose to hide a specific
-- published article from the homepage. The content itself is public, but the
-- decision to demote it is not something visitors should be able to read.
--
-- Fix: revoke public access entirely, and expose ONLY the final computed
-- homepage selection through a SECURITY DEFINER function. Visitors can see
-- which articles are on the homepage — which is self-evident, since they are
-- looking at them — and nothing about how that set was chosen or what was
-- excluded.
--
-- The ranking is reimplemented here in SQL rather than left in TypeScript,
-- because applying overrides on the client side of the boundary would require
-- shipping the override list to the caller, which is precisely what we are
-- closing. Keep this formula in step with src/lib/public/trending.ts.

-- 1. Close the hole.
drop policy if exists "public can read homepage overrides" on public.homepage_overrides;
revoke select on public.homepage_overrides from anon;

-- 2. Expose only the final selection.
--
-- Returns published content only, already ordered, with a role of 'lead' or
-- 'supporting'. Suppressed items are simply absent — indistinguishable from
-- items that merely did not rank, which is the point.
create or replace function public.public_homepage_selection(p_supporting integer default 4)
returns table (
  content_id uuid,
  slug text,
  title text,
  content_type text,
  category_slug text,
  published_at timestamptz,
  role text
)
language plpgsql
security definer
stable
set search_path = public
as $fn$
declare
  v_supporting integer := least(greatest(coalesce(p_supporting, 4), 1), 8);
begin
  return query
  with published as (
    select ci.id, ci.slug, ci.title, ci.type, ci.published_at, tc.slug as cat
      from public.content_items ci
      left join public.taxonomy_categories tc on tc.id = ci.category_id
     where ci.status = 'published'
       and ci.published_at is not null
       and ci.published_at <= now()
  ),
  -- Mirrors the half-lives in src/lib/public/trending.ts: news decays fast,
  -- evergreen guides decay slowly.
  scored as (
    select p.*,
      power(0.5, extract(epoch from (now() - p.published_at)) / 3600.0 /
        case p.type
          when 'news' then 48.0
          when 'comparison' then 504.0
          when 'review' then 720.0
          else 1080.0
        end) * 70.0
      + least(coalesce((
          select count(*) from public.content_relationships r
           where r.content_id = p.id or r.related_content_id = p.id
        ), 0)::numeric / 5.0, 1.0) * 22.0
      + case when exists (
          select 1 from public.content_media cm
            join public.media_assets ma on ma.id = cm.media_id
           where cm.content_id = p.id and cm.role = 'hero'
             and ma.publication_status = 'published'
        ) then 8.0 else 0.0 end as score
    from published p
  ),
  -- Overrides are read here, inside the security barrier, and never returned.
  ov as (select o.content_id, o.mode from public.homepage_overrides o),
  eligible as (
    select s.* from scored s
     where not exists (select 1 from ov where ov.content_id = s.id and ov.mode = 'suppress')
  ),
  lead_pick as (
    select e.*, 0 as rank_group
      from eligible e
     where exists (select 1 from ov where ov.content_id = e.id and ov.mode = 'pin_lead')
     order by e.score desc
     limit 1
  ),
  lead_fallback as (
    select e.*, 0 as rank_group
      from eligible e
     where not exists (select 1 from lead_pick)
     order by e.score desc
     limit 1
  ),
  the_lead as (
    select * from lead_pick union all select * from lead_fallback
  ),
  supporting as (
    select e.*,
           case when exists (select 1 from ov where ov.content_id = e.id and ov.mode = 'pin_supporting')
                then 1 else 2 end as rank_group
      from eligible e
     where e.id not in (select id from the_lead)
     order by rank_group asc, e.score desc
     limit v_supporting
  )
  select t.id, t.slug::text, t.title::text, t.type::text, t.cat::text, t.published_at, 'lead'::text
    from the_lead t
  union all
  select s.id, s.slug::text, s.title::text, s.type::text, s.cat::text, s.published_at, 'supporting'::text
    from supporting s;
end;
$fn$;

revoke execute on function public.public_homepage_selection(integer) from public;
grant execute on function public.public_homepage_selection(integer) to anon, authenticated;
