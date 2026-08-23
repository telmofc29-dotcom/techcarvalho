-- The two confidence bands a machine must never infer.
--
-- src/lib/public/source-confidence.ts labels a news story with one of six
-- bands. Four of them are derived from source independence, which the site can
-- measure: how many distinct originating VOICES are behind a claim, once
-- syndication, aggregators and multiple pages from one publisher are collapsed.
--
-- Two cannot be derived from anything this database holds:
--
--   developing   — the story is still moving. Nothing in a source list says
--                  whether a story has stopped changing.
--   conflicting  — the sources make claims that cannot all be true.
--                  source_records holds a URL, a publisher and a reliability
--                  tier. There is no field expressing "this contradicts that",
--                  and a heuristic over the three fields that exist would
--                  produce a confident-looking label from no evidence at all.
--
-- So both are set by a person. These columns are where that judgement lives.
--
-- WHY NOT ONE `confidence_band` COLUMN
-- ------------------------------------
-- Because a single stored band would let an editor overwrite the four DERIVED
-- bands too, and a stored "Confirmed" would then survive the primary source
-- being removed from the article. Storing only the two things that cannot be
-- computed keeps the computed ones honest: they always reflect the sources
-- currently attached, and they cannot drift.
--
-- WHY NOT NULLABLE BOOLEANS
-- -------------------------
-- Three states would invite "unknown", and the reader-facing code already
-- treats false as "NOT FLAGGED" rather than "checked and fine" — that
-- distinction is documented at the point it matters (the module header) rather
-- than encoded as a NULL that every query then has to remember to handle.

-- A third flag, for the same reason. `reliability_tier` on source_records
-- grades WHO PUBLISHED, not WHAT THEY CLAIMED. A real article on this site —
-- next-gen-console-rumor-tracker-ps6-xbox, whose subject is explicitly rumour —
-- came out labelled "Strongly supported" because three reputable outlets had
-- each covered it. Three independent reports OF A RUMOUR are strong sourcing of
-- a weak claim. The engine's evidence rows carry claim_status for precisely
-- this distinction, but that table is admin-only and the public source list has
-- no equivalent column, so an editor states it here.

alter table public.content_items
  add column if not exists claim_developing boolean not null default false,
  add column if not exists claim_conflicting boolean not null default false,
  add column if not exists claim_unconfirmed boolean not null default false,
  -- Who made the call and when, so the flag is attributable. A story flagged
  -- `conflicting` two years ago by someone who has since left is a different
  -- thing from one flagged this morning.
  add column if not exists claim_state_set_by uuid references auth.users(id) on delete set null,
  add column if not exists claim_state_set_at timestamptz;

comment on column public.content_items.claim_developing is
  'Editorial: this story is still changing. Cannot be inferred from sources — see src/lib/public/source-confidence.ts. false means NOT FLAGGED, not "checked and settled".';
comment on column public.content_items.claim_conflicting is
  'Editorial: the sources disagree irreconcilably. Cannot be inferred — source_records has no field expressing contradiction. false means NOT FLAGGED.';
comment on column public.content_items.claim_unconfirmed is
  'Editorial: the underlying claim is unconfirmed whatever the standing of who reported it. reliability_tier grades the publisher, not the claim. false means NOT FLAGGED.';

-- Both flags are read by the PUBLIC article page, so anon must be able to see
-- them on a published row. They ride on the existing content_items select
-- policy (published rows only) — no new policy and no new grant is needed,
-- because column-level grants are not used on this table. Verified below
-- rather than assumed.

-- ---------------------------------------------------------------------------
-- Verification — run these; do not trust the success message
-- ---------------------------------------------------------------------------
-- The 2026-08-24 migration applied cleanly while leaving every insert broken,
-- so "no error" is not evidence.
--
--   -- (a) The columns exist and defaulted correctly on all existing rows:
--   select count(*) filter (where claim_developing) as developing,
--          count(*) filter (where claim_conflicting) as conflicting,
--          count(*) as total
--     from public.content_items;
--   -- expect: developing = 0, conflicting = 0, total = 81
--
--   -- (b) anon can read the flags on a PUBLISHED row:
--   --     (run as anon, e.g. from the REST endpoint)
--   --     GET /rest/v1/content_items?select=slug,claim_developing,claim_conflicting&limit=1
--   -- expect: rows returned, both fields present and false
--
--   -- (c) anon still cannot read an unpublished row through them:
--   select count(*) from public.content_items where status <> 'published';
--   -- as anon, expect: 0 (RLS unchanged)
