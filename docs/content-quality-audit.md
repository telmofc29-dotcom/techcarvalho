# Content quality & AdSense readiness audit

**Audit date:** 2026-08-22
**Scope:** 81 published articles, 36 published products, 7 trust/publisher pages, live site at
https://www.techcarvalho.com
**Method:** read-only production query via `createAdminClient()` (same RLS path as the app, no
service-role key, nothing written), plus live fetches of the public pages.
**Context:** a sibling site was previously rejected by Google AdSense for *"Low value content."*
This audit asks one question: if a reviewer opened TechCarvalho today, would they reach the same
conclusion?

**Honest headline: yes, probably.** Not because the writing is bad — the best pieces here are
genuinely good — but because the corpus's *shape* matches Google's published description of scaled
content almost point for point, and every trust page tells the reviewer the site is unfinished.

---

## 1. What Google actually requires (read 2026-08-22)

Working from the current published documents, not memory. Several of these changed in 2024–2025.

### Google Search spam policies — "Scaled content abuse"
Source: https://developers.google.com/search/docs/essentials/spam-policies — **page last updated
2026-05-15 UTC**

> "Scaled content abuse is when many pages are generated for the primary purpose of manipulating
> search rankings and not helping users."

Listed examples that apply here:

> "Using generative AI tools or other similar tools to generate many pages without adding value for
> users"

> "Scraping feeds, search results, or other content to generate many pages … where little value is
> provided to users"

Note what the 2024 revision of this policy did: it **removed the requirement that the content be
automated**. The test is now *scale + low added value*, whatever produced it. Hand-written pages can
violate it.

### Google Search spam policies — "Thin affiliation"
Same URL.

> "Thin affiliation is the practice of publishing content with product affiliate links where the
> product descriptions and reviews are copied directly from the original merchant without any
> original content or added value."

Google's stated bar for an acceptable affiliate/product page is that it adds "meaningful content
through comparisons, testing, ratings, or navigation features." TechCarvalho has no affiliate links
today, but the *page shape* being described — merchant-derived specs with little added — is what 36
of its product pages currently are.

### Google Publisher Policies (governs AdSense)
Source: https://support.google.com/adsense/answer/9335564

> "We do not allow Google-served ads on screens: without publisher-content or with low-value
> content, that are under construction, that are used for alerts, navigation or other behavioral
> purposes"

Two phrases matter: **"low-value content"** and **"under construction."** The second one is not
about content at all — it is about the site declaring itself unfinished. See §4.

> ads may not be placed on screens "with embedded or copied content from others without additional
> commentary, curation, or otherwise adding value"

> "You must not: place Google-served ads on screens that violate the Spam policies for Google web
> search"

So the Search spam policies above are incorporated by reference into AdSense eligibility.

### AdSense eligibility
Source: https://support.google.com/adsense/answer/9724

> "Your content must be high-quality, original, and attract an audience."

> you must have "your own unique and interesting content"

### Creating helpful, reliable, people-first content
Source: https://developers.google.com/search/docs/fundamentals/creating-helpful-content —
**page last updated 2025-12-10 UTC**

The self-assessment questions that this site fails hardest on:

- Does the content provide "original information, reporting, research, or analysis"?
- Does it provide "a substantial, complete, or comprehensive description of the topic"?
- Does it provide "insightful analysis or interesting information that is beyond the obvious"?
- Is the content produced by "an expert or enthusiast who demonstrably knows the topic well"?
- **Who:** "Do you make it clear who authored the content?" — bylines and author background.
- **How:** *"Is the use of automation, including AI-generation, self-evident to visitors through
  disclosures?"*
- **Why:** is the content made to help people, or primarily to rank?

### Structured data policies
Source: https://developers.google.com/search/docs/appearance/structured-data/sd-policies

> "Don't use structured data to deceive or mislead users."

> "Don't mark up content that is not visible to readers of the page."

---

## 2. The corpus, measured

All figures from a live read of production on 2026-08-22.

### Length

| Bucket | Articles |
|---|---|
| under 300 words | 21 |
| 300–499 | 29 |
| 500–799 | 24 |
| 800–1,199 | 1 |
| 1,200–1,999 | 4 |
| 2,000+ | 2 |

- **Median article: 461 words. Shortest: 212. p90: 765.**
- **Total prose on the entire site: 43,879 words** across 81 articles — roughly one non-fiction
  book, spread over 81 URLs.
- **50 of 81 articles (62%) are under 500 words.**
- **40 of 81 are simultaneously under 500 words and backed by 2 or fewer source records.**

*This is not an argument for padding.* Google does not have a word-count threshold and inflating
these would make things worse, not better. The number matters only as a proxy for the real finding
in §3: most of these pieces contain nothing a reader could not get from the two manufacturer spec
pages they were derived from.

The 10 thinnest, with actual titles:

| Words | Type | Sources | Title |
|---|---|---|---|
| 212 | comparison | 2 | GoPro HERO13 Black vs. DJI Osmo Action 5 Pro: Which Action Camera Should You Buy? |
| 222 | comparison | 2 | PS5 Digital Edition vs. Disc Edition: What You Actually Give Up |
| 222 | guide | 1 | What HDMI 2.1 Actually Changes for PS5 and Xbox Gaming |
| 227 | guide | 1 | FPV vs. Camera Drone: Which One Do You Actually Want? |
| 228 | guide | 2 | Wi-Fi 7 Explained — What Actually Changes |
| 233 | troubleshooting | 2 | DJI Drone Losing Signal or Won't Connect? Here's What's Actually Wrong |
| 234 | guide | 2 | Best Action Camera for Mountain Biking and Trail Riding |
| 234 | comparison | 2 | Nintendo Switch 2 vs. Switch: What's Actually New |
| 238 | comparison | 2 | Xbox Series X vs. Series S in 2026: Which One to Buy |
| 246 | guide | 2 | AI in Your Phone's Camera — What's Real vs. Marketing |

### Publication cadence — the single most damaging number

| Date | Articles published |
|---|---|
| 2026-08-21 | **72** |
| 2026-08-22 | 9 |

Row-creation timestamps: 20 rows on 2026-08-20, 52 on 2026-08-21, 9 on 2026-08-22.

**The entire 81-article corpus was created and published within a 72-hour window.** A reviewer does
not need to read a single article to see this — it is visible from the sitemap and from the dates
rendered on every article page. Combined with the uniform house style (below), this is the exact
fact pattern of "many pages generated … without adding value."

### Structural uniformity

- H2 heading count: **54 of 81 articles have exactly 4 or 5 H2s.** Range across the whole site is
  3–12.
- Paragraph count: **32 of 81 have exactly 6 paragraphs**; 51 of 81 have 5–7.
- **70 of 81 articles contain zero bullet lists.**
- Recurring section headings across different articles: *"The honest bottom line"* ×9, *"The bottom
  line"* ×8, *"When this doesn't matter"* ×5 plus *"When this does not matter to you"* ×4, *"Who
  should pick which"* ×3, *"The short version"* ×3, *"Who should actually buy which"* ×2, *"When not
  to spend money"* ×2, *"When none of this matters"* ×2.

### The verbal tic — the most visible single-generator fingerprint

**42 of 81 titles (52%) contain the word "Actually."**

A sample, all live:

- What HDMI 2.1 **Actually** Changes for PS5 and Xbox Gaming
- Wi-Fi 7 Explained — What **Actually** Changes
- Wi-Fi 4 to Wi-Fi 7: What Each Generation **Actually** Changed
- Nintendo Switch 2 vs. Switch: What's **Actually** New
- PS5 Digital Edition vs. Disc Edition: What You **Actually** Give Up
- Xbox Game Pass vs PlayStation Plus: What You **Actually** Get
- PS5 Storage Expansion Explained: What Drives **Actually** Work
- What "AI PC" **Actually** Means (And Why the Term Gets Abused)
- What AMD's 3D V-Cache (X3D) Chips **Actually** Do for Gaming
- Robot Vacuum Buying Guide: What **Actually** Matters in 2026
- Smart Home Starter Guide: Where to **Actually** Begin
- Thread vs Zigbee vs Wi-Fi: What Each Smart Home Protocol **Actually** Does
- Minimum and Recommended System Requirements: What They **Actually** Promise
- How Much Storage Modern Games **Actually** Need
- Late 2026 Game Release Dates: What's **Actually** Dated
- GTA 6: What's **Actually** Confirmed About the Release Date
- Call of Duty: Modern Warfare 4: What's **Actually** Confirmed
- Sensor Size Explained: Crop vs Full-Frame, What It **Actually** Changes
- Canon EOS 70D vs 80D vs 90D: What **Actually** Changed Between Generations
- Do You **Actually** Need an RTX 5090 for 1440p Gaming?
- …and 22 more.

Other title formulas: 27 titles contain "vs.", 9 contain "Explained", 8 contain "Do You Need",
12 contain a bare year.

No human editorial desk produces 42 headlines around one adverb. A reviewer scrolling a category
listing page sees this in about four seconds, and it is the thing most likely to trigger the "this
was machine-produced at scale" judgement before any article is read.

### Sourcing

- **23 of 81 articles (28%) have zero source records.**
- **29 of 81 (36%) have one or none.**
- Only 8 articles have 4 or more.
- 176 content-linked source records total; tiers: 134 primary, 39 secondary, 3 community.

Every zero-source article, by title — note that this is *the entire photography and
astrophotography vertical*:

| Words | Type | Title |
|---|---|---|
| 752 | guide | Wide-Field Astrophotography: Getting the Milky Way Without a Tracker |
| 715 | guide | Equatorial Mounts Explained: Do Beginners Actually Need One |
| 689 | comparison | Mesh Wi-Fi vs a Single Router: Do You Actually Need Mesh |
| 673 | guide | Sensor Size Explained: Crop vs Full-Frame, What It Actually Changes |
| 672 | troubleshooting | Home Wi-Fi Troubleshooting: What to Check Before You Buy New Hardware |
| 628 | guide | Astrophotography for Beginners: A Practical Starting Guide |
| 595 | comparison | Canon EOS R5 vs R6: Which Full-Frame R Body Do You Need |
| 581 | comparison | Canon 90D vs Entry Mirrorless: Which Should You Actually Buy |
| 566 | guide | How to Photograph the Moon (Without a Telescope) |
| 562 | guide | Canon DSLR Buying Guide: Which EOS Body Actually Makes Sense Now |
| 544 | comparison | Canon 6D vs 6D Mark II: Is the Upgrade Actually Worth It |
| 528 | comparison | Canon EOS R vs RP: Canon's First Full-Frame Mirrorless Bodies Compared |
| 521 | comparison | Canon EOS 70D vs 80D vs 90D: What Actually Changed Between Generations |
| 514 | guide | Meteor Shower Photography: Camera Settings and Realistic Expectations |
| 504 | guide | Camera Settings for Astrophotography: Manual Mode Explained |
| 490 | guide | Do You Actually Need 4K or 8K Video Right Now? |
| 489 | guide | When Does Upgrading Actually Matter? |
| 485 | guide | Tripod vs Star Tracker: Which Do You Actually Need First? |
| 478 | guide | DSLR vs Mirrorless: The Real Trade-offs, Not the Marketing Version |
| 471 | comparison | Canon R10 vs R7: Canon's APS-C Mirrorless Lineup Explained |
| 469 | guide | Canon EF Lenses Still Worth Buying Used |
| 421 | troubleshooting | Canon EOS 60D: Is It Still Worth Buying? |
| 415 | guide | Best Used Canon DSLRs for Beginners |

Where sources *do* exist, the concentration is telling: the single most-cited domain across the
whole site is `store.steampowered.com` (28 citations), followed by `wi-fi.org` (13),
`learn.microsoft.com` (8), `dji.com` (7), `apple.com` (6), `nvidia.com` (6). These are almost
entirely vendor spec pages and store listings — i.e. the material Google's thin-affiliation policy
describes as the merchant's own description.

### Hero media

| Hero source type | Articles |
|---|---|
| `tc_graphic` (site-generated graphic) | **69** |
| `public_domain_or_cc` (real photograph, Wikimedia Commons) | 12 |
| Staff photograph | **0** |
| Manufacturer / press kit | **0** |

- **85% of articles lead with a generated graphic rather than a photograph of anything.**
- **71 of 81 articles have exactly one image on the entire page.** The other 10 have two.
- Zero images anywhere on the site are original photography. All 12 real photographs are third-party
  Wikimedia Commons images (credited to Steve Jurvetson, See-ming Lee, Henry Söderlund, etc.).
- Media library totals: 112 assets, 65 `tc_graphic`, 39 `public_domain_or_cc`, 8 uncategorised.

**15 articles whose subject is a specific, named, photographable physical product lead with a
generic card graphic instead of the product:**

| Words | Hero role | Title |
|---|---|---|
| 551 | comparison_graphic | iPhone 17 Pro vs. Galaxy S26 Ultra vs. Pixel 10 Pro: Which 2026 Flagship Actually Fits You |
| 474 | article_hero | Canon Announces the EOS R6 V: What's Confirmed So Far |
| 464 | article_hero | PS6 and Next-Gen Xbox: Rumour Tracker |
| 390 | comparison_graphic | How Much Power Supply Do You Actually Need for an RTX 5090 Build? |
| 331 | comparison_graphic | Xbox Game Pass vs PlayStation Plus: What You Actually Get |
| 320 | comparison_graphic | RTX 5090 vs RTX 5080: Is the Extra $1,000 Worth It? |
| 269 | comparison_graphic | Ryzen 7 9800X3D vs Ryzen 9 9950X: Gaming Chip or Workstation Chip? |
| 262 | comparison_graphic | PS5 vs. PS5 Pro: Is the $200+ Upgrade Actually Worth It? |
| 256 | comparison_graphic | DJI Mini 4 Pro vs. DJI Air 3S: Which Should You Buy? |
| 238 | comparison_graphic | Xbox Series X vs. Series S in 2026: Which One to Buy |
| 234 | comparison_graphic | Nintendo Switch 2 vs. Switch: What's Actually New |
| 233 | article_hero | DJI Drone Losing Signal or Won't Connect? Here's What's Actually Wrong |
| 222 | article_hero | What HDMI 2.1 Actually Changes for PS5 and Xbox Gaming |
| 222 | comparison_graphic | PS5 Digital Edition vs. Disc Edition: What You Actually Give Up |
| 212 | comparison_graphic | GoPro HERO13 Black vs. DJI Osmo Action 5 Pro: Which Action Camera Should You Buy? |

**41 of the 51 articles that are explicitly linked to a product in the catalogue still use a
generated graphic as the hero** — even though the linked product record already has a real
photograph attached. The photo exists; the article just isn't using it.

### Internal linking and orphans

- No article is a true orphan: every one has at least one `content_relationships` edge. Good.
- But **22 of 81 have zero *inbound* links** — nothing in the corpus points at them.
- **The article body format supports no inline links at all.** `src/lib/content/body-format.ts`
  parses exactly three constructs — `##`/`###` headings, `- ` bullets, and paragraphs — and its own
  header states: *"No inline emphasis/links."* Every internal link on the site is therefore a
  templated module (related cards, tag chips, breadcrumbs), never a contextual in-prose link. To a
  reviewer this reads as a generated catalogue rather than a publication whose writers reference
  each other's work.
- 30 of 81 articles link to no product at all.

### Metadata and freshness

- **42 of 81 articles have no hand-written meta description** (they fall back to a derived excerpt).
- **0 articles have any `freshness_log` entry.** Nothing on the site has ever been reviewed for
  accuracy after publication.

### Authorship

- **`author_id` is NULL on all 81 articles.**
- There is no authors table in the schema and no byline rendered anywhere in
  `src/app/(public)/articles/[slug]/page.tsx`. The article header shows only content type and date:
  *"Guide · Published August 22, 2026."*
- The site has exactly one `admin_users` row, and that person is not named anywhere on the public
  site.

This is a direct miss against the "Who" question in Google's helpful-content guidance and against
E-E-A-T's Trust component, which is the one Google describes as the most important member of the
family.

### Products (36 published)

Better than the articles in one respect, worse in another.

- **All 36 have a real Wikimedia Commons photograph.** No generated placeholders. Good.
- All 36 have specs and at least one source record.
- But the editorial `summary` field ranges from **4 to 71 words**, median ~18. Examples: *Microsoft
  Xbox Series X* — 4 words. *Nintendo Switch 2* — 4 words. *NVIDIA GeForce RTX 5090* — 5 words.
  *Sony PlayStation 5* — 7 words.
- So a product page is: one third-party photo, a spec table, a one-line summary. That is a
  specification database entry, not publisher content. Thirty-six of them are indexed.
- The catalogue is also heavily skewed: **22 of 36 published products are Canon cameras.**

### First-hand testing claims — this one is a *pass*

I scanned all 81 bodies for nine families of experiential phrasing ("we tested", "in our testing",
"hands-on", "our review unit", "we found", "our pick", "we recommend", …).

**Only 2 articles matched, and neither is a false claim:**

1. *Robot Vacuum Buying Guide* — "cutting **hands-on** maintenance to roughly once every 60 days."
   Describes the reader's maintenance, not the site's testing. Fine.
2. *Minimum and Recommended System Requirements* — matched only because it contains an explicit
   **denial**: *"No frame-rate measurements, no 'we tested this on an RTX 4070' claims … TechCarvalho
   has not bench[marked]…"*

The article bodies are commendably disciplined about not fabricating experience. Credit where due —
this was the failure mode most likely to be fatal, and the corpus avoids it. **But see §4: the site
chrome makes the claim the articles refuse to make.**

---

## 3. Reading the actual prose

The metrics above would be unfair on their own, so here is the qualitative read.

**The corpus is bimodal.** There are two clearly different classes of article.

**Class A — about 7 pieces. Genuinely good, and Google would say so.** *Wi-Fi 4 to Wi-Fi 7* (2,716
words, 17 sources) does real work: it separates the IEEE amendment date from the Wi-Fi Alliance
certification date, gives both ("IEEE lists 802.11ax as published on 19 May 2021, but Wi-Fi
Alliance announced … on 16 September 2019"), and explains why the gap exists. *Wi-Fi Connected But
No Internet* (2,241 words) tells the reader what "Reset Network Settings" actually destroys, quoting
Apple and Microsoft directly, before recommending against it. *"Display Driver Stopped Responding"*
(1,733 words) quotes Microsoft's TDR documentation precisely, including the two-second default
timeout. These are original synthesis and analysis. They are exactly what §1's helpful-content
questions are asking for.

**Class B — roughly 50 pieces. Accurate, competent, and empty.** They are not spam and not
gibberish. They are correct. The problem is that there is nothing in them. *GoPro HERO13 Black vs.
DJI Osmo Action 5 Pro* (212 words) has five H2s, each restating one spec pair: battery life,
resolution, low light, waterproofing, price. Every number in it comes from gopro.com and dji.com.
The only added value is the closing sentence telling you to weigh battery life over a $20 price gap.
A reader who opened the two product pages would have everything except that sentence.

That is the finding. Not "the writing is bad" — **"the page does not contain a reason to exist
separate from the two manufacturer pages it was derived from."** Google's own framing:

> "embedded or copied content from others without additional commentary, curation, or otherwise
> adding value"

The content is paraphrased rather than copied, and there *is* a thin layer of curation. Whether a
reviewer counts 212 words of restated specs plus one recommendation as "adding value" is exactly
the judgement call that produced a "Low value content" rejection on the sibling site.

The zero-source photography cluster has a different problem: it hedges instead of answering.
*Wide-Field Astrophotography* (752 words) is supposed to tell you how to shoot the Milky Way. What
it says is: *"the exact window shifts with latitude, so check a dedicated planning app or star chart
for your specific location rather than assuming a fixed calendar date applies everywhere."* The
article's job was to be the resource; it tells you to go find the resource. Twenty-three articles
share this shape, with no sources behind any of them.

---

## 4. Trust and publisher pages — the most fixable, most damaging findings

I fetched all seven live.

### Every legal page declares itself incomplete

`src/components/public/legal-page.tsx` renders this unconditionally, on **all five** pages that use
it — `/privacy`, `/cookies`, `/terms`, `/affiliate-disclosure`, `/editorial-policy`:

> "This page is a placeholder pending final legal review and does not yet constitute Tech
> Carvalho's complete policy."

Set this against the Publisher Policy language quoted in §1: ads are not allowed on screens **"that
are under construction."** The site is telling the reviewer, in writing, on the privacy policy, that
it is under construction. `/terms` adds: *"Full terms of use will be published here before the site
accepts user accounts, comments, or submissions."*

A privacy policy is a hard requirement for AdSense — and this one disclaims its own validity.

### /contact provides no way to make contact

> "Tech Carvalho does not yet have a monitored contact address or contact form set up — this page
> will be updated…"

No email, no form, no postal address, no legal entity. A reviewer assessing publisher legitimacy
cannot contact the publisher. Combined with zero bylines, there is **no identifiable human being
associated with this publication anywhere on the site.**

### /editorial-policy claims testing that does not exist

The policy says content is:

> "built around real testing, sourcing, and freshness records"

Measured reality: **0 evidence/testing records, 0 freshness reviews, and 23 of 81 articles with no
source records.** The same page also says:

> "nothing is published as tested, reviewed, or sourced unless it genuinely is"

which is a good principle that the site's own chrome then breaks — see below. It also concedes:

> "A formal, public-facing correction log has not been built yet."

**There is no corrections policy.** There is a statement that one does not exist yet.

### The per-article evidence note is false on at least 23 articles

`src/app/(public)/articles/[slug]/page.tsx:288` renders this on **every article, unconditionally**,
with no check on whether any records exist:

> "Evidence, sourcing, and testing records behind this piece are tracked internally as part of Tech
> Carvalho's editorial process."

On the 23 zero-source articles this is simply untrue. And **"testing records"** implies first-hand
testing on all 81 — the exact claim the article bodies are so careful not to make. The site chrome
undoes the bodies' honesty. This also violates this repo's own rule in `CLAUDE.md`: *"Never render
fabricated reviews, ratings, testing claims…"*

Compounding it: source records are internal-only and never rendered. So a reviewer sees a site that
*asserts* it has sourcing while showing none, on articles that in many cases have none.

### Automation is not disclosed

`/editorial-policy` states:

> "Article text is written and edited by people. If that changes for any specific piece, it will be
> disclosed on that piece."

Against Google's "How" question — *"Is the use of automation, including AI-generation, self-evident
to visitors through disclosures?"* — a reviewer looking at 72 articles published in one day, 52% of
whose titles share one adverb, will not find that statement credible. If it is accurate, the site
needs to say something that explains the cadence. If it is not accurate, it is a false statement on
a trust page, which is worse than no statement.

### /about

The most honest page on the site, and the only one without the placeholder disclaimer. It says
outright: *"Nothing is published here to make the site look more complete than it is."* But it names
no person, describes no process, and mentions no automation.

### /affiliate-disclosure

Accurate — *"Tech Carvalho does not currently participate in any affiliate programs"* — and
therefore currently pointless, but harmless. It carries the placeholder disclaimer for no reason.

---

## 5. Prioritised findings

### (a) Genuinely likely to matter to a reviewer

**P0 — the site declares itself unfinished on the pages a reviewer reads first.**
Five legal pages carry "placeholder pending final legal review"; `/contact` offers no contact
method. Publisher Policy explicitly excludes screens "under construction." This is one shared
component (`legal-page.tsx:31-34`) plus one page, and it is the cheapest high-severity fix on this
list. Nothing else on the list matters if the reviewer stops here.

**P1 — no identifiable publisher or author, anywhere.**
`author_id` NULL ×81, no authors table, no byline rendered, no named person on `/about` or
`/contact`. Fails the "Who" question and E-E-A-T Trust outright. A site with no author and no
contact route is a site with no accountable publisher.

**P2 — false trust claims in site chrome.**
The unconditional per-article "Evidence, sourcing, and testing records" note (23 articles have no
source records; nothing on the site has ever been tested or freshness-reviewed) and
`/editorial-policy`'s "built around real testing." A reviewer who checks one claim and finds it
unsupported will discount everything else the site asserts. This is also a self-inflicted wound: the
article bodies are scrupulously honest and the chrome overrides them.

**P3 — the corpus shape reads as scaled generation.**
72 articles in one day; 43,879 total words over 81 URLs; median 461 words; 54 of 81 with 4–5 H2s; 32
of 81 with exactly 6 paragraphs; "The honest bottom line"/"The bottom line" ×17; **42 of 81 titles
containing "Actually."** No single fact here is disqualifying. Together they are a fingerprint, and
the title tic is visible from a category listing page without opening anything.

**P4 — ~50 Class B articles add little beyond the vendor pages they cite.**
40 articles are under 500 words with ≤2 sources, most citing only `store.steampowered.com`,
`dji.com`, `gopro.com`, `apple.com`, `nvidia.com`. This is the substance of the "low value" charge.
**The fix is not padding** — a 900-word version of the GoPro comparison would be a worse page and a
clearer policy violation. The options that actually help are: consolidate several thin comparisons
into one genuinely comprehensive piece; add something the vendor pages don't have (real
side-by-side measurement, a decision framework, historical price tracking); or unpublish the ones
that cannot be raised.

**P5 — 23 articles with zero sources, comprising the entire photography/astrophotography vertical.**
These are also the hedge-heavy ones that defer to other resources. Highest-risk cluster on the site
against "original information, reporting, research, or analysis."

**P6 — 85% of heroes are generated graphics; zero original photography.**
Including 15 articles about specific photographable products (PS5, RTX 5090, GoPro HERO13, iPhone 17
Pro, Nintendo Switch 2) and 41 articles that are already linked to a catalogue product that *has* a
real photo. 71 of 81 articles have exactly one image. Note this is partly a **routing** problem, not
a sourcing problem — the photos exist and aren't being used.

**P7 — 36 product pages with 4–71 word summaries.**
Photo + spec table + one line. The shape Google's thin-affiliation policy describes, and 22 of 36
are Canon cameras. Consider `noindex` on product pages that carry no original commentary, or fold
them into the articles that reference them.

**P8 — no corrections policy and no freshness activity.**
`/editorial-policy` states a public correction log "has not been built yet"; `freshness_log` is
empty for all 81 articles. Corrections practice is a standard trust signal for a publication that
makes factual claims about prices and specs.

**P9 — automation not disclosed, in tension with a claim that it isn't used.**
Either explain the production process in a way that accounts for 72 articles in a day, or stop
asserting the negative.

### (b) Cosmetic — worth doing, will not change a verdict

- **42 missing meta descriptions.** The derived-excerpt fallback already works and is honest. Pure
  SEO hygiene; a reviewer never sees this.
- **22 articles with no inbound internal links.** Real for crawl equity, invisible to a human
  reviewer, and no article is a genuine orphan.
- **47 articles with NULL `intent_fingerprint`.** Internal editorial metadata, not user-facing.
- **Near-duplicate/cannibalisation risk is low.** Only 8 title/query pairs cross the similarity
  threshold, no duplicate `intent_fingerprint` values, and no duplicate `primary_query` values. The
  strongest pairs are legitimately distinct products (*Canon EOS R vs RP* / *Canon EOS R5 vs R6*;
  *Mesh Wi-Fi vs a Single Router* / *Mesh Router Buying Guide 2026*). This is a **ranking** concern,
  not a low-value one — do not let it distract from P0–P4.
- **`/affiliate-disclosure` carrying a placeholder notice** while correctly stating there are no
  affiliate programs. Fix it when the shared component is fixed.
- **Canon-heavy catalogue skew (22/36).** A topical-focus question, not a policy one.

---

## 6. The blunt version

**This site currently looks like a thin automated catalogue, and the evidence is not subtle.**

Eighty-one URLs, 43,879 words, published in three days, median 461 words, 62% under 500 words, 28%
with no sources at all, 85% illustrated with generated graphics rather than photographs, zero
bylines, zero corrections policy, zero contact method, and 52% of headlines built on the same
adverb. A reviewer does not need to read the articles to form that impression, and the two pages
they *would* read — `/contact` and `/privacy` — both say the site isn't finished.

Two things genuinely cut the other way, and they should not be lost:

1. **The article bodies do not lie.** Across 81 pieces there is not one fabricated test, benchmark,
   rating, or price claim, and one article explicitly refuses to make claims it can't support. The
   `evidence_records`/`source_records`/`media rights` architecture is real and unusually
   disciplined. Most sites in this position fail *here*, and this one doesn't.
2. **About 7 articles are genuinely strong** — *Wi-Fi 4 to Wi-Fi 7*, *Wi-Fi Connected But No
   Internet*, *"Display Driver Stopped Responding"*, *DLSS/FSR/XeSS*, *Minimum and Recommended
   System Requirements*, *How Much Storage Modern Games Actually Need*, *Thread vs Zigbee vs Wi-Fi*.
   Deeply sourced, quoting primary standards and vendor documentation, doing analysis a reader
   cannot get elsewhere. These prove the site can produce the real thing.

The problem is the **ratio**, and the ratio is fixable in the direction that costs nothing: 7 strong
pieces out of 81 reads as a content farm that occasionally tries. **7 strong pieces out of 20 reads
as a small, honest, focused publication.** Removing weak pages is the highest-leverage move
available and the one most consistent with Google's actual guidance — and with this repo's own
stated principle that *"Nothing is published here to make the site look more complete than it is."*

Right now, 81 URLs is doing exactly that.

---

## Sources consulted (all read 2026-08-22)

- [Google Publisher Policies (AdSense)](https://support.google.com/adsense/answer/9335564)
- [Google Search spam policies](https://developers.google.com/search/docs/essentials/spam-policies) — page last updated 2026-05-15 UTC
- [Creating helpful, reliable, people-first content](https://developers.google.com/search/docs/fundamentals/creating-helpful-content) — page last updated 2025-12-10 UTC
- [AdSense eligibility requirements](https://support.google.com/adsense/answer/9724)
- [Structured data general guidelines](https://developers.google.com/search/docs/appearance/structured-data/sd-policies)
- [Google Ads destination requirements](https://support.google.com/adspolicy/answer/6368661) (insufficient original content)
