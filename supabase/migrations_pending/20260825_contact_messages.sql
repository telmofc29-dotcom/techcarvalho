-- A real way to reach the publisher.
--
-- NOT APPLIED. Lives in migrations_pending/ deliberately — move it to
-- migrations/ only after it has actually been run.
--
-- WHY
-- ---
-- /contact currently offers no contact method at all. It says so honestly
-- ("does not yet have a monitored contact address or contact form set up"),
-- which beats publishing an inbox nobody reads, but Google's Publisher
-- Policies require a real route to the publisher and a reviewer opens
-- /contact before they open an article. The alternative to this table is
-- publishing the owner's personal email address, which is irreversible the
-- moment it is crawled and scraped. A form is reversible; an address is not.
--
-- THE SHAPE OF THE WRITE PATH, AND WHY IT IS AN RPC
-- -------------------------------------------------
-- This table holds other people's email addresses and their unpublished
-- messages. `anon` must therefore never be able to SELECT from it — not
-- "filtered to zero rows", but with no privilege on the table at all, the
-- same standard 20260821_first_party_analytics.sql applies to raw analytics.
--
-- But a form needs rate limiting, and rate limiting means counting recent
-- rows, and counting rows needs SELECT. That is the exact tension the
-- analytics work already hit and already solved: a SECURITY DEFINER function
-- that returns a verdict rather than the rows it counted. So `anon` gets
-- EXECUTE on ONE function and no table privilege whatsoever. There is no
-- insert policy for anon either, because there is no anon insert.
--
-- ANTI-ABUSE, AND WHAT IT DOES NOT DO
-- -----------------------------------
-- Four layers, three of them here:
--   1. A honeypot field, in the app (src/app/(public)/contact/contact-form.tsx).
--      Stops naive bots. Stops nothing else.
--   2. Server-side validation, HERE, not only in the browser: the Server
--      Action can be POSTed directly, so the browser's `required`/`maxlength`
--      attributes are decoration.
--   3. Per-sender rate limit: 3 messages per email address per hour.
--   4. Site-wide ceiling: 60 messages per hour.
--
-- Layer 4 has a real, deliberate trade-off: a flood can exhaust the ceiling
-- and make a genuine visitor's message bounce with "try again later" for the
-- rest of the hour. That is chosen over the alternative, which is an unbounded
-- table anyone can fill. It is bounded loudly (the sender is told), not
-- silently. The honest limits of this design: no IP is recorded, so nothing
-- here can rate-limit a spammer who varies their email address, and no CAPTCHA
-- is used. An IP address is personal data this site's privacy policy currently
-- promises it does not collect, and buying that promise back for a contact
-- form is a worse trade than a ceiling.
--
-- WHAT IS DELIBERATELY NOT STORED
-- -------------------------------
-- No IP address, no user-agent, no session or visitor identifier, no
-- analytics correlation of any kind. A message and a way to reply to it. That
-- keeps /privacy's existing sentence — "Neither system collects your name,
-- email address, precise location, IP address, or any information you have not
-- chosen to give us" — true, since everything here is information the sender
-- chose to give.

create table if not exists public.contact_messages (
  id uuid primary key default gen_random_uuid(),
  -- Optional: a message is answerable without a name.
  name text check (name is null or char_length(name) <= 120),
  -- Required: without it there is no way to reply, and a contact form that
  -- cannot be replied to is the same as no contact form.
  email text not null check (char_length(email) between 6 and 254),
  -- Closed vocabulary, never free text — a free-text subject is a spam
  -- payload with extra steps. Mirrors CONTACT_SUBJECTS in
  -- src/lib/contact/message.ts; keep the two in sync.
  subject text not null check (subject in ('correction', 'sourcing', 'permissions', 'general')),
  message text not null check (char_length(message) between 20 and 4000),
  -- Which page the sender was on, when the form was reached from one. A
  -- correction is about a specific article far more often than not.
  page_path text check (page_path is null or char_length(page_path) <= 512),
  status text not null default 'new' check (status in ('new', 'read', 'archived')),
  created_at timestamptz not null default now(),
  handled_at timestamptz,
  handled_by uuid references public.admin_users (id) on delete set null
);

comment on table public.contact_messages is
  'Messages sent through /contact. Written ONLY by public.submit_contact_message() — anon has no privilege on this table. Contains third-party email addresses: admin-read-only, never public.';

create index if not exists contact_messages_status_created_idx
  on public.contact_messages (status, created_at desc);
-- Supports the per-sender rate-limit count inside submit_contact_message().
create index if not exists contact_messages_email_created_idx
  on public.contact_messages (email, created_at desc);

alter table public.contact_messages enable row level security;

drop policy if exists "admins can read contact messages" on public.contact_messages;
create policy "admins can read contact messages" on public.contact_messages
  for select to authenticated using (public.is_admin());

drop policy if exists "admins can update contact messages" on public.contact_messages;
create policy "admins can update contact messages" on public.contact_messages
  for update to authenticated using (public.is_admin()) with check (public.is_admin());

drop policy if exists "admins can delete contact messages" on public.contact_messages;
create policy "admins can delete contact messages" on public.contact_messages
  for delete to authenticated using (public.is_admin());

-- No insert policy for ANY role. The only writer is the SECURITY DEFINER
-- function below, which bypasses RLS for its own insert by design — the same
-- pattern as compute_analytics_rollup(). If you find yourself adding an anon
-- insert policy here, the validation and the rate limit have just been
-- bypassed.

-- RLS never grants; it only restricts what a grant already permits. See
-- 20260821_first_party_analytics_grants_fix.sql for the day this project
-- learned that the hard way. Grants here match the policies exactly and go no
-- wider: anon gets nothing at all on the table.
-- Order matters: strip anything ambient FIRST (a PUBLIC grant would reach anon
-- however carefully anon itself is handled), then grant back exactly what the
-- policies above need.
revoke all on public.contact_messages from public;
revoke all on public.contact_messages from anon;
grant select, update, delete on public.contact_messages to authenticated;

-- ---------------------------------------------------------------------------
-- The only write path.
--
-- Returns jsonb rather than raising, so a rejected message is a normal result
-- the form can explain to the sender, not a 500. Every rejection reason is a
-- fixed code — nothing about the table's contents or size leaks back to the
-- caller.
-- ---------------------------------------------------------------------------
create or replace function public.submit_contact_message(
  p_name text,
  p_email text,
  p_subject text,
  p_message text,
  p_page_path text default null
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_name text := nullif(btrim(coalesce(p_name, '')), '');
  v_email text := lower(btrim(coalesce(p_email, '')));
  v_subject text := btrim(coalesce(p_subject, ''));
  v_message text := btrim(coalesce(p_message, ''));
  v_path text := nullif(btrim(coalesce(p_page_path, '')), '');
  v_recent_sender integer;
  v_recent_total integer;
  v_id uuid;
begin
  -- Deliberately not a full RFC 5322 email grammar: an over-clever regex
  -- rejects real addresses, and the only thing this check has to achieve is
  -- "there is something that could plausibly be replied to". The real
  -- verification is that a reply either arrives or bounces.
  if char_length(v_email) < 6
     or char_length(v_email) > 254
     or v_email !~ '^[^@[:space:]]+@[^@[:space:]]+\.[^@[:space:]]+$' then
    return jsonb_build_object('ok', false, 'reason', 'invalid_email');
  end if;

  if v_subject not in ('correction', 'sourcing', 'permissions', 'general') then
    return jsonb_build_object('ok', false, 'reason', 'invalid_subject');
  end if;

  if char_length(v_message) < 20 or char_length(v_message) > 4000 then
    return jsonb_build_object('ok', false, 'reason', 'invalid_message');
  end if;

  if v_name is not null and char_length(v_name) > 120 then
    return jsonb_build_object('ok', false, 'reason', 'invalid_name');
  end if;

  -- Truncated rather than rejected: the path is context we chose to record,
  -- not something the sender typed, so a long one must never cost them their
  -- message.
  if v_path is not null and char_length(v_path) > 512 then
    v_path := left(v_path, 512);
  end if;

  select count(*) into v_recent_sender
  from public.contact_messages
  where email = v_email and created_at > now() - interval '1 hour';
  if v_recent_sender >= 3 then
    return jsonb_build_object('ok', false, 'reason', 'rate_limited_sender');
  end if;

  select count(*) into v_recent_total
  from public.contact_messages
  where created_at > now() - interval '1 hour';
  if v_recent_total >= 60 then
    return jsonb_build_object('ok', false, 'reason', 'rate_limited_site');
  end if;

  insert into public.contact_messages (name, email, subject, message, page_path)
  values (v_name, v_email, v_subject, v_message, v_path)
  returning id into v_id;

  return jsonb_build_object('ok', true, 'id', v_id);
end;
$$;

comment on function public.submit_contact_message(text, text, text, text, text) is
  'The ONLY write path into contact_messages. Validates, rate-limits (3/hour per sender, 60/hour site-wide) and inserts. Returns {ok, reason} — never raises for a rejected message.';

-- EXECUTE on a function is granted to PUBLIC by default. Revoke first, then
-- grant deliberately, so the surface is what this file says it is.
revoke all on function public.submit_contact_message(text, text, text, text, text) from public;
grant execute on function public.submit_contact_message(text, text, text, text, text) to anon, authenticated;

-- ---------------------------------------------------------------------------
-- VERIFICATION — runs as part of this migration, not as a comment telling you
-- what you could check. A previous migration in this project was 103 lines of
-- pure comment, applied cleanly, and did nothing. Everything below either
-- passes or aborts the whole transaction.
--
-- The probe message is inserted through the real public entry point and then
-- deleted, so a successful run leaves the table exactly as it found it.
-- ---------------------------------------------------------------------------
do $verify$
declare
  v_result jsonb;
  v_probe_id uuid;
begin
  if not (select relrowsecurity from pg_class where oid = 'public.contact_messages'::regclass) then
    raise exception 'contact_messages: row level security is NOT enabled';
  end if;

  if has_table_privilege('anon', 'public.contact_messages', 'select')
     or has_table_privilege('anon', 'public.contact_messages', 'insert')
     or has_table_privilege('anon', 'public.contact_messages', 'update')
     or has_table_privilege('anon', 'public.contact_messages', 'delete') then
    raise exception 'contact_messages: anon holds a direct table privilege — the RPC must be the only path';
  end if;

  if not has_table_privilege('authenticated', 'public.contact_messages', 'select') then
    raise exception 'contact_messages: authenticated cannot SELECT, so no admin can ever read a message';
  end if;

  if not has_function_privilege('anon', 'public.submit_contact_message(text,text,text,text,text)', 'execute') then
    raise exception 'submit_contact_message: anon cannot execute it, so the form can never submit';
  end if;

  v_result := public.submit_contact_message('Probe', 'not-an-email', 'general', repeat('probe ', 10), '/contact');
  if (v_result->>'ok')::boolean then
    raise exception 'validation hole: an invalid email address was accepted';
  end if;

  v_result := public.submit_contact_message('Probe', 'probe@example.com', 'general', 'too short', '/contact');
  if (v_result->>'ok')::boolean then
    raise exception 'validation hole: a message under the 20-character floor was accepted';
  end if;

  v_result := public.submit_contact_message('Probe', 'probe@example.com', 'not-a-subject', repeat('probe ', 10), '/contact');
  if (v_result->>'ok')::boolean then
    raise exception 'validation hole: an unknown subject was accepted';
  end if;

  v_result := public.submit_contact_message('Probe', 'probe@example.com', 'general', repeat('probe ', 10), '/contact');
  if not (v_result->>'ok')::boolean then
    raise exception 'a valid message was rejected: %', v_result->>'reason';
  end if;

  v_probe_id := (v_result->>'id')::uuid;
  delete from public.contact_messages where id = v_probe_id;
  if not found then
    raise exception 'the probe message was reported as inserted but is not in the table';
  end if;

  raise notice 'contact_messages: table, policies, grants and the submit RPC all verified; probe row removed.';
end
$verify$;
