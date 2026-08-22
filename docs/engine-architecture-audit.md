# Growth Engine — architecture audit and gap analysis

**Date:** 2026-08-22
**Scope:** `src/lib/engine/**`, `src/app/api/engine/**`, the `engine_*` schema and every
anon-callable `SECURITY DEFINER` RPC, plus the media-rights and publication surfaces the engine
depends on.
**Purpose:** establish what the engine actually is, what has actually broken, and what would break
first if autonomy were switched on — ahead of an "Autonomous Engine Hardening" phase.
**Mandate:** *"Do not immediately rewrite everything. Identify the actual failure modes and
strengthen the existing architecture."*

This document contains no recommendations to rebuild. Where the architecture is right, it says so
and says why, because the hardening work should preserve those properties rather than trade them
away.

## Method, and what was verified live

Everything below was read from source. In addition, the security boundary and several suspected
defects were **verified against production** using the `anon` publishable key from `.env.local`,
read-only, in accordance with the standing rule that RLS denies by returning zero rows rather than
an error — so an empty result was never read as "no data" without inspecting the status and error.

Live probes were restricted to (a) reads, and (b) write-RPC calls deliberately shaped to hit a
validation early-return, so they prove `EXECUTE` is granted without inserting a row. No row was
written to production, no migration was applied, nothing was deployed, and no application code was
changed. The only file added by this audit is this document.

Findings that were confirmed against production rather than inferred are marked **[verified live]**.

## Summary

The engine is architecturally better than most of what it would be compared to, and its weaknesses
are not design weaknesses. Three properties are worth protecting explicitly:

- **No LLM exists in the pipeline.** Every stage is deterministic and tested. The engine cannot
  hallucinate, because nothing in it generates text (§3.5).
- **Publication is blocked structurally, not by a flag.** `engine_assemble_draft` and
  `engine_assemble_product` hard-code `'draft'` and `false` and expose no parameter capable of
  publishing. `anon` holds no table-level write grant on `content_items`, `products` or
  `media_assets`, and no service-role key exists anywhere in the codebase (§5.4).
- **Measurement is kept separate from inference** — `engine_trends` from `engine_opportunities`,
  confidence ceilings from corroboration counts, score from confidence — and unscored is reported as
  `null` rather than `0`, because *"'no data' and 'no interest' are different claims."*

The gaps are of a single kind, and it is the kind this project has already named as its governing
failure class: **controls that are believed to exist, do not, and cannot report their own absence.**

- The media-first publication gate blocks nothing; `evaluateMediaReadiness` is called only by
  display components (§3.1).
- `autonomous_publishing_enabled` is read by no job and no RPC. Flipping it changes nothing (§5.4).
- The kill switch is written by a Server Action that never checks its error, so turning the engine
  off can silently fail (§3.12).
- Every engine RPC is callable by any holder of the publishable key, which ships in the browser
  bundle; three of them write to `content_items` and `products` and check no flag (§5.1).
- The editorial gates — approval, relevance, rights review — are implemented as filters in the
  read-side RPCs, while the write-side RPCs validate only shape. `engine_assemble_draft` creates a
  `content_items` row for a `p_brief_id` that need not exist (§5.5).
- CC-licensed photographs render uncredited on every card surface, because the batched query drops
  the attribution columns (§4, R2).
- The freshness→update-proposal bridge sends a reason string its own RPC rejects, has never created a
  row, and discards the result (§Class 2).

Four of those six were confirmed against production, not inferred.

---

## 1. The pipeline, end to end

### 1.1 Orchestration

One Vercel Cron entry drives everything: `vercel.json` schedules `/api/engine/tick` at `30 4 * * *`
— **once per day**. `src/app/api/engine/tick/route.ts:46-78` defines thirteen stages that run
sequentially in dependency order inside a single request.

The design rationale is recorded in the route's own header (lines 20-45) and it is sound: the
Hobby-plan two-cron limit is answered by adding *stages*, not *schedules*, so stage ordering can
express real data dependencies (relevance sees this pass's discoveries; briefs see this pass's
relevance verdicts) instead of introducing a full cycle of lag between each stage.

Three orchestration properties are genuinely good:

- **Failure isolation.** Each stage runs in its own `try/catch` (`route.ts:91-100`), so one throwing
  stage cannot abort the pass.
- **Independent flag gating.** Every stage checks a flag before doing anything.
- **Per-stage audit.** Every stage writes its own `engine_job_runs` row, and the tick writes a
  summary row.

Three legacy single-purpose routes also exist — `/api/engine/discover`, `/api/engine/freshness`,
`/api/engine/opportunities` — each wrapping one stage. They are not scheduled but are live and
share the same auth.

### 1.2 Authentication and the execution identity

`src/lib/engine/cron.ts:44-67` — `checkCronAuth()` fails closed: a missing `CRON_SECRET` in
production returns 503 rather than allowing the request, and comparison is timing-safe. This was a
deliberate fix to an earlier state where an unset secret allowed everyone.

The load-bearing fact for everything downstream: **the engine runs as `anon`.** A Vercel Cron
invocation carries no cookies, so `createClient()` produces an unauthenticated client. This is
stated at `cron.ts:9-13` and is the reason every engine write goes through a narrow
`SECURITY DEFINER` RPC rather than a table write. Section 5 examines whether that boundary holds.

### 1.3 Stage-by-stage

| # | Stage | Module | Flag | Reads | Writes |
|---|---|---|---|---|---|
| 1 | discovery | `jobs/discovery.ts` | `discovery` | `engine_due_sources()`, remote feeds | `engine_upsert_discovery`, `engine_record_source_check` |
| 2 | relevance | `jobs/relevance-job.ts` | `discovery` | `engine_unclassified_discoveries` | `engine_set_relevance` |
| 3 | update_proposals | `jobs/update-job.ts` | `freshness` | `engine_briefable_discoveries`, `engine_existing_entities`, `engine_evidence_for` | `engine_upsert_update_proposal` |
| 4 | product_assembly | `jobs/product-job.ts` | `research` | as above + `engine_reference_data` | `engine_assemble_product`, `engine_record_entity_resolution` |
| 5 | briefs | `jobs/brief-job.ts` | `research` | `engine_briefable_discoveries`, `engine_evidence_for` | `engine_create_brief` |
| 6 | draft_assembly | `jobs/draft-job.ts` | `research` | `engine_assemblable_briefs`, `engine_existing_entities` | `engine_assemble_draft`, `engine_record_entity_resolution`, `engine_upsert_update_proposal` |
| 7 | search_intelligence | `jobs/search-job.ts` | `opportunity` | — | `engine_aggregate_searches` |
| 8 | opportunities | `jobs/opportunity-job.ts` | `opportunity` | `engine_opportunity_inputs` | `engine_upsert_opportunity` |
| 9 | trends | `jobs/trend-job.ts` | `opportunity` | `engine_trend_inputs` | `engine_upsert_trend`, `engine_expire_stale_trends` |
| 10 | media_acquisition | `jobs/media-acquisition-job.ts` | `research` | `engine_open_media_requirements`, **`engine_sources` (direct)** | `engine_record_media_candidate` |
| 11 | freshness | `jobs/freshness-job.ts` | `freshness` | `engine_freshness_candidates` | `engine_upsert_freshness`, `engine_upsert_update_proposal` |
| 12 | internal_links | `jobs/link-job.ts` | `freshness` | `engine_existing_entities`, `content_relationships`, `content_products` (direct) | `engine_upsert_freshness` |
| 13 | hero_media | `jobs/hero-media-job.ts` | `freshness` | `engine_existing_entities`, `content_media`, `product_media`, `media_assets` (direct) | `engine_flag_weak_hero` |

**Discovery** (`jobs/discovery.ts:33-143`). `engine_due_sources()` returns at most 25 sources past
their `check_frequency_hours`. `safeFetchText` (`cron.ts:124-147`) bounds each fetch to 10s, caps
the payload at 2MB, declares an honest User-Agent, and never throws. Feed items are classified by
`feed-parser.ts` and fingerprinted by `dedupe.ts`. On failure the source's health row is updated and
the pass continues. Crucially, a source that is *reachable but unparseable* is recorded as a failure
(lines 74-86) rather than as "no news" — the empty-vs-failed distinction applied correctly.

**Relevance** (`jobs/relevance-job.ts`). `classifyRelevance` (`relevance.ts:137-178`) is a weighted
keyword/pattern scorer, deterministic, no AI. Accept ≥ 5, reject ≤ 0, uncertain between
(`relevance.ts:134-135`). Nothing is deleted: a rejected discovery is parked in state `rejected`
with its score and explanation, and `engine_set_relevance` refuses to overwrite a row where
`relevance_overridden_by_admin` is true (`20260822_phase4_pipeline.sql:180`).

**Evidence and confidence.** `confidence.ts:67-123` is the strongest single piece of reasoning in
the codebase. Two mechanisms: a claim's confidence *ceiling* is set by its strongest evidence
(`CLAIM_CEILING`, lines 23-30) so twenty secondary outlets cannot exceed a secondary ceiling; and
corroboration counts only from sources with no `originates_from_url`, so circular reporting is
excluded outright (lines 79-96). `engine_upsert_discovery` reinforces this at the database level: a
repeat sighting raises `sighting_count` and recency but explicitly **does not** raise confidence or
promote `claim_status` (`20260821_growth_engine.sql:437-445`).

**Brief** (`jobs/brief-job.ts`, `brief-builder.ts`). A promotional classifier
(`promotional.ts:100-139`, threshold 8) runs first and skips vendor marketing copy. `buildBrief`
performs the verified/uncertain split: a fact enters `verifiedFacts` only when
`isPublishableAsFact` holds — `confirmed_primary` **and** confidence ≥ 0.8
(`confidence.ts:130-132`). Everything else is written into `uncertainties` phrased as an attributed
claim. Briefs enter `review_state = 'pending'`.

**Draft** (`jobs/draft-job.ts`, `draft-assembly.ts`). Gated on `review_state = 'approved'`
(`20260822_phase6_draft_assembly.sql:139`), i.e. a human action in an earlier pass. Entity
resolution runs first; a match against existing content produces an update proposal instead of a
second article, and an ambiguous match is held for a human. `assembleDraft` writes **structure and
quoted evidence only** — an editor banner, section placeholders, an explicit "Unverified — DO NOT
state as fact" block, and a source list. No prose is generated anywhere.

**Media.** `media-acquisition-job.ts` proposes candidate routes but never downloads, hotlinks, or
writes to `media_assets`. Original TechCarvalho graphics are the only class that skips rights
review; third-party imagery is always `requires_human_review = true` regardless of recorded terms
(lines 173-175).

**SEO / internal linking.** `proposeSeo` (`draft-assembly.ts:190-201`) derives a description only
from the brief's own question and returns `null` rather than inventing one. `link-job.ts` finds
orphans exactly but only *proposes* links, on measured grounds: the heuristic reproduced 6 of 29
editor-chosen links, and the module says so in its header (lines 20-33).

**Validation and publication.** Publication is a human action in the admin UI. Two guards exist and
are examined in §3.5.

**Freshness / update / monitoring.** `freshness-job.ts` flags stale published records and bridges
high-severity findings into the update-proposal queue. `hero-media-job.ts` classifies every
published page's hero against `media/hierarchy.ts` and records upgrade candidates without ever
unpublishing anything. `link-job.ts` reports orphans. All three are detection-only.

### 1.4 The single most important architectural property

**There is no LLM anywhere in the engine.** `ai-provider.ts` is an interface with a null
implementation (`NullAiProvider`, lines 49-66); `getAiProvider()` always returns it (line 77-79); no
vendor SDK is imported and no API key is read. Every stage — dedupe, relevance, confidence,
promotional detection, entity resolution, trend scoring, opportunity scoring, brief construction,
draft assembly — is deterministic, tested, and explainable.

This is the reason the anti-hallucination posture is strong (§3.5): the engine cannot hallucinate
because nothing in it generates text. Every string that reaches a draft is either a template
constant, a recorded evidence URL, or a source's own words. Any hardening work must treat this as
the property to protect, not as a limitation to remove.

---

## 2. Failure classes — what has actually gone wrong

This project has an unusually honest commit history: bugs are described mechanically, retractions
are explicit, and near-misses are recorded. Mining all 72 commits produces a taxonomy of **fifteen
recurring classes**. The ones that matter for autonomy are below, each with the historical instance
and — where it exists — **a live instance still present in the engine today**.

### Class 1 — Failure indistinguishable from an empty result

The governing class of this codebase. RLS and missing grants deny by returning **zero rows**, or by
PostgREST reporting the table as "not found in the schema cache", never by raising a permission
error.

*History:* the 2026-08 incident where `anon` held no table privileges and every public page rendered
an honest-looking "Coming soon" for weeks; discovered only by hitting production with raw `curl`.
Fixed structurally by `src/lib/log/query-error.ts`, `QueryErrorBanner`, and
`DashboardCounts.hasError`. Later caught *before shipping* twice, by explicitly pattern-matching
against it (`b58dc7a`, `28cb448`).

**Live instance — `media-acquisition-job.ts:93-98`.** The stage reads the source registry directly:

```ts
const { data: sources } = await supabase
  .from("engine_sources")
  .select("id, organisation, media_rights_status, media_republication_permitted, terms_url, registration_required");
```

`engine_sources` is admin-only under RLS with a grant only to `authenticated`. **[verified live]** a
direct `anon` read returns `HTTP 200` with `[]` — no error. The `error` field is not destructured,
so nothing could report it even if there were one. The consequence is not a crash: `sourceByOrg` is
permanently empty, so **every** manufacturer media candidate is written with
`rightsStatus = "unverified"`, `p_confidence: 0.1`, and the reason string *"No assessed source on
file for X. Rights are unknown"* — including for manufacturers whose terms **have** been reviewed and
recorded. The entire `src` branch at lines 151-157 is dead code. This is the flagship failure class,
reproduced verbatim, in the one stage whose whole purpose is rights accuracy.

### Class 2 — Silent write loss

*History:* `recordOutboundClick` fired `void supabase.from(...).insert(...)` with no error handling
while `link_position: 'family_page'` was absent from the CHECK vocabulary — every family-hub click
was rejected by the constraint and discarded, *"indistinguishable from 'nobody clicked'"* (`982caf6`).
And the analytics `upsert()` chain, where two unchecked errors cascaded into an FK failure with no
visible cause (`88350d0`).

**Live instance — `freshness-job.ts:93-111` writes into a vocabulary that rejects it.**
`engine_update_proposals.reason` permits `'stale_content'` at the table level
(`20260822_phase6_draft_assembly.sql:45`), but the RPC's own validation list omits it
(same file, line 287):

```sql
if p_reason not in ('firmware_update','successor_released','discontinued','spec_change',
                    'price_change','newer_evidence','broken_source') then
  return 'rejected_invalid';
```

`freshness-job.ts:100` sends exactly `'stale_content'`. **[verified live]** calling
`engine_upsert_update_proposal` with that reason returns `"rejected_invalid"`. And the call site at
line 93 is a bare `await supabase.rpc(...)` — neither `data` nor `error` is captured, and no counter
moves. **The age-based half of the freshness→update-proposal bridge has never created a single row,
and there is no signal anywhere that it hasn't.** Only the `broken_source` half works.

**Live instance — eleven error-discarding call sites.** Every engine RPC call that drops its result:

| File:line | Call | Consequence when it fails |
|---|---|---|
| `discovery.ts:65, 80, 127` | `engine_record_source_check` | Source health silently not updated; the health page reports stale truth |
| `draft-job.ts:95` | `engine_record_entity_resolution` | The "why didn't this create an article?" audit record is lost |
| `draft-job.ts:110` | `engine_upsert_update_proposal` | `counters.deduped++` still runs — the brief is counted as handled while no proposal exists |
| `freshness-job.ts:93` | `engine_upsert_update_proposal` | Above — proven to always fail |
| `product-job.ts:100` | `engine_record_entity_resolution` | Audit record lost |
| `media-acquisition-job.ts:93` | `engine_sources` select | Class 1, above |
| `product-job.ts:139`, `update-job.ts:83` | `engine_evidence_for` | `sourceUrls`/`evidence` silently become `[]` — a product is created **with no sources attached**, or a proposal with no evidence |

The last row is the sharpest: `product-job.ts:139` discards the error, so a transient failure
produces a catalogue row whose provenance is simply missing, and the run still reports success.

### Class 3 — Verification against a report rather than the running system

*History:* the richest vein. A migration's `drop constraint if exists` silently no-opping on a name
mismatch and creating a *second* independently-enforced CHECK, so the migration "succeeded" while the
old constraint kept rejecting rows (`20260820_content_troubleshooting_type.sql`). The repeated
discipline of *"not just trusting 'Success. No rows returned.' from the SQL editor"*. And the best
commit in the history, `4e0f83e`, which **deleted** an `--allow-uncredited` flag and replaced it with
a live `fetch` of a production article asserting the rendered HTML contains both a licence-deed link
and a source link:

> *"A flag asserting 'the credit renders now' is a promise, and a promise is the wrong instrument for
> a licence condition."*

**Live instance — `supabase/migrations_pending/` is not a reliable record of what is applied.**
The directory convention exists precisely to answer this class. **[verified live]** it currently
answers it wrongly in both directions:

- `engine_flag_weak_hero` sits in `migrations_pending/20260822_hero_media_upgrade.sql`, described as
  *"Drafted, not run"* — but production returns `"rejected_invalid"` to a probe, so **it is applied**.
- `trend-job.ts:154` still tells operators that `engine_expire_stale_trends` *"may not be applied yet
  (supabase/migrations_pending/20260822_trend_decay_expiry.sql)"* — but that file is in
  `migrations/`, and production answers the RPC. The warning text is stale.

Neither is dangerous today. Both mean the directory is a *claim* about production, maintained by
hand, currently wrong — which is exactly the instrument this class warns against.

### Class 4 — Trusting a flag or badge instead of the underlying evidence

*History:* a Commons file with a clean CC badge whose raw EXIF asserted "all rights reserved"; photos
of a church anniversary mass miscategorised into `Category:Canon EOS R6`; Openverse rejected on
principle because it *"presents each result with a clean licence badge and no route to the evidence
underneath"*; `asset_role` distrusted in `media/hierarchy.ts` because it was backfilled.

*In the engine today this class is handled well.* `confidence.ts` refuses to let repetition raise a
claim; `engine_upsert_discovery` refuses to promote `claim_status` on a repeat sighting;
`media-acquisition-job.ts:173-175` forces `requires_human_review = true` on third-party imagery
*"regardless of how favourable the recorded terms look"*. This is the class the architecture is most
consciously built against.

### Class 5 — Data written but never read (or read but never written)

*History:* `outbound_click_events` had a table, RLS and an admin dashboard reading it while nothing
in the app ever inserted; `content_relationships` had an admin curation UI but the public page never
queried it, because of a stale code comment; `engine_upsert_freshness`'s `'missing_internal_links'`
reason sat unused in the schema since Phase 3.

**Live instance — `isVerbatimVendorHeadline` has zero production call sites.**
`promotional.ts:148-156` exists, is exported, and is tested. Nothing calls it. Meanwhile
`brief-builder.ts:184` still does `proposedTitle: input.title.slice(0, 300)` — the vendor's headline
verbatim — and `draft-job.ts:186` passes that straight through to `content_items.title`. The exact
mechanism the A6 incident identified (*"the brief builder was taking the vendor's headline verbatim
as the proposed article title"*) is unchanged; only the promotional *filter* was added in front of it.
A newsworthy vendor announcement that scores below the promotional threshold still becomes an
article title copied word-for-word from the manufacturer.

**Live instance — `engine_job_runs.idempotency_key` has no writer.** The column and its partial
unique index exist (`20260821_growth_engine.sql:306, 318-320`) and are documented as *"the
idempotency substrate"*. `engine_record_job_run` has **no parameter for it**, so it is never set. See
§3.17.

### Class 6 — Write-once column with no writer, trusted by a UI that filters on it

*History:* `engine_trends.is_active` defaulted to `true` and **nothing in the repository ever set it
false**, while `/admin/engine/trending` filtered on it. A trend scored during one busy week stayed at
the top of a ranking claiming to describe the present, forever. Fixed properly in
`20260822_trend_decay_expiry.sql` with two deliberately different exits (`evidence_horizon` applies
even to unscored rows; `below_floor` is grace-gated so a *low but current* measurement is never
mistaken for a stale one), and decay never overwrites `trend_score`.

This is now the best-engineered corner of the engine, and it was proven against production with a
synthetic stale row inserted and removed. **[verified live]** the RPC exists and returns cleanly.

### Class 7 — Structural proxy mistaken for a semantic test

*History:* the product detector required only *a digit or an all-caps token*, so `"$15 Billion"`,
`"RAMP-C"` and `"AI"` all qualified. Seven real production discoveries would have become catalogue
rows, including a product called "NVIDIA Alpamayo 2 Super" — an AI model. The load-bearing detail:
relevance could not be the guard, because Alpamayo is **correctly** relevant. Fixed with the
`NOT_A_PRODUCT` veto list (`product-signals.ts:53-81`), title-only so a summary mentioning the cloud
cannot veto a genuine hardware launch.

**Live residue — `product-job.ts:166`** distinguishes a returned UUID from a sentinel string with
`typeof result === "string" && !result.includes("-")`. It works, because UUIDs contain hyphens and
every sentinel uses underscores — but it is a shape sniff, not a contract. Any future sentinel
containing a hyphen would be silently treated as a created product id.

### Class 8 — Input-distribution failure read as a model failure

*History:* twice, and both times the pipeline was working correctly on a corpus that was 100% one
kind of thing. All 16 briefs the engine ever produced were press releases, because all four active
sources were vendor newsrooms. Then, once ten non-vendor feeds were added, the relevance vocabulary —
*tuned on vendor PR* — scored genuine category news at zero (`"VESA Introduces DisplayHDR True Black
1400"` → 0, rejected). Both fixed by measurement against real corpora, with rejected sources kept in
the registry *"as a recorded negative so nobody re-adds it by the same reasoning"*.

This is the class most relevant to autonomy: **the engine's classifiers are only as good as the
distribution they were tuned on, and nothing currently monitors for distribution drift.**

### Class 12 — Default-permissive behaviour never explicitly overridden

*History:* Postgres grants `EXECUTE` to `PUBLIC` on every new function unless revoked — so
`compute_analytics_rollup` was callable by any unauthenticated visitor. RLS policies were written
without the base `GRANT`s they depend on (*"RLS only ever RESTRICTS an operation a role's grants
already permit"*). And `checkCronAuth` returned `null` — allow — when `CRON_SECRET` was unset,
leaving every scheduled endpoint publicly callable.

All three are fixed, and the engine RPC migrations now consistently pair
`revoke execute ... from public` with an explicit grant. That discipline holds across all 27 engine
functions. See §5 for what the grant itself still permits.

### Classes not currently reproduced in the engine

Worth recording, because hardening should not spend effort here: **Class 9** (two-column state
machine with one column written) was fixed and is now explicitly asymmetric — rejection retires both
`review_state` and `state`, while approval deliberately advances neither, *"nothing moves through the
pipeline automatically because a human said yes."* **Class 13** (placeholder fed into a real
calculation) is actively guarded: `opportunity-job.ts:56` converts the `9999` sentinel to `null`
rather than carrying it through as a real age, and `trends.ts` returns `score: null` rather than `0`
when nothing is measurable, because *"'no data' and 'no interest' are different claims."*

---

## 3. Gap analysis against autonomous operation

For each dimension: what exists, what is missing, and the risk if autonomy were enabled.

### 3.1 Publication safety gate

**Exists.** One publish-conditional check in the entire application: `content/actions.ts:70-77` runs
`findUnfinishedAssemblyMarkers(body)` and refuses to publish a body still containing engine
scaffolding. It is well-reasoned — `draft-assembly.ts:157-178` defines the markers beside the code
that emits them so they cannot drift — and it is enforced in the Server Action, not the UI. Below it,
`published_at` auto-fills so a "published" row is not silently invisible.

**Missing.** *Everything else.* `evaluateMediaReadiness` — the function whose own header calls itself
*"the single gate a future batch/manual publish flow should call"* — is invoked in exactly three
places, all display-only Server Components (`media-requirement-card.tsx:49`,
`engine/drafts/page.tsx:178`, `media/requirements/page.tsx:82`). `engine/drafts/page.tsx:176-177`
says so outright: *"run here purely to display the blocker. Nothing on this page acts on the
result."* **Zero Server Action, API route, or database call sites.** There is no CHECK constraint, no
trigger (all five triggers in `supabase/` are `set_updated_at` timestamp touches), and no `raise
exception` anywhere in any migration. The RLS policy for products
(`20260819202305_rls_policies.sql:103-105`) is `for all to authenticated using (is_admin()) with
check (is_admin())` — the `WITH CHECK` inspects nothing else, so
`update products set is_published = true` on a media-less row is accepted by the database.
`products/actions.ts` has **zero** publish-conditional validation: `is_published` is a bare checkbox
read and written verbatim. Content can publish with a `null` body.

The `awaiting_media` status was invented *for* the media-first rule, and nothing prevents
`awaiting_media → published`.

**Risk if autonomy is enabled.** Total. There is no gate to enable autonomy *through* — the
media-first rule, which CLAUDE.md and three separate design documents treat as inviolable, is a badge
on an admin page. Any autonomous publish path would be writing into a system whose only publication
precondition is a string search for `"[Write this section"`.

### 3.2 Per-dimension confidence

**Exists, and this is the engine's best-developed idea.** Confidence is not one number but a
decomposition: `confidence.ts` separates *claim ceiling* (set by strongest evidence) from *source
credibility* (`TRUST_BASE`) from *corroboration* (independent sources only, capped at +0.18), and
returns `effectiveClaimStatus`, `independentSources`, `derivativeSources` and a prose explanation
alongside the score. `trends.ts` does the same with `contributing_signals` as a named breakdown, and
separates score from confidence entirely — reporting `score: null` when nothing is measurable rather
than 0, because *"'no data' and 'no interest' are different claims."*

**Missing.** The dimensions are not the ones a *publication* decision needs. There is a confidence
score for "is this claim true", but none for: is this topic worth covering, is this draft complete,
is this hero image adequate, are the internal links correct, does the media clear rights, is the
category assignment right. Those judgements exist as separate boolean-ish signals in unrelated
modules with no common aggregation. There is no single "readiness" vector for a candidate article.

**Risk.** Moderate. An autonomous gate would have to invent an aggregate, and the tempting move —
averaging the signals — would let a strong confidence score mask a failing rights check. The
architecture's own principle (ceilings, not averages) is the right answer and is already proven in
`confidence.ts`; it just has not been generalised.

### 3.3 Source-quality hierarchy

**Exists and is well-reasoned.** `trust_level` ∈ `primary | secondary | community` on
`engine_sources`, with `TRUST_BASE` mapping it to credibility. Vendor newsrooms stay `primary`
because *"a vendor is the most reliable source for what that vendor is doing"*; DPReview is
deliberately `secondary` so it *"cannot reach `confirmed_primary` and cannot corroborate itself"*.
Media rights are tracked on **three independent permissions** — `discovery_permitted`,
`media_browsing_permitted`, `media_republication_permitted` — with a deliberate note that being
allowed to read facts never implies permission to republish imagery.

**Missing.** Two things. First, **vendor-ness is not a stored column.** The source registry tracks
trust, not independence, and most non-vendor additions (NASA, ESA, Mozilla, VESA) are also `primary` —
so "is this an independent outlet?" cannot be derived from the schema. The distribution failure in
Class 8 (a corpus that was 100% vendor) is therefore still not *measurable* from the data; it was
found by a human reading briefs. Second, **`confidence.ts` never sees `trust_level` from the source
registry at decision time** — it reads it off the evidence row, which `engine_upsert_discovery`
copies from whatever the caller passed.

**Risk.** Moderate-high under autonomy. Without a stored independence axis, "two independent sources
confirm this" cannot be checked against "both are vendor newsrooms owned by the same company".

### 3.4 Claim-level evidence coverage

**Exists in structure.** `engine_discovery_evidence` links every claim to its URLs, `source_records`
travels with every assembled draft and product, and `brief-builder.ts` performs the verified/uncertain
split so an unconfirmed claim is written as an attributed claim rather than a fact.

**Missing.** Coverage is at *discovery* level, not *claim* level. A brief has one confidence score
for the whole headline; there is no mapping from an individual sentence or fact to the evidence that
supports it. `assembleDraft` emits a global source list, not per-claim citations. So "every claim in
this article is backed" is not a checkable property — and `freshness-job.ts:57-63` already surfaces
the consequence: it flags records with `source_count === 0` because *"its factual claims cannot be
re-verified against anything"*, which is the only claim-coverage check that exists and it is binary.

**Risk if autonomy is enabled.** High. Autonomous publication requires being able to answer "which
evidence supports this sentence" for every sentence. Today the answer is "here are the article's
sources, somewhere among them."

### 3.5 Anti-hallucination

**Exists, and it is the strongest control in the system — by construction rather than by policy.**
There is no LLM. `getAiProvider()` returns `NullAiProvider` unconditionally. Every string that
reaches a draft is a template constant, a recorded URL, or a source's own words. `assembleDraft`
writes structure and quoted evidence only, and prefixes unconfirmed material with an explicit
*"Unverified — DO NOT state as fact"* block. `engine_assemble_product` deliberately writes **no**
specifications, prices, release dates or summary — *"those are the fields a machine would have to
invent"* — leaving them null with sources attached. `proposeSeo` returns `null` rather than inventing
a description. `engine_assemble_draft` refuses to invent a manufacturer: `products.manufacturer_id`
is `NOT NULL` and the RPC returns `unknown_manufacturer`.

**Missing.** Nothing, *while the null provider holds*. The gap is that the guarantee is a property of
the current implementation, not an invariant: `ai-provider.ts` documents four intended use cases and
`AI_USE_CASES` explicitly anticipates `draft_outline` and `rewrite_headline`. The moment a real
provider is constructed at line 78, every downstream guarantee changes character, and there is no
test, constraint, or gate that would notice.

**Risk.** Currently zero, and this must be stated plainly: **the engine cannot hallucinate.** The
risk is entirely about the transition. Hardening should make the null-provider guarantee explicit and
enforced (a test asserting no draft body contains text not traceable to a template or an evidence
row) *before* a provider is ever added, not after.

### 3.6 Adversarial review

**Exists in a narrow, real sense.** Several stages are deliberately built to argue against the
previous one: `promotional.ts` exists solely to reject what `relevance.ts` accepted, on the explicit
grounds that they are *different axes*; `product-signals.ts`'s `NOT_A_PRODUCT` veto exists solely to
reject what relevance correctly accepted; `entity-resolution.ts` has two hard guards
(`MODEL_DISCRIMINATORS`, model-number mismatch) that override the containment bias specifically
because *"containment alone happily merges a product into its own successor."* The `ambiguous` band
(0.55–0.80) is a genuine "refuse to decide" state, and both `draft-job.ts:134-137` and
`product-job.ts:117-120` honour it by holding for a human.

**Missing.** There is no adversarial pass over the *output*. Nothing reads an assembled draft and
asks "is this actually supported, is it duplicative, is this title just the vendor's headline?" —
and `isVerbatimVendorHeadline`, written for exactly that, is never called (§Class 5).

**Risk.** High under autonomy. The existing adversarial checks all sit at the *input* end. The output
end has one string-matching check.

### 3.7 Run modes (OFF / SHADOW / CANARY / AUTONOMOUS)

**Exists.** Six booleans in `engine_settings`: `master_enabled` plus four capability flags plus
`autonomous_publishing_enabled`. `engine_flag_enabled` short-circuits on `master_enabled` and fails
closed on an unknown flag (**[verified live]** `bogus_flag` → `false`).

**Missing.** There are no *modes*, only on/off switches per capability, and they are not composable
into the four states named above. Specifically:

- **SHADOW** — no concept. There is no way to run a stage and record what it *would* have done
  without doing it. Every enabled stage writes for real.
- **CANARY** — no concept. No per-category, per-source, or percentage-based scoping. A flag is global.
- **AUTONOMOUS** — the flag exists and is read by nothing (§5.4).

Worse, the flags are **capability** switches, not **risk** switches. `research` simultaneously gates
brief generation (read-mostly, low risk), draft assembly (writes `content_items`), product assembly
(writes `products`), and media acquisition. There is no way to enable briefs without also enabling
row creation in the public catalogue tables.

**Risk.** High. Enabling autonomy means flipping a boolean whose blast radius is the whole
capability, with no staged rollout and no reversible observation period.

### 3.8 Shadow evaluation

**Exists in spirit, manually.** The project has a genuine culture of it: the promotional classifier
was evaluated against all 16 real briefs before shipping; the relevance vocabulary was re-measured
against ten new feeds; the link heuristic was scored against 29 editor-chosen links and *reported its
6-of-29 hit rate in the output it produces* (`link-job.ts:100-106`); `product-signals.ts` was tested
against seven real production discoveries, all now permanent regression tests.

**Missing.** None of it is automated or repeatable. There is no held-out corpus, no stored
ground-truth labels, no scheduled re-evaluation, and no metric that would show a classifier degrading.
The regression tests are unit tests over hand-copied strings, not a corpus. `relevance_overridden_by_admin`
exists on `engine_discoveries` and is honoured by `engine_set_relevance` — **it is a perfect
ground-truth signal for classifier accuracy, and nothing computes anything from it.**

**Risk.** High. Class 8 (input-distribution drift) is the failure most likely to recur, it recurred
twice already, and both times it was caught by a human reading output. Under autonomy there is no
human reading output.

### 3.9 Circuit breakers

**Exists, partially, at the source level only.** `engine_sources.consecutive_failures` is incremented
by `engine_record_source_check` and rendered in red on the admin page — but **nothing acts on it**.
There is no threshold at which a source is deactivated; `engine_due_sources()` filters on `is_active`
and `discovery_permitted`, never on failure count. Deactivation is a manual admin action (as happened
with IETF, deliberately, after measurement).

**Missing.** Every other kind. No breaker on: consecutive job failures, error rate within a pass,
anomalous creation volume, or repeated `rejected_invalid` returns. `tick/route.ts:90-100` runs all
thirteen stages regardless of how many have already failed. There is no state that says "the engine
tripped and is holding".

**Risk.** High. The `stale_content` defect (§Class 2) is the proof: a call that returns
`rejected_invalid` on 100% of invocations, every night, indefinitely, with nothing tripping.

### 3.10 Rate limits and budgets

**Exists, and is genuinely well-bounded — for the current workload.** `engine_due_sources()` caps at
25 sources per pass and respects `check_frequency_hours`. `safeFetchText` bounds each fetch to 10s
and caps payloads at 2MB. Per-stage row limits are explicit (`p_limit` of 10/15/30/200/500). The cron
runs **once daily**. There are no paid API calls at all, so there is no spend to control.

**Missing.** Three things. First, **no total-work budget** — nothing caps how many drafts or products
a single pass may create; the limits are per-query, not per-outcome. Second, **no wall-clock budget**:
`tick/route.ts` exports no `maxDuration`, and discovery alone can consume 25 × 10s = 250s of fetch
time before twelve further stages run. On Vercel's default function timeout the pass can be killed
mid-flight — at which point the final `recordJobRun` at line 104 never executes, so **a timed-out
tick leaves no summary row at all**, and looks like a tick that never ran. Third, no budget on
`engine_expire_stale_trends`, whose thresholds are caller-supplied (§5.3).

**Risk.** Moderate now, high under autonomy — because the missing budget is on *outcomes*, which is
exactly what autonomy would start producing.

### 3.11 Rollback

**Exists for one thing, well.** Trend expiry is reversible by design: `is_active` is flipped, never
deleted, the measurement and its explanation survive, and `engine_upsert_trend` reactivates a topic
when fresh measurable evidence arrives. Relevance rejection is also non-destructive — a rejected
discovery is parked, inspectable, and admin-overridable.

**Missing.** For everything the engine creates. There is no `created_by_engine` marker on
`content_items` or `products`, no batch or run id linking a row to the tick that made it, and no
"undo this pass" action. `engine_briefs.assembled_content_id` is the only link, and only for drafts —
`engine_assemble_product` accepts `p_discovery_id` and **discards it**, so an engine-created product
has no recorded provenance back to its discovery at all. The
`engine_entity_resolutions` log records decisions but not creations.

This is not theoretical: the history records that *"nothing in the engine has ever created a product
row… how the 22 were created is therefore unestablished"* — a question that was unanswerable
precisely because no provenance marker exists.

**Risk.** High. A misbehaving autonomous pass would produce rows indistinguishable from
human-authored ones, with no way to enumerate or reverse them.

### 3.12 Self-monitoring

**Exists, and the *derivation* is good.** `engine/page.tsx` computes `failingJobs` and renders it as
a red card above the job table, including a "has never succeeded" state and the raw error text. It
tracks `last_run` and `last_success` **separately** — a deliberate fix, because *"a job failing
nightly still has a recent run, and only the gap between the two reveals it."* A 10-run sparkline per
job gives trend at a glance.

**Missing, and this is the sharpest gap in the section.** Three compounding defects mean the engine
cannot reliably report its own failure:

1. **`recordJobRun` swallows its own failure** (`cron.ts:103-106`). The rationale — *"an unwritable
   audit row is worth a lost log line, not a failed job"* — is defensible for a single stage, but the
   consequence is that the one surface where failures are observable is written by a function that
   cannot report being unable to write.
2. **The tick summary can never say "failed".** `tick/route.ts:103` reads
   `anyFailed ? "partial" : anySkipped ? "success" : "success"` — the two branches are identical and
   `"failed"` is unreachable.
3. **Engine Server Actions swallow every error.** None of the twelve writes in `engine/actions.ts`
   checks the returned `error`. Including `updateEngineSettings` at lines 61-73 — **so flipping the
   master kill switch OFF and having the write silently fail would leave the operator believing the
   engine is stopped while it continues running.** That is the Class 1/Class 2 failure applied to the
   safety control itself.

**Risk.** Very high. Self-monitoring that cannot report its own failure is the precondition for every
incident in §2.

### 3.13 Autonomous freshness

**Exists as detection, deliberately and correctly.** `freshness-job.ts` flags stale records;
`link-job.ts` finds orphans; `hero-media-job.ts` classifies weak heroes. All three are explicitly
detection-only and say so: *"generate update recommendations rather than silently rewriting published
factual content"*; a weak hero *"is not a reason to hide a page"* and never overwrites an existing
`media_requirements` row, and writes `sourcing_status='sourcing'` rather than `'needed'` *"so the
count of genuinely blocked media stays meaningful."* That restraint is right and should be kept.

**Missing.** The bridge from detection to action is broken in its main path — the `stale_content`
proposal has never been created (§Class 2) — and the staleness threshold is a hardcoded
`STALE_DAYS = 180` in `freshness-job.ts:8`, duplicating rather than reusing
`FRESHNESS_OVERDUE_DAYS` in `src/lib/admin/freshness.ts`, which CLAUDE.md names as the single place
these are defined.

**Risk.** Moderate. Autonomous freshness *action* (as opposed to detection) is the one autonomy that
would be relatively safe here, because updating an existing page against new evidence is a narrower
act than authoring one — but it depends on claim-level evidence coverage (§3.4), which does not exist.

### 3.14 Observability

**Exists, and the breadth is genuinely impressive:** fifteen admin engine pages covering source
health, discoveries with relevance overrides, briefs, drafts with a media-gate badge, update
proposals, entity resolutions (including the no-op decisions, so *"why didn't this create an
article?"* has an answer), searches, freshness, trends, opportunities, media acquisition, media
blockers, and homepage selection. Job runs carry structured `detail` jsonb, and jobs deliberately
report things that are neither success nor failure — `heldForReview`, `notAnUpdate`,
`notAProductAnnouncement`, `promotional` — so a quiet pass is *visibly* quiet rather than ambiguous.
That distinction is the direct product of the Class 1 lesson and it is applied consistently.

**Missing.** It is **100% pull-based.** There is no alerting of any kind — no email, webhook, Slack,
Sentry, or push integration exists anywhere in `src/`. There is no machine-readable health endpoint;
every surface is a Server Component behind `requireAdmin()`, so an external monitor would have to be
built from scratch. If nobody opens `/admin/engine`, a job that has never succeeded stays invisible
indefinitely.

**Risk.** High under autonomy. Dashboards work when a human runs the system daily. Autonomy is
precisely the state in which nobody is looking.

### 3.15 Readiness scorecard

**Exists.** Nothing.

**Missing.** There is no composite readiness assessment for a candidate — no per-record scorecard
combining confidence, evidence coverage, media clearance, link health, duplicate risk and category
confidence into a single reviewable verdict. `engine/drafts/page.tsx` comes closest (it counts drafts
passing the media badge) but it is a per-page count, not a per-record scorecard, and nothing acts on
it.

**Risk.** High as a *prerequisite*: an autonomous publish gate is exactly a readiness scorecard with
a threshold. Its absence means there is no artefact to review, calibrate, or shadow-evaluate before
switching anything on.

### 3.16 Chaos testing

**Exists in the culture, not in the code.** The history shows genuine adversarial verification: a
synthetic stale trend inserted into *production* and removed to prove expiry works; rate limiting
tested with 65 rapid events (61 accepted / 4 rejected, DB count matching); a reverse relationship row
actually inserted to confirm the unique index rejects it; a live `fetch` of production HTML to prove
a licence credit renders.

**Missing.** None of it is repeatable. 438 tests pass and all 20 test files cover **pure functions
only** — rights eligibility, slugify, confidence, freshness bucketing, trend decay, JSON-LD. There
are no tests for: a source returning malformed XML, a source returning HTML instead of a feed, an RPC
returning `rejected_invalid`, a partial failure mid-pass, a timeout, or two ticks running
concurrently. Every failure mode in §2 is a *runtime* one, and the test suite tests no runtime paths.

**Risk.** High. The `stale_content` defect would have been caught by a single test asserting that
every reason string a job sends is accepted by the RPC that receives it.

### 3.17 Idempotency and concurrency

**Exists, at the row level, and it is done properly.** Every write RPC is idempotent by construction:
`engine_upsert_discovery` dedupes on fingerprint; `engine_upsert_freshness` keeps one open review per
`(entity, reason)`; `engine_update_proposals` has partial unique indexes enforcing one open proposal
per `(target, reason)` and the RPC catches `unique_violation` to refresh rather than duplicate;
`engine_create_brief` relies on `engine_briefs_one_live_per_discovery`; `engine_assemble_draft` and
`engine_assemble_product` both reject on slug collision. In-pass state is kept current too —
`draft-job.ts:214-219` adds new slugs to `takenSlugs` so two briefs in one pass cannot collide.

**Missing.** **Run-level idempotency and any concurrency control.** `engine_job_runs.idempotency_key`
and its partial unique index exist and are documented as *"the idempotency substrate — a job can
check 'did I already run for this key?' before doing work again"* — and
`engine_record_job_run` **has no parameter for it**. Nothing ever writes it. There is no advisory
lock, no "running" guard, and the three legacy single-purpose routes (`/api/engine/discover`,
`/freshness`, `/opportunities`) can be invoked concurrently with a tick. Two overlapping passes would
both run all thirteen stages; the row-level idempotency would mostly save them, but the counters,
`consecutive_failures` bookkeeping and job-run log would be wrong, and `engine_expire_stale_trends`
would race the re-measure phase.

**Risk.** Moderate today (one cron, once daily). High under autonomy, where retries and more frequent
passes are the obvious first change.

### 3.18 Security boundary

Covered in full in §5. Summary: the narrow-RPC design is right, the `revoke ... from public`
discipline is applied consistently, no service-role key exists, and publication is blocked by
hard-coded literals in the RPCs rather than by a flag — which is the strong form. But the grant is to
`anon`, `anon` is the publicly-shipped key, three write functions check no flag at all, and
`engine_assemble_draft` never validates that its `p_brief_id` refers to an approved brief.

**Risk.** High and independent of autonomy — this is exploitable today.

---

## 4. Ranked risk

Ranked by *"what would cause the worst outcome soonest if autonomy were switched on tomorrow"* —
severity × how quickly it fires × how long it would stay undetected. The last factor dominates: this
codebase's entire failure history is about things that were wrong for weeks while looking fine.

### Tier 0 — Live today, independent of autonomy

**R1. Any holder of the publishable key can write to `content_items` and `products`.**
§5.1–5.3, and §5.5 for the mechanism. `engine_assemble_draft` never validates `p_brief_id` — it
inserts the `content_items` row before touching `engine_briefs` at all — so the human-approval gate
that `draft-job.ts` enforces in TypeScript is not enforced by the function it calls.
`engine_assemble_product` discards `p_discovery_id` entirely, so it has no antecedent whatsoever. The
three functions that write to public-facing tables check no flag, so the master kill switch does not
close this path.
Exploitable now, from a browser, with a key that ships in every page. Nothing would publish, but rows
would appear in the editor's queues indistinguishable from real ones, and `engine_record_job_run`
would let an attacker forge the audit trail that an operator would use to investigate. Worst outcome
soonest, and it does not need autonomy to fire.

**R2. Published CC-licensed photographs render with no credit on every card surface.**
`hero-image.ts:195-197` omits `attribution`, `attribution_required` and `creator` from the batched
list-page query, so `cards.tsx:133` renders `attributionRequired: undefined` for every row — on the
homepage, trending rails, every category and search grid, and the related rails on article pages. The
credit **cannot** be added at the render site because the query dropped it. This is the 2026-08-22
licence incident reproduced exactly one layer out: the DB has the credit, the query discards it, the
render can never show it. A licence-condition breach is a legal exposure, not a quality issue, and
the last one was found only by fetching production HTML. Compounding it, `article-lead-media.tsx:62`
gates the hero credit on the DB column `attribution_required` rather than on the licence string, so a
single wrong column value silently removes the credit. `licence-links.ts:44` exports
`requiresAttribution()`, which reads the licence *string* and would catch that contradiction — and it
is never called at render time; its only non-test callers do not exist. The product hero avoids the
whole problem by calling `MediaCredit` unconditionally (`product-lead-media.tsx:108`) and letting it
degrade; the article hero does not.

**R3. The kill switch can fail silently.**
§3.12. `engine/actions.ts:61-73` writes `engine_settings` and never checks the returned `error`. An
operator who flips `master_enabled` off, sees the page re-render, and walks away may have changed
nothing. This is the one control that must never fail quietly, and it is written by a path that
cannot report failure — while `recordJobRun` (`cron.ts:103-106`) also swallows its own failure and
`tick/route.ts:103` can never emit `"failed"`. Three independent defects in the mechanism by which
the system reports it has stopped.

### Tier 1 — Would cause the worst outcome fastest under autonomy

**R4. There is no publication safety gate to attach autonomy to.**
§3.1. `evaluateMediaReadiness` blocks nothing; there is no constraint, no trigger, no Server Action
check. The media-first rule — treated as inviolable across CLAUDE.md and three design documents — is
a badge. Adding autonomous publishing to this system means adding a writer to a table whose only
publication precondition is a string search for engine scaffolding. Everything else in Tier 1 is
downstream of this one.

**R5. `autonomous_publishing_enabled` is inert, and the operator model assumes it is not.**
§5.4. Verified live: nothing reads it. The real boundary is hard-coded literals in two RPCs, which is
the *stronger* design and should be kept. The danger is the mismatch: the admin page presents the
toggle as the control, so the natural implementation of autonomy is "gate it on the flag" — using an
interlock that has never been exercised, while widening the structural boundary that was actually
doing the work. Ranked this high because it is the specific mistake most likely to be made first.

**R6. Nothing would notice for weeks.**
§3.9, §3.12, §3.14. No alerting of any kind, no machine-readable health endpoint, no circuit breaker
on repeated failure. The `stale_content` defect is the existence proof: an RPC returning
`rejected_invalid` on 100% of calls, nightly, indefinitely, with the call site discarding the result
and no counter moving. Autonomy is by definition the state in which nobody is reading the dashboard,
and this system's dashboards are the only failure channel that exists.

**R7. No rollback and no provenance on engine-created rows.**
§3.11. No `created_by_engine`, no run id, and `engine_assemble_product` accepts `p_discovery_id` and
discards it. A bad pass produces rows that cannot be enumerated, attributed, or reversed. The history
already contains an instance where "how were these 22 product rows created?" was unanswerable for
exactly this reason. Under autonomy the volume is higher and the question is asked under pressure.

### Tier 2 — Would degrade quality steadily rather than fail loudly

**R8. Classifier drift is unmeasured, and it is this system's most-repeated failure.**
§3.8, Class 8. Twice the pipeline was working correctly on a corpus that had shifted underneath it,
and both times a human reading output caught it. `relevance_overridden_by_admin` is a ready-made
ground-truth signal and nothing computes accuracy from it. Ranked below Tier 1 only because it
degrades gradually.

**R9. No claim-level evidence coverage.**
§3.4. Evidence attaches to discoveries, not sentences. "Every claim in this article is supported" is
not a checkable property, and autonomous publication is precisely the act of asserting it.

**R10. No shadow or canary mode; flags are capability-scoped, not risk-scoped.**
§3.7. `research` gates brief generation *and* `content_items` creation *and* `products` creation
together. There is no way to observe autonomy without enabling it, and no way to enable it for one
category first.

**R11. Vendor headlines still become article titles.**
§Class 5. `brief-builder.ts:184` copies the source headline verbatim; `isVerbatimVendorHeadline` was
written for this and is never called. The promotional filter catches the egregious cases; a
newsworthy vendor announcement below threshold still produces a title copied word-for-word from the
manufacturer. Thin-content risk and a plagiarism-adjacent one.

**R12. Eleven error-discarding call sites, two of which lose evidence.**
§Class 2. `product-job.ts:139` discards the error from `engine_evidence_for`, so a transient failure
creates a catalogue row with no sources attached and reports success — producing exactly the
"published record with no evidence" state that `freshness-job.ts` exists to detect.

**R13. `media-acquisition-job.ts` cannot read the source registry.**
§Class 1. Verified live. Every manufacturer media candidate is recorded as "rights unknown" including
for manufacturers whose terms have been reviewed. Fails in the safe direction — it understates
permission — but it is the flagship failure class reproduced verbatim in the stage whose entire
purpose is rights accuracy, and if it can happen there it can happen where the safe direction is the
other one.

### Tier 3 — Real, but slow and bounded

**R14.** No run-level idempotency or concurrency lock (§3.17); the substrate exists unused.
**R15.** No wall-clock budget on the tick; a timeout leaves no summary row (§3.10).
**R16.** `migrations_pending/` does not reflect production, in both directions (§Class 3).
**R17.** `engine_expire_stale_trends` takes its thresholds from the caller (§5.3).
**R18.** `STALE_DAYS = 180` duplicated in `freshness-job.ts:8` instead of reusing
`src/lib/admin/freshness.ts` (§3.13).
**R19.** `product-job.ts:166` sniffs a UUID by hyphen presence rather than an explicit contract.
**R20.** `bulkSetRightsStatus` lets an admin mass-set `rights_status='verified'` with no evidence
requirement, reducing the primary publication key to a self-attested boolean.
**R21.** `media/actions.ts:15-22` omits `public_domain_or_cc` and `tc_graphic` from
`VALID_SOURCE_TYPES` though the DB accepts them and the UI offers them — the source type that most
needs correct provenance recording cannot be set through the admin UI.

### The shape of the ranking

Tiers 0 and 1 share a single root cause, and it is the one this codebase already named:
**a control that is believed to exist, does not, and cannot report its own absence.** The media gate
that only renders a badge; the autonomy flag nothing reads; the kill switch whose write is unchecked;
the credit column the query never selected; the `stale_content` reason the RPC always rejects. Every
one of them looks correct from the surface an operator would inspect.

That is why the hardening instruction is right. The architecture underneath is unusually sound — the
narrow-RPC boundary, the confidence ceilings, the measurement/inference separation, the absence of an
LLM, the refusal to invent specifications. What is missing is not better design; it is the
enforcement of the designs already written down, and a way to tell when enforcement stops happening.

---

## 5. Security boundary audit

### 5.1 The headline finding

**`CRON_SECRET` protects the route. It does not protect the data path.**

The engine's threat model, as written in `cron.ts:9-13` and
`20260821_growth_engine_rpcs.sql:6-14`, is that jobs run as `anon`, so instead of granting `anon`
table access, *"each job goes through a narrow SECURITY DEFINER function"* and *"every function here
re-checks the relevant engine flag internally, so the kill switch cannot be bypassed by calling an
endpoint directly."*

That reasoning is correct as far as it goes, and the narrowing is real. But the grant is
`to anon` — and `anon` is not a private identity. It is the role attached to
`NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY`, which by design ships in the browser bundle of every page on
the public site. **Anyone who views source on techcarvalho.com can call every engine RPC directly,
bypassing the cron route and its secret entirely.**

**[verified live]** Using only the publishable key from `.env.local`, with no cron secret and no
session, every write RPC responded `200`/`204` rather than `401`/`403`:

```
engine_assemble_draft            -> 200  "rejected_invalid"
engine_assemble_product          -> 200  "rejected_invalid"
engine_upsert_discovery          -> 200  "rejected_invalid"
engine_record_job_run            -> 204
engine_upsert_freshness          -> 200  "rejected_invalid"
engine_upsert_update_proposal    -> 200  "rejected_invalid"
engine_upsert_opportunity        -> 204
engine_record_entity_resolution  -> 204
```

(Each probe was deliberately shaped to hit the function's own validation early-return, so it proves
`EXECUTE` is granted without writing a row.)

Read RPCs return live data to the same caller: `engine_due_sources()` returned the full active source
registry with organisations and feed URLs; `engine_existing_entities()` returned every product and
content row **including unpublished ones** with their publication state; `engine_reference_data()`
returned every manufacturer and category; `engine_briefable_discoveries()` returned unpublished
editorial intent.

### 5.2 Full enumeration of the anon-callable `SECURITY DEFINER` surface

27 functions are granted to `anon`. Grouped by what they can actually do:

**Writes to public-facing tables (the serious group)**

| Function | Writes | Flag-gated? | Notes |
|---|---|---|---|
| `engine_assemble_draft` | **`content_items`** (status hard-wired `'draft'`), `source_records`, `seo_metadata`, `media_requirements`, `engine_briefs` | **No** | `p_brief_id` is **never validated** — the function does not check the brief exists or is approved. It inserts the `content_item` first and only then runs `update engine_briefs where id = p_brief_id`, which is a harmless no-op for a bogus id. An arbitrary caller can inject arbitrary draft bodies into `content_items`. Only the slug-collision check limits volume. |
| `engine_assemble_product` | **`products`** (`is_published` hard-wired `false`), `source_records`, `media_requirements` | **No** | Requires a real manufacturer slug and category slug — both readable via `engine_reference_data()` by the same caller. `p_discovery_id` is accepted and ignored. |
| `engine_upsert_discovery` | `engine_discoveries`, `engine_discovery_evidence` | **No** | Injects candidates that flow into relevance → briefs. |

**Writes confined to engine-internal tables**

`engine_record_job_run` (no flag — can forge audit-log entries), `engine_set_relevance`,
`engine_create_brief`, `engine_upsert_opportunity`, `engine_upsert_freshness`,
`engine_upsert_update_proposal`, `engine_upsert_trend`, `engine_expire_stale_trends`,
`engine_record_media_candidate`, `engine_record_entity_resolution`, `engine_record_source_check`,
`engine_aggregate_searches` (writes `search_intelligence`), `engine_flag_weak_hero`.

**Reads only**

`engine_flag_enabled`, `engine_due_sources`, `engine_unclassified_discoveries`,
`engine_briefable_discoveries`, `engine_assemblable_briefs`, `engine_evidence_for`,
`engine_existing_entities`, `engine_reference_data`, `engine_freshness_candidates`,
`engine_opportunity_inputs`, `engine_trend_inputs`, `engine_open_media_requirements`,
`public_homepage_selection`, `compute_analytics_rollup_guarded`.

### 5.3 What is broader than it needs to be

1. **Flag gating is inconsistent, and absent from exactly the wrong functions.** Nine functions check
   `engine_flag_enabled` internally. The three that can write to `content_items` and `products` —
   `engine_assemble_draft`, `engine_assemble_product`, `engine_upsert_discovery` — **check nothing**.
   The kill switch therefore stops the *stages* (the jobs check flags before calling) but does not
   stop the *functions*. Turning the master switch off does not close the injection path.
2. **`engine_record_job_run` accepts an arbitrary `job_name` and arbitrary `detail` jsonb from
   `anon`.** The audit log — the thing an operator would consult after an incident — is
   attacker-writable and has no integrity marker distinguishing a real tick from a forged row.
3. **`engine_existing_entities()` leaks unpublished inventory.** It returns every product and content
   row with `is_published` / `status = 'published'` for each. The function comment justifies exposing
   the flag ("so an assembled draft may link only to published records"), which is right — but the
   *unpublished rows themselves* are unreleased editorial intent, available to anyone with the
   publishable key. Contrast `public_homepage_selection`, which was deliberately built so suppressed
   items are *"indistinguishable from items that merely did not rank."* The same reasoning was not
   applied here.
4. **`engine_expire_stale_trends` takes its thresholds as caller parameters.** A hostile caller can
   pass a huge floor and expire every active trend, or a tiny horizon to the same effect. The
   constants are single-sourced in `trends.ts`, which is good design for the legitimate caller and a
   liability for an untrusted one.
5. **`engine_due_sources()` exposes the full source registry.** Organisations, feed URLs, trust
   levels. Low severity, but it is competitive/operational information behind no gate.

### 5.4 Is "autonomous publishing OFF" a real backend boundary?

**Partly — and the part that is real is not the flag.**

**[verified live]** `engine_flag_enabled('autonomous_publishing')` returns `false` in production
today, while `discovery`, `research`, `freshness` and `opportunity` all return `true`. The engine is
live and running nightly.

**The flag itself is decorative.** A repo-wide search for `autonomous_publishing` finds it in exactly
five places: the column definition, the `engine_flag_enabled` `case` arm, the TypeScript type, the
admin form that writes it (`engine/actions.ts:69`), and the admin page that displays it. **No job
calls `isFlagEnabled(supabase, "autonomous_publishing")`. No RPC reads
`autonomous_publishing_enabled`.** The `isFlagEnabled` signature in `cron.ts:112` accepts the string,
but nothing passes it. Flipping the toggle to ON in `/admin/engine` would change no behaviour
whatsoever.

**The real boundary is structural, and it is genuinely strong.** Publication is impossible not
because a flag forbids it but because *no anon-callable function can express it*:

- `engine_assemble_draft` hard-codes `'draft'` at `20260822_phase6_draft_assembly.sql:190`, with the
  comment `-- never anything else`. It has **no parameter** capable of setting status.
- `engine_assemble_product` hard-codes `false` at line 395, likewise with no parameter.
- No anon-callable function writes `content_items.status`, `products.is_published`, or
  `media_assets.publication_status`.
- `anon` has no table-level `UPDATE` grant on `content_items`, `products` or `media_assets`; those are
  granted only to `authenticated` under `is_admin()` policies.

That is a real, enforced, database-level boundary and it is the right design. It should be preserved
exactly as it is.

**But the two are conflated in the operator's mental model, and that is the danger.** The admin page
renders the toggle with a red border when enabled and blue when disabled (`engine/page.tsx:144`),
presenting it as *the* control. An operator reasonably believes turning it on grants publishing, and
that turning it off withdraws it. Neither is true. The first time someone builds a publishing
capability, the natural move is to gate it on the flag — at which point the flag becomes load-bearing
for the first time, having never been tested, and the structural boundary (hard-coded literals in
RPCs) is the thing that would have to be deliberately widened. The risk is not that the flag fails
today; it is that a false belief about where the boundary lives will shape the next change.

### 5.5 The structural flaw: gates live on the read side, writes trust the caller

This is the single most important pattern in the security boundary, and it generalises across
almost every write RPC.

**The engine's editorial gates are implemented as filters in the `SELECT`-side functions, not as
preconditions in the `INSERT`-side functions.** `engine_assemblable_briefs` returns only briefs where
`review_state = 'approved'`; `engine_briefable_discoveries` returns only discoveries where
`relevance_verdict = 'relevant'`; `engine_open_media_requirements` returns only open requirements.
The corresponding write functions then validate **shape** — vocabulary membership, string length,
numeric clamping, slug uniqueness — and validate **eligibility not at all.**

For the intended caller this is invisible, because `draft-job.ts` reads then writes in the same loop.
For any other caller it means the gate is simply absent. And as §5.1 establishes, every holder of the
publishable key is another caller.

**`engine_assemble_draft` never validates `p_brief_id`.** Confirmed by reading the body
(`20260822_phase6_draft_assembly.sql:168-223`): there is no `select ... from engine_briefs where
id = p_brief_id`, no existence check, and no check of `review_state`. The function inserts the
`content_items` row **first** (line 188), then attempts `update public.engine_briefs ... where id =
p_brief_id` (lines 215-220) — which is a silent no-op for a nonexistent or null id. So a
`content_items` row is created for a brief that does not exist, with a caller-supplied title, body,
slug, content type and category. The human-approval gate that the module header calls
*"two gates… and neither is bypassable"* is enforced only by the TypeScript that chooses what to pass.

**`engine_assemble_product` accepts `p_discovery_id` and never references it.** The parameter appears
in the signature (line 350) and nowhere in the body. There is no antecedent at all: the only
preconditions are that the manufacturer slug and category slug resolve — both enumerable by the same
caller via `engine_reference_data()` — and that the product slug is free. This is also why
engine-created products carry no provenance link back to a discovery (§3.11, R7): the parameter that
would record it is discarded.

**`engine_record_media_candidate` takes its rights-review decision from the caller.**
`20260822_phase5_trends_media.sql:349-350`:

```sql
-- Anything needing review enters rights_review; nothing bypasses it.
v_state := case when coalesce(p_requires_human_review, true) then 'rights_review' else 'discovered' end;
```

The comment is true of the *state machine* and false of the *boundary*: **who decides that review is
needed is the caller.** `media-acquisition-job.ts:173-175` correctly hard-codes `true` for all
third-party imagery — but the RPC will accept `false` for a manufacturer press image and route it
straight to `discovered`. The default is safe (`coalesce(..., true)`), which is right; the parameter
existing at all is the gap. A rights decision should not be an argument.

**`engine_create_brief`** is the one that partly holds: `engine_briefs.discovery_id` is
`not null references engine_discoveries` (`20260821_growth_engine.sql:189`), so the foreign key
enforces that *some* real discovery exists. But nothing checks it was classified `relevant`, so the
relevance gate is read-side only, like the rest.

**`engine_set_relevance`** returns `'ok'` unconditionally (line 188), whether the `UPDATE` matched a
row, matched nothing, or was correctly refused because `relevance_overridden_by_admin` is true. The
caller cannot distinguish "I changed a verdict" from "I was overruled by a human" — a small instance
of the same empty-vs-failed class the whole codebase is organised against.

**Why this matters more than the individual defects.** The narrow-RPC architecture was adopted
specifically so that the database, not the application, would be the boundary — the migration header
says the cron path *"cannot change state machines, cannot publish, and cannot touch settings."* The
publication half of that claim is true and enforced by hard-coded literals (§5.4). The **state
machine** half is not: eligibility, approval and rights-review are enforced in TypeScript and in
read-side filters, and the write functions accept whatever they are handed. Hardening should move
each gate into the function that performs the write — `engine_assemble_draft` should itself require
`review_state = 'approved'` and `assembled_content_id is null`; `engine_assemble_product` should
require a real, relevant discovery and record it; `engine_record_media_candidate` should derive
`requires_human_review` from the asset type and source rather than accept it. None of that requires
rewriting the architecture; it requires putting the checks on the side of the boundary the
architecture already declared authoritative.

### 5.6 What is genuinely well-designed here

To be explicit, because hardening should not disturb these:

- **No service-role key exists anywhere in the codebase.** Every path runs as `anon` or
  `authenticated` under RLS. This is rare and valuable.
- **Every engine write is a narrow function with a validated vocabulary**, returning a status string
  rather than rows. The `revoke ... from public` / explicit-grant pairing is applied consistently
  across all 27 functions — the `compute_analytics_rollup` lesson was internalised properly.
- **`compute_analytics_rollup_guarded`** is a model of how to reopen a path to `anon` safely: the raw
  function stays locked, the wrapper enforces a cooldown so hammering it is bounded, and it returns a
  text status so the route can log *which* thing happened rather than appearing to succeed.
- **`public_homepage_selection`** applies overrides inside the security barrier and returns only the
  resulting set, so administrative editorial intent never crosses it.
- **The engine's trend table does not feed the public site.** `src/lib/public/trending.ts` computes
  its own recency/relationship score; `engine_trends` reaches only `/admin/engine/trending`. So the
  trend-injection vector in §5.3(4) cannot influence what visitors see. That separation is deliberate
  (*"a trend is a measurement, not a decision to publish"*) and it pays off directly as a security
  property.
