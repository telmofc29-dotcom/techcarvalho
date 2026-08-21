-- Tech Carvalho — provision an existing Supabase Auth user as admin.
--
-- Why this is needed at all: every write policy in this schema (see
-- supabase/migrations/20260819202305_rls_policies.sql) is gated on
-- public.is_admin(), defined in 20260819202304_initial_schema.sql as:
--
--   exists (select 1 from public.admin_users where id = auth.uid())
--
-- auth.uid() is null for the anon role (no JWT at all), so anon can never
-- satisfy this — by design, this is the real authorization boundary, not
-- just a UI restriction. There is no service-role key anywhere in this
-- codebase (CLAUDE.md: "the app never uses a service-role key... every
-- read/write goes through anon/authenticated roles, gated by RLS"), so
-- there is no way to bypass this from application code, and the ingestion
-- scripts (scripts/ingest-catalogue.ts, scripts/ingest-content.ts) don't
-- try to — their --apply mode calls supabase.auth.signInWithPassword()
-- with TC_ADMIN_EMAIL/TC_ADMIN_PASSWORD, the exact same sign-in call
-- src/app/admin/login/actions.ts makes for the web UI, just invoked from
-- Node instead of a browser. No new auth architecture, nothing bypassed.
--
-- admin_users.id is a foreign key to auth.users.id (on delete cascade) —
-- a row can only exist here if a matching auth.users row already exists.
-- This script does not (and cannot, without weakening anything) create an
-- auth.users row itself; Supabase Auth account creation only happens
-- through Supabase's own Auth API/Dashboard, never through a public app
-- signup route (this app deliberately has none — CLAUDE.md: "no admin
-- bypass: no public admin signup").
--
-- STEP 1 — find out whether you already have an auth.users account.
-- Run this read-only query first (Supabase Dashboard -> SQL Editor), or
-- check Dashboard -> Authentication -> Users directly:

select id, email, created_at
from auth.users
order by created_at;

-- STEP 2a — if that returned a row for the email you want to use as the
-- Tech Carvalho admin: skip account creation, go straight to STEP 3.
--
-- STEP 2b — if it returned no rows (or not the account you want): create
-- one via Dashboard -> Authentication -> Users -> "Add user" (or "Invite
-- user" if you want it to arrive by email with a set-your-own-password
-- link, generally the safer option since it means this SQL editor session
-- never sees or sets the password). Use a real email you control. Do this
-- through the Dashboard, not SQL — Supabase Auth manages its own password
-- hashing/session machinery and shouldn't be hand-inserted into via SQL.
-- Then re-run the STEP 1 query to confirm the new row exists.

-- STEP 3 — grant that account admin access. Replace the email below with
-- the real one from STEP 1/2, then run this. Looks the user up by email
-- from auth.users directly rather than asking you to copy-paste a UUID by
-- hand, to avoid a transcription mistake creating a row that satisfies no
-- real session. Idempotent: on conflict (id) do nothing, safe to re-run.

insert into public.admin_users (id, display_name)
select id, 'REPLACE_WITH_DISPLAY_NAME'
from auth.users
where email = 'REPLACE_WITH_YOUR_ADMIN_EMAIL'
on conflict (id) do nothing;

-- Verification — expect exactly one row, and is_admin should read true for
-- a session authenticated as that user:
-- select au.id, au.display_name, u.email, au.created_at
-- from public.admin_users au join auth.users u on u.id = au.id;
