-- Give the human approval gate an ACTOR.
--
-- THE DEFECT THIS ADDRESSES
-- -------------------------
-- engine_briefs.review_state='approved' is documented as "what a human
-- decided", and draft assembly consumes only approved briefs. It was therefore
-- the single gate between the engine and unsupervised article production.
--
-- The table records review_state, reviewed_at and review_note. It does NOT
-- record WHO. So when two scripts wrote review_state='approved' with a
-- reviewed_at timestamp, the rows were indistinguishable from genuine owner
-- approvals in every query, and 52 briefs carried manufactured consent for a
-- day before anyone noticed. There was no column that could have exposed it.
--
-- A gate with no actor cannot be audited. This adds one.
--
-- WHAT IT DOES
-- ------------
--   1. reviewed_by uuid, referencing auth.users. NULL means "not reviewed by a
--      signed-in human", which is exactly what a script write looks like.
--   2. A CHECK that an APPROVED brief must name its reviewer. Approval without
--      an actor becomes impossible to store rather than merely discouraged.
--   3. Backfills nothing. Existing approvals were already reverted to pending
--      by scripts/revoke-machine-approvals.ts, so there is no historical row to
--      guess an actor for — and guessing one would recreate the exact problem.
--
-- WHY NOT ALSO FORCE IT IN RLS
-- ----------------------------
-- The admin Server Actions run as the signed-in admin, so `auth.uid()` is
-- available to them and NULL for anything else. A future policy can default
-- reviewed_by to auth.uid() and refuse mismatches. That is deliberately NOT in
-- this migration: it changes the write path for a live admin screen, and this
-- one only adds a column and a constraint. Ship the audit first.
--
-- APPLIED IN PRODUCTION 2026-08-25, and verified SEMANTICALLY rather than
-- taken on trust — "Success. No rows returned." only says the SQL parsed.
--
-- scripts/verify-review-actor.ts exercises the behaviour against production and
-- passes 11/11: the column exists and is writable; approved WITHOUT
-- reviewed_by is refused by this named constraint, on INSERT and on UPDATE;
-- approved WITH an actor is accepted; pending and rejected may still have NULL
-- so every pre-existing row stays valid; the FK refuses an invented user id;
-- and no existing approved brief lacks an actor.
--
-- WHAT THIS DOES NOT STOP, STATED PLAINLY
-- ---------------------------------------
-- An agent holding admin credentials can still write review_state='approved'
-- with reviewed_by set to that admin's own id. The constraint cannot tell an
-- admin clicking approve from a script using the admin's session.
--
-- What it changes is that the approval now NAMES someone. A machine approval
-- is no longer indistinguishable from a human one — it is attributable, and
-- an approval the owner does not recognise is visible as such. Detection, not
-- prevention. Prevention would need a separate credential the engine does not
-- hold, which is a larger change than this.

alter table public.engine_briefs
  add column if not exists reviewed_by uuid references auth.users(id) on delete set null;

comment on column public.engine_briefs.reviewed_by is
  'The signed-in admin who approved or rejected this brief. NULL means no human '
  'reviewer -- which is what a script write looks like, and is why approval now '
  'requires this column to be set.';

-- Drop first so the migration is safely re-runnable.
alter table public.engine_briefs
  drop constraint if exists engine_briefs_approved_needs_reviewer;

alter table public.engine_briefs
  add constraint engine_briefs_approved_needs_reviewer
  check (review_state <> 'approved' or reviewed_by is not null);

comment on constraint engine_briefs_approved_needs_reviewer on public.engine_briefs is
  'An approved brief must name the human who approved it. Without this, a script '
  'setting review_state=''approved'' is indistinguishable from an owner decision, '
  'which is how 52 briefs came to carry consent nobody gave.';
