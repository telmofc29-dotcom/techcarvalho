# Evidence/source and media architecture audit

**Date:** 2026-08-22. **Scope:** read-only. Nothing in `src/`, `supabase/` or the database was
changed by this audit. Production counts were taken over an authenticated admin session
(`signInWithPassword`, same RLS path as the app — no service-role key exists in this project).

Purpose: establish what actually exists today, ahead of a phase that will build (a) a reader-facing
confidence system and (b) an owned-photography library. Where something does not exist, this
document says so plainly rather than describing what it would look like.

---

## PART 1 — EVIDENCE / SOURCE ARCHITECTURE

### 1.1 What is recorded per piece of evidence

`engine_discovery_evidence` (defined in `supabase/migrations/20260821_growth_engine.sql`) has
eleven columns. Production, 2026-08-22, **118 rows**:

| Column | Populated | Notes |
|---|---|---|
| `discovery_id` | 118 / 118 | |
| `url` | 118 / 118 | |
| `publisher` | 118 / 118 | Copied from `engine_sources.organisation` — 9 distinct values |
| `claim_status` | 118 / 118 | 114 `confirmed_primary`, 4 `estimate` |
| `trust_level` | 118 / 118 | **118 of 118 are `primary`** — no other value occurs |
| `retrieved_at` | 118 / 118 | DB default |
| **`source_id`** | **0 / 118** | Never written |
| **`excerpt`** | **0 / 118** | Never written |
| **`originates_from_url`** | **0 / 118** | Never written |

**The previous audit's finding still holds, and is worse than "source_id and excerpt".** Three of
the nine columns are structurally unreachable, not merely empty.

**Why.** No TypeScript code ever inserts an evidence row. The sole writer is the SECURITY DEFINER
function `engine_upsert_discovery` (current definition:
`supabase/migrations/20260822_engine_safety.sql` lines 474–483), called from exactly one place —
`src/lib/engine/jobs/discovery.ts` `runDiscovery()`. Its insert names five columns:

```sql
insert into public.engine_discovery_evidence (
  discovery_id, url, publisher, claim_status, trust_level
) values (...)
on conflict (discovery_id, url) do nothing;
```

- `source_id`: the function signature **has no `p_source_id` parameter**, even though the job is
  iterating `engine_due_sources()` and knows precisely which registry row it polled. This is
  already documented in `src/lib/engine/shadow-io.ts` (lines 134–160) and in
  `src/lib/types/database.ts:1867`.
- `excerpt`: repo-wide grep finds readers only (`engine_shadow_evidence` RPC, the admin
  discoveries page, `shadow-io.ts`). No writer exists in `.ts`, `.tsx`, `.sql` or `.mjs`.
- `originates_from_url`: no writer.

### 1.2 Independent corroboration vs syndicated repetition

**Designed for. Not achievable today.**

The intended mechanism is `originates_from_url`: `computeConfidence()`
(`src/lib/engine/confidence.ts`) splits evidence into `independent = evidence.filter(e =>
!e.originates_from_url)` and `derivative`, and only independent rows earn the corroboration bonus.
With the column NULL on 100% of rows, **every evidence row in production is classified as
independent**, and the circular-reporting guard is inert by construction.

It has also never been exercised even accidentally. Production distribution:

- 118 discoveries, 118 evidence rows — **evidence-count distribution is `1:118`**. Every single
  discovery has exactly one evidence row.
- **0 discoveries have evidence from more than one distinct host.**
- Therefore `corroborating = max(independent.length - 1, 0) = 0` and the corroboration bonus
  (`CORROBORATION_STEP = 0.06`, capped at `MAX_CORROBORATION_BONUS = 0.18`) has contributed
  nothing, ever.

Signals that do exist:

| Signal | Where | Usable in production? |
|---|---|---|
| `originates_from_url` → derivative | `confidence.ts:79`, `source-quality.ts:180`, `claim-coverage.ts:491` | No — never written |
| Shared-upstream-origin clustering (`shared_origin` finding) | `reviewer.ts:696–713` | No — keys on the same NULL column |
| Same-organisation collapse (`single_organisation` finding) | `reviewer.ts:715–726` | Yes, but only fires when **all** evidence is one org |
| Host extraction (`hostOf`) | duplicated verbatim in `source-quality.ts:170`, `reviewer.ts:1083`, `shadow-io.ts:120` | Yes |
| `distinctPublishers` count | `publication-gate.ts`, `shadow-composition.ts:217` | Caller-supplied |
| Canonical-URL / `rel=canonical` extraction | **does not exist anywhere in the repo** | — |

Host normalisation is `hostname.replace(/^www\./, "")` with no eTLD+1 reduction, so in the live
data `nasa.gov` and `science.nasa.gov` are two different "organisations" (they account for 6 and 4
rows respectively). Corroboration inside `confidence.ts` counts **rows**, with no dedupe by
publisher, host, or corporate parent.

### 1.3 Primary/official vs secondary reporting

Represented on **three axes that deliberately disagree**:

- **Axis A — `engine_sources.source_type`** (8 values): `manufacturer_newsroom`, `product_feed`,
  `rss_atom`, `official_docs`, `public_api`, `regulatory_dataset`, `trusted_editorial`,
  `other_approved`.
- **Axis B — `trust_level`** (`primary | secondary | community`), copied verbatim onto every
  evidence row. **This is the only axis `confidence.ts` reads** (`TRUST_BASE = {primary: 0.8,
  secondary: 0.5, community: 0.25}`).
- **Axis C — `SourceClass`** in `src/lib/engine/source-quality.ts`: `primary |
  independent_high_quality | vendor_press_release | social_forum | unclassified`. Derived at read
  time, never stored.

Axis C exists because Axis B is the wrong answer to the question that matters. From that file's
header: *"Phase 3 produced 16 briefs and every single one was a vendor press release, precisely
because a primary trust_level was read as a general licence to treat the item as news."*

`SOURCE_TYPE_CLASS` maps **`manufacturer_newsroom` → `vendor_press_release`, not `primary`**
(`official_docs` / `regulatory_dataset` / `public_api` are the only `primary` types). A
`vendor_press_release` has authority over `vendor_own_specification`, `vendor_own_price` and
`vendor_own_release_date` — nothing else. `qualifiesAsNews()` requires at least one
`independent && independent_high_quality` source, which vendor-only sourcing can never satisfy.

**Reliability of this in production:** poor, and in a specific way.

- `engine_sources`: 29 rows — 15 `manufacturer_newsroom` (**all 15 `is_active = false`**),
  13 `rss_atom`, 1 `trusted_editorial` (DPReview, `secondary`, active). 28 `primary` /
  1 `secondary`. 13 active / 16 inactive.
- All 118 evidence rows carry `trust_level = 'primary'`, because every source that has actually
  been polled is registered as primary. Axis B therefore carries **zero discriminating
  information** on the live data.
- The 12 active feeds are registered as `rss_atom`, which `SOURCE_TYPE_CLASS` maps to
  `unclassified` → `CLASS_AUTHORITY[] = []` → `signalOnly: true`. So on Axis C, *every discovery
  currently in the database is sourced entirely from rows with no factual authority at all* —
  even though several (blog.google, blogs.nvidia.com, newsroom.intel.com, news.xbox.com) are
  literally manufacturer newsrooms that happen to have been registered by transport type.
- `source_id` being NULL means an evidence row cannot even be joined back to its registry row to
  recover Axis A or C. `buildSourceIndex()` (`shadow-io.ts:161`) exists to reverse-engineer the
  link by exact host match, but only in the shadow path.

Production hosts behind the 118 rows: `blog.google` 20, `blog.mozilla.org` 20,
`blogs.nvidia.com` 18, `news.xbox.com` 10, `newsroom.intel.com` 10, `bluetooth.com` 10,
`raspberrypi.com` 10, `vesa.org` 9, `nasa.gov` 6, `science.nasa.gov` 4, `displayport.org` 1.

### 1.4 Confidence as computed today

`computeConfidence(evidence)` takes **only** `{claim_status, trust_level, originates_from_url}` —
no URL, no publisher, no host, no timestamp.

```
CLAIM_CEILING = {rumour .3, unverified .35, leak .45, estimate .55, reported_secondary .75, confirmed_primary 1.0}
TRUST_BASE    = {primary .8, secondary .5, community .25}
confidence    = min(bestTrust + min(independentCount-1, 3)*0.06, CLAIM_CEILING[strongestClaim])
```

There are **no output bands**. The only threshold is
`isPublishableAsFact = effectiveClaimStatus === "confirmed_primary" && confidence >= 0.8`.

**It is never persisted.** `engine_discoveries.confidence` is written once as `0` by
`engine_upsert_discovery` and repeat sightings explicitly do not raise it
(`20260822_engine_safety.sql:466–469`). Production: **all 118 discoveries have
`confidence = 0`**. The real value is recomputed at read time in three places only
(`brief-builder.ts:119`, `reviewer.ts:503`, the admin discoveries page).

Other production state: `engine_discoveries` — 81 `rejected`, 37 `discovered`; 0 linked to a
`content_id` or `product_id`. `engine_briefs` 31 rows. `engine_update_proposals` 0 rows.

### 1.5 The other, older evidence tables

Two tables from the initial schema are separate from the engine and are what the public site
actually reads:

- **`source_records`** — 226 rows. `reliability_tier`: 155 `primary`, 68 `secondary`,
  3 `community`. `publisher` populated 226/226. Attached to 50 products, 176 content items,
  0 product specs. Top hosts: `store.steampowered.com` 28, `en.wikipedia.org` 23, `wi-fi.org` 13,
  `dji.com` 10, `nvidia.com` 8, `blog.playstation.com` 8, `learn.microsoft.com` 8,
  `tomshardware.com` 7, `apple.com` 7. No excerpt column, no origin column, no per-claim link.
- **`evidence_records`** (first-party test results) — **0 rows.**

There is no relationship of any kind between `engine_discovery_evidence` and `source_records`.
They are two disconnected evidence systems.

### 1.6 What readers see today

**Effectively nothing.** Verified against the live site as well as the source.

- `src/app/(public)/articles/[slug]/page.tsx` lines 287–294 render a static grey box:
  *"Evidence, sourcing, and testing records behind this piece are tracked internally as part of
  Tech Carvalho's editorial process. See our editorial policy for how we work."* Confirmed present
  and data-free on `https://www.techcarvalho.com/articles/canon-eos-r5-vs-r6`.
- `src/app/(public)/products/[slug]/page.tsx` lines 249–263 render
  `"{N} sources cited · {M} evidence records — see our editorial policy for how we verify facts."`
  Those counts come from `source_records` and `evidence_records`
  (`src/lib/public/product-detail.ts:150–151`), **not** from the engine. Since
  `evidence_records` is empty, only the sources half ever appears. No URLs, no publishers, no
  tiers, no dates. Confirmed live on `/products/canon-eos-r5`.
- `src/app/(public)/editorial-policy/page.tsx:23` states outright that evidence is not exposed
  as raw data to readers.
- Nothing in `src/components/public/**` renders confidence, claim status, trust level, source
  class, or corroboration count. The only source-ish public component is `media-credit.tsx`,
  which is photo licence attribution — a different concern.

All engine evidence UI is admin-only
(`src/app/admin/(dashboard)/engine/discoveries/page.tsx`). Its amber "repeating an upstream claim"
card at lines 296–309 is dead code in practice, since `originates_from_url` is always NULL.

### 1.7 What is missing for reader-facing CONFIRMED / STRONGLY SUPPORTED / DEVELOPING / RUMOUR / DISPUTED / UNVERIFIED

Ordered by how blocking each item is.

1. **A claim-level entity. Does not exist.** Every rating verb above is a statement about a
   *claim* ("the RTX 5090 has 32 GB of VRAM"), and the schema's finest grain is a *discovery*
   (one feed item) or a *content item* (one article). `claim-coverage.ts` operates on claims but
   nothing persists them. Without a `claims` table (claim text, subject entity, claim domain,
   status, current rating, computed-at), there is nothing a badge can be attached to.
2. **`excerpt`, populated.** A "Why this rating?" panel that cannot quote what each source
   actually said is a rating with no exhibit. This is also load-bearing internally:
   `claim-coverage.ts` matches numeric claim values against `excerpt`, so with all excerpts NULL
   `isValueAttested()` returns `false` for every value and every numeric claim fails
   `value_not_attested`.
3. **`originates_from_url`, populated.** Without it, STRONGLY SUPPORTED cannot be distinguished
   from twelve outlets rewriting one press release — which is precisely the failure mode the
   column was added to prevent. Populating it needs work the codebase does not have: canonical-URL
   extraction, "via/according to/first reported by" attribution parsing, and a
   syndication-partner list. There is currently **no canonical-URL extraction anywhere**.
4. **`source_id`, populated.** Without the join back to `engine_sources`, a reader-facing rating
   cannot name the source class (`vendor_press_release` vs `independent_high_quality`), which is
   the axis that actually separates "the manufacturer says so" from "someone independent checked".
   Fixing this is small: add `p_source_id` to `engine_upsert_discovery` and pass `source.id` from
   `runDiscovery()`.
5. **A DISPUTED state. Does not exist.** No enum anywhere models contradiction. `claim_status` is
   a six-value ladder with no branch for "two credible sources disagree". `reviewer.ts` produces
   conflict *findings* and `HUMAN_REVIEW_DOMAINS` marks four domains as never auto-resolvable, but
   nothing persists a dispute or its two sides.
6. **Persisted confidence with named bands.** Today confidence is one float, recomputed at read
   time, and `engine_discoveries.confidence` is 0 on all 118 rows. Reader labels need the score
   *and the band boundaries* stored, so the badge does not silently change meaning when the
   scoring constants are tuned.
7. **A rating-explanation record.** `computeConfidence()` returns an `explanation` string, thrown
   away at read time. "Why this rating?" needs a durable structure: which sources counted, which
   were discounted and why, which class each belonged to, what the ceiling was and which claim
   status set it.
8. **A path from engine evidence to published articles.** 0 of 118 discoveries have a
   `content_id`; the 81 published articles are connected to `source_records`, which carries no
   claim status, no excerpt, and no origin. Whatever badge system gets built has to decide which
   of the two evidence systems it reads — or unify them.
9. **Real corroboration in the data.** Every discovery has exactly one source. Until at least two
   genuinely independent sources reach the same discovery, STRONGLY SUPPORTED can never be earned
   and CONFIRMED would mean "one press release", which would be worse than showing nothing.

Points 2–4 are the cheap, high-value ones: they are three columns that already exist, in a
constraint-checked table, with one writer.

---

## PART 2 — MEDIA ARCHITECTURE

### 2.1 media_assets: production counts (112 rows)

| by `source_type` | | by `rights_status` | | by `publication_status` | |
|---|---|---|---|---|---|
| `tc_graphic` | 65 | `verified` | **112** | `published` | 104 |
| `public_domain_or_cc` | 39 | `unknown` | 0 | `private` | 8 |
| NULL | 8 | `pending_verification` | 0 | | |
| `staff_photograph` | **0** | `restricted` | 0 | | |

`media_type`: 112 `image`, 0 `video`. `owned`: 73 true / 39 false. `ai_generated`: 8 true.
`asset_role`: `article_hero` 38, `product_photo` 36, `comparison_graphic` 19, `diagram` 10,
`logo_brand` 8, `chart` 1. `brand_role`: 8 non-null (2 `wordmark`, 2 `wordmark_tagline`,
2 `mark`, 2 `logo_full_tagline`).

**The composition of the library:**

- **65 TechCarvalho-generated graphics** (`tc_graphic`) — SVG rendered locally by
  `src/lib/media/graphics/` and rasterised to 1600×900 PNG via Playwright by
  `scripts/generate-editorial-graphics.mjs` / `generate-editorial-heroes.mjs`. All carry
  `TC_ORIGINAL_GRAPHIC_RIGHTS` (`owned: true, rights_status: "verified", ai_generated: false`).
- **39 third-party photographs** (`public_domain_or_cc`) — all Wikimedia Commons, `owned = false`,
  `license`/`source_url`/`attribution` populated 39/39.
- **8 brand logos** — `source_type` NULL, `ai_generated = true`, `owned = true`, private.
- **0 manufacturer / press-kit / stock-licensed assets.**
- **0 real photography owned by TechCarvalho.** There is not one `staff_photograph` row.

The 8 NULL `source_type` rows are a UI artefact, not a data decision:
`media-upload-form.tsx:332` hides the source-type select entirely when the `owned` checkbox is
ticked, so an owned upload can never also record where it came from.

`rights_status` is `verified` on 100% of rows, which makes the column useless as a filter today.
`src/lib/media/provenance.ts` exists specifically because of this: `classifyRights()` re-derives
`RightsClass` (`rights_verified | rights_uncertain | rights_restricted | generated_original |
owned_original`) rather than trusting the column, since 65 of the 112 "verified" rows mean
"we made it", not "we checked someone else's licence".

### 2.2 Hero split: generic graphic vs real photograph of the subject

**Published articles: 81. Of these, 69 (85%) lead with a TechCarvalho-generated graphic and
12 (15%) with a real photograph.**

| Hero | Count | Examples |
|---|---|---|
| `tc_graphic` / `article_hero` (title card) | 40 | `meteor-shower-photography-settings`, `tripod-vs-star-tracker`, `next-gen-console-rumor-tracker-ps6-xbox`, `canon-eos-r6-v-announcement` |
| `tc_graphic` / `comparison_graphic` | 18 | `rtx-5090-vs-rtx-5080-worth-the-upgrade`, `ryzen-7-9800x3d-vs-ryzen-9-9950x`, `iphone-17-pro-vs-galaxy-s26-ultra-vs-pixel-10-pro` |
| `tc_graphic` / `diagram` | 10 | `game-upscaling-dlss-fsr-xess-explained`, `wifi-generations-explained-wifi-4-to-wifi-7` |
| `tc_graphic` / `chart` | 1 | `game-storage-requirements-2026` |
| `public_domain_or_cc` / `product_photo` | 9 | `canon-eos-r5-vs-r6`, `canon-eos-r10-vs-r7`, `canon-6d-vs-6d-mark-ii` |
| `public_domain_or_cc` / `article_hero` | 3 | `canon-dslr-buying-guide`, `astrophotography-for-beginners`, `mesh-wifi-vs-single-router` |
| No hero | 0 | |

Worse than the tier split: **6 fully generic category title cards cover 20 of the 81 articles.**

| Asset | Articles |
|---|---|
| `hero-smartphones.png` | 4 |
| `hero-ai-hardware.png` | 4 |
| `hero-computing.png` | 3 |
| `hero-smart-home-robots.png` | 3 |
| `hero-drones-fpv.png` | 3 |
| `hero-gaming.png` | 3 |

So `is-yearly-phone-upgrade-worth-it`, `phone-camera-vs-real-camera-2026` and
`which-flagship-phone-should-you-buy-2026` all show the identical picture, which is a styled card
reading "Smartphones".

**Published products: 36 of 36 lead with a `public_domain_or_cc` Wikimedia photograph** — the one
place the site consistently shows the actual subject. Eight further products are unpublished, all
blocked on media (`media_requirements.sourcing_status = 'blocked'`, 8 rows, `target_source_type =
'manufacturer'`). Nine third-party photographs are reused across two entities each (article + its
product page), which is legitimate.

Association totals: `content_media` 91 + `product_media` 36 = 127 rows (117 `hero`, 10 `gallery`).
104 of 112 assets are associated to something; the 8 unassociated are the brand logos.

### 2.3 Support for `owned_original` today

**`owned_original` is a derived label, not a column, and there is no upload path for it.**

- `src/lib/media/provenance.ts:38–50` defines `RightsClass` including `"owned_original"`, derived
  at line 98 from `OWNED_SOURCE_TYPES = new Set(["staff_photograph"])`. So the storage
  representation of "TechCarvalho's own photograph" **is** `source_type = 'staff_photograph'`.
- `classifyMediaTier()` (`hierarchy.ts:51, 95`) maps `staff_photograph` → tier `original_photo`,
  ranked equal to `real_subject`; `presentation.ts:48–55` includes it in `PHOTOGRAPHIC_SOURCES`.
  The downstream plumbing is ready.
- **Production count of `staff_photograph`: 0.** The concept has never been used.
- The admin upload path (`media-upload-form.tsx` + `actions.ts uploadMediaAsset`) is a generic
  drag-and-drop with a 15 MB cap. There is no owned-photography flow. Two defects block one today:
  1. **`VALID_SOURCE_TYPES` in `src/app/admin/(dashboard)/media/actions.ts:15–32` omits
     `public_domain_or_cc` and `tc_graphic`**, while `media-upload-form.tsx:351–352` offers both.
     Selecting either fails with "Choose a valid source type." The parallel list in
     `requirement-actions.ts:9–18` has all eight. (Not exercised by the current library, which was
     populated by scripts, not the form.)
  2. Ticking `owned` hides the source-type select, so **an owned upload cannot be recorded as
     `staff_photograph`** — it lands with `source_type = NULL`, exactly as the 8 brand logos did.

**Provenance fields — what exists, what does not.**

Live `media_assets` columns: `id, storage_path, media_type, alt_text, width, height, license,
attribution, created_at, caption, source_type, creator, source_url, attribution_required,
ai_generated, owned, publication_status, public_storage_path, published_at, published_by,
rights_status, brand_role, asset_role` — plus, from
`supabase/migrations/20260822_media_provenance_evidence.sql`, which **is applied in production**
(verified by reading the columns back): `content_hash, provenance_evidence, rights_verified_at,
rights_verified_by, source_checked_at, source_check_result`.

> Note: that migration's own header still reads *"DRAFTED, NOT APPLIED. Lives in
> `migrations_pending/`"*. It is applied and it lives in `migrations/`. The header is stale in the
> exact way this project has been burned by before.

Populated in production:

| Field | Populated |
|---|---|
| `width` / `height` | 107 / 112 |
| `alt_text` | 112 / 112 |
| `license`, `source_url`, `attribution` | 39 / 112 (the Commons photographs) |
| `creator` | 47 / 112 |
| `caption` | 38 / 112 |
| **`content_hash`** | **0 / 112** |
| **`provenance_evidence`** | **0 / 112** |
| **`rights_verified_at`** | **0 / 112** |
| **`source_checked_at`** | **0 / 112** |

**Missing outright — no column exists:**

- original filename (it is only smeared into `storage_path` as
  `${media_type}/${uuid}-${sanitizedName}` at `actions.ts:135`)
- byte size, MIME type
- EXIF of any kind; capture date; camera/lens; GPS
- any derivative table or derivative reference
- any subject/entity link other than the two join tables (`content_media`, `product_media`),
  whose only vocabulary is `role ∈ {hero, gallery, thumbnail}`

`width`/`height` are read **client-side from the browser `Image` object**
(`media-upload-form.tsx:39–53`) and are hand-editable before submit — they are not measured
server-side from the file.

A richer record exists in flight and is discarded: `ProvenanceRecord`
(`src/lib/media/providers/types.ts:175–223`) carries `originalFileName, mimeType, byteSize,
contentHash, licenceDeclared, licenceMetadata, creatorPageUrl, acquiredAt, verifiedAt, evidence[],
conflicts[]`, with a 12-value `EvidenceItem.kind` union including `exif_artist`, `exif_copyright`,
`content_hash`. `media-acquisition-job.ts:358` explicitly passes
`existingContentHashes: new Set<string>()` with the comment that `media_assets` has no content-hash
column — **which is now false**; the column exists and nothing writes it. sha256 is computed in
`scripts/engine-media-search.ts:467` and `scripts/proof-media-acquisition.ts:183`, and written into
a free-text notes string. Commons contributes **sha1**, not sha256.

### 2.4 Derivatives and delivered bytes

**No derivatives are stored. One file per asset, byte-for-byte.** Publishing copies the object
from `media-private` to `media-public` unchanged (`actions.ts:230, 341`). `sharp` is a dependency
but is called at exactly two sites, both `.metadata()` only — repo-wide grep for `.resize(`,
`.webp(`, `.toFormat` returns zero hits outside `package-lock.json`. Supabase's
`/storage/v1/render/image` transformation endpoint is **available on this project** (a probe
returned `200 image/jpeg`) and **is used nowhere**; `public-url.ts` builds plain `/object/public/`
URLs.

**But readers are not served the originals.** Next.js's built-in optimizer is configured in
`next.config.ts` (`formats: ["image/avif", "image/webp"]`, `minimumCacheTTL` 30 days,
`qualities: [75]`) and every public surface renders through `next/image` with an explicit `sizes`
(article lead: `(min-width: 768px) 720px, calc(100vw - 48px)`). So responsive AVIF/WebP
derivatives are generated and cached at request time — they just do not exist as library objects.

Measured, 2026-08-22:

**Origin objects, all 81 published article heroes:** total 38.1 MB, **mean 470 KB**.
- `tc_graphic` (n=69): mean 360 KB, min 29 KB, max 616 KB — 1600×900 PNG.
- `public_domain_or_cc` (n=12): mean **1104 KB**, min 131 KB, **max 9681 KB** (the Palit RTX 5090
  photograph, 4203×3152 PNG).
- Storage extensions across the library: 70 `png`, 38 `jpg`, 4 `svg`.
- Objects are served from the public bucket with **`cache-control: no-cache`**.

**What a reader actually downloads, through `/_next/image?w=750&q=75`:**

| Asset | Origin | AVIF @750w | AVIF @1080w | Fallback @750w |
|---|---|---|---|---|
| `hero-smartphones.png` (title card) | 485 KB | **3.4 KB** | 5.0 KB | 40 KB (PNG) |
| `canon-eos-line-up.jpg` | 320 KB | 28.8 KB | 52 KB | 59 KB (JPEG) |
| Palit RTX 5090 PNG | 9680 KB | 16.7 KB | 27.9 KB | 118 KB (PNG) |
| Milky Way JPEG | 612 KB | 66.9 KB | 142 KB | 111 KB (JPEG) |

So delivery is in good shape; the library is not. The 9.68 MB origin is a storage, backup and
cold-start cost, not a reader cost.

### 2.5 Watermarking

**Does not exist.** Repo-wide case-insensitive grep for "watermark" returns three hits, all in
`src/lib/media/providers/ranking.ts` — `"watermark"` and `"watermarked"` inside `OVERLAY_TOKENS`
(line 108), used at lines 234–242 to *penalise* a candidate whose description suggests an imposed
overlay. No watermark is ever applied, and no watermark policy exists in code or in `docs/`.

**What would carry the policy, though, already exists and is nearly the right shape.** A
watermark-eligibility predicate is exactly the `RightsClass` split in `provenance.ts`:
`owned_original` and `generated_original` are the two classes that could be watermarked;
`rights_verified` (third-party CC/PD — CC BY-SA in particular restricts adding effective
technological measures and requires the work not be presented as one's own), `rights_uncertain`
and `rights_restricted` never can. `brand_role` non-null (logos) is a separate never-watermark
class. What is missing is (a) the predicate itself, (b) any rendering step that could apply a mark,
and (c) a derivative to apply it to — since the published object is a byte copy of the private
original, watermarking today would mean mutating the archive copy or introducing a derivative
concept that does not exist.

### 2.6 The weak-hero / media-upgrade queue

**The mechanism is built end to end and has produced zero rows in production.**

- `src/lib/engine/jobs/hero-media-job.ts` exports `runHeroMediaAudit(supabase)`, job name
  `engine_hero_media`. It is registered at `src/app/api/engine/tick/route.ts:91` as
  `["hero_media", runHeroMediaAudit]` and declared `role: "assessor"` in `stage-roles.ts:74`.
- It is not a queue reader: it reads all published entities via `engine_existing_entities`, plus
  hero rows from `content_media`/`product_media`, plus `media_assets`, plus
  `engine_open_media_requirements(500)`, classifies each hero with `classifyMediaTier()` →
  `evaluateHero()` (`src/lib/media/hierarchy.ts:160–220`), and calls `engine_flag_weak_hero` for
  each one that `shouldReplace`.
- "Weak" = tier in `{missing, generic_graphic, data_graphic, original_render}`, gated identically
  in TypeScript and in the RPC (`20260822_hero_media_upgrade.sql:68`). Concretely:
  `generic_graphic` or `data_graphic` on a product/named-media page always flags; `generic_graphic`
  on a comparison flags.
- The RPC never unpublishes, never overwrites an existing `media_requirements` row (returns
  `already_tracked`), and inserts with `sourcing_status = 'sourcing'` — deliberately not
  `'needed'`, so that the blocked-product count stays meaningful.

Production state:

- `engine_job_runs` contains **no `engine_hero_media` row at all**. The most recent engine run of
  any kind is `2026-08-21T20:24Z`; the hero-media migration and job are dated 2026-08-22.
  **The job has never executed.**
- `media_requirements`: 65 rows — **57 `approved`, 8 `blocked`, 0 `needed`, 0 `sourcing`,
  0 `available`**. Zero notes contain `"Hero-media upgrade"`.
- `target_source_type`: 30 `public_domain_or_cc`, 27 `tc_graphic`, 8 `manufacturer`.
  38 for products, 27 for content, 57 resolved.

By the job's own rules, if it ran today it would flag on the order of 69 published articles
(every `tc_graphic` hero) plus whatever tier-by-subject logic spares — a queue roughly 10× the
size of the entire current requirements table.

**Could it carry a "photo request"?** Yes, with one schema change and one vocabulary addition.

- `media_requirements` already has `target_source_type` drawn from the full eight-value
  `MediaSourceType` vocabulary and explicitly nullable *"since a requirement may exist before
  anyone has decided which source it'll come from"*. Setting `target_source_type =
  'staff_photograph'` is a photo request with no migration at all. `evaluateMediaReadiness()`
  (`requirements.ts:18–39`) already gates on hero + `evaluatePublishEligibility` +
  `sourcing_status === 'approved'`, so an owned photo would resolve a requirement the same way a
  Commons file does.
- What is missing: a `sourcing_status` value for "we intend to shoot this" (today the choice is
  `needed`, which means "no usable media" and would corrupt the blocked count, or `sourcing`,
  which means "looking for existing material"); and no field for the shoot itself — subject,
  whether the item is in hand, shot list, deadline.
- **One real blocker.** The two partial unique indexes on `media_requirements` are named
  `..._one_open_per_product` / `..._one_open_per_content` but their predicate is *one per
  product/content **ever***. A resolved requirement can therefore never be superseded by a new
  one — so a product resolved with a Commons photo in August can never later carry a "shoot this
  ourselves" requirement. This is flagged as a known defect in
  `20260822_media_provenance_evidence.sql:251–256` and deliberately left unfixed there. **An
  owned-photography programme cannot be tracked in this table until that index is changed.**

### 2.7 Summary of what does not exist

| Capability | Status |
|---|---|
| Owned photograph in the library | 0 rows. `source_type = 'staff_photograph'` is the representation; never used |
| Admin upload path for owned photography | No dedicated flow; the generic form cannot set `owned` **and** `staff_photograph` together |
| Original filename / byte size / MIME columns | Do not exist |
| EXIF, capture date, camera/lens, GPS | Do not exist |
| Content hash | Column exists (applied), 0/112 populated; sha256 lives in notes strings; Commons gives sha1 |
| Structured provenance evidence | Column exists (applied), 0/112 populated; `ProvenanceRecord` is built then discarded |
| Stored derivatives (responsive / WebP / AVIF / thumbnails) | Do not exist. All derivatives are generated at request time by `next/image` |
| Watermarking | Does not exist. No policy, no predicate, no rendering step |
| Rights-class-based watermark policy | Does not exist, but `RightsClass` in `provenance.ts` is the right seam |
| Weak-hero queue | Built, wired, and has never run — 0 rows produced |
| Photo-request concept | Expressible via `target_source_type = 'staff_photograph'`; blocked by the "one requirement per entity ever" unique index |
