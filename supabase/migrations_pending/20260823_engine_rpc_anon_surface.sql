-- ============================================================================
-- Engine RPC anon surface — least privilege where it costs cron nothing
-- NOT YET APPLIED. Drafted only. Move into supabase/migrations/ once it has
-- actually been run.
-- ============================================================================
--
-- WHAT THIS FILE IS
-- -----------------
-- A 2026-08-22 audit probed production as `anon` (the publishable key, which
-- ships in client-side JavaScript, so "anon" means "anyone with curl") and
-- established BEHAVIOURALLY — not by reading these migrations — that every
-- engine RPC granted to anon is reachable by an ordinary visitor. The control
-- was `compute_analytics_rollup`, which is granted only to `authenticated` and
-- answered 42501 "permission denied for function"; every engine RPC answered
-- 200/204/409 instead, which is what proves the grant is real and live.
--
-- Most of that surface is load-bearing: `src/lib/engine/cron.ts` runs as anon
-- because a Vercel Cron request carries no cookies, and every stage in
-- `src/app/api/engine/tick/route.ts` reaches the database only through these
-- functions. Revoking them wholesale would stop the engine.
--
-- So this file contains ONLY changes that cost the cron path nothing. Each one
-- states why cron still works. The two findings that cannot be fixed this way
-- are described at the bottom, unfixed and explicitly so, because the fix needs
-- an application change that must land first.
--
-- IT DOES NOT: weaken any RLS policy, publish anything, delete anything, or
-- change any function signature.

-- ============================================================================
-- PART 1 — Three shadow RPCs that no caller reaches as anon
-- ============================================================================
--
-- `engine_shadow_escapes`, `engine_shadow_proof_runs` and
-- `engine_shadow_record_proof_run` were granted to anon alongside the rest of
-- the shadow surface in 20260822_engine_shadow_evaluation.sql. Nothing in the
-- cron path calls them:
--
--   src/lib/engine/jobs/shadow-job.ts calls engine_shadow_candidates,
--   engine_shadow_evidence, engine_shadow_media, engine_shadow_sources,
--   engine_shadow_content_signals, engine_shadow_ledger and
--   engine_shadow_record_decision — and none of these three.
--
-- Their only callers are `scripts/run-shadow-evaluation.ts` (which signs in as
-- a real admin via signInWithPassword, i.e. `authenticated`) and, for
-- engine_shadow_record_proof_run, nothing at all yet.
--
-- WHY THIS MATTERS MORE THAN THE OTHER READS. These three are the
-- AUTONOMOUS-READINESS surface. engine_shadow_escapes is the measured
-- zero-tolerance criterion — the count of times the engine decided to publish
-- something it had itself flagged. engine_shadow_record_proof_run is how a
-- chaos/rollback/outage proof gets recorded as EXERCISED, at levels up to
-- 'production_proven'. An outsider able to write that table can manufacture
-- evidence that the engine has been proven safe. Readiness is the gate that
-- would eventually be used to argue for turning autonomous publishing on;
-- evidence for that gate must not be writable by the public internet.
--
-- HOW CRON STILL WORKS: it never called them. The admin script keeps working
-- because `authenticated` retains EXECUTE.

revoke execute on function public.engine_shadow_escapes() from anon;
revoke execute on function public.engine_shadow_proof_runs(integer) from anon;
revoke execute on function public.engine_shadow_record_proof_run(text, text, text, text, text, boolean) from anon;

-- Re-assert the intended grant rather than assuming it, so this file is
-- idempotent and the end state is stated rather than implied.
grant execute on function public.engine_shadow_escapes() to authenticated;
grant execute on function public.engine_shadow_proof_runs(integer) to authenticated;
grant execute on function public.engine_shadow_record_proof_run(text, text, text, text, text, boolean) to authenticated;

-- ============================================================================
-- PART 2 — engine_begin_run: a lease may only be taken for a CURRENT window
-- ============================================================================
--
-- THE ATTACK THIS CLOSES (unauthenticated, permanent, and invisible in logs).
--
-- The tick's idempotency key is fully deterministic and public:
--
--   src/lib/engine/concurrency.ts
--     idempotencyKeyFor('engine_tick', now) === `engine_tick:${bucketStartISO}`
--     with TICK_WINDOW_MINUTES = 5
--
-- and vercel.json schedules /api/engine/tick at 30 4 * * *, so tomorrow's key —
-- and every key for the next decade — is `engine_tick:YYYY-MM-DDT04:30:00.000Z`.
--
-- engine_job_runs carries a partial unique index on (job_name,
-- idempotency_key) where status in ('success','running'). engine_begin_run
-- reaps expired leases by demoting 'running' rows to 'failed' — but it does
-- NOT touch 'success' rows, deliberately, because a window that already did its
-- work must not be redone.
--
-- Combined, an outsider holding only the publishable key can:
--
--   for each future date D:
--     r = engine_begin_run('engine_tick', 'engine_tick:D T04:30:00.000Z', 900)
--         -> 'acquired:<uuid>'          (the uuid is handed to the caller)
--     engine_complete_run('<uuid>', 'success')
--         -> 'completed'
--
-- leaving a 'success' row that occupies the index slot for that window forever
-- and can never be reaped. When the real cron fires, engine_begin_run hits
-- unique_violation and returns 'already_running'; route.ts records a 'skipped'
-- run and returns HTTP 200 {"ok":true}. The engine is off, permanently, and
-- every signal says it is healthy and merely idle. Two HTTP requests per day
-- shut it down; ~730 requests cover two years.
--
-- THE FIX. A lease may only be claimed for a window that is actually current.
-- The key must be `<job_name>:<timestamp>` and the timestamp must fall inside
-- a generous window around the database's own clock. Pre-claiming the future is
-- then impossible, and a poisoned past window ages out of relevance instead of
-- blocking forever.
--
-- HOW CRON STILL WORKS: guard.ts calls beginRun with
-- idempotencyKeyFor(JOB, now), whose bucket start is by construction at most
-- TICK_WINDOW_MINUTES (5) behind the current instant, so it lands well inside
-- the -24h/+5min window. No signature change, no TypeScript change. The two
-- refusal strings are new, and guard.ts already treats any unrecognised answer
-- as "no lease" (outcome 'unavailable') rather than as a pass — fail-closed —
-- so nothing needs to learn them.
--
-- The rest of the body below is UNCHANGED from
-- supabase/migrations/20260822_engine_safety.sql. Only the block marked
-- "PART 2 GUARD" is new.
create or replace function public.engine_begin_run(
  p_job_name text,
  p_idempotency_key text,
  p_lease_seconds integer default 900
)
returns text
language plpgsql
security definer
set search_path = public
as $fn$
declare
  v_id uuid;
  v_taken_over integer := 0;
  v_suffix text;
  v_window timestamptz;
begin
  if p_job_name is null or char_length(p_job_name) > 100 then
    return 'rejected_invalid';
  end if;
  if p_idempotency_key is null or char_length(p_idempotency_key) > 200 then
    return 'rejected_invalid';
  end if;

  -- ---- PART 2 GUARD -------------------------------------------------------
  -- The key must name this job and a parseable instant. Compared with left()
  -- rather than LIKE on purpose: job names contain underscores, which LIKE
  -- would treat as single-character wildcards.
  if left(p_idempotency_key, char_length(p_job_name) + 1) <> p_job_name || ':' then
    return 'rejected_invalid';
  end if;
  v_suffix := substr(p_idempotency_key, char_length(p_job_name) + 2);
  begin
    v_window := v_suffix::timestamptz;
  exception when others then
    return 'rejected_invalid';
  end;

  -- A worker may only lease a window near the present. Bulk-claiming the future
  -- is what turns this RPC into a permanent off switch, and that is what this
  -- bound removes.
  --
  -- THE FUTURE TOLERANCE IS 15 MINUTES, NOT 5, AND THE REASON IS ASYMMETRY OF
  -- HARM. idempotencyKeyFor() (src/lib/engine/concurrency.ts) buckets by
  -- TICK_WINDOW_MINUTES = 5 and the bucket start is never ahead of the caller's
  -- own clock — so on a correct clock even 1 minute would do. But the clock
  -- being compared is Vercel's, and it is compared against Postgres's. If
  -- Vercel ever runs more than the tolerance ahead, a legitimate cron call is
  -- refused; decideLease() then treats it as `unavailable`, and the pass keeps
  -- measuring but stops CREATING. That is a self-inflicted partial outage
  -- caused by a security control, which is exactly the "do not replace one
  -- problem with another" trap.
  --
  -- 15 minutes buys real skew headroom while leaving the attack dead: it caps
  -- pre-claiming at three 5-minute windows, so instead of ~730 requests buying
  -- two years of silence, an attacker must keep re-attacking every quarter of
  -- an hour, forever, and the damage self-heals the moment they stop.
  if v_window > now() + interval '15 minutes'
     or v_window < now() - interval '24 hours' then
    return 'rejected_window';
  end if;
  -- ---- end PART 2 GUARD ---------------------------------------------------

  -- Reap leases that cannot still be held. Vercel's function ceiling is far
  -- below the default lease, so a 'running' row this old is a dead worker, not
  -- a slow one. It is demoted rather than deleted: the evidence that a run was
  -- abandoned is worth keeping.
  update public.engine_job_runs
     set status = 'failed',
         finished_at = now(),
         error = left(coalesce(error || ' ', '') ||
           '[lease of ' || greatest(coalesce(p_lease_seconds, 900), 1) ||
           's expired; run abandoned and taken over by a later worker]', 2000)
   where job_name = p_job_name
     and status = 'running'
     and started_at < now() - make_interval(secs => greatest(coalesce(p_lease_seconds, 900), 1));
  get diagnostics v_taken_over = row_count;

  begin
    insert into public.engine_job_runs (job_name, idempotency_key, status, started_at)
    values (p_job_name, p_idempotency_key, 'running', now())
    returning id into v_id;
  exception when unique_violation then
    return 'already_running';
  end;

  return case when v_taken_over > 0 then 'took_over:' else 'acquired:' end || v_id::text;
end;
$fn$;
revoke execute on function public.engine_begin_run(text, text, integer) from public;
grant execute on function public.engine_begin_run(text, text, integer) to anon, authenticated;

-- ============================================================================
-- PART 3 — What is deliberately NOT fixed here, and why
-- ============================================================================
--
-- 3a. AUDIT-HISTORY FORGERY (engine_record_job_run) HAS NO SQL-ONLY FIX.
--
-- Three anon calls of
--   engine_record_job_run('engine_discover', 'failed')
-- satisfy BREAKER_THRESHOLDS.databaseConsecutiveErrorRuns = 3 in
-- src/lib/engine/circuit-breaker.ts and trip the database_errors breaker; a run
-- claiming a large items_created trips publication_volume
-- (publicationHardCeiling = 25). The breakers read their telemetry from
-- engine_recent_job_runs, i.e. from exactly the table this RPC appends to. The
-- same forgery works in reverse: a stream of fabricated 'success' rows is what
-- the SILENT_SUCCESS detector reads as a healthy engine.
--
-- A job-name whitelist was considered and REJECTED. It stops nothing (the real
-- job names are in the repository) and it introduces the failure mode this
-- codebase exists to avoid: a job renamed later would have its audit rows
-- silently dropped, and the safety layer would starve while every stage still
-- reported success.
--
-- 3b. THE READ SURFACE IS THE WHOLE UNPUBLISHED ENGINE, AND CRON NEEDS IT.
--
-- Verified as anon against production on 2026-08-22:
--   engine_existing_entities()       -> 125 rows, INCLUDING 8 unpublished
--                                       product names and slugs
--   engine_shadow_candidates()       -> every discovery, title and summary
--   engine_shadow_evidence(id)       -> evidence URLs, publishers, excerpts and
--                                       the registry's rights columns
--   engine_shadow_sources()          -> 29 sources with discovery/republication
--                                       permissions and rights status
--   engine_due_sources()             -> the live source registry with URLs
--   engine_recent_job_runs()         -> the engine's operating history
--   engine_validation_stats()        -> 118 evaluated / 81 rejected
--   engine_flag_enabled('discovery') -> the kill-switch state
--
-- Every one of those is called by a cron stage, so none can simply be revoked,
-- and none can be trimmed without breaking the job that reads it (entity
-- resolution genuinely needs unpublished names, precisely so an assembled draft
-- does not link to a record that is not live).
--
-- 3c. THE ACTUAL FIX FOR BOTH, WHICH NEEDS AN APPLICATION CHANGE FIRST.
--
-- The engine is granted to anon because the cron path has no identity. Give it
-- one, and the whole surface can leave anon behind at once. The cheapest
-- version needs no RPC signature change and no call-site change:
--
--   1. Application (one place): the Supabase client used by the engine path
--      attaches a secret header, e.g.
--          global: { headers: { "x-engine-token": process.env.ENGINE_RPC_TOKEN } }
--      PostgREST forwards request headers to SQL as
--          current_setting('request.headers', true)::json ->> 'x-engine-token'
--      so the token arrives on every RPC without any of them declaring a
--      parameter for it.
--   2. Database: an admin-only `engine_cron_tokens` table holding a hash, plus
--      a NOT-granted helper `engine_caller_authorized()` that returns true for
--      a matching header OR for `public.is_admin()`.
--   3. Database: each engine RPC re-emitted with
--          if not public.engine_caller_authorized() then
--            return 'rejected_unauthorized';
--          end if;
--      as its first statement.
--
-- ORDER MATTERS AND IS THE REASON STEP 3 IS NOT IN THIS FILE: applying it
-- before the deployed application sends the header would refuse every cron
-- call and halt the engine. Step 3 belongs in a migration written and applied
-- alongside that deployment, and verified the way the assembly fix eventually
-- was — by replaying the attack, not by reading the SQL editor's result message.
