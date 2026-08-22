-- STATUS 2026-08-22: APPLIED IN PRODUCTION.
-- Verified BEHAVIOURALLY (probed as `anon` against production), not from this
-- filename and not from an SQL-editor result message. Both have been wrong in
-- this project before: a migration once reported "Success" without applying,
-- and these headers said NOT APPLIED while the functions were live -- which
-- cost real time during the 2026-08-22 security audit.
-- ============================================================================
-- (An earlier revision of this header claimed it was not applied. It is.)
-- ============================================================================
-- Drafted, not run. Lives in migrations_pending/ so no tooling picks it up;
-- move it into migrations/ only once it has actually been executed.
--
-- WHAT THIS FIXES
-- ---------------
-- engine_trends.is_active has existed since 20260822_phase5_trends_media.sql
-- and defaults to true, and /admin/engine/trending filters on it — but NOTHING
-- has ever set it to false. There is no code path in the repository that
-- deactivates a trend. The column is effectively write-once, so a trend scored
-- during one busy week stays "active" forever, and a topic whose category is
-- later renamed or deleted stops being returned by engine_trend_inputs and is
-- therefore never updated again: a permanently frozen row sitting at the top of
-- a ranking that claims to describe the present.
--
-- The scheduled jobs run as `anon` (a Vercel Cron request carries no cookies —
-- see src/lib/engine/cron.ts), and engine_trends is admin-only under RLS, which
-- denies by returning ZERO ROWS rather than an error. So the job cannot simply
-- UPDATE the table: it would silently affect nothing, forever, with nothing in
-- the logs. Expiry therefore has to be a narrow SECURITY DEFINER RPC, like
-- every other engine write.
--
-- WHAT IT DOES NOT DO
-- -------------------
--   * It never deletes a trend. Expiry flips is_active; the measurement, its
--     signal breakdown and its why_trending text stay on the row as the record
--     of what was actually observed.
--   * It never writes a decayed number into trend_score. trend_score remains
--     the honest measurement taken at last_observed_at. The decay multiplier is
--     applied here only to decide expiry, and in the application layer only to
--     ORDER rows. A discounted score is an inference about currency; recording
--     it as the measurement would erase the distinction this engine is built
--     around.
--   * It never resurrects a trend on the strength of no evidence — see the
--     reactivation rule in section 2.
--   * It cannot publish anything, and touches no content, product or media row.
--
-- The decay constants are NOT hardcoded here. They are parameters, and their
-- single source of truth is src/lib/engine/trends.ts
-- (TREND_EVIDENCE_HALF_LIFE_HOURS / TREND_EXPIRY_SCORE /
-- TREND_EVIDENCE_HORIZON_HOURS / TREND_DECAY_GRACE_HOURS), which the trend job
-- passes in. The defaults below merely mirror those values so a manual call
-- behaves identically; the reasoning for each number is documented in the TS.

-- ---------------------------------------------------------------------------
-- 1. Expire stale trends
-- ---------------------------------------------------------------------------
-- Two independent exits, deliberately different in kind:
--
--   'evidence_horizon' — the measurement is older than one full
--     engine_trend_inputs window (14 days), so every signal behind it has aged
--     out of the window that produced it. Applies whatever the score was, and
--     applies to unscored rows too. This is the rule that catches orphans.
--
--   'below_floor' — the decayed ranking value has fallen under the floor. Gated
--     on the grace period so that a LOW BUT CURRENT measurement ("we looked
--     today and there is barely anything here") is never mistaken for a STALE
--     one. Those are different statements and the engine must not merge them.
--
-- Unscored rows can only ever leave via the horizon: there is no number to
-- compare against a floor, and inventing one is exactly what we refuse to do.
create or replace function public.engine_expire_stale_trends(
  p_half_life_hours numeric default 72,
  p_floor numeric default 5,
  p_horizon_hours numeric default 336,
  p_grace_hours numeric default 24
)
returns table (topic_key text, reason text)
language plpgsql
security definer
set search_path = public
as $fn$
declare
  v_half numeric := greatest(coalesce(p_half_life_hours, 72), 1);
  v_floor numeric := greatest(coalesce(p_floor, 5), 0);
  v_horizon numeric := greatest(coalesce(p_horizon_hours, 336), 1);
  v_grace numeric := greatest(coalesce(p_grace_hours, 24), 0);
begin
  -- Same kill switch every other trend function honours. Fails closed: with
  -- the flag off this returns no rows and changes nothing.
  if not public.engine_flag_enabled('opportunity') then
    return;
  end if;

  return query
  with aged as (
    select
      t.id,
      t.topic_key,
      t.trend_score,
      greatest(extract(epoch from (now() - t.last_observed_at)) / 3600.0, 0)::numeric as age_hours
    from public.engine_trends t
    where t.is_active
  ),
  decayed as (
    select
      a.id,
      a.topic_key,
      a.age_hours,
      -- Null score decays to null, never to zero. Past the horizon the decay
      -- is short-circuited to 0 rather than evaluated: the row is expiring on
      -- the horizon rule regardless, and power() with a very large exponent is
      -- pointless work on a long-abandoned row.
      case
        when a.trend_score is null then null
        when a.age_hours >= v_horizon then 0::numeric
        else a.trend_score * power(0.5::numeric, a.age_hours / v_half)
      end as rank_score
    from aged a
  ),
  doomed as (
    select
      d.id,
      d.topic_key,
      case when d.age_hours >= v_horizon then 'evidence_horizon' else 'below_floor' end as reason
    from decayed d
    where d.age_hours >= v_horizon
       or (d.rank_score is not null and d.rank_score < v_floor and d.age_hours >= v_grace)
  ),
  expired as (
    update public.engine_trends t
       set is_active = false,
           updated_at = now()
      from doomed x
     where t.id = x.id
    returning x.topic_key, x.reason
  )
  select e.topic_key::text, e.reason::text from expired e;
end;
$fn$;

revoke execute on function public.engine_expire_stale_trends(numeric, numeric, numeric, numeric) from public;
grant execute on function public.engine_expire_stale_trends(numeric, numeric, numeric, numeric) to anon, authenticated;

-- ---------------------------------------------------------------------------
-- 2. Reactivation on fresh evidence
-- ---------------------------------------------------------------------------
-- Replaces engine_upsert_trend from 20260822_phase5_trends_media.sql. The body
-- is unchanged except for the is_active clause; expiry is a state, not a
-- tombstone, so a topic that becomes measurable again must be able to come
-- back.
--
-- The condition is load-bearing. Reactivating on EVERY upsert would undo the
-- expiry sweep on the very next pass, because the trend job upserts a row for
-- every taxonomy category whether or not anything was measured — the engine
-- would look permanently busy while measuring nothing. So a row returns only
-- when there is an actual score behind it; an upsert carrying a null score
-- leaves is_active exactly as it was.
create or replace function public.engine_upsert_trend(
  p_topic_key text, p_label text, p_category text,
  p_score numeric, p_confidence numeric, p_velocity numeric,
  p_signals jsonb, p_why text, p_recommended_type text, p_has_coverage boolean
)
returns text
language plpgsql
security definer
set search_path = public
as $fn$
begin
  if p_topic_key is null or p_label is null then
    return 'rejected_invalid';
  end if;
  insert into public.engine_trends (
    topic_key, label, category_slug, trend_score, confidence, velocity,
    contributing_signals, why_trending, recommended_content_type,
    has_published_coverage, last_observed_at, updated_at
  ) values (
    left(p_topic_key, 200), left(p_label, 300), left(p_category, 100),
    p_score, least(greatest(coalesce(p_confidence, 0), 0), 1), p_velocity,
    coalesce(p_signals, '{}'::jsonb), left(p_why, 2000),
    nullif(p_recommended_type, ''), coalesce(p_has_coverage, false), now(), now()
  )
  on conflict (topic_key) do update set
    label = excluded.label,
    trend_score = excluded.trend_score,
    confidence = excluded.confidence,
    velocity = excluded.velocity,
    contributing_signals = excluded.contributing_signals,
    why_trending = excluded.why_trending,
    recommended_content_type = excluded.recommended_content_type,
    has_published_coverage = excluded.has_published_coverage,
    -- Fresh measurable evidence revives an expired trend; nothing else does.
    is_active = case
      when excluded.trend_score is not null then true
      else public.engine_trends.is_active
    end,
    last_observed_at = now(),
    observation_count = public.engine_trends.observation_count + 1,
    updated_at = now();
  return 'ok';
end;
$fn$;
revoke execute on function public.engine_upsert_trend(text, text, text, numeric, numeric, numeric, jsonb, text, text, boolean) from public;
grant execute on function public.engine_upsert_trend(text, text, text, numeric, numeric, numeric, jsonb, text, text, boolean) to anon, authenticated;

-- ---------------------------------------------------------------------------
-- 3. Index note
-- ---------------------------------------------------------------------------
-- engine_trends_active_idx (is_active, last_observed_at desc) already exists
-- and is exactly the index the sweep in section 1 wants. No new index needed.
