-- DAILY SPOTLIGHT ROTATION
--
-- NOT YET APPLIED.
--
-- WHAT IT ADDS
-- ------------
-- One table recording which content held a front-page position on which day,
-- and two functions: one for the engine to record a rotation, one for the
-- public path to read the current one.
--
-- WHY A TABLE AND NOT A COMPUTATION
-- ---------------------------------
-- Rotation needs MEMORY. Without it the engine re-runs the same comparison
-- every night and the same five stories win, which is the entire complaint.
-- "How long since this was on the front page?" and "has this ever had a turn?"
-- cannot be derived from the content itself; they are facts about what the
-- homepage DID, and only a log knows them.
--
-- It also gives daily stability for free. The selection is computed once by the
-- nightly tick and read all day, so a visitor refreshing at noon sees what they
-- saw at breakfast — not because a cache is hiding churn, but because there is
-- nothing to churn.
--
-- WHY THE PUBLIC READ IS A SECURITY DEFINER FUNCTION
-- --------------------------------------------------
-- Same reason as public_homepage_selection: the public site runs as `anon`, and
-- the log should not be a table `anon` can enumerate. The function returns only
-- the current rotation's content, joined to already-public columns.
--
-- WHAT THIS DOES NOT DO
-- ---------------------
-- It does not rank. Scoring stays in public_homepage_selection and
-- src/lib/public/trending.ts. This records decisions; it does not make them.

-- ---------------------------------------------------------------------------
-- 1. The log
-- ---------------------------------------------------------------------------

create table if not exists public.homepage_spotlight_log (
  id uuid primary key default gen_random_uuid(),
  -- The rotation this belongs to. One row per content item per rotation.
  rotation_date date not null,
  content_id uuid not null references public.content_items(id) on delete cascade,
  role text not null check (role in ('lead', 'supporting')),
  -- Position within the role, so a rotation can be replayed in order.
  position integer not null default 0,
  -- The rotation score at selection time. Kept for auditing why a day looked
  -- as it did; never read back into scoring.
  score numeric,
  reasons text[] not null default '{}',
  created_at timestamptz not null default now(),

  -- One appearance per item per day. A re-run of the rotation job must update
  -- rather than duplicate, or "how many times has this been spotlighted"
  -- becomes "how many times did the job run".
  constraint homepage_spotlight_log_unique unique (rotation_date, content_id)
);

create index if not exists homepage_spotlight_log_date_idx
  on public.homepage_spotlight_log (rotation_date desc, role, position);
create index if not exists homepage_spotlight_log_content_idx
  on public.homepage_spotlight_log (content_id, rotation_date desc);

comment on table public.homepage_spotlight_log is
  'Which content held a front-page position on which day. Gives the rotation '
  'engine its memory (last exposure, appearance count, never-spotlighted) and '
  'gives the homepage daily stability, since the selection is computed once by '
  'the nightly tick and read all day.';

alter table public.homepage_spotlight_log enable row level security;

-- Admins read it for the Today panel. Nobody reads it as anon; the public path
-- goes through the SECURITY DEFINER function below.
drop policy if exists homepage_spotlight_log_admin_read on public.homepage_spotlight_log;
create policy homepage_spotlight_log_admin_read
  on public.homepage_spotlight_log for select
  using (public.is_admin());

-- ---------------------------------------------------------------------------
-- 2. Rotation memory, for the engine
-- ---------------------------------------------------------------------------

create or replace function public.homepage_rotation_memory()
returns table (
  content_id uuid,
  last_spotlighted_at date,
  spotlight_count integer
)
language sql
stable
security definer
set search_path = public
as $fn$
  select l.content_id,
         max(l.rotation_date) as last_spotlighted_at,
         count(*)::integer as spotlight_count
    from public.homepage_spotlight_log l
   group by l.content_id;
$fn$;

revoke execute on function public.homepage_rotation_memory() from public;
grant execute on function public.homepage_rotation_memory() to anon, authenticated;

comment on function public.homepage_rotation_memory is
  'Per-content exposure history for the rotation engine: when it was last on '
  'the front page and how many times it has been. Content absent from the '
  'result has never been spotlighted, which is what earns it the fairness bonus.';

-- ---------------------------------------------------------------------------
-- 3. Recording a rotation
-- ---------------------------------------------------------------------------

create or replace function public.homepage_record_spotlight(
  p_rotation_date date,
  p_content_id uuid,
  p_role text,
  p_position integer default 0,
  p_score numeric default null,
  p_reasons text[] default '{}'
)
returns text
language plpgsql
security definer
set search_path = public
as $fn$
begin
  if p_role not in ('lead', 'supporting') then
    return 'rejected_invalid_role';
  end if;

  -- Only PUBLISHED content may be recorded. A draft cannot hold a front-page
  -- position, and recording one would corrupt the exposure history that later
  -- rotations read.
  if not exists (
    select 1 from public.content_items
     where id = p_content_id and status = 'published'
  ) then
    return 'rejected_not_published';
  end if;

  insert into public.homepage_spotlight_log
    (rotation_date, content_id, role, position, score, reasons)
  values
    (p_rotation_date, p_content_id, p_role, coalesce(p_position, 0), p_score, coalesce(p_reasons, '{}'))
  on conflict (rotation_date, content_id) do update
    set role = excluded.role,
        position = excluded.position,
        score = excluded.score,
        reasons = excluded.reasons;

  return 'recorded';
end;
$fn$;

revoke execute on function public.homepage_record_spotlight(date, uuid, text, integer, numeric, text[]) from public;
grant execute on function public.homepage_record_spotlight(date, uuid, text, integer, numeric, text[]) to anon, authenticated;

-- ---------------------------------------------------------------------------
-- 4. The public read
-- ---------------------------------------------------------------------------

create or replace function public.public_spotlight(p_rotation_date date default null)
returns table (
  content_id uuid,
  slug text,
  title text,
  content_type text,
  category_slug text,
  published_at timestamptz,
  role text,
  position integer
)
language sql
stable
security definer
set search_path = public
as $fn$
  -- The most recent recorded rotation at or before the requested date. Using
  -- the latest AVAILABLE rather than requiring an exact match means a missed
  -- nightly run shows yesterday's page rather than an empty one.
  with target as (
    select max(rotation_date) as d
      from public.homepage_spotlight_log
     where rotation_date <= coalesce(p_rotation_date, current_date)
  )
  select l.content_id,
         ci.slug::text,
         ci.title::text,
         ci.type::text,
         tc.slug::text,
         ci.published_at,
         l.role::text,
         l.position
    from public.homepage_spotlight_log l
    join target t on l.rotation_date = t.d
    join public.content_items ci on ci.id = l.content_id
    left join public.taxonomy_categories tc on tc.id = ci.category_id
   where ci.status = 'published'
     and ci.published_at is not null
     and ci.published_at <= now()
     -- An override applied AFTER the rotation was recorded still takes effect,
     -- so suppressing something removes it immediately rather than tomorrow.
     and not exists (
       select 1 from public.homepage_overrides_active o
        where o.content_id = l.content_id and o.mode = 'suppress'
     )
   order by case l.role when 'lead' then 0 else 1 end, l.position, ci.published_at desc;
$fn$;

revoke execute on function public.public_spotlight(date) from public;
grant execute on function public.public_spotlight(date) to anon, authenticated;

comment on function public.public_spotlight is
  'The current front-page rotation. Reads the most recent recorded rotation so '
  'a missed nightly run degrades to yesterday rather than to an empty page, and '
  'honours suppress overrides applied since the rotation was recorded.';

-- ---------------------------------------------------------------------------
-- 5. Repoint the existing selection at the ACTIVE overrides view
-- ---------------------------------------------------------------------------
--
-- 20260824_homepage_override_windows.sql added starts_at/ends_at and the
-- homepage_overrides_active view, but public_homepage_selection still reads the
-- BASE TABLE — so a window is recorded and then ignored, which is worse than
-- not having windows at all. This is the repoint that migration's header said
-- would be needed.
--
-- Only the `ov` CTE changes; the scoring is untouched.

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
  -- CHANGED: the active view, so an expired pin stops applying on its own.
  ov as (select o.content_id, o.mode from public.homepage_overrides_active o),
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

-- ---------------------------------------------------------------------------
-- 6. Self-check
-- ---------------------------------------------------------------------------

do $verify$
declare v_count integer;
begin
  assert public.homepage_record_spotlight(current_date, '00000000-0000-0000-0000-000000000000'::uuid, 'lead')
         = 'rejected_not_published',
         'unknown content must be refused';

  assert (select count(*) from public.homepage_overrides_active) >= 0,
         'homepage_overrides_active must exist -- apply 20260824_homepage_override_windows.sql first';

  select count(*) into v_count from public.public_homepage_selection(4);
  assert v_count >= 0, 'public_homepage_selection must still run after the repoint';

  raise notice 'spotlight rotation: assertions passed, selection returned % rows', v_count;
end
$verify$;
