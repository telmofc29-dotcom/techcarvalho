-- HOMEPAGE OVERRIDES: BOOST, AND OVERRIDES THAT EXPIRE ON THEIR OWN
--
-- NOT YET APPLIED. Lives in migrations_pending/ deliberately.
--
-- WHAT THE HOMEPAGE ALREADY DOES, SO THIS DOES NOT REBUILD IT
-- ----------------------------------------------------------
-- Ranking, rotation and decay are already implemented and honest:
-- src/lib/public/trending.ts scores on recency with a PER-TYPE half-life (news
-- 48h, comparisons 3 weeks, guides and troubleshooting ~6 weeks), plus cluster
-- centrality and a small hero-image tie-breaker. It deliberately reads no
-- analytics at all, because analytics_daily_rollups and engine_trends are
-- admin-only under RLS and RLS denies by returning ZERO ROWS -- querying them
-- from the public path would look exactly like "nothing is popular" forever.
-- src/lib/public/visual-variety.ts and homepage-sections.ts already enforce
-- media and category diversity.
--
-- So news already rotates and already decays, evergreen content already decays
-- differently, and nothing fabricates popularity. This migration adds only what
-- was genuinely missing.
--
-- WHAT WAS MISSING: AN OVERRIDE THAT ENDS
-- ---------------------------------------
-- Today an override is permanent until a human deletes it. That is the exact
-- shape of the problem the owner described -- "do not require me to manually
-- manage homepage articles every day" -- because the natural use of a pin is
-- temporary ("lead with this for launch week") and the system has no way to
-- express temporary. Every pin therefore becomes a small permanent debt that
-- someone has to remember to pay off, and the homepage silently rots around
-- pins nobody revisits.
--
-- starts_at/ends_at make a pin self-clearing. An expired override stops
-- applying without anyone doing anything, which is the whole point.
--
-- WHY NULL MEANS "NO BOUND" RATHER THAN A DEFAULT WINDOW
-- -----------------------------------------------------
-- Both columns are nullable with no default, so every existing override keeps
-- behaving exactly as it does now. Defaulting to a window would silently expire
-- overrides a human set deliberately, which is a data-destroying default
-- dressed up as a convenience.
--
-- WHY BOOST IS SEPARATE FROM PIN
-- ------------------------------
-- A pin FORCES a position; a boost RAISES a score and lets the ranking still
-- decide. They are different editorial intents and collapsing them loses the
-- distinction that matters: "this is more important than the algorithm thinks"
-- is not the same instruction as "put this first no matter what". Boost also
-- degrades gracefully -- a boosted item that genuinely has nothing going for it
-- still will not lead, whereas a pin would put it there regardless.

alter table public.homepage_overrides
  add column if not exists starts_at timestamptz,
  add column if not exists ends_at timestamptz;

-- An override whose window closes before it opens can never apply, and is
-- always a mistake at the point of entry rather than something to discover
-- later by wondering why the homepage ignored it.
alter table public.homepage_overrides
  drop constraint if exists homepage_overrides_window_ordered;

alter table public.homepage_overrides
  add constraint homepage_overrides_window_ordered check (
    starts_at is null or ends_at is null or ends_at > starts_at
  );

comment on column public.homepage_overrides.starts_at is
  'When this override begins applying. NULL means "already active". Used so a '
  'launch-week pin can be set in advance rather than remembered on the day.';

comment on column public.homepage_overrides.ends_at is
  'When this override stops applying. NULL means "until removed by hand". '
  'Setting it is what makes a pin self-clearing -- the reason this column '
  'exists is that a permanent pin is a maintenance debt nobody remembers to '
  'pay, and the homepage rots around it.';

-- Add `boost` to the permitted modes. The existing three are unchanged.
alter table public.homepage_overrides
  drop constraint if exists homepage_overrides_mode_check;

alter table public.homepage_overrides
  add constraint homepage_overrides_mode_check check (
    mode in ('pin_lead', 'pin_supporting', 'boost', 'suppress')
  );

-- The selection function must respect the window. Overrides outside their
-- window are simply not visible to it, so no ranking code needs to know that
-- windows exist -- an expired pin becomes indistinguishable from no pin.
--
-- NOTE FOR WHOEVER APPLIES THIS: public_homepage_selection is defined in
-- 20260822_phase5_secure_homepage.sql. This view is the seam that migration's
-- body should read from instead of homepage_overrides directly. Applying this
-- file alone adds the columns and the view; it does NOT change selection
-- behaviour until that function is repointed, which is deliberate -- the
-- columns should exist and be populatable before anything starts depending on
-- them.
create or replace view public.homepage_overrides_active as
select
  id,
  content_id,
  mode,
  note,
  created_at,
  starts_at,
  ends_at
from public.homepage_overrides
where (starts_at is null or starts_at <= now())
  and (ends_at is null or ends_at > now());

comment on view public.homepage_overrides_active is
  'Overrides currently in force. Selection reads THIS rather than the base '
  'table, so an expired override stops applying with no code path aware that '
  'windows exist.';
