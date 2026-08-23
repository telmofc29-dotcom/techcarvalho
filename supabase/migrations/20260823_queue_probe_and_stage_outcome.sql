-- STATUS 2026-08-23: APPLIED IN PRODUCTION AND VERIFIED BEHAVIOURALLY.
-- 17/17 checks: npx tsx scripts/verify-changelog-queueprobe.ts
-- The SQL editor's message was not treated as evidence -- this file's first
-- two companions applied cleanly and still carried three defects that only
-- fire when the functions are CALLED.
-- (Originally drafted into migrations_pending/.)
-- "move it into migrations/ only once it's actually been run in production").
-- Nothing in src/ requires it — every code path added in this change works
-- without it and reports honestly about what it therefore cannot establish.
--
-- ---------------------------------------------------------------------------
-- WHAT IT CLOSES
-- ---------------------------------------------------------------------------
--
-- src/lib/engine/queue-read.ts separates "the queue was empty" from "we were not
-- allowed to look", using three forms of reader-liveness evidence. Two of them
-- are object-specific and settle the question outright:
--
--   SAME_READ_FILTERED   the queue read returned rows and application code
--                        filtered them to zero eligible. Available today to
--                        link-job, hero-media-job, product-job.
--   UNFILTERED_COUNT     an unfiltered count of the SAME object. NOT AVAILABLE
--                        TODAY — this migration is what makes it available.
--
-- The third is weaker, and the jobs that must rely on it say so in their own
-- telemetry rather than implying more:
--
--   CONTROL_READ         a separate cheap read (engine_reference_data) that must
--                        return rows if the grants are intact. Excludes a
--                        BLANKET loss of grants — the actual 2026-08 shape.
--                        Does NOT exclude a defect inside the queue function's
--                        own body.
--
-- That last gap is concrete, not theoretical. engine_assemblable_briefs opens
-- with:
--
--     if not public.engine_flag_enabled('research') then return; end if;
--
-- so a research flag reading false INSIDE the function returns zero rows with no
-- error, from a function that executed perfectly, whose grant is intact, and
-- whose control read answers happily. Nothing outside the function can see that.
-- engine_briefable_discoveries, engine_freshness_candidates,
-- engine_unclassified_discoveries and engine_due_sources all carry filters of
-- their own with the same property.
--
-- ---------------------------------------------------------------------------
-- A. engine_queue_probe — the unfiltered count
-- ---------------------------------------------------------------------------
-- One SECURITY DEFINER function that answers, for each engine queue, the two
-- numbers the classifier needs: how many rows exist in the underlying object AT
-- ALL, and how many the eligibility filter matches.
--
-- WHY IT HAS TO BE A SEPARATE FUNCTION AND NOT A FLAG ON EACH QUEUE RPC: adding
-- an out-parameter to fourteen existing functions means fourteen DROP/CREATE
-- pairs (a RETURNS TABLE column list cannot be changed by CREATE OR REPLACE —
-- 42P13, the defect 20260822_silent_success_telemetry.sql already had to work
-- around), and between deploy and migration every one of them would answer
-- PGRST202. One additive function has no such window.
--
-- WHY total > 0 IS PROOF: it is read through the SAME grant, in the SAME
-- statement family, against the SAME object as the queue read. If the object
-- were unreadable this would be zero too. If the queue function's own filter has
-- gone wrong, total is large and eligible is zero — which is precisely the
-- distinction no control read can make.
--
-- IT DELIBERATELY DOES NOT CHECK ANY FLAG. That is the whole point: it must
-- answer the same numbers whether the engine is switched on or off, so that
-- "the flag is off inside the queue function" becomes visible as
-- total > 0, eligible = 0 rather than as an empty queue.

create or replace function public.engine_queue_probe(p_queue text)
returns table (
  queue text,
  total bigint,
  eligible bigint,
  -- Named so the caller does not have to know the filter; it goes straight into
  -- the InputProbe's `corroboration` text.
  eligibility text
)
language plpgsql
security definer
set search_path = public
as $fn$
begin
  case p_queue

    when 'engine_assemblable_briefs' then
      return query
        select p_queue,
               (select count(*) from public.engine_briefs),
               (select count(*) from public.engine_briefs b
                 where b.review_state = 'approved'
                   and b.assembled_content_id is null
                   and b.state not in ('rejected', 'published')),
               'review_state = approved, not yet assembled, state not rejected/published'::text;

    when 'engine_briefable_discoveries' then
      return query
        select p_queue,
               (select count(*) from public.engine_discoveries),
               (select count(*) from public.engine_discoveries d
                 where d.relevance_verdict = 'relevant'
                   and d.state = 'new'),
               'relevance_verdict = relevant and state = new'::text;

    when 'engine_unclassified_discoveries' then
      return query
        select p_queue,
               (select count(*) from public.engine_discoveries),
               (select count(*) from public.engine_discoveries d
                 where d.relevance_verdict is null),
               'relevance_verdict is null'::text;

    when 'engine_due_sources' then
      return query
        select p_queue,
               (select count(*) from public.engine_sources),
               (select count(*) from public.engine_sources s
                 where s.is_active
                   and s.approval_status = 'approved'
                   and (s.last_checked_at is null
                        or s.last_checked_at < now() - make_interval(hours => s.check_frequency_hours))),
               'active, approved, and past its check_frequency_hours'::text;

    when 'engine_open_media_requirements' then
      return query
        select p_queue,
               (select count(*) from public.media_requirements),
               (select count(*) from public.media_requirements r
                 where r.sourcing_status in ('needed', 'sourcing')),
               'sourcing_status in (needed, sourcing)'::text;

    when 'engine_existing_entities' then
      return query
        select p_queue,
               (select count(*) from public.products) + (select count(*) from public.content_items),
               (select count(*) from public.products) + (select count(*) from public.content_items),
               'unfiltered — every product and every content item'::text;

    when 'engine_reference_data' then
      return query
        select p_queue,
               (select count(*) from public.manufacturers) + (select count(*) from public.taxonomy_categories),
               (select count(*) from public.manufacturers) + (select count(*) from public.taxonomy_categories),
               'unfiltered — every manufacturer and every taxonomy category'::text;

    else
      -- AN UNKNOWN QUEUE NAME RAISES. It must NOT return zero rows: that is the
      -- exact ambiguity this function exists to remove, and a typo in a caller
      -- silently producing "no evidence" would reintroduce it one level up.
      raise exception 'engine_queue_probe: unknown queue %', p_queue
        using errcode = '22023';
  end case;
end;
$fn$;

revoke execute on function public.engine_queue_probe(text) from public;
grant execute on function public.engine_queue_probe(text) to anon, authenticated;


-- ---------------------------------------------------------------------------
-- B. Carry the stage-outcome verdict into engine_recent_job_runs
-- ---------------------------------------------------------------------------
-- SECOND, SMALLER GAP. src/lib/engine/queue-read.ts writes its verdict into
-- engine_job_runs.detail (jsonb), and engine_recent_job_runs does not expose
-- `detail`. So the breaker chain reads the verdict only INDIRECTLY, through the
-- row shape health.ts's `input_unproven` detector keys on:
--
--     status = 'failed' AND every counter = 0
--
-- That works and is deliberately robust — it fires on the first run, needs no
-- history, and catches a failed kill-switch read as well as a denied queue read.
-- What it cannot do is tell an operator WHICH of those two it was without
-- opening the detail payload by hand, and it cannot distinguish UNCLASSIFIED
-- from PERMISSION_FAILURE.
--
-- Two columns fix that. Both nullable, so every row written before this lands
-- keeps meaning "unmeasured" rather than being back-filled with a guess.
--
-- NOTE THE DROP. engine_recent_job_runs is RETURNS TABLE; adding a column to
-- that list requires dropping first (42P13). This is the same defect
-- 20260822_silent_success_telemetry.sql documents at its section C, and the same
-- fix.

alter table public.engine_job_runs
  add column if not exists stage_outcome text,
  add column if not exists outcome_ambiguity text;

comment on column public.engine_job_runs.stage_outcome is
  'One of STAGE_OUTCOME_CLASSES in src/lib/engine/stage-outcome.ts, or UNCLASSIFIED. NULL means the '
  'run predates this column or the stage does not classify itself — UNMEASURED, never "fine".';
comment on column public.engine_job_runs.outcome_ambiguity is
  'The AmbiguityCode when stage_outcome is UNCLASSIFIED. NULL otherwise.';

-- engine_record_job_run and engine_recent_job_runs both need the two extra
-- columns threaded through. Left as an explicit TODO rather than written blind:
-- the 12-argument signature added by 20260822_silent_success_telemetry.sql would
-- become a 14-argument one, and src/lib/engine/cron.ts's recordJobRun already
-- carries the deploy-order fallback that makes such a change safe (it retries
-- the older signature on PGRST202 and REPORTS the downgrade rather than
-- swallowing it). Whoever applies this should extend that same fallback ladder
-- rather than replacing it.


-- ---------------------------------------------------------------------------
-- WHAT IS STILL NOT PROVEN AFTER THIS MIGRATION
-- ---------------------------------------------------------------------------
-- Stated here so the next person does not have to re-derive it.
--
-- 1. engine_queue_probe reads the underlying tables directly, as its owner. If
--    the QUEUE FUNCTION and this PROBE disagree, the probe is believed — but if
--    both are wrong in the same way (e.g. the tables themselves are empty
--    because an upstream stage is broken), neither says so. That is a different
--    failure class, and it is what silent-success.ts's cross-run detectors are
--    for.
-- 2. This function is itself a grant that can be revoked. A revoked EXECUTE
--    answers PGRST202 — an error — which src/lib/engine/jobs/reader-liveness.ts
--    already turns into `form: "none"`, i.e. no evidence, i.e. UNCLASSIFIED. So
--    losing the probe fails closed rather than open. That is checked in
--    src/lib/engine/queue-read.test.ts.
-- 3. Neither column in section B is read by any breaker. They improve DIAGNOSIS,
--    not detection. The detection path is the row shape, and it must stay that
--    way — a breaker keyed on a column that only new code writes would go blind
--    on exactly the stages nobody has instrumented yet.
