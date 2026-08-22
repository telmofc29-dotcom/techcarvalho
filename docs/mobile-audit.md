# Mobile audit — live production (www.techcarvalho.com)

Measured 2026-08-22 against the **live production site**, not a local build. Read-only audit: no
production code was changed, nothing was pushed or deployed.

## Method

Playwright 1.62.1 / Chromium 151, one fresh browser context per (page × width). Realistic UA set
explicitly (`...Chrome/131.0.0.0 Mobile Safari/537.36`) because the default headless UA contains
`HeadlessChrome`, which `BOT_UA_PATTERN` in `src/app/api/analytics/track/route.ts` rejects.
`deviceScaleFactor: 3`, `isMobile`, `hasTouch` for widths < 768.

Widths: **320, 360, 390, 414, 768, 1280**. Pages: 20 routes (homepage, article list + 3 real
articles, product list + 3 real products, 3 category hubs, a family hub, manufacturer index +
detail, search empty + `?q=camera`, and the three trust pages). All returned **HTTP 200**, no
console errors at any width.

Requests to `/api/analytics/track` were aborted in every context so the audit did not write
synthetic pageviews into production analytics.

Raw data: `results.json` (6.3 MB, 120 page×width measurements) in the session scratchpad.

---

## Headline result

**The site does not have a mobile layout problem.** The things a mobile-first redesign usually
starts by fixing are already correct here, and the numbers say so unambiguously:

| Check | Result |
|---|---|
| Horizontal overflow | **0 px on all 20 pages × all 6 widths** (120/120) |
| Cumulative Layout Shift | **0.0000 on all 20 pages × all 6 widths** |
| Hover-only affordances | **0** CSS rules where `:hover` controls `display`/`visibility`/`opacity`/`transform` |
| Viewport meta | `width=device-width, initial-scale=1` present |
| Image `srcset` | **293/293** images carry a `srcset`; 0 over-fetched, 0 under-resolved |
| Image `decoding` | **293/293** `decoding="async"`; 284 `loading="lazy"`, 9 eager (the LCP heroes) |
| Alt text | **293/293** have an `alt` attribute; 0 empty on content images |
| Console errors | 0 |

The findings below are therefore about **density, legibility and page weight**, not about breakage.

### What was checked and found clean (do not "fix" these)

- **No `<table>` elements exist anywhere on the public site.** The body parser
  (`src/lib/content/body-format.ts`) supports exactly three blocks — `## `/`### ` headings, `- `
  lists, blank-line paragraphs. There is no table syntax, so there is no table to overflow. See
  finding **S4** for the consequence.
- **Image pipeline is correct.** `/_next/image` returns AVIF at the requested width
  (verified: `w=1080` → a real 1080×608 AVIF, `x-vercel-cache: HIT`, `max-age=2592000`). An earlier
  reading suggesting 3× under-resolution was a measurement artifact — `img.naturalWidth` is
  density-adjusted when a `w`-descriptor `srcset` is used, so it reports the CSS width by design.
- **Layout stability.** Every image sits in a fixed-ratio CSS box (`aspect-[16/9]`, `aspect-[4/3]`,
  or `frameAspectRatio()` from the asset's own dimensions), which is why CLS is a true zero rather
  than a small number.

---

## Findings by severity

### BLOCKING

None. No horizontal scroll, no unreadable page, no broken navigation at any tested width.

---

### SERIOUS

#### S1 — The consent banner covers 56% of a 320 px screen on first visit

At **320 × 568** the banner is `position: fixed`, `z-index: 50`, occupying **y = 251 → 568**:
**317 px of a 568 px viewport = 56%**.

What a first-time visitor on a small phone can actually see: 568 px viewport − 65 px sticky header
− 317 px banner = **186 px of content**. On `/articles` the first article card starts at
**y = 505 px**, so a first-time 320 px visitor sees **zero cards** until the banner is dismissed.

All three banner actions are also under the 44 px tap minimum:

| Control | Size |
|---|---|
| Reject non-essential | 169 × **38** px |
| Manage preferences | 168 × **38** px |
| Accept all | 98 × **36** px |
| "Cookie Policy" (inline link) | 86 × **18** px |

Files: `src/components/consent/consent-banner.tsx`.

#### S2 — Category, family and manufacturer hubs do not paginate

`/articles` and `/products` paginate at 24 cards. The hub pages do not, and they are the longest
pages on the site by a wide margin. Measured at 390 × 800:

| Route | Cards | Page height | Screens of scroll | Images | Full-page transfer |
|---|---|---|---|---|---|
| `/cameras-photography` | 36 | **15,930 px** | **19.9** | 37 | **1,060 KB** (763 KB images) |
| `/manufacturers/canon` | 33 | **15,138 px** | **18.9** | 35 | **1,089 KB** (740 KB images) |
| `/computing` | 20 | 8,671 px | 10.8 | 21 | 597 KB |
| `/gaming` | 21 | 8,210 px | 10.3 | 21 | 556 KB |
| `/families/canon-eos-5d` | 5 | 3,899 px | 4.9 | 7 | 478 KB |
| `/articles` (paginated) | 24 | 10,912 px | 13.6 | 26 | 757 KB |
| `/products` (paginated) | 24 | 11,476 px | 14.3 | 26 | 1,042 KB |

These grow without bound as the catalogue expands. `/cameras-photography` is already a 20-screen
page carrying three quarters of a megabyte of images.

Files: `src/app/(public)/[category]/page.tsx`, `src/app/(public)/manufacturers/[slug]/page.tsx`,
`src/app/(public)/families/[slug]/page.tsx`. The pagination component already exists at
`src/components/public/pagination.tsx`.

#### S3 — Product spec rows collide at 320 px

`src/app/(public)/products/[slug]/page.tsx:177` renders each spec as
`<div className="flex justify-between border-b border-zinc-100 pb-2 text-sm">` with a `<dt>` and a
`<dd>`. At 320 px the row content box is **230 px**, and `justify-between` provides **no gap** —
so once both sides wrap, the label runs straight into the value with zero separation.

Measured on `/products/canon-eos-r5` at 320 px — **6 of the first 14 rows have `gap = 0 px`**:

| Label | Value | dt / dd width | Gap | Row height |
|---|---|---|---|---|
| Shutter speed range | 30 s to 1/8000 s | 125 / 106 px | **0 px** | 49 px (2 lines) |
| Image stabilisation | 5-axis in-body, up to 8 stops | 90 / 140 px | **0 px** | 49 px |
| Storage/card slots | 1× CFexpress + 1× SDXC (UHS-II) | 85 / 145 px | **0 px** | 49 px |
| Launch MSRP (USD, body only) | $3,899 (body only) | 143 / 87 px | **0 px** | 49 px |
| Autofocus system | Dual Pixel CMOS AF II, 5,940 s… | 65 / 165 px | **0 px** | **69 px (3 lines)** |
| Video resolutions/frame rates | 8K RAW at 29.97fps; 4K at up t… | 114 / 116 px | **0 px** | **69 px** |
| Electronic viewfinder | 5.76m-dot OLED EVF, 0.76× magn… | 67 / 163 px | **0 px** | **69 px** |

Two wrapped columns butted edge-to-edge is the hardest possible reading of a spec sheet. The same
`flex justify-between` pattern is used in the sidebar "Details" panel (line 273 onward).

#### S4 — Comparison data is delivered as raster images, so it cannot reflow

There is no table syntax in the body parser, so every comparison the site publishes is either prose
or a **1600 × 900 PNG editorial graphic**. Confirmed in the alt text of the served assets:

- `"Original Tech Carvalho comparison graphic: Minimum spec versus Recommended…"`
- `"Original Tech Carvalho bar chart: Published install size, current PC r…"`
- `"Original Tech Carvalho timeline diagram: Wi-Fi generations: the certif…"`

At 390 px these render into a **342 × 192 px** slot. A two-column comparison chart designed for
1600 px reduced to 342 px is not readable — and being an image, it cannot reflow, cannot be
selected, cannot be searched, and cannot be zoomed independently of the page.

The code is already aware of half of this: `MediaFrame`'s `fit="contain"` and the 16:9
`ContentCard` frame exist specifically so charts are not centre-cropped
(`src/components/public/cards.tsx:93-179`). But not cropping a 342 px chart still leaves a 342 px
chart. A mobile-first phase needs a real table/comparison block in the body model — which
`body-format.ts:9-11` already flags as the trigger to revisit the body model itself.

#### S5 — Trust pages set body copy at 14 px

`src/components/public/legal-page.tsx:37` renders the entire body of `/about`, `/privacy`,
`/editorial-policy`, `/cookies`, `/terms` and `/affiliate-disclosure` as:

```
<div className="prose text-sm text-zinc-700 flex flex-col gap-4">
```

`text-sm` = **14 px with a 20 px line-height (1.43)**. Article bodies use 16 px / 26 px (1.63). So
the pages whose entire job is to be believed are set in the smallest, tightest body type on the
site. Measured: `about@390` = 14 px / lh 20 px, ~42 chars per line.

---

### MINOR

#### M1 — Tap targets under 44 px

Between **45 and 57 controls per page** measure under 44 px in at least one dimension at 390 px
(45–57 of 59–138 total). The footer accounts for roughly half; excluding it, **22–34 per page**.

Worst offenders by frequency across the 20 pages:

| Control | Size at 390 px | Occurrences |
|---|---|---|
| Footer nav links (`text-sm`, `gap-1.5`) | ~76 × **18** px, **6 px** apart vertically | 322 |
| Hamburger `<summary>` | **38 × 38** px | every page |
| Header search `<input>` | **38** px tall | every page |
| Mobile menu links | 272–366 × **36** px | 12 per page |
| Pagination Previous / Next | 89 × **38**, 64 × **38** px | list pages |
| `/products` filter selects | 107 × **34**, 201 × **34** px | products list |

The footer is the clearest problem: `gap-1.5` (6 px) between 18 px-tall links gives a **24 px
pitch** for adjacent targets in a 7-item legal list.

Files: `src/components/public/site-footer.tsx:53,65,77` (`gap-1.5`),
`src/components/public/site-header.tsx:92,107` (`p-2`, `py-2`),
`src/components/public/pagination.tsx`, `src/components/public/filter-select.tsx`.

#### M2 — 11 px uppercase micro-labels

Smallest text rendered on the public site is **11 px**, uppercase, with letter-spacing — the
category/manufacturer eyebrow labels:

- `src/components/public/cards.tsx:247` (`ContentCard` category label)
- `src/components/public/cards.tsx:309` (`ProductCard` manufacturer)
- `src/components/public/home-sections.tsx:46,50,178`
- `src/components/public/trending.tsx:111,113,161`
- `src/app/(public)/articles/[slug]/page.tsx:439` (Explore hub kind)

Homepage carries 75 characters at 11 px and 1,261 characters at 12 px, against 5,594 at 14 px.

There is also a **10 px** white-on-photograph credit overlay
(`src/components/public/cards.tsx:163`, `text-[10px] text-white/85` over a `from-black/55`
gradient). It did not appear on the pages sampled, but it is the smallest type the codebase can
produce and it is set in low-contrast white over arbitrary image content.

#### M3 — Article measure is too wide at 768 px and above

| Context | 320 px | 390 px | 768 px | 1280 px |
|---|---|---|---|---|
| Article body (`max-w-3xl`, 16 px/26 px) | 33 cpl | 42 cpl | **78 cpl** | **78 cpl** |
| Trust pages (`max-w-2xl`, 14 px/20 px) | 34 cpl | 42 cpl | **78 cpl** | **78 cpl** |
| Product summary (18 px/28 px) | 26 cpl | 33 cpl | 70 cpl | 70 cpl |
| Homepage lead (16 px/26 px, `max-w-xl`) | 30 cpl | 37 cpl | 63 cpl | 63 cpl |

Mobile widths are comfortable. The tablet/desktop measure of **78 characters per line** sits above
the 45–75 range, and the homepage's own lead paragraph (`max-w-xl`, 63 cpl) shows the codebase
already knows the right number — the article column just does not apply it.

#### M4 — An unused font downloads on every page

Three woff2 files, **74,716 bytes**, load on every public page:

```
797e433ab948586e-s.p.…woff2   23,108 B
caa3a2e1cccd8315-s.p.…woff2   29,288 B
0c89a48fa5027cee-s.p.…woff2   22,320 B
```

But only **two** families are ever applied to an element (measured on `/products`: `Geist` on 158
elements, `Space Grotesk` on 26). `Geist_Mono` is declared in `src/app/layout.tsx:12` — the **root**
layout, shared with admin — and `font-mono` is used *only* in `src/app/admin/**`. Every public
visitor downloads a monospace font that never renders. ~22–29 KB per page, on the critical path.

#### M5 — JS payload, and the product-page outlier

Measured above-the-fold (no scroll) at 390 px:

| Page | Total | JS (wire) | JS (decoded — parse cost) | Document (wire / decoded) |
|---|---|---|---|---|
| `/` | 494 KB | 157 KB | **494 KB** | 31 KB / **445 KB** |
| `/articles/canon-eos-r5-vs-r6` | 335 KB | 157 KB | **495 KB** | 18 KB / 168 KB |
| `/products/canon-eos-r5` | 417 KB | **224 KB** | **743 KB** | 14 KB / 132 KB |
| `/about` | 290 KB | 156 KB | — | 9 KB / — |

Two things stand out:

1. **Product pages ship 67 KB more JS over the wire (+43%) and 248 KB more to parse (+50%)** than
   every other route — one extra chunk, `18mgq3qporz5j.js` (247.7 KB decoded). Every other page
   shares an identical ~157 KB / ~494 KB baseline.
2. **The homepage HTML/RSC document is 445 KB decoded** (31 KB gzipped — a 14× ratio). That is
   parsed on the main thread on every cold homepage visit.

Largest single resources site-wide: `3un74ugz4xnkh.js` (223.1 KB decoded), `1q6lpoty9egui.js`
(131.5 KB), the stylesheet `2knhy6t63752u.css` (66.6 KB decoded), and a 138.9 KB AVIF hero on
`/articles/astrophotography-for-beginners`.

Full-page (after scrolling everything into view) image weight is the other half: 763 KB on
`/cameras-photography`, 749 KB on `/products`, 740 KB on `/manufacturers/canon`, 571 KB on `/`.
All correctly lazy — but see **S2**: without pagination a visitor who scrolls the hub *will* fetch
all of it.

#### M6 — No `fetchpriority="high"` on the LCP hero

**0 of 293** images carry a `fetchpriority` attribute. The LCP heroes are handled correctly
otherwise (9 images are eager rather than lazy, and `preload` emits a `<link rel=preload>` — the
deliberate choice documented at `src/components/public/site-header.tsx:50-69`), but the hero `<img>`
itself still competes at default priority.

---

## Navigation at 320 px — verified working

The header is `sticky top-0`, **65 px** tall at all mobile widths (106 px at 1280 px where the
subject rail appears), and does **not** overflow at 320 px.

The hamburger is a **no-JS `<details>`/`<summary>`** disclosure (`site-header.tsx:91`). Opened at
each width, measured:

| Viewport | Panel | Search input | Menu links | Doc overflow while open |
|---|---|---|---|---|
| 320 | 320 px wide × 580 px, `overflow-y: auto` | 272 × 38 px | 12 links, 272 × 36 px | **0 px** |
| 360 | 360 px | 312 × 38 px | 12 × 312 × 36 px | **0 px** |
| 390 | 390 px | 342 × 38 px | 12 × 342 × 36 px | **0 px** |
| 414 | 414 px | 366 × 38 px | 12 × 366 × 36 px | **0 px** |
| 768 | 768 px | 720 × 38 px | 12 × 720 × 36 px | **0 px** |
| 1280 | hamburger hidden; 13 links inline | 384 × 38 px | — | **0 px** |

All 10 subject areas plus "All articles" and "All products" are reachable, none clipped, none
off-screen. The panel's containing block resolves to the sticky `<header>` (the `<details>` is
`position: static`), which is why `inset-x-0` correctly spans the full viewport.

The desktop subject rail is a single `overflow-x-auto` strip that scrolls internally at 1280 px
(scrollWidth 1193 vs clientWidth 1104) rather than widening the document — working as the comment at
`site-header.tsx:12-15` describes.

Two caveats, both minor: the `<summary>` carries no `aria-expanded`/`aria-controls`, and the
hamburger is shown all the way to 1023 px (`lg:hidden`), so a 768 px tablet gets a full-width
720 px-wide search field inside the dropdown.

---

## Article header structure — current vs. wanted

Measured on `/articles/canon-eos-r5-vs-r6` at 390 px (DOM order, `y` = px from document top):

| y | height | Element |
|---|---|---|
| 113 | 92 | Breadcrumbs (`nav.text-sm`) — wraps to 3 lines |
| 229 | 20 | Type badge + `Published August 21, 2026` |
| **265** | **108** | `<h1>` — `text-3xl` (30 px), 3 lines at this width |
| 389 | 104 | "Part of our guide to…" cluster-pillar nav *(conditional)* |
| **525** | **264** | **Hero figure** — *below* the headline |
| 821 | 88 | "Products covered" chip row |
| **941** | 2608 | **Body starts** |

On `/articles/astrophotography-for-beginners` (no pillar nav, no products row) the body starts at
**y = 735**.

Against the phase's target header:

| Wanted | Exists today? | Detail |
|---|---|---|
| **Hero media** | ✅ but **below the headline** | `ArticleLeadMedia` at y = 525, after `<h1>` at y = 265. Caption + licence credit render correctly. |
| **Headline** | ✅ | `text-3xl sm:text-4xl` — 30 px at 390 px, 108 px tall (3 lines) |
| **Confidence / status** | ❌ **does not exist** | No confidence, certainty or status indicator on article pages. (Products have a `status` badge — `products/[slug]/page.tsx:154` — articles have nothing equivalent.) |
| **Updated date** | ⚠️ **partial** | Shows **`Published <date>`**, not updated. A separate `Last verified <date>` line renders at `text-xs` (12 px) `text-zinc-400` **only when a `freshness` row exists** — absent on both articles sampled. `content.updated_at` is in the JSON-LD and in `generateMetadata` but is never rendered to the reader. |
| **Estimated reading time** | ❌ **does not exist in the UI** | `estimateReadingTime()` in `src/lib/content/reading-time.ts` is **fully implemented and unit-tested** (`reading-time.test.ts`, 6 tests) but is **imported by no component or page** — verified by grep across `src/`. The feature is built and unwired. |
| **Short summary / deck** | ❌ **does not exist** | No deck between headline and body. `excerptFromBody()` produces one for `<meta name="description">` and for list-view cards only. `cards.tsx:181-187` documents the deliberate decision not to add a dedicated excerpt column. |

So of the six wanted elements: **2 present** (hero, headline), **1 present but wrong** (published
rather than updated, plus a conditional 12 px "last verified"), **1 present in the wrong position**
(hero below headline), and **3 absent** (confidence/status, reading time, deck) — one of which is
already written and tested in `src/lib/content/reading-time.ts` and only needs wiring.

The practical mobile consequence: at 390 × 800 the first sentence of the body sits at **y = 941 px**
— **161 px below the fold**. A reader on a phone scrolls past a full screen of breadcrumbs, badge,
date, headline and chrome before reading a word. A deck and a `updated • N min read` line would add
height, so this phase should also reconsider the breadcrumb block (92 px, 3 lines) and the
"Products covered" chip row (88 px) that currently sit between the headline and the prose.

---

## Suggested order of work

1. **S1** — consent banner height and 44 px actions (worst first-visit experience on a small phone).
2. **Article header rebuild** — hero above headline, wire up the already-tested reading time, add a
   deck, switch `Published` to `Updated`. Highest value for the phase's stated goal.
3. **S3** — spec rows: give the `dt`/`dd` row a gap, or stack it below ~400 px.
4. **S2** — paginate the category / family / manufacturer hubs.
5. **S5** + **M3** — trust-page body to 16 px; cap the article measure near 65–70 cpl.
6. **M1 / M2** — footer link pitch and the 11 px eyebrow labels.
7. **M4 / M5 / M6** — drop `Geist_Mono` from the public font set, look at the product-page chunk,
   add `fetchpriority="high"` to the hero.
