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

## Afterwards — DONE

Cleanup was run on 2026-08-22 and independently verified against production.

| | Before | After |
|---|---|---|
| `analytics_events` | 155 | **26** |
| `analytics_sessions` | 14 | **8** |
| Sessions with no events | — | **0** |

The real figure came out lower than the ~88 estimated here, because the
inspection found considerably more `/verify-*` traffic than this document had
anticipated — particularly `verify-finalratelimit-*` paths. **26 events across
8 sessions is the clean starting dataset.** No attempt has been made to restore
or compensate for the difference.

### Two paths the cleanup did not catch

`/retest-no-select` and `/repro-full-shape` (one event each) are still present.
They are plainly synthetic but matched none of the patterns above, which is the
whole argument against cleaning up after the fact: **you cannot reliably
enumerate names nobody has invented yet.** They have been left in place rather
than chasing them, and they are ~8% of the remaining set — worth remembering
before drawing any conclusion from 26 events.

## The permanent fix — implemented 2026-08-22

Synthetic traffic is now dropped at **write time**, in
`src/app/api/analytics/track/route.ts`, via `src/lib/analytics/path-filter.ts`.
Nothing needs cleaning up afterwards, because nothing is written.

### The convention

> **Any path beginning `/__test` is never recorded.**

Verification runs, Playwright journeys and reproduction scripts must navigate
paths under that prefix. It is a 404 on the public site, deliberately: a test
path should not resolve to real content, or it would be exercising the wrong
thing.

### What else is excluded

- The historical shapes (`verify-`, `_rls-`, `retest-`, `repro-`, `e2e-`,
  `smoke-`, `playwright-`), matched in any path segment — so re-running an old
  script cannot reintroduce the problem.
- Any path ending in a 13-digit epoch timestamp. That suffix is what made the
  old paths unique per run and therefore impossible to clean in bulk; real
  routes are human-authored slugs and never carry one.
- `localhost`, `127.0.0.1`, `*.local` and `*.vercel.app` hosts. There is one
  Supabase instance shared by local development and preview deployments, so
  without this a developer clicking around localhost lands in production
  analytics.

The filter is deliberately conservative in one direction only: recording fake
traffic silently corrupts every later conclusion, whereas dropping a genuine
hit costs one row. Real slugs containing the word "verify"
(`/articles/how-to-verify-your-gpu-drivers`) are explicitly tested and kept.

All six synthetic paths that actually reached production are permanent
regression tests in `src/lib/analytics/path-filter.test.ts`.
