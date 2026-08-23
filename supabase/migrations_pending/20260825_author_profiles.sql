-- A byline that can only ever name somebody real.
--
-- NOT APPLIED. Lives in migrations_pending/ deliberately — move it to
-- migrations/ only after it has actually been run.
--
-- WHY THIS TABLE EXISTS AT ALL, RATHER THAN OPENING admin_users
-- ------------------------------------------------------------
-- content_items.author_id already references admin_users, and admin_users
-- already has a display_name. The obvious move is to let `anon` read that
-- column and be done. Do not do it. admin_users IS the authorization table:
-- its rows are the answer to "who can write to this database". Making it
-- publicly readable publishes the membership list of the site's admin group
-- and the display name attached to each account, to everyone, forever, as a
-- side effect of wanting a byline. Its RLS policy ("admins can read own row")
-- is load-bearing and stays exactly as it is.
--
-- So: a separate editorial identity, keyed 1:1 to an admin account, that is
-- private by default and becomes public only when somebody deliberately sets
-- is_public. Publishing a person's name is irreversible once it is crawled;
-- the default therefore has to be "not published", the same way media assets
-- default to unpublished in this project and for the same reason.
--
-- WHAT IT DOES NOT CONTAIN
-- ------------------------
-- No credentials column, no qualifications, no years-of-experience, no
-- employment history. short_bio exists and is seeded NULL: a factual line
-- about what the person does on this site is fine and anything resembling a
-- CV is not, and nothing in this migration is in a position to tell the
-- difference — so a human writes it or it stays empty.
--
-- WHAT IT DOES NOT DO
-- -------------------
-- It creates no /authors/[slug] route and no author slug. There is one
-- person; author archive pages would be one more thin URL per person, which
-- is the opposite of what this site needs (see I3/I10 in
-- docs/adsense-readiness-audit.md). The byline is text, not a link to a hub.

create table if not exists public.author_profiles (
  -- 1:1 with an admin account. An author must be somebody who can actually
  -- publish here; there is no freestanding "author" record to invent.
  id uuid primary key references public.admin_users (id) on delete cascade,
  display_name text not null check (char_length(btrim(display_name)) between 2 and 120),
  -- What they do on this site. Not a job title from a CV.
  role_title text check (role_title is null or char_length(role_title) <= 120),
  -- One or two factual sentences, written by a person. Never generated.
  short_bio text check (short_bio is null or char_length(short_bio) <= 400),
  -- FALSE by default, and that default is the whole safety property: a row can
  -- exist, be edited, and be got right before any reader ever sees the name.
  is_public boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

comment on table public.author_profiles is
  'Public editorial identity for an admin account. Separate from admin_users so the admin membership list is never publicly readable. Readable by anon ONLY where is_public = true.';
comment on column public.author_profiles.is_public is
  'Gate on the anon SELECT policy. FALSE means no reader can see this name — publishing a real person''s name is irreversible once crawled, so it is opt-in.';
comment on column public.author_profiles.short_bio is
  'Written by a person. Never a generated or inferred biography, and never credentials, qualifications or years of experience.';

alter table public.author_profiles enable row level security;

-- The only public read, and it is gated on the column, not on the caller.
drop policy if exists "public can read published author profiles" on public.author_profiles;
create policy "public can read published author profiles" on public.author_profiles
  for select to anon, authenticated using (is_public);

drop policy if exists "admins can read all author profiles" on public.author_profiles;
create policy "admins can read all author profiles" on public.author_profiles
  for select to authenticated using (public.is_admin());

drop policy if exists "admins can write author profiles" on public.author_profiles;
create policy "admins can write author profiles" on public.author_profiles
  for all to authenticated using (public.is_admin()) with check (public.is_admin());

-- RLS restricts; it never grants. See
-- 20260821_first_party_analytics_grants_fix.sql for the incident that taught
-- this project the difference.
revoke all on public.author_profiles from public;
grant select on public.author_profiles to anon, authenticated;
grant insert, update, delete on public.author_profiles to authenticated;

-- ---------------------------------------------------------------------------
-- Seed: the site's publisher.
--
-- The name is the literal 'Telmo Carvalho' rather than admin_users.display_name
-- on purpose. PUBLISHER_NAME in src/lib/seo/publisher.ts is the single source
-- of truth that /about, the footer and the JSON-LD all read from, and a byline
-- reading "Telmo" beside an About page reading "Telmo Carvalho" is exactly the
-- drift that file exists to prevent. If the two ever need to differ, change
-- both together and know that you are doing it.
--
-- Guarded to a single-admin installation. With two or more admin_users rows
-- there is no way for SQL to know which one is the publisher, and guessing
-- would attribute a publication to a person. The verification below aborts
-- rather than proceeding on a guess.
--
-- is_public is TRUE here because this same name is being published on /about
-- and in the footer in the same change — the profile is not a new disclosure,
-- it is the same one made byline-shaped. It still renders NOTHING on its own:
-- every content_items.author_id is NULL, so no article carries a byline until
-- somebody sets one (see 20260825b_backfill_content_author_id.sql).
-- ---------------------------------------------------------------------------
insert into public.author_profiles (id, display_name, role_title, short_bio, is_public)
select u.id, 'Telmo Carvalho', 'Editor and publisher', null, true
from public.admin_users u
where (select count(*) from public.admin_users) = 1
on conflict (id) do nothing;

-- ---------------------------------------------------------------------------
-- VERIFICATION — runs, and aborts the transaction on failure. Not a list of
-- queries somebody might run afterwards.
-- ---------------------------------------------------------------------------
do $verify$
declare
  v_admins integer;
  v_public integer;
  v_name text;
begin
  if not (select relrowsecurity from pg_class where oid = 'public.author_profiles'::regclass) then
    raise exception 'author_profiles: row level security is NOT enabled';
  end if;

  -- The public read must be gated on is_public. A policy of `using (true)`
  -- would publish every draft identity the moment it was typed.
  if not exists (
    select 1 from pg_policies
    where schemaname = 'public'
      and tablename = 'author_profiles'
      and cmd = 'SELECT'
      and 'anon' = any (roles)
      and qual ilike '%is_public%'
  ) then
    raise exception 'author_profiles: the anon SELECT policy is not gated on is_public';
  end if;

  if has_table_privilege('anon', 'public.author_profiles', 'insert')
     or has_table_privilege('anon', 'public.author_profiles', 'update')
     or has_table_privilege('anon', 'public.author_profiles', 'delete') then
    raise exception 'author_profiles: anon can write to it';
  end if;

  if not has_table_privilege('anon', 'public.author_profiles', 'select') then
    raise exception 'author_profiles: anon cannot SELECT, so a published byline could never be read';
  end if;

  select count(*) into v_admins from public.admin_users;
  if v_admins <> 1 then
    raise exception
      'author_profiles: this installation has % admin_users rows. The publisher seed only runs for exactly one, because SQL cannot know which admin is the publisher and guessing would attribute a publication to a person. Insert the correct author_profiles row by hand, then re-run this file.',
      v_admins;
  end if;

  select count(*) into v_public from public.author_profiles where is_public;
  if v_public <> 1 then
    raise exception 'author_profiles: expected exactly 1 published profile after the seed, found %', v_public;
  end if;

  select display_name into v_name from public.author_profiles where is_public;
  if v_name <> 'Telmo Carvalho' then
    raise exception
      'author_profiles: the published name is "%", which does not match PUBLISHER_NAME in src/lib/seo/publisher.ts. The byline and /about would disagree.',
      v_name;
  end if;

  -- The mechanism is live; the data is not. This is the intended state after
  -- this file alone: nothing on the public site changes yet.
  if exists (select 1 from public.content_items where author_id is not null) then
    raise notice 'author_profiles: some content_items already carry an author_id — bylines will render for those.';
  else
    raise notice 'author_profiles: ready. No article carries an author_id yet, so no byline renders. That is expected — see 20260825b_backfill_content_author_id.sql.';
  end if;
end
$verify$;
