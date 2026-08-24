-- THE RESEARCH STAGE'S WRITE PATH
--
-- NOT YET APPLIED. Lives in migrations_pending/ deliberately.
--
-- WHY IT IS NEEDED
-- ----------------
-- `engine_upsert_discovery` writes exactly one evidence row — the feed item's
-- own URL — and there has never been a way to add a second. That is layer 2 of
-- the corroboration diagnosis: even when the research stage FINDS three other
-- publications covering a story, it has nothing to call to record them.
--
-- Engine jobs run as `anon` (a Vercel Cron request carries no cookies), so a
-- direct INSERT is refused by RLS. This adds the one narrow SECURITY DEFINER
-- function that lets research attach corroborating evidence, and nothing else.
--
-- WHAT IT DELIBERATELY CANNOT DO
-- ------------------------------
-- It cannot create a discovery, change a discovery's claim status, alter
-- confidence, or touch anything outside engine_discovery_evidence. The
-- structural rule that the engine cannot publish is untouched: there is still
-- no function it can call that sets content_items.status or
-- products.is_published.
--
-- It also refuses to record evidence for a discovery that does not exist,
-- rather than silently inserting an orphan row.
--
-- ON `originates_from_url`
-- -----------------------
-- This is the column confidence.ts already uses to refuse corroboration credit
-- to a derivative report. The research stage populates it from lineage.ts when
-- an article credits another outlet, so "The Verge, citing Bloomberg" is stored
-- AS a derivative rather than as an independent voice. Recording that at write
-- time is what makes the existing independence model work on real data.

create or replace function public.engine_add_evidence(
  p_discovery_id uuid,
  p_url text,
  p_publisher text default null,
  p_claim_status text default 'unverified',
  p_trust_level text default 'secondary',
  p_excerpt text default null,
  p_originates_from_url text default null,
  p_origin_examined boolean default true
)
returns text
language plpgsql
security definer
set search_path = public
as $fn$
declare
  v_exists boolean;
begin
  if not public.engine_flag_enabled('research') then
    return 'rejected_research_disabled';
  end if;

  if p_url is null or length(trim(p_url)) = 0 then
    return 'rejected_missing_url';
  end if;

  select exists(select 1 from public.engine_discoveries where id = p_discovery_id)
    into v_exists;
  if not v_exists then
    -- An orphan evidence row is worse than none: it would be counted by any
    -- aggregate that joins loosely, and belongs to nothing anyone can inspect.
    return 'rejected_unknown_discovery';
  end if;

  insert into public.engine_discovery_evidence (
    discovery_id, url, publisher, claim_status, trust_level,
    excerpt, originates_from_url, origin_examined
  ) values (
    p_discovery_id,
    left(p_url, 1000),
    left(p_publisher, 200),
    coalesce(nullif(p_claim_status, ''), 'unverified'),
    coalesce(nullif(p_trust_level, ''), 'secondary'),
    left(p_excerpt, 2000),
    left(p_originates_from_url, 1000),
    coalesce(p_origin_examined, true)
  )
  on conflict (discovery_id, url) do nothing;

  if found then
    return 'created';
  else
    return 'deduped';
  end if;
end;
$fn$;

revoke execute on function public.engine_add_evidence(uuid, text, text, text, text, text, text, boolean) from public;
grant execute on function public.engine_add_evidence(uuid, text, text, text, text, text, text, boolean) to anon, authenticated;

comment on function public.engine_add_evidence is
  'Attach a corroborating source to an existing discovery. The ONLY way the '
  'research stage can record that a second publication covered a story. '
  'Gated on the research flag, refuses unknown discoveries, and cannot touch '
  'anything except engine_discovery_evidence -- in particular it cannot '
  'publish, cannot create discoveries, and cannot alter claim status.';
