# SEO architecture

Audit and implementation pass, 2026-08-22. Scope: the public site under `src/app/(public)/`,
`src/app/sitemap.ts`, `src/app/robots.ts`, and the shared SEO layer in `src/lib/seo/`.

This is a structural and semantic audit, not a keyword exercise. Nothing here adds a keyword to a
page. The work is: make every page state truthfully what it is, make exactly one URL authoritative
for each thing, and make sure the only claims handed to a search engine in machine-readable form
are claims the database can back.

The site's own honesty rule governs the structured-data work throughout: **a field that would have
to be invented is omitted, and a type whose required fields would have to be invented is not
emitted at all.** That is why a `review` content item is marked up as an `Article` and never as a
`schema.org/Review` (Review requires `reviewRating`, and this site publishes no scores), and why
`Product` carries no `offers` (see §2.3).

Measurements below were taken against the real production database via the `anon` role, and against
a real `next build` + `next start`, not inferred from the source.

---

## 1. What was broken, and what it now does

### 1.1 Every page on the site had a duplicated title suffix

The highest-impact defect found, and it affected 100% of pages.

`src/app/layout.tsx` declares a title template:

```ts
title: { default: `${SITE_NAME} — ${SITE_TAGLINE}`, template: `%s | ${SITE_NAME}` },
```

`buildMetadata()` in `src/lib/seo/metadata.ts` separately appended the same suffix itself
(`const fullTitle = \`${title} | ${SITE_NAME}\``) and returned it as a **plain string**. Next
applies a parent segment's template to any child segment returning a string title —
`node_modules/next/dist/docs/01-app/03-api-reference/04-functions/generate-metadata.md`:

> `title` (string) defines the routes title. It will augment `title.template` from the closest
> parent segment if it exists.

So the suffix was applied twice. Confirmed empirically by reverting the fix, rebuilding, and
curling the running production server:

```
$ curl -s localhost:3112/terms         | grep -o '<title>.*</title>'
<title>Terms of Use | Tech Carvalho | Tech Carvalho</title>
$ curl -s localhost:3112/products      | grep -o '<title>.*</title>'
<title>Products | Tech Carvalho | Tech Carvalho</title>
$ curl -s localhost:3112/manufacturers | grep -o '<title>.*</title>'
<title>Manufacturers | Tech Carvalho | Tech Carvalho</title>
```

Every title also burned ~16 characters of SERP width on a repeated brand name.

**Fixed** by returning `title: { absolute: fullTitle }`, which the same doc documents as opting out
of the parent template. `buildNotFoundMetadata()` had the identical defect and got the identical
fix. Regression-tested in `src/lib/seo/metadata.test.ts`
("title is \`absolute\` so the root layout's template can't append a second site-name suffix").

Current output:

```
$ curl -s localhost:3111/products/canon-eos-r5 | grep -o '<title>.*</title>'
<title>Canon EOS R5: 45MP Full-Frame with 8K Video | Tech Carvalho</title>
```

### 1.2 `seo_metadata` was a write-only table

`seo_metadata` carries `meta_title`, `meta_description`, `canonical_url` and `noindex`, scoped by
`product_id` / `content_id` / `category_id`. Both admin detail forms write all four
(`src/app/admin/(dashboard)/products/actions.ts:222-232`,
`src/app/admin/(dashboard)/content/actions.ts:222-232`) and both render them as editable fields.

On the public side:

| Column | Products | Content | Categories |
|---|---|---|---|
| `meta_title` | **never read** | read | **never read** |
| `meta_description` | **never read** | read | **never read** |
| `canonical_url` | **never read** | selected but unused | **never read** |
| `noindex` | **never read** | **never selected** | **never read** |

`src/lib/public/product-detail.ts` did not query the table at all. `article-detail.ts` selected
`canonical_url` and then never referenced it, and never selected `noindex`. Grepping the whole
tree for `noindex` before this pass returned no public consumer of the column anywhere.

Concretely, against production: **4 `seo_metadata` rows are scoped to a product, and all 4 have
both a `meta_title` and a `meta_description` written by an editor.** All four were being
discarded — the pages fell back to the raw `products.name` and `products.summary`. The Canon EOS
R5 title quoted in §1.1 (`Canon EOS R5: 45MP Full-Frame with 8K Video`) is one of those four,
rendering for the first time.

The `noindex` and `canonical_url` halves are more serious as a *control* than as a live incident:
production currently has `noindex=true` on 0 rows and `canonical_url` set on 0 rows, so nothing was
mis-indexed. But an editor ticking the "noindex" checkbox got a page that still rendered
`<meta name="robots" content="index, follow">` and stayed in `sitemap.xml`. The control existed,
looked functional, and did nothing.

**Fixed.** All four columns are now read for products, content and categories, and honoured in
`generateMetadata()` and in the sitemap.

`canonical_url` is free text from an admin form, so it goes through `normalizeCanonical()`
(`src/lib/seo/metadata.ts`), which accepts only a root-relative path or a same-origin absolute URL.
A canonical pointing at a domain we do not control would tell Google to drop our page in favour of
someone else's; a typo should not be able to do that. Off-origin and unparseable values are ignored
and the page falls back to its self-referencing canonical.

### 1.3 A pre-existing bug that broke `next build` outright

`scripts/audit-media-backlog.ts` queried `admin_users.user_id`:

```ts
.from("admin_users").select("user_id").eq("user_id", userData.user.id)
```

There is no such column. `supabase/migrations/20260819202304_initial_schema.sql:26-30` defines
`admin_users.id uuid primary key references auth.users (id)` — the primary key **is** the auth user
id. This failed the build's type-check:

```
scripts/audit-media-backlog.ts(41,9): error TS2345: Argument of type '"user_id"' is not
assignable to parameter of type '"id" | "display_name" | "created_at"'.
Failed to type check.
```

Beyond blocking the build, had the script ever run it would have errored at PostgREST and reported
`admin_users self-check: NOT VISIBLE — RLS may be denying` for a genuine admin — precisely the
"failure that looks like empty" confusion the script's own header comment says it exists to
prevent. Fixed to `.select("id").eq("id", …)`.

### 1.4 Hero images silently dropped their source link

`getPublishedHeroImage()` in `src/lib/public/hero-image.ts` selected `source_url`, and `HeroImage`
declared `sourceUrl`, but the returned object never copied it across. Any hero image whose licence
requires a link back to its source rendered the credit as plain text with the link dropped.
`getPublishedGallery()` in the same file has always returned it correctly; only the hero path lost
it. Fixed.

---

## 2. Structured data

### 2.1 What is emitted now, and what backs each field

| Type | Where | Fields | Backed by |
|---|---|---|---|
| `Organization` | public layout | `name`, `url`, `description`, `logo` (+`width`/`height`) | `SITE_NAME`/`SITE_TAGLINE`; logo dimensions read from `public/brand/logo-full-trimmed.png` (1400×367, verified) |
| `WebSite` | public layout | `name`, `url`, `description`, `publisher`, `potentialAction` | `SearchAction` targets `/search?q={search_term_string}` — a route that genuinely exists and works (`src/app/(public)/search/page.tsx`) |
| `BreadcrumbList` | `<Breadcrumbs>` | positioned `ListItem`s | the visible trail on the same page |
| `Product` | `/products/[slug]` | `name`, `description`, `brand`, `image`, `mpn`, `releaseDate`, `category`, `url` | `products.name/summary/model_number/release_date`, `manufacturers.name`, `taxonomy_categories.name`, published hero `media_assets` |
| `Article` / `NewsArticle` | `/articles/[slug]` | `headline`, `description`, `image`, `datePublished`, `dateModified`, `author`, `publisher`, `isPartOf`, `mainEntityOfPage`, `articleSection`, `about`, `url` | `content_items.*`, `seo_metadata.meta_description`, published hero asset, `taxonomy_categories.name`, `content_products` |
| `ItemList` | `/articles`, `/articles?type=*`, `/products`, `/manufacturers`, `/manufacturers/[slug]`, `/[category]` | `numberOfItems`, positioned `ListItem`s | the rows the page actually rendered, in render order |

`Organization` and `WebSite` carry stable `@id`s (`/#organization`, `/#website`) so `Article`
references one Organization by `@id` as both `author` and `publisher` rather than restating it.

### 2.2 What is deliberately NOT emitted

- **`aggregateRating`, `ratingValue`, `reviewCount`, `review`** — anywhere. The site publishes no
  scores. A `review` content item is an `Article`, not a `schema.org/Review`, because `Review`
  requires `reviewRating` and there is no honest value to put there.
- **`sku`** — a SKU is a *seller's* stock identifier and this site sells nothing. `products.
  model_number` is emitted as `mpn` (manufacturer part number), which is what it actually is.
- **`sameAs`** on Organization — no verified social profiles exist to link.
- **`wordCount`, `articleBody`** — never counted; the page already carries the body.
- **`author` as a Person** — see §2.4.

### 2.3 Why `Product` has no `offers`, and why that is the correct answer

`product_offers` (`src/lib/types/database.ts:427-452`) has `retailer`, `url`, `affiliate_status`
and `price_note` — and `price_note` is **free text**. There is no price column, no currency column
and no availability column anywhere in the table. A `schema.org/Offer` without `price` +
`priceCurrency` is ineligible for the merchant rich result it exists to earn, so emitting a hollow
Offer buys nothing and creates a standing invitation for someone to "fill in" the price later from
an unstructured note. The property is omitted entirely. Locked in by a test
(`productJsonLd never fabricates rating/price/availability fields`) that asserts `"offers" in
result === false` even for a fully-populated product.

`product_launch_pricing` does hold a structured `amount` + `currency`, but it is *historical launch
MSRP*, explicitly not a current offer (see the type's own comment in `product-detail.ts:21-29`).
Marking a 2020 launch price up as a live `Offer` would be a straightforwardly false claim about
availability and price. It stays out of the markup and remains visible on-page as what it is.

### 2.4 Authorship

`content_items.author_id` references `admin_users`, whose only RLS policy is
`"admins can read own row" … using (id = auth.uid())` (`20260819202305_rls_policies.sql:43-45`).
The `anon` role cannot read `admin_users.display_name` at all, so a per-piece human author name is
not available to the public site — and inventing one is exactly what this file forbids.

`author` is therefore the Organization, referenced by `@id`. This is truthful (the site publishes
under its masthead; `/editorial-policy` describes an organisational process, not named bylines) and
is a valid `author` value. If named bylines are ever wanted as an E-E-A-T signal, that is a schema
+ RLS change, not a markup change — see §6.

---

## 3. Canonicals and duplicate control

### 3.1 Self-referencing canonicals with a parameter allow-list

`/articles` and `/products` used a static `export const metadata`, which cannot see `searchParams`.
Consequence: `/articles?type=guide`, `/articles?page=3` and `/articles?utm_source=newsletter` all
rendered **the same** `<title>Articles | …>`, the same `<meta description>`, and the same canonical
`…/articles`. Filter and pagination state was invisible to the canonical, and any tracked inbound
link was a crawlable variant.

Both now use `generateMetadata({ searchParams })` with `canonicalPathWithParams()`
(`src/lib/seo/metadata.ts`), which rebuilds the query string from an allow-list in a fixed order:

- unknown params (`utm_*`, `fbclid`, a mistyped `type=`) are **dropped**;
- param order is **normalised**, so `?page=3&manufacturer=canon` and `?manufacturer=canon&page=3`
  produce one canonical;
- `page=1` **collapses** to the bare path;
- an unrecognised `?type=` resolves to the unfiltered hub and canonicalises to `/articles`, rather
  than becoming its own self-canonicalising URL.

Paginated pages are self-canonical (not cross-canonicalised to page 1) and carry a distinct title
(`Buying guides — page 2`), which is current Google guidance and keeps deep items discoverable.

### 3.2 Cannibalisation fixed: facets that duplicated dedicated routes

`/products?manufacturer=canon` lists exactly the published Canon products that
`/manufacturers/canon` lists. `/products?category=computing` lists exactly what `/computing` lists.
Two dedicated, richer routes already own those intents — the brand page adds a description,
website link and product families; the category page adds trending, subcategories, guides and
manufacturers. All three were indexable, and the thinnest of the three was fully eligible to win.

Filtered `/products` views are now `noindex` with **`follow: true`** — they remain a real browsing
affordance and their product links are worth crawling; `nofollow` would strand them. The canonical
stays self-referencing rather than cross-pointing at the dedicated hub, because a filtered subset
is not a true duplicate of that hub's page, and a cross-canonical Google rejects would leave the
page with no canonical signal at all. The filtered view now also renders a visible link through to
the hub that owns the intent, so it is not a dead end for either crawlers or readers.

This required a new `follow` parameter on `buildMetadata()` — previously `noindex` always implied
`nofollow`, which is the wrong pairing for a facet.

### 3.3 Content-type hubs promoted to real pages

`/articles?type=review|guide|comparison|news|troubleshooting` were five URLs sharing one title, one
description and one `<h1>Articles</h1>`. They are genuinely distinct search intents, so each now
has its own title, meta description, `<h1>`, visible on-page description, breadcrumb level,
self-referencing canonical and `ItemList`. The definitions live in `src/lib/public/article-hubs.ts`
rather than beside the route, because `sitemap.ts` needs the same list and two copies would drift.

---

## 4. Sitemap quality

**104 URLs** (`curl -s /sitemap.xml | grep -c '<loc>'`), down from 112, with the composition
materially changed:

| | Before | After | Note |
|---|---|---|---|
| Static pages | 9 | 11 | `/about` + `/contact` added — footer-linked on every page, and the two pages an E-E-A-T assessment looks for, previously the only footer destinations missing |
| Content-type hubs | 0 | 4 | only types that actually have published pieces (`review` has none, so it is absent) |
| Categories | 10 | 10 | now gated on having published content; all 10 currently qualify |
| Manufacturers | 15 | **1** | see below |
| Products | 6 | 6 | |
| Articles | 72 | 72 | |
| **Total** | **112** | **104** | |

**The manufacturer drop is the substantive change.** `manufacturers` is world-readable reference
data with no publish gating, so a row — and a live route — exists the moment an admin adds a brand.
Production has 15 manufacturers and **only 1 (Canon) has any published product**. The other 14
rendered `"No published products yet"` empty states, were indexable, and were all submitted to
Google. That is 14 near-identical thin pages per crawl. They are now `noindex, follow` on the page
*and* excluded from the sitemap, and they flip back to indexable automatically the moment a product
of theirs is published.

Other rules now enforced, each of which was previously unenforced:

- **`noindex` rows are excluded.** A URL that renders `<meta robots="noindex">` while sitting in
  `sitemap.xml` is a direct contradiction and the fastest way to teach Google to distrust the file.
- **Cross-canonicalised rows are excluded.** A row whose `seo_metadata.canonical_url` points
  elsewhere is by definition not the canonical version of itself.
- **Empty category hubs are excluded.** `PLANNED_CATEGORIES` renders all ten subject areas whether
  or not anything is published under them; the empty ones show "Coming soon". All ten currently
  have content so the count is unchanged, but the gate now exists and matches the page's own
  `noindex`.
- **`lastmod` comes from real timestamps only.** Present on 93 of 104 entries. The 11 without it
  are the hand-written static pages, which have no row and therefore no honest timestamp — omitted
  rather than stamped with `now()`, which would tell crawlers the whole site changed on every
  crawl. Category and manufacturer hubs derive `lastmod` from the newest `updated_at` among the
  rows they actually list.

`/search` remains excluded, consistent with its page-level `noindex`.

**`robots.ts`** additionally disallows `/api/` and `/auth/` (analytics ingest, growth-engine cron
endpoints, auth confirmation — none render a page, and `/api/analytics/track` would have recorded
crawler traffic as pageviews). `/search` is deliberately **not** disallowed: it is already
`noindex`, and a crawler must be allowed to fetch a page to see its `noindex` — blocking it would
leave any linked `/search` URL eligible for URL-only indexing, the exact outcome the `noindex`
exists to prevent.

---

## 5. Per-page metadata, Open Graph, breadcrumbs

- **Homepage** had no `metadata` export at all and inherited the root layout's site-wide fallback
  strings. It now declares its own title, description and self-referencing canonical.
- **Products** — title is manufacturer-qualified by default (`Canon EOS R5`, not `EOS R5`);
  catalogue names are stored unqualified and are not distinguishable in a SERP without the brand.
  An editor `meta_title` always wins.
- **Articles** — a piece with no editor-written `meta_description` previously inherited
  `SITE_TAGLINE`, meaning every such article shared one identical description with every other page
  on the site. `excerptFromBody()` (`src/lib/content/body-format.ts`) now derives one from the
  piece's own opening paragraph, trimmed at a word boundary. It is not generated text and not a
  summary — it is the article's own prose — and it returns `null` rather than a broken fragment
  when there is no usable paragraph.
- **Articles** also now emit `og:type=article` with real `publishedTime` / `modifiedTime` /
  `section`.
- **Manufacturers** — title is `"<Brand> products and coverage"` rather than a bare brand name,
  which is a query this site has no business competing for.
- **Categories** — description is enriched when the hub has real content; OG image is the real
  category banner asset when one exists.
- **OG/Twitter images** — unchanged mechanism, and it is correct: a page passes its real hero image
  and gets `summary_large_image`; a page without one omits the field and the root
  `opengraph-image.tsx` file convention supplies the site-wide card. Manufacturer pages
  deliberately do not pass the brand logo — a wide transparent logo in a `summary_large_image` card
  renders as a letterboxed smear.

**Breadcrumbs** (visible `<nav>` + `BreadcrumbList`, same component, so they cannot disagree):

- Product pages with no category previously emitted a two-item trail jumping straight from the
  homepage to a leaf, telling crawlers the product sits directly under the root. They now fall back
  to `/products` as the intermediate level.
- Article trails ran `Home > Articles > Reviews > piece` and never touched the subject-area hub the
  piece belongs to, passing no breadcrumb signal to it. The category level is now inserted when the
  piece has one — which required `article-detail.ts` to start selecting `category_id` at all.

---

## 6. Found and NOT fixed — ranked by leverage

### 6.1 Product families have no public route at all — highest leverage

`product_families` has 7 rows, full admin CRUD, and **all 6 published products belong to one**.
There is no `/families/[slug]` route, no family hub, and no link: `products/[slug]/page.tsx` renders
`{family.name}` as **plain text** in the details sidebar.

A family is the natural comparison cluster — "Canon EOS 5D series", "Canon EOS R full-frame" — and
maps onto a real, high-intent query shape ("which Canon 5D should I buy", "5D Mark II vs III vs
IV"). Today that entire query class has no landing page, and the four published 5D-series bodies
are connected only by three `successor_of` rows rendered as one-line sidebar links.

Implementing it is cheap because `manufacturer-detail.ts` + `manufacturers/[slug]/page.tsx` are a
direct template: a `family-detail.ts`, a route, a link from the product sidebar, a breadcrumb level,
an `ItemList`, and a sitemap block gated on having published products. It was left out of this pass
because it is a new public route rather than a correction to an existing one. It is the single
biggest structural gap on the site.

### 6.2 `intent_fingerprint` coverage is 42%, so the cannibalisation guard mostly cannot fire

The project already has a cannibalisation detector (`src/lib/admin/cannibalisation.ts`) with a
sensible priority order: exact `intent_fingerprint`, then exact `primary_query`, then title-token
overlap. Run over all 72 published items:

```
published content items: 72
with primary_query set:  72   (100%)
with intent_fingerprint: 30   (42%)
total flagged pairs:      2
```

Both flagged pairs are **false positives** from the title-overlap fallback — `canon-6d-vs-6d-mark-ii`
vs `ps5-vs-ps5-pro-worth-it` (shared tokens: "vs", "worth", "it") and
`do-you-need-rtx-5090-for-1440p-gaming` vs `psu-wattage-for-rtx-5090-build` (shared: "rtx", "5090",
"for"). The heuristic's 0.7 overlap ratio is measured against the *shorter* title's token count,
which makes short titles collide on stopwords.

The real problem is that the highest-confidence check covers 42% of the corpus, so it found nothing.
Two fixes, in order: backfill `intent_fingerprint` on the 42 items missing it, and exclude a small
stopword set (`vs`, `for`, `it`, `the`, `is`, `worth`, `do`, `you`, `need`) from `tokenize()`.

### 6.3 Genuine cannibalisation the detector missed

Read off the real `primary_query` values, grouped by category. These are pairs targeting one
intent, none of which the detector flags:

| Category | Competing pieces | Shared intent |
|---|---|---|
| Networking | `mesh-router-buying-guide-2026` (`best mesh wifi router 2026`) vs `mesh-wifi-vs-single-router` (`mesh wifi vs single router`) | "should I buy a mesh system" — the strongest overlap on the site |
| Computing | `do-you-need-rtx-5090-for-1440p-gaming` (`is rtx 5090 overkill for 1440p`) vs `rtx-5090-vs-rtx-5080-worth-the-upgrade` (`rtx 5090 vs rtx 5080`) | "is the 5090 worth it" |
| Smartphones | `which-flagship-phone-should-you-buy-2026` vs `iphone-17-pro-vs-galaxy-s26-ultra-vs-pixel-10-pro` | the comparison *is* the answer to the guide's query |
| Cameras | `canon-dslr-buying-guide` vs `best-used-canon-dslr-beginners` | "which Canon DSLR to buy" — the second is a subset of the first |
| Smart Home | `matter-smart-home-standard-explained` vs `thread-vs-zigbee-vs-wifi-smart-home` | "which smart-home standard" |

None of these need deleting. Each is a pillar/supporting pair, and `content_relationships` already
supports exactly that (`pillar_of` / `supporting_of` / `related_to`, surfaced by
`article-detail.ts`). Declaring the relationship explicitly, and having the supporting piece link up
to the pillar with descriptive anchor text, resolves the competition and consolidates the signal.

### 6.4 Mis-categorised content dilutes three hubs

Three pieces sit under **Computing** that clearly belong elsewhere, judged by their own
`primary_query`:

- `humanoid-home-robots-2026-reality-check` — `humanoid robot for home 2026` → **Smart Home & Robots**
  (which has only 4 items)
- `openai-consumer-hardware-device` — `openai hardware device 2026` → **AI & AI Hardware**
  (only 4 items)
- `ai-pendant-hardware-bust-2026` — → **AI & AI Hardware**

This is a data fix, not a code fix, but it has SEO consequences now that `articleSection` and the
category breadcrumb level are emitted from `content_items.category_id`: these three pieces are
currently telling Google they are Computing articles, and they are starving the two thinnest hubs.

### 6.5 Zero published `review` content

72 published pieces, and the type breakdown is guide / comparison / news / troubleshooting — **no
reviews at all**. `/articles?type=review` correctly renders an empty state and is correctly absent
from the sitemap. Worth naming because "reviews" is the highest-commercial-intent content type the
site models, the homepage masthead promises "Reviews, guides, and comparisons built on real
testing", and the `Review`-shaped structured data this site refuses to fake would only become
relevant once real reviews exist.

### 6.6 Smaller items

- **No category-scoped `seo_metadata` rows exist** (0 of 34). The plumbing now reads them; the
  category hubs are the pages most likely to benefit from a hand-written description.
- **`getCategoryPublishedCounts()` costs an extra round trip on empty categories.** It falls back
  to `getPublishedContentForCategory()` when direct counts are zero, so the page's `noindex`
  decision matches what the page actually renders. Only reached for otherwise-empty hubs, so it is
  free today, but it is a duplicate query worth folding into one call if category hubs ever get hot.
- **Only 3 `product_relationships` rows exist, all `successor_of`.** `alternative_to` is what
  powers comparison intent and is entirely unused.
- **`/products` pagination is `page`-only with no category/manufacturer facet indexed**, which is
  correct today at 6 products but will need revisiting when the catalogue is large enough that
  page 2+ carries meaningful content.

---

## 7. Verification

```
npm test          312 passed, 0 failed
npx tsc --noEmit  clean
npx eslint .      0 errors
npm run build     succeeded
```

New tests added: `src/lib/seo/metadata.test.ts` (title-template regression, `normalizeCanonical`
off-origin rejection, `canonicalPathWithParams` param normalisation, noindex/follow pairing,
canonical override, OG article times), `src/lib/seo/jsonld.test.ts` (SearchAction target, `mpn` not
`sku`, no Review/rating for `type='review'`, Organization authorship, `ItemList` counts, no
fabricated price/offer fields), `src/lib/content/body-format.test.ts` (`excerptFromBody` word-boundary
truncation and null-rather-than-fragment behaviour).
