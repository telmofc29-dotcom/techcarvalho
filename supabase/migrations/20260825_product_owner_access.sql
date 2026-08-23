-- Can we actually photograph this thing?
--
-- WHY
-- ---
-- The shooting list (src/lib/media/photo-requests.ts) ranks products by how
-- many pages a photograph would improve. That is a question about the SITE, and
-- it is the right primary ranking — but on its own it produced a backlog whose
-- top entry was a camera body nobody involved owns or can borrow, sitting above
-- a router on the owner's own desk. A list whose first item cannot be done
-- teaches its reader to skip the first item.
--
-- Physical access is a fact about the WORLD, nothing in the catalogue implies
-- it, and no query can derive it. So a person records it here.
--
-- WHY A TEXT ENUM AND NOT A BOOLEAN
-- ---------------------------------
-- `can_photograph boolean` would collapse two states this project has been
-- burned by conflating: "assessed, and no" versus "nobody has looked". Those
-- must stay distinguishable — see the same lesson in engine_job_runs.stage_outcome
-- and engine_discovery_evidence.origin_examined. Hence 'unknown' as the DEFAULT,
-- meaning NOBODY HAS ASSESSED IT, which the ranking treats as still-shootable
-- so an unassessed product goes to triage rather than being silently buried.
--
-- 'retail_display' exists because a shop shot is a real photograph of the real
-- product with constrained angles and lighting — genuinely different from both
-- a studio shot and no access at all.

alter table public.products
  add column if not exists owner_access text not null default 'unknown'
    check (owner_access in ('owned', 'borrowable', 'retail_display', 'not_accessible', 'unknown')),
  -- Attribution, so a stale assessment is visible as stale. "Not obtainable"
  -- recorded three years ago is a different claim from one recorded this week.
  add column if not exists owner_access_note text,
  add column if not exists owner_access_set_at timestamptz;

comment on column public.products.owner_access is
  'Whether the physical object can be got at for photography. Default ''unknown'' means NOBODY HAS ASSESSED IT, not ''no'' — see src/lib/media/resolution.ts. Editorial; not derivable from any other column.';

-- Reference data on this table is world-readable and the admin write policy
-- already covers every column, so no policy change is required. Verified rather
-- than assumed, below.

-- ---------------------------------------------------------------------------
-- Verification — run these; the success message is not evidence
-- ---------------------------------------------------------------------------
--   -- (a) Every existing product defaulted to unknown, not to a guess:
--   select owner_access, count(*) from public.products group by 1 order by 2 desc;
--   -- expect: a single row, 'unknown', equal to the full product count.
--
--   -- (b) The check constraint actually rejects a bad value:
--   update public.products set owner_access = 'maybe' where false;
--   --   (or, to see it fire, try one real row inside a transaction and roll back)
--   -- expect: 23514 check constraint violation, NOT success.
--
--   -- (c) anon can still read products, and still only published ones:
--   --     GET /rest/v1/products?select=slug,owner_access&limit=5   (as anon)
--   -- expect: rows returned; count matches published products only.
