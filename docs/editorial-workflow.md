# Editorial workflow

How content moves from idea to published, and the rules that keep claims
(sourcing, hands-on testing, freshness) honest.

## Status pipeline

Today `content_items.status` supports exactly three values: `draft`,
`published`, `archived` (see the CHECK constraint in
`supabase/migrations/20260819_content_media_extensions_and_storage.sql`).
The fuller pipeline described in the original project plan (Idea → Planned
→ Draft → Review → Ready → Published → Needs update → Archived) doesn't
exist as stored states — implementing it is a schema change, drafted (not
applied) at
`supabase/migrations_pending/20260820_editorial_workflow_statuses.sql`,
which also notes that `needs_update` is arguably better *derived* from
`freshness_log` (see [Freshness](#freshness) below) than stored as a status
an editor has to remember to set by hand.

## Sources and evidence

Two separate tables, two separate editorial questions:

- **`source_records`** — where did a claim (a spec, a price, a manufacturer
  statement) come from. Attached to exactly one of a product, a content
  item, or a product spec. Editable inline from the Product/Content edit
  pages ("Sources" card), with a global oversight list at
  `/admin/source-records` for spotting gaps (e.g. products with zero
  sources).
- **`evidence_records`** — what was actually verified/tested, and how.
  Attached to exactly one of a product or a content item. The `test_type`
  column is free text (no CHECK constraint) but the admin UI
  (`src/lib/admin/evidence-test-types.ts`) offers a fixed suggested
  vocabulary rather than a blank field, specifically so
  **`staff_hands_on_testing` is a deliberate choice, never a default**.

**Hands-on claim rule**: nothing on the public site may say or imply a
product was personally tested unless a genuine `evidence_records` row with
`test_type = 'staff_hands_on_testing'` (or equivalent) backs it up. The UI
enforces this by never pre-selecting or defaulting to that option — an
editor has to deliberately pick it, which is the same bar the batch's
standing instructions set: never claim hands-on testing that didn't happen.

The admin dashboard's "Editorial quality" section
(`getEditorialQualityCounts()` in `src/lib/admin/dashboard-service.ts`)
surfaces content with zero sources or zero evidence records as a live
count, linking to the oversight lists — a nudge, not a publish-blocker.

## Cannibalisation strategy

`src/lib/admin/cannibalisation.ts` (`findCannibalisationMatches()`) flags,
never blocks. Three signals, checked in order of certainty: exact
`intent_fingerprint` match, exact `primary_query` match, then a
normalized-token-overlap heuristic on the title (≥70% shared tokens
relative to the shorter title). No ML, no embeddings, no new dependency —
deliberately simple and explainable, so an editor can see *why* two pieces
were flagged. Surfaced two ways: live, non-blocking on the content
edit/new admin pages (`CannibalisationCheck` component, reads the form's
current values via DOM event delegation without needing the shared form
component to know about it), and as a dashboard-wide count on the main
admin dashboard.

## Internal journeys

Public "related content" surfacing draws on real relationships only —
`content_products` (shared product association) today; the drafted (not
applied) `content_relationships` table
(`supabase/migrations_pending/20260820_content_relationships.sql`) would
add genuine content-to-content structure (pillar/supporting/related) once
applied. `getArticleDetail()` prefers content sharing a product over a
same-type/most-recent fallback, since a real relationship is a stronger
signal than recency alone. Clicks on these are tracked via
`RelatedContentTracker` (`src/components/public/related-content-tracker.tsx`),
a small event-delegating client wrapper firing `related_content_click`
(see `docs/analytics-architecture.md` for the event taxonomy) — no
JavaScript is needed for the list itself, only for the click event.

## Freshness process

`freshness_log` records a `reviewed_at` timestamp per product/content item.
`src/lib/admin/freshness.ts` buckets the most recent review into `recent`
(< 150 days), `due_soon` (150–180 days), `overdue` (≥ 180 days), or
`no_review` (never reviewed) — thresholds are an editorial default, not
derived from the schema, and documented as the single place to adjust them.
Archived content is excluded from staleness nagging (`archived` already
means "not meant to be current," so flagging it as overdue is a false
positive, not a real gap) — enforced in
`src/lib/admin/freshness-service.ts`. `/admin/freshness` lists everything
bucketed by staleness; the main dashboard's "Content requiring review" tile
counts `overdue` + `no_review` items.

## Article body

`content_items.body` is plain text — no rich-text/JSON block schema, and a
full WYSIWYG editor isn't justified at the current editorial scale. The
public article page renders it through `parseBodyBlocks()`
(`src/lib/content/body-format.ts`), a small dependency-free parser
supporting `## `/`### ` headings, `- ` bullet lists, and blank-line
paragraphs — deliberately no inline emphasis/links. If that turns out to
be needed, treat it as a signal to revisit the body model itself (e.g.
stored blocks), not a reason to grow this parser further. The admin
content form documents the syntax inline next to the Body field.
