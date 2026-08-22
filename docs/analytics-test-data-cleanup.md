# Analytics test-data cleanup — needs running by hand

**Status: NOT APPLIED. Requires you to run it in the Supabase SQL editor.**
Written 2026-08-22.

## The problem

`analytics_events` contains synthetic traffic generated during earlier
verification runs. As of 2026-08-22 it is **67 of 155 events — 43% of the whole
dataset**, including 61 page views on a single path that never existed publicly:

| Path | Events | What it is |
|---|---|---|
| `/_rls-verify-test` | 61 | RLS verification probe |
| `/verify-finaljourney-home-1787315742598` | 2 | Playwright consent/analytics journey |
| `/verify-finaljourney-product-1787315745279` | 2 | Same |
| other `verify-*` paths | 2 | Same |

Left in place, `/_rls-verify-test` is the single most-viewed page on the site and
will present as the top result in any "most popular pages" view, and will skew
`analytics_daily_rollups` for the days it covers.

It does **not** affect the public site: `src/lib/public/trending.ts` deliberately
does not read analytics tables at all (see its header — reading them from the
`anon` path would mean granting anonymous visitors raw analytics, and RLS denies
by returning zero rows rather than an error, so it would silently degrade).

## Why this cannot be fixed from the application

The analytics tables are admin-**read**-only by design: there is no DELETE policy
for `authenticated`. Attempting the cleanup through the app produced:

```
synthetic test events present: 67
delete -> 0 rows deleted     <-- no error raised
remaining: 67
```

A silent no-op, which is precisely the failure mode this project treats as a
bug class. The correct fix is a deliberate manual statement, not a new DELETE
policy — adding one would weaken the boundary permanently to solve a one-off.

## The SQL

Run the SELECT first and confirm the count matches what you expect. Only then
run the DELETE.

```sql
-- 1. Inspect before deleting.
select path, count(*) as events
  from public.analytics_events
 where path like '%_rls-verify-test%'
    or path like '%verify-finaljourney%'
    or path like '/verify-%'
 group by path
 order by events desc;

-- 2. Delete the synthetic events.
delete from public.analytics_events
 where path like '%_rls-verify-test%'
    or path like '%verify-finaljourney%'
    or path like '/verify-%';

-- 3. Sessions that now have no events at all.
delete from public.analytics_sessions s
 where not exists (
   select 1 from public.analytics_events e where e.session_id = s.id
 );

-- 4. Recompute the affected rollups rather than leaving stale aggregates.
--    Safe to run repeatedly; it is the same function the nightly cron calls.
select public.compute_analytics_rollup('2026-08-21'::date);
```

## Afterwards

Real sample size drops to roughly **88 events across 14 sessions on one day**,
which is still far too small to infer anything about reader behaviour — but it
will at least be *honest* about being small, rather than dominated by traffic
we generated ourselves.

Future verification runs should use a path prefix that is filtered at ingestion
rather than cleaned up afterwards.
