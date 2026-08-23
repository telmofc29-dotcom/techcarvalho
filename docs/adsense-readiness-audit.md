# AdSense / Google Publisher Policies readiness audit

**Audit date:** 2026-08-23
**Auditor scope:** read-only. No code changed, no content changed, no monetisation setting
touched, no AdSense review requested.
**Subject:** https://www.techcarvalho.com — 81 published articles, 36 published products,
160 URLs in the live sitemap.

## Method

Two independent evidence sources, cross-checked against each other:

1. **Production database**, read through `createAdminClient()` (`scripts/_shared.ts`) — the same
   RLS path the app uses, no service-role key, nothing written. Every query checks its own `error`
   and throws; no `?? []` and no `.catch(() => [])` anywhere in the measurement code. Two queries
   *did* fail during this audit (`evidence_records.evidence_type`, `product_families.manufacturer_id`
   — wrong column names) and both threw rather than returning an empty array. That is the specific
   failure mode that produced fabricated measurements in this project twice before; it did not
   happen here.
2. **The live site**, crawled at 2026-08-23: all 160 sitemap URLs fetched, plus 15 further
   internal links discovered during the crawl, plus 11 deliberate probes of routes *not* in the
   sitemap. For every page: HTTP status, `<main>` word count, whole-page word count, emitted
   JSON-LD, `robots` meta, and every internal `href`.

Content length uses `countBodyWords()` from `src/lib/content/reading-time.ts` — the same parser the
site uses for its own reading-time estimate, so this audit and the site cannot disagree about what
counts as prose. Length is judged against `INTENT_FLOOR` in
`src/lib/content/quality-inventory.ts`, not against an invented threshold. Overlap detection uses
the existing `findOverlaps()` from the same file, unmodified — no new detector was written.

**Policy texts were fetched today (2026-08-23), not recalled**; quotes and last-updated dates are
in §11.

### One caveat that matters for reading everything below

**The live site is serving `3e4a83b`. Local `HEAD` is `a611d28` ("Rebuild homepage front line…"),
which is one commit ahead of `origin/main` and therefore not deployed — this repo's Vercel
deployment only updates on push.** That one commit happens to fix part of B3 below. Where local and
live differ, this audit reports what a Google reviewer would see *today* — the live state — and says
so explicitly. Nothing here was committed, pushed or deployed by this audit.

---

## Verdict first

**Not ready to apply. Four blockers, all of them cheap to fix, none of them requiring new writing.**

The corpus problem is real but it is *not* the thing most likely to fail the application. What is
most likely to fail it is that the site currently tells a reviewer, in its own words, on its own
privacy policy, that it is unfinished — and simultaneously makes one claim on its front page that
its own editorial policy denies. Those are one component and one line of copy.

The shortest honest path to ready is in §10. It is roughly a day of work plus a decision about
roughly 20 URLs, and it involves no padding of any article.

---

## Findings, ranked by likelihood of causing a rejection

### BLOCKERS

---

#### B1 — Four policy pages declare themselves placeholders. The privacy policy is one of them.

`src/components/public/legal-page.tsx` renders, when `provisional` is true:

> "This page is a placeholder pending final legal review and does not yet constitute Tech
> Carvalho's complete policy."

`provisional` defaults to `true` and is only overridden on `/editorial-policy`. Fetched live today:

| Page | `<main>` words | Placeholder banner? | Substantive? |
|---|---|---|---|
| `/privacy` | 262 | **yes** | Yes — genuinely describes GA4, first-party analytics, storage, withdrawal |
| `/cookies` | 334 | **yes** | Yes — per-category, names the actual storage mechanisms |
| `/terms` | 72 | **yes** | No — three sentences, one of which says the real terms will come later |
| `/affiliate-disclosure` | 65 | **yes** | Accurate but near-empty (correctly states there are no affiliate programs) |
| `/editorial-policy` | 393 | no | **Yes — the strongest page on the site** |
| `/about` | 135 | no | Thin but honest |
| `/contact` | 72 | no | **No — see B2** |

Google Publisher Policies (read today) bar Google-served ads on screens *"without publisher-content
or with low-value content, that are under construction."* The site is asserting "under construction"
in writing, on the page a reviewer checks first to confirm a privacy policy exists at all.

The perverse part: `/privacy` and `/cookies` are **actually finished**. They describe real,
specific, checkable behaviour. The banner is untrue of both of them. `/terms` and
`/affiliate-disclosure` genuinely are stubs, and for those the banner is honest — which is why the
fix is different for each pair (see §10).

---

#### B2 — There is no way to contact the publisher, and no identifiable publisher.

`/contact`, live, in full (72 words in `<main>`):

> "Tech Carvalho does not yet have a monitored contact address or contact form set up — this page
> will be updated with a real way to reach the editorial team as soon as one exists, rather than
> publishing an inbox that isn't actually checked."

No email, no form, no postal address, no legal entity, no country. The footer's copyright line is
`© 2026 Tech Carvalho` and nothing more.

Measured alongside it:

- `content_items.author_id` is **NULL on all 81 published articles**.
- No byline is rendered on any article page (confirmed across all 81 crawled pages).
- `articleJsonLd()` correctly emits `author: { "@id": ORGANIZATION_ID }` rather than inventing a
  person — the honest choice given there is no readable name — but the consequence is that **no
  human being is associated with this publication anywhere, in markup or on screen.**

Against Google's helpful-content self-assessment (read today): *"Is it self-evident to your visitors
who authored your content?"* and *"Do pages carry a byline, where one might be expected?"* Both are
currently no.

A reviewer assessing publisher legitimacy has no route to the publisher. This compounds B1: the two
pages a reviewer opens before reading any article are `/privacy` (which disclaims itself) and
`/contact` (which offers nothing).

---

#### B3 — The live homepage claims testing the site does not do. Already fixed locally; not deployed.

The live homepage masthead reads:

> "Reviews, guides, and comparisons built on **real testing** and real sourcing — cameras, drones,
> computing, networking, and gaming, explained without the noise."

Measured against that claim:

- `evidence_records`: **0 rows.** Site-wide. No test record of any kind exists.
- `/editorial-policy` states, on the same site: *"Tech Carvalho does not currently publish hands-on
  reviews, benchmarks, or test results. Nothing on this site is written from having used the
  product."*
- 58 of 81 article pages carry the line *"Tech Carvalho does not publish hands-on test results."*
- `content_items.type` distribution: guide 43, comparison 20, news 11, troubleshooting 7. **Zero
  `review` rows.** The homepage advertises "Reviews" as a content type that does not exist here.

The homepage metadata description (live) compounds it: *"built on a structured product catalogue
with real sourcing and **freshness records**."* `freshness_log` has **0 rows**. Nothing on this site
has ever been through a freshness review.

This is the single most dangerous finding in the audit, because it is a direct, checkable
contradiction between the front page and the editorial policy. A reviewer who notices it will
discount every other honesty signal on the site — and there are a lot of genuine ones.

**Status:** local commit `a611d28` deletes this masthead entirely, including exactly the "built on
real testing and real sourcing" line. **That commit is one ahead of `origin/main` and has not been
pushed, so the claim is still live** — re-fetched at the end of this audit and still present. The
metadata description's "freshness records" claim is present in *both* the live and the local
version and is not fixed by that commit. This audit does not push or deploy.

---

#### B4 — All 81 articles tell readers and Google they were updated today. None were.

Every article page rendered today reads **"Updated 23 August 2026"**, and every article's JSON-LD
emits `"dateModified": "2026-08-23..."`. Verified on all 81 crawled pages: 81/81 say "Updated",
0/81 say "Published".

The cause, measured directly: **all 81 `content_items.updated_at` values sit in the same minute —
`2026-08-23T08:18`.** A single bulk write moved every row. `freshness_log` remains empty and
`evidence_records` remains empty, so nothing was actually reviewed, corrected, or revised.

`src/lib/content/article-header.ts` was written specifically to prevent this — its
`REVISION_THRESHOLD_MS` comment says *"`updated_at` moves for reasons a reader does not care about
— a status flip, a tag change, a re-run of a backfill. Labelling a piece 'Updated' because its row
was touched an hour after publication overstates the maintenance."* The 24-hour guard works for a
same-day touch and does nothing against a bulk write two days after publication, which is what
happened.

Why this is a blocker rather than a nit: it is a freshness claim made to readers on 81 pages and to
Google in structured data on 81 pages, and it is false on all 81. Google's structured data policies
(read today) say *"Don't use structured data to deceive or mislead users."* More practically, a
reviewer comparing "Updated 23 August 2026" against a sitemap where everything published on 21–22
August is being told the site backdates or bulk-stamps its revision dates.

Unlike B1–B3, this one has no local fix pending.

---

### IMPROVEMENTS — ranked

---

#### I1 — 51 of 81 articles are below the floor their own format sets. 22 are below half of it.

Floors are the project's own (`INTENT_FLOOR`, `src/lib/content/quality-inventory.ts`): comparison
600, guide 600, troubleshooting 500, review 800, news 150. These are floors for *suspicion*, and
the file is explicit that they are not targets to write to.

**Total prose on the entire site: 42,798 words across 81 URLs. Median 448. Shortest 206. Longest
2,591.**

| Words | Articles |
|---|---|
| under 200 | 0 |
| 200–299 | 24 |
| 300–399 | 12 |
| 400–499 | 15 |
| 500–799 | 23 |
| 800–1,199 | 2 |
| 1,200–1,999 | 3 |
| 2,000+ | 2 |

Against their own floors:

| Type | Published | Below floor | Floor |
|---|---|---|---|
| guide | 43 | **31** | 600 |
| comparison | 20 | **17** | 600 |
| troubleshooting | 7 | 3 | 500 |
| news | 11 | **0** | 150 |
| **total** | **81** | **51 (63%)** | |

News is a clean pass — every news item clears its floor, which is the correct outcome for a format
that is legitimately short.

The 22 pieces under **half** their floor, named:

| Words / floor | Slug |
|---|---|
| 206 / 600 | `gopro-hero13-vs-osmo-action-5-pro` |
| 209 / 600 | `wifi-7-explained-what-changes` |
| 216 / 600 | `hdmi-2-1-console-gaming-explained` |
| 219 / 600 | `ps5-digital-vs-disc-edition` |
| 222 / 600 | `fpv-vs-camera-drone-which-do-you-want` |
| 227 / 600 | `mesh-router-buying-guide-2026` |
| 228 / 500 | `dji-drone-signal-loss-connection-troubleshooting` |
| 228 / 600 | `best-action-camera-mountain-biking-trail-riding` |
| 230 / 600 | `switch-2-vs-switch-whats-new` |
| 236 / 600 | `ai-phone-camera-real-vs-marketing` |
| 237 / 600 | `xbox-series-x-vs-series-s` |
| 239 / 600 | `local-llm-hardware-requirements` |
| 243 / 600 | `dji-mini-4-pro-vs-air-3s-which-to-buy` |
| 253 / 600 | `smart-home-starter-guide-where-to-begin` |
| 254 / 600 | `what-3d-v-cache-x3d-does-for-gaming` |
| 256 / 600 | `ryzen-7-9800x3d-vs-ryzen-9-9950x` |
| 256 / 600 | `ps5-vs-ps5-pro-worth-it` |
| 278 / 600 | `do-you-need-rtx-5090-for-1440p-gaming` |
| 283 / 600 | `what-ai-pc-actually-means` |
| 290 / 600 | `amd-vs-intel-high-end-cpu-buying-guide-2026` |
| 295 / 600 | `robot-vacuum-buying-guide-what-actually-matters` |
| 298 / 600 | `which-flagship-phone-should-you-buy-2026` |

**Do not pad these.** A 900-word version of the GoPro comparison would be a worse page and a
clearer policy violation than the 206-word version. The three honest options are: improve it with
material that isn't in the two vendor pages it came from; merge it (rarely — see I2, which found
almost nothing genuinely mergeable); or unpublish it.

---

#### I2 — Near-duplicate content is *not* a real problem here. One reported pair, and it looks like a false positive.

Run through the existing `findOverlaps()` — unmodified, with `productIds` and `categoryId` supplied
so the shared-product corroboration is active — against all 81 published pieces:

**Two items reported, forming one pair:**

- `phone-camera-vs-real-camera-2026` — *"Phone Camera vs. a Real Camera in 2026: What You Actually
  Gain and Lose"* (334w)
- `ai-phone-camera-real-vs-marketing` — *"AI in Your Phone's Camera — What's Real vs. Marketing"*
  (236w)

**I read both in full, and I believe this is a false positive. Do not merge them.**

- The first is about optics: sensor size vs. computational synthesis, phase-detect autofocus on
  fast subjects, where "100x zoom" stops being optical, when a dedicated body still wins.
- The second is about vendor claims: that Gemini Nano genuinely runs on-device per Google's
  developer blog, and that **no TOPS figure for the A18 Pro appears anywhere in Apple's own
  newsroom release**, so every circulating Apple TOPS number is a third-party estimate.

They share no substantive content. The detector fired because the significant-token sets reduce to
`{phone, camera, real, 2026}` and `{phone, camera, real, marketing}` — 3/4 shared, over the 0.7
threshold — and because both are legitimately linked to a 2026 flagship phone, which satisfied the
shared-product corroboration. The word doing the damage is **"real"**, which is house style here
(*"What's Real vs. Marketing"*, *"a Real Camera"*, *"The Real Trade-offs"*) and means something
different in each title. It is the same class of failure as the `worth`/`upgrade`/`actually`
formula the STOPWORDS list already documents, one word short of being caught.

Two articles about flagship phones will always share a flagship phone, so shared-product
corroboration is weakest exactly in the site's densest verticals. Worth noting as a follow-up (not
actioned here, this audit is read-only): `real` is a candidate for the formulaic-headline half of
`STOPWORDS`.

**What the safeguards correctly suppressed:** running the same function *without* corroboration
(title-similarity only) reports 4 items / 2 pairs. The extra pair is
`mesh-wifi-vs-single-router` (666w) ↔ `mesh-router-buying-guide-2026` (227w). These share no linked
product, so they were withheld. That call was right on the merge question — the intents differ ("do
I need mesh?" vs "which mesh?") — but the pair is a genuine *ranking* cannibalisation risk, and the
second of the two is one of the 22 under-half-floor pages in I1. It is a candidate for unpublishing,
not for merging.

**Other duplication checks, all clean:**

- Duplicate titles: **0**
- Duplicate `primary_query`: **0**
- Duplicate `intent_fingerprint`: **0**
- Articles rendering the deck sentence again as the first body sentence: **3** —
  `tripod-vs-star-tracker`, `gopro-hero13-vs-osmo-action-5-pro`,
  `xbox-game-pass-vs-playstation-plus-comparison`. Cosmetic, visible, cheap to fix.

**Conclusion: near-duplicate content is the one thing on the task list that is genuinely fine here.**
Do not let it absorb effort that belongs on B1–B4.

---

#### I3 — Thin hub pages: 4 manufacturer hubs are indexed with one or two items, and the cause is missing tag rows.

The gating in `src/lib/public/hub-eligibility.ts` works and is honest: 4 manufacturer routes with no
published products (`intel`, `tp-link`, `roborock`, `amazon`) render 200, render an explicit "No
published products yet" empty state, are **`noindex`**, and are **absent from the sitemap** (11 of 15
manufacturers are submitted). Verified live. That is the right behaviour and it should be left
alone.

The problem is the tier above it — hubs that pass the gate but have almost nothing on them. Fetched
live, `<main>` word counts:

| Hub | `<main>` words | Items linked | In sitemap | Indexed |
|---|---|---|---|---|
| `/manufacturers/sony` | **26** | 1 | yes | yes |
| `/manufacturers/gopro` | **28** | 1 | yes | yes |
| `/manufacturers/microsoft` | **34** | 2 | yes | yes |
| `/manufacturers/dji` | 63 | 3 | yes | yes |
| `/manufacturers/apple` | 77 | 3 | yes | yes |
| `/manufacturers/samsung` | 76 | 3 | yes | yes |
| `/manufacturers/google` | 76 | 3 | yes | yes |

`/manufacturers/sony` in its entirety: a breadcrumb, the word "Sony", a link to sony.com, one
product card for the PlayStation 5, and "← All manufacturers". It emits a `CollectionPage` whose
`ItemList` has `numberOfItems: 1`.

**The cause is a data gap, not a content gap.** Brand hubs source their coverage section from the
brand *tag* (see the comment on `getBrandArticles()`), and cross-checking `taxonomy_tags` against
`manufacturers`:

| Manufacturer | Published products | Brand tag row |
|---|---|---|
| sony | 1 | **none** |
| gopro | 1 | **none** |
| microsoft | 2 | **none** |
| dji | 3 | **none** |
| tp-link, roborock, amazon | 0 | **none** |
| canon | 22 | 11 articles |
| nvidia | 1 | 6 articles |
| amd | 2 | 5 articles |
| nintendo | 1 | 3 articles |

The site has PlayStation, Xbox, GoPro and DJI articles. Sony's hub shows none of them because no
`sony` tag row exists. Creating four tag rows and applying them would turn four 26–63-word stubs
into real hubs without writing a word.

**Thin category hubs** (all indexed, all in the sitemap): `/ai-hardware` 94 words / 4 items,
`/action-cameras` 103 / 5, `/smart-home-robots` 120 / 4, `/drones-fpv` 122 / 6, `/smartphones` 164 /
8. Every category has ≥3 published articles, so none is empty — but a 94-word page is a listing, not
publisher content.

**Family hubs**: 7 of 7 have ≥2 published products, 120–361 `<main>` words. All Canon. Acceptable as
navigation; none is empty.

**Tag pages do not exist as routes** — there is no `/tags` route (probed: 404) and no `href` to one
anywhere in the crawl. This is worth stating plainly because it is the classic source of hundreds of
thin hub URLs, and this site has zero of them despite carrying 59 tags, **5 of which are attached to
nothing at all** (`battery`, `thread`, `matter`, `robot-vacuum`, `software-updates`) and 16 more
attached to a single item. Because tags never become URLs, none of that reaches the index. Good
architecture; no action needed.

**`/articles?type=…`**: four query-parameter filter views (`guide`, `comparison`, `news`,
`troubleshooting`) are submitted in the sitemap and self-canonicalise. They are pure navigation
screens over content already indexed at `/articles` and at each category. Low severity, but they are
five listing URLs out of 160 that a reviewer could reasonably call navigational rather than
publisher content.

---

#### I4 — 23 published articles have no source records, and the entire site has zero evidence records.

Re-measured today, not assumed. **The figure is still exactly 23.**

- `source_records`: 226 rows total — 176 linked to content, 50 to products.
- **23 of 81 published articles (28%) have zero source records.**
- 29 of 81 have one or zero.
- `evidence_records`: **0 rows site-wide.** No article, no product.
- `freshness_log`: **0 rows site-wide.**
- Articles with neither a source record nor an evidence record: **23** — the same 23.
- Products: all 36 published products have at least one source record and at least one spec. Clean.

The 23, with word counts:

| Words | Type | Slug |
|---|---|---|
| 730 | guide | `wide-field-astrophotography-milky-way` |
| 705 | guide | `equatorial-mounts-explained` |
| 666 | comparison | `mesh-wifi-vs-single-router` |
| 660 | troubleshooting | `home-wifi-troubleshooting-before-buying-hardware` |
| 630 | guide | `sensor-size-explained-crop-vs-full-frame` |
| 616 | guide | `astrophotography-for-beginners` |
| 569 | comparison | `canon-eos-r5-vs-r6` |
| 561 | comparison | `canon-90d-vs-eos-r10` |
| 552 | guide | `how-to-photograph-the-moon` |
| 551 | guide | `canon-dslr-buying-guide` |
| 527 | comparison | `canon-6d-vs-6d-mark-ii` |
| 510 | comparison | `canon-70d-80d-90d-generation-differences` |
| 508 | comparison | `canon-eos-r-vs-rp` |
| 506 | guide | `meteor-shower-photography-settings` |
| 494 | guide | `astrophotography-camera-settings-manual-mode` |
| 488 | guide | `when-does-upgrading-gear-actually-matter` |
| 480 | guide | `do-you-need-4k-8k-video` |
| 473 | guide | `tripod-vs-star-tracker` |
| 470 | guide | `dslr-vs-mirrorless-real-tradeoffs` |
| 460 | guide | `canon-ef-lenses-worth-buying-used` |
| 412 | guide | `best-used-canon-dslr-beginners` |
| 407 | troubleshooting | `canon-eos-60d-still-worth-it` |
| 458 | comparison | `canon-eos-r10-vs-r7` |

This is the entire astrophotography vertical plus most of the Canon vertical — the two subject areas
the site is most identified with.

**In its favour**, and this genuinely counts: `/editorial-policy` addresses this head-on rather than
hiding it — *"some explanatory pieces are written from public standards documentation and carry no
source list, and an article with nothing listed is showing you exactly that rather than implying
sources it does not have."* And the site behaves accordingly: 58 of 81 article pages render a
Sources section, 23 render none. There is no fabricated sourcing anywhere. This is the honest
handling of a gap.

**Against it**: those 23 pages carry no source list *and* no on-page note explaining why (the
"Tech Carvalho does not publish hands-on test results" line renders only on the 58 pages that
*have* sources). A reviewer landing on `wide-field-astrophotography-milky-way` sees 730 words with
no citation, no photograph, and no explanation — the site-wide policy page is a click away and they
will not make it.

**The prose problem underneath**: these pieces hedge where they should answer. Read in full,
`wide-field-astrophotography-milky-way` is supposed to tell you how to photograph the Milky Way. It
gives no aperture, no ISO, no shutter-speed rule of thumb, no worked example — and on visibility it
says *"the exact window shifts with latitude, so check a dedicated planning app or star chart for
your specific location rather than assuming a fixed calendar date applies everywhere."* The
article's job was to be the resource; it directs the reader to the resource. Against Google's
self-assessment question — does the content provide *"a substantial, complete, or comprehensive
description of the topic"* — this cluster is the weakest on the site, and it is 730 words long, so
word count would not have found it.

---

#### I5 — Original contribution: strong at the top, thin in the middle, and the middle is most of the site.

This is the substance of a "low value content" verdict, so it is worth separating carefully.

**Genuinely original — about 7 pieces, and they are good.** `wifi-generations-explained-wifi-4-to-wifi-7`
(2,591 words, 17 sources) separates the IEEE amendment date from the Wi-Fi Alliance certification
date, gives both, and explains why they differ by years — a distinction most coverage gets wrong.
`wifi-connected-but-no-internet` (2,213 words) tells you what "Reset Network Settings" actually
destroys, quoting Apple and Microsoft, *before* recommending against it.
`display-driver-stopped-responding-and-has-recovered` (1,710 words) quotes Microsoft's TDR
documentation including the two-second default timeout. `new-ssd-not-showing-up-in-windows` (1,577
words) flags the exact step that erases data before you reach it. These are synthesis a reader
cannot get from a vendor page, and they are exactly what the helpful-content guidance asks for.

**Restated specs — roughly 50 pieces.** They are accurate, competent, not spam, and contain almost
nothing. `gopro-hero13-vs-osmo-action-5-pro`, read in full at 206 words: five H2s, each restating
one spec pair (battery, resolution, low light, waterproofing, price), every figure traceable to
gopro.com or dji.com, and one sentence of added judgement at the end ("don't let a $20–30 difference
be the deciding factor"). A reader who opened the two manufacturer pages would have everything
except that sentence.

Google's framing is *"embedded or copied content from others without additional commentary,
curation, or otherwise adding value."* The content here is paraphrased rather than copied and there
*is* a thin layer of curation. Whether a reviewer counts 206 words of restated specs plus one
recommendation as adding value is precisely the judgement call at issue.

**Sourcing concentration supports the concern.** Top content-linked source domains:
`store.steampowered.com` (28), `wi-fi.org` (13), `learn.microsoft.com` (8), `dji.com` (7),
`tomshardware.com` (6), `apple.com` (6), `nvidia.com` (6), `blog.playstation.com` (6). Tiers: 134
primary, 39 secondary, 3 community. The primary sources are overwhelmingly the vendor's own spec
page or store listing — which is the material the thin-affiliation policy describes as the
merchant's own description. (There are no affiliate links on this site: `product_offers` has **0
rows**. The *shape* is the concern, not affiliation.)

**Product pages are specification database entries.** All 36 published products, live: `<main>`
ranges 115–301 words, median 237 — and a large share of that is the spec table and navigation, not
prose. Editorial `summary` ranges **4 to 71 words, median 18**; 16 of 36 are under 15 words
(`xbox-series-x` 4, `nintendo-switch-2` 4, `rtx-5090` 5, `xbox-series-s` 6, `playstation-5` 7). A
product page is: one third-party Wikimedia photograph, a spec table, one line of summary, and link
rails. Thirty-six of those are submitted for indexing.

**Imagery is the other half of "original contribution", and it is weak.** Hero source types across
81 articles: `tc_graphic` **69**, `public_domain_or_cc` **12**, staff photograph **0**, manufacturer
press kit **0**. 71 of 81 articles carry exactly one image; the other 10 carry two. Of the 10
astrophotography articles, **one** shows a photograph. An astrophotography vertical with a single
photograph in it is a hard thing to defend as original contribution, whatever the prose does.

Credit where it is due: `/editorial-policy` discloses this precisely — *"a generated image is never
presented as a photograph of a real product, a screenshot, or evidence of a test"* — and the media
rights architecture behind it (`src/lib/media/rights.ts`, two-bucket storage) is unusually
disciplined. The generated graphics are honestly labelled. They are just not photographs of
anything.

---

#### I6 — Excessive templating: the median article page is 46% unique prose and 54% chrome.

Measured as article body words (`countBodyWords`) against the rendered page, for all 81 live pages:

| Measure | Min | Median | Max |
|---|---|---|---|
| Unique prose as % of `<main>` | 29% | **58%** | 91% |
| Unique prose as % of whole rendered page | 27% | **46%** | 85% |

Median non-body words inside `<main>`: **231** (breadcrumbs, deck, meta line, product cards, spec
comparison table, sources block, "more in this series", "explore topic", related rails). Median
words outside `<main>`: **165** (header nav, footer, policy links).

**46 of 81 articles are less than half unique prose.** The worst:

| Unique prose | Body / `<main>` | Slug |
|---|---|---|
| 29% | 551 / 1,889 | `canon-dslr-buying-guide` |
| 40% | 510 / 1,265 | `canon-70d-80d-90d-generation-differences` |
| 41% | 412 / 1,007 | `best-used-canon-dslr-beginners` |
| 42% | 236 / 565 | `ai-phone-camera-real-vs-marketing` |
| 42% | 216 / 520 | `hdmi-2-1-console-gaming-explained` |
| 43% | 206 / 483 | `gopro-hero13-vs-osmo-action-5-pro` |

The best are the long-form troubleshooting pieces at 85–91%, which is the shape you want: chrome is
a roughly fixed cost, so it dominates only when the article is short. This finding is a restatement
of I1 rather than an independent one — **fix the thin pages and this fixes itself.** It is emphatically
not an argument for removing the related-content modules, which are what give the site its
zero-orphan link graph (I7).

**Structural uniformity, which a reviewer sees without opening anything:**

- H2 count: **54 of 81 have exactly 4 or 5.** Range 3–12.
- Paragraph count: **32 of 81 have exactly 6.** 51 of 81 have 5–7.
- **70 of 81 articles contain no bullet list at all.**
- Recurring section headings across unrelated articles: *"the honest bottom line"* ×9, *"the bottom
  line"* ×8, *"when this doesn't matter"* ×5, *"when this does not matter to you"* ×4, *"the short
  version"* ×3, *"who should pick which"* ×3 — 32 heading reuses in total.
- Title formulas: **42 of 81 titles (52%) contain "Actually."** 27 contain "vs", 12 contain a bare
  year, 9 contain "Explained", 8 are "Do You Need…", 5 contain "Worth", 4 are "What's … Confirmed".

**Publication cadence:** `published_at` — 72 articles on 2026-08-21, 9 on 2026-08-22. Row creation —
20 on 08-20, 52 on 08-21, 9 on 08-22. **The entire corpus was created and published inside a
72-hour window.** A reviewer sees this from the sitemap without opening a page.

Set against the scaled-content-abuse policy read today — *"many pages are generated for the primary
purpose of manipulating search rankings and not helping users"*, with *"using generative AI tools or
other similar tools to generate many pages without adding value for users"* as a listed example —
no single number here is disqualifying. Together they are a fingerprint, and the "Actually" tic is
visible from a category listing page in about four seconds.

`/editorial-policy` does disclose the automation, and does it well: *"Research and drafting are
assisted by automated systems… Nothing is published automatically: a person reviews and publishes
every piece."* That is a direct, credible answer to Google's *"Is the use of automation, including
AI-generation, self-evident to visitors through disclosures?"* — and it is the reason this is an
improvement and not a blocker. **The disclosure is on the right side of the line. The 42 identical
headline formulas are what makes a reviewer go looking for it.**

---

#### I7 — Navigation health is genuinely good. No action needed.

Crawled all 160 sitemap URLs plus every internal link discovered from them:

- **Broken internal links: 0.** Every internal `href` on every crawled page resolves 200.
- **Orphan pages: 0.** Every sitemap URL is linked from at least one other page.
- Article inbound links (counted from the real crawl, not from `content_relationships`): **minimum
  3, median 7.** No article is linked from fewer than three pages.
- `content_relationships`: 158 rows, **158 of which connect two published pieces** — zero edges
  pointing at unpublished content.
- 22 of 81 articles have no inbound edge *in the content graph specifically*, but all of them are
  reachable from category hubs, type listings and related rails, so none is an orphan in any sense a
  crawler or a reader would notice.
- `noindex` pages: 5 — `/search` and the 4 empty manufacturer hubs. **None of them is in the
  sitemap.** The sitemap and the `noindex` decisions agree everywhere, which is exactly what
  `hub-eligibility.ts` was written to guarantee.
- `robots.txt` is correct: `Disallow: /admin`, `/api/`, `/auth/`, sitemap declared.

One structural limitation worth naming: `src/lib/content/body-format.ts` parses only headings,
bullets and paragraphs — *"No inline emphasis/links."* Every internal link on the site is therefore a
templated module, never a contextual in-prose link. That reads as a generated catalogue rather than
a publication whose writers reference each other's work. It is a design decision, not a defect, but
it is part of why I6's ratio is what it is.

---

#### I8 — Misleading claims: the article bodies are clean. The site chrome is where the problems are.

I scanned all 81 published bodies and all 36 product summaries for ten families of claim: first-hand
testing, hands-on/review units, measurement claims, numeric ratings, star ratings, awards, explicit
prices, availability, audience/traffic figures, and "we recommend / our pick".

**Findings in the article bodies — effectively clean:**

| Pattern | Hits | Verdict |
|---|---|---|
| "we tested" / "our testing" | 1 | **Not a violation** — it is an explicit *denial* in `pc-game-system-requirements-what-they-mean`: *"No frame-rate measurements, no 'we tested this on an RTX 4070' claims…"* |
| "hands-on" | 1 | **Not a violation** — `robot-vacuum-buying-guide` describing *the reader's* maintenance: "cutting hands-on maintenance to roughly once every 60 days" |
| rating / score out of N | 1 | **Not a violation** — "the Osmo Action 5 Pro's *rated* 4-hour life" (a manufacturer rating) |
| availability | 1 | **Not a violation** — a caution: *"Neither card should be assumed to be in stock at MSRP"* |
| star ratings | 0 | — |
| editor's choice / awards | 0 | — |
| "we measured" | 0 | — |
| "we recommend" / "our pick" | 0 | — |
| traffic / audience claims | 0 | — |

**Across 81 articles there is not one fabricated test, benchmark, rating, or audience figure.** This
is the failure mode most likely to be fatal and the corpus avoids it completely. It deserves saying
plainly, because almost every other finding in this document is a criticism.

**Prices — 32 articles contain a currency figure. One is a problem.** Scanning for
current-market phrasing that carries no date: **2 hits, and only 1 is a real issue.**

- `canon-eos-r6-v-announcement` — *"check current retail listings for up-to-date pricing and
  availability before treating any specific price as current."* This is a caveat, not a claim. Fine.
- **`gopro-hero13-vs-osmo-action-5-pro`** — *"HERO13 Black: $399 MSRP (street pricing has dropped
  toward $329-379). Osmo Action 5 Pro: $349 MSRP, now listed around $319 on DJI's own store."* The
  MSRPs are attributed and durable; **"street pricing has dropped toward $329-379" and "now listed
  around $319" are undated current-market claims with no source**, on a page that now also says
  "Updated 23 August 2026". They will silently become false. This is one sentence on one page.

Everything else is launch price / MSRP anchored to a source, or explicitly dated (*"As of 22 August
2026…"*), or explicitly labelled speculation (`next-gen-console-rumor-tracker-ps6-xbox`: *"Figures
circulating in coverage… are estimates based on component cost trends"*). Two product summaries
mention a price; both are launch prices, and `canon-eos-rebel-t7`'s goes out of its way to explain
why the body-only MSRP is omitted rather than substituting a kit price.

**JSON-LD — clean.** Every `application/ld+json` block was extracted and parsed from the live HTML
of all 160 sitemap pages: **661 blocks, 0 parse errors.** Types emitted: `Organization` ×160,
`WebSite` ×160, `BreadcrumbList` ×159, `Article` ×70, `NewsArticle` ×11, `Product` ×36, `ItemList`
×47, `CollectionPage` ×18. Article + NewsArticle = 81 and Product = 36, matching the database
exactly — nothing is marked up that is not published.

- **No `aggregateRating`, no `reviewRating`, no `ratingValue`, no `review`, no `offers`, no
  `price`, no `priceCurrency`, no `availability`, no `wordCount`, no `sameAs`** in any of the 661
  blocks. Swept programmatically, not sampled.
- `Product` nodes emit only `name`, `description`, `brand`, `image`, `releaseDate`, `category`,
  `url`, and `mpn` where a model number exists. `productJsonLd()`'s own comment explains the
  refusal to emit a hollow `Offer`, and the live markup matches it.
- `review`-type content is emitted as `Article`, never `schema.org/Review` — correct, since `Review`
  requires `reviewRating` and this site does not score anything. (Moot in practice: there are zero
  `review` rows.)
- `author` is the Organization, not an invented person.
- `ItemList`/`CollectionPage` `numberOfItems` matches what the page actually renders, including on
  `/manufacturers/sony` where it honestly says `1`.

`src/lib/seo/jsonld.ts` does what its header comment claims. **The structured data is the most
policy-compliant part of this site.**

**The two chrome-level claims that are not clean are B3 (homepage "real testing" + metadata
"freshness records") and B4 (81 false "Updated" dates).** Both are site furniture rather than
editorial copy, and both override the bodies' honesty — which is the frustrating shape of this
whole audit.

---

#### I9 — A rendering defect leaks raw JSON into spec values on 19 pages.

Spec values stored as JSON strings are being rendered with their delimiters intact. Live on
`/products/gopro-hero13-black`, the first spec row reads:

```
Sensor    "1/1.9\" CMOS, ~27MP"
```

— surrounding straight quotes plus a backslash-escaped inch mark, straight from the JSON literal.
Confirmed in the served HTML (`&quot;1/1.9\&quot; CMOS, ~27MP&quot;`), not a crawling artefact.

Counted across the live crawl: **19 pages render a backslash-escaped quote** (7 product pages, 12
article pages carrying spec comparison tables), and **14 product pages render at least one
quote-wrapped spec value**.

Not a policy violation. But it appears in the *first spec row* of affected pages, and it is exactly
the kind of thing that makes a human reviewer read "under construction" into a site that has just
told them, on its privacy policy, that it is under construction.

---

#### I10 — Smaller items, worth doing, will not change a verdict on their own

- **42 of 81 articles have no hand-written meta description** (55 `seo_metadata` rows carry one;
  39 of those belong to published articles). The derived-excerpt fallback is honest and works. Pure
  SEO hygiene; invisible to a reviewer.
- **5 `taxonomy_tags` rows are attached to nothing** and 16 more to a single item. Harmless today
  because tags have no routes — but it is the kind of unused surface that becomes 59 thin URLs the
  day someone adds `/tags/[slug]`.
- **30 of 81 articles link to no catalogue product.**
- **Catalogue skew: 22 of 36 published products are Canon cameras**, and all 7 product families are
  Canon. A topical-focus question rather than a policy one, but it makes the site read as a Canon
  site with unrelated articles attached.
- **The consent banner is homemade, not an IAB-registered/certified CMP**
  (`src/lib/consent/consent-context.tsx` says so in its own header). Not an eligibility blocker, but
  it constrains what can lawfully be served in the UK/EEA once ads are actually enabled. Out of
  scope for this audit, flagged so it is not forgotten.
- **The AdSense library is not detectable by a crawler.** `AdSenseScript` is gated on
  `consent.advertising`, so Google's own bot will never see the tag; `public/ads.txt` carries the
  real `pub-8902041855720121` entry and is the mechanism that actually satisfies verification. This
  is a deliberate, documented design decision and I am not recommending changing it — but it should
  be consciously re-checked at the moment of applying, because some AdSense flows look for the
  snippet. `AdSlot` has zero call sites and `NEXT_PUBLIC_ADS_ENABLED` is unset, so there are
  currently **no ad units anywhere** — which usefully makes an ad-density or ad-placement violation
  impossible today.

---

## What is genuinely good here, and should not be lost

Listing these is not politeness; three of them are things most rejected sites fail at, and they
change what the shortest path to ready looks like.

1. **No fabricated claims, anywhere.** Zero invented tests, ratings, benchmarks, audience figures or
   availability claims across 81 articles and 36 products. One article goes out of its way to
   enumerate the claims it is *not* making.
2. **The structured data refuses to invent.** No `aggregateRating`, no `offers`, no fake author. A
   `review` type is downgraded to `Article` rather than emitting a `Review` without a rating.
3. **`/editorial-policy` is a genuinely strong trust page** and it discloses the automation, the
   absence of testing, the absence of a corrections log, and the use of generated imagery — all
   things it would have been easier to omit.
4. **Navigation is clean**: zero broken links, zero orphans, sitemap and `noindex` in agreement
   everywhere, empty hubs correctly gated out of the index.
5. **The near-duplicate risk is real-but-tiny**, and the one detector hit is a false positive — the
   safeguards in `quality-inventory.ts` are doing their job.
6. **About 7 articles are genuinely excellent.** They prove the site can produce the real thing.

---

## §10 — The shortest honest path to ready

Ordered by ratio of risk removed to effort. Nothing here involves padding an article.

### Step 1 — Stop the site calling itself unfinished (hours, no writing)

- Set `provisional={false}` on `/privacy` and `/cookies`. Both are already substantive and
  specific; the banner is untrue of them. *(B1)*
- Finish `/terms` and `/affiliate-disclosure` properly, or accept the banner on those two only. A
  72-word terms page is a real stub and the banner is honest about it — but four banners is a
  pattern and two is an exception. *(B1)*
- Put a real contact route on `/contact`: an address that is monitored, or a form. This is the
  single highest-value change on the list. *(B2)*
- Name a publisher. A named editor on `/about` with a line of background, and a byline on articles,
  answers Google's "Who" question. If a personal name is not wanted, a legal entity and country in
  the footer is the minimum. *(B2)*

### Step 2 — Remove the three false claims (hours, no writing)

- Deploy the removal of the homepage "built on real testing and real sourcing" masthead — **it is
  already written and committed as `a611d28`; it is simply unpushed, so it is not live**. *(B3)*
- Fix the homepage metadata description, which still claims "freshness records" that do not exist in
  either the local or the live version. *(B3)*
- Stop rendering "Updated 23 August 2026" on 81 articles that were not updated. Either drive the
  displayed revision date from `freshness_log` (which is what it is for, and which would render
  nothing today — correctly), or reset `updated_at` to `published_at` for rows the bulk write
  touched. **This needs an explicit decision from you before any production SQL runs; nothing was
  changed by this audit.** *(B4)*
- Delete or date the two undated street-price sentences in `gopro-hero13-vs-osmo-action-5-pro`.
  *(I8)*

### Step 3 — Decide about roughly 20 URLs (a day, mostly deciding)

This is the corpus fix, and it is subtraction rather than addition.

- Take the **22 articles under half their own floor** (I1). For each: does it contain something the
  vendor pages do not? If yes, improve it with that material. If no, **unpublish it.** Merging is
  almost never the answer here — I2 found essentially nothing genuinely duplicative.
- **7 strong pieces out of 81 reads as a content farm that occasionally tries. 7 out of 55 reads as
  a small publication with a long tail. 7 out of 30 reads as a focused one.** Removing weak pages is
  the highest-leverage move available and the only one consistent with `/about`'s own promise:
  *"Nothing is published here to make the site look more complete than it is."* Eighty-one URLs is
  currently doing exactly that.
- Add the four missing brand tag rows (`sony`, `gopro`, `microsoft`, `dji`) and apply them. Four
  26–63-word hub pages become real hubs with no writing at all. *(I3)*
- Fix the spec-value JSON escaping. 19 pages, one rendering bug. *(I9)*

### Step 4 — Only then consider applying

Once Steps 1 and 2 are live, re-crawl and confirm: no page says "placeholder", `/contact` offers a
route, the homepage makes no testing claim, and no article claims an update that did not happen.

Steps 1 and 2 alone remove all four blockers and are a day's work. Step 3 is what changes the
answer to *"is this a publication or a catalogue?"*, and it is the one that needs your editorial
judgement rather than mine.

### What I would explicitly *not* do

- **Do not lengthen thin articles.** A 900-word `gopro-hero13-vs-osmo-action-5-pro` is a worse page
  and a clearer scaled-content violation than the 206-word one.
- **Do not merge the `phone-camera` / `ai-phone-camera` pair.** The detector's one hit is a false
  positive (I2); merging would destroy a genuinely distinct article about vendor AI claims.
- **Do not add `/tags/[slug]` routes.** They would create 59 URLs, 21 of which carry one item or
  none.
- **Do not remove the related-content modules** to improve the boilerplate ratio in I6. They are
  what give the site zero orphans and a median of seven inbound links per article.
- **Do not weaken the `noindex` gating on empty hubs.** It is correct and it is already saving four
  URLs from the index.

---

## §11 — Policy sources (all fetched 2026-08-23)

| Source | Stated last update | Used for |
|---|---|---|
| [Google Publisher Policies](https://support.google.com/adsense/answer/9335564) | none stated | "low-value content… under construction"; "embedded or copied content from others without additional commentary, curation, or otherwise adding value"; incorporation of the Search spam policies by reference |
| [Google Search spam policies](https://developers.google.com/search/docs/essentials/spam-policies) | 2026-05-15 UTC | Scaled content abuse definition and examples; thin affiliation definition |
| [AdSense eligibility](https://support.google.com/adsense/answer/9724) | none stated | "high-quality, original, and attract an audience"; "your own content that meets our policies" |
| [Creating helpful, reliable, people-first content](https://developers.google.com/search/docs/fundamentals/creating-helpful-content) | 2025-12-10 UTC | Who/How/Why self-assessment — bylines, author background, automation disclosure |
| [Structured data general guidelines](https://developers.google.com/search/docs/appearance/structured-data/sd-policies) | 2026-07-10 UTC | "Don't use structured data to deceive or mislead users" |

Note on the scaled-content policy: its current wording does **not** require the content to be
automated. The test is scale plus low added value, whatever produced it — hand-written pages can
violate it. That is why I6's cadence and uniformity findings matter even though `/editorial-policy`
discloses the automation honestly.

## §12 — Measurement provenance

Every figure in this document comes from one of two runs on 2026-08-23:

- **Database**: a temporary read-only script using `loadEnvLocal()` / `createAdminClient()` from
  `scripts/_shared.ts`, run via `npx tsx`. Tables read: `content_items`, `source_records`,
  `evidence_records`, `freshness_log`, `content_relationships`, `content_products`, `content_tags`,
  `content_media`, `media_assets`, `products`, `product_specs`, `product_offers`,
  `product_launch_pricing`, `product_tags`, `product_families`, `manufacturers`,
  `taxonomy_categories`, `taxonomy_tags`, `seo_metadata`, `engine_job_runs`. Every `select` checked
  its own `error` and its own `null` and threw on either. The script was deleted after the run; it
  wrote nothing.
- **Live crawl**: 160 sitemap URLs + 15 discovered internal links + 11 probes, fetched over HTTP
  with retries that throw rather than returning empty.

Where this audit repeats a figure established earlier (the "23 sourceless pages"), it was
**re-measured, not assumed** — and it re-measured to exactly 23.

Where a figure describes the live site rather than the local checkout, it is labelled as such. The
local branch is one commit ahead of `origin/main`; nothing was committed, pushed or deployed by this
audit, and no production SQL was run. The only file this audit created is this document — the
measurement script was deleted after its run.
