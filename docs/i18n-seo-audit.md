# Multilingual phase — URL, SEO and data-model audit

Audit and feasibility assessment for adding Portuguese, Spanish and French alongside English.
**No production code was changed, nothing was committed or pushed, and nothing was written to the
database.** Every production figure below came from read-only `select` queries via
`scripts/_shared.ts createAdminClient()` (authenticated as the real admin, RLS path, no
service-role key), or from fetching the live site.

Audited **2026-08-22** against `next@16.3.1`, commit `bab344d` plus the uncommitted working tree,
and `https://www.techcarvalho.com` as it was serving that day.

---

## 0. The finding that reframes the whole question

The brief assumes "the existing English URLs are indexed and must not be casually destroyed."
That premise does not survive contact with the data.

| Evidence | Value | Source |
|---|---|---|
| Repository initial commit | **2026-08-19** (3 days ago) | `git log --reverse` |
| Earliest `content_items.published_at` in production | **2026-08-21T09:27:50Z** (1 day ago) | production query |
| Total analytics sessions ever recorded | **9** | `analytics_sessions` (9 rows) |
| Sessions with any referrer at all | **1** (`com.google.android.googlequicksearchbox`, landed on `/`) | `analytics_sessions.referrer_host` |
| Rolled-up sessions / pageviews, 2026-08-16 → 08-21 | **8 sessions, 14 pageviews** | `analytics_daily_rollups` (`dimension_type='site'`) |
| Google Search Console coverage | **NOT VERIFIED — no access** | — |

Two of those nine sessions have entry paths `/retest` and `/repro`, i.e. they are the developer's
own debugging traffic. There is no organic search traffic in the record at all.

**What this means.** The entire public corpus went live yesterday. Google has had roughly one day
to discover a brand-new domain with 160 sitemap URLs. Whatever is indexed today is a small,
freshly-discovered set carrying essentially no accumulated ranking signal, no external links, and
no measurable organic traffic. The cost of moving English from `/` to `/en/` is therefore at its
**all-time minimum right now**, and it grows monotonically from here.

**What I could not verify, and you should check before deciding.** I have no Search Console access
and the session's web-search budget was exhausted, so I could not run a `site:` query or read the
Coverage report. Before committing to either option, open Search Console → Pages and read the
actual "Indexed" count. If it is under ~50 and "Discovered – currently not indexed" is large, the
migration risk in §2 is close to zero in absolute terms. If it is unexpectedly high, re-weight
accordingly. Everything below is written so the decision holds either way, but the honest framing
is: *this is a launch-week decision, not a migration.*

---

## PART 1 — Current URL and SEO reality

### 1.1 Route inventory

Public routes, from `src/app/(public)/`:

| Route file | URL pattern |
|---|---|
| `page.tsx` | `/` |
| `[category]/page.tsx` | `/{category-slug}` — **root-level single segment** |
| `articles/page.tsx` | `/articles` (+ `?type=`, `?page=` facets) |
| `articles/[slug]/page.tsx` | `/articles/{slug}` |
| `products/page.tsx` | `/products` (+ facets) |
| `products/[slug]/page.tsx` | `/products/{slug}` |
| `manufacturers/page.tsx` | `/manufacturers` |
| `manufacturers/[slug]/page.tsx` | `/manufacturers/{slug}` |
| `families/[slug]/page.tsx` | `/families/{slug}` (no index route) |
| `search/page.tsx` | `/search` (noindex, deliberately crawlable) |
| `about`, `contact`, `editorial-policy`, `privacy`, `cookies`, `terms`, `affiliate-disclosure` | 7 static pages |

Non-public: `src/app/admin/**`, `src/app/api/**`, `src/app/auth/confirm`, plus the root metadata
file conventions `sitemap.ts`, `robots.ts`, `icon.tsx`, `apple-icon.tsx`, `opengraph-image.tsx`.

Host canonicalisation is already correct: `https://techcarvalho.com/` returns **308 →
`https://www.techcarvalho.com/`**, so `www` is the single canonical host.

### 1.2 Sitemap — what it actually contains

`https://www.techcarvalho.com/sitemap.xml` — HTTP 200, `application/xml`, 30,733 bytes,
**160 `<loc>` entries**, `xmlns` = sitemaps 0.9 only. **Zero `hreflang` or `xhtml:` occurrences.**

| Type | In sitemap | Rows in production | Gap |
|---|---:|---:|---|
| Articles (`/articles/{slug}`) | 81 | 81 published (81 total) | — |
| Products (`/products/{slug}`) | 36 | 36 published (44 total) | 8 unpublished → not live |
| Manufacturer hubs | 11 | 15 rows | 4 suppressed as thin by `isManufacturerHubIndexable` |
| Family hubs | 7 | 7 rows | — |
| Category hubs (root-level) | 10 | 10 rows | — |
| Content-type hubs (`/articles?type=…`) | 4 | guide, comparison, news, troubleshooting | — |
| Static + legal | 11 | `/`, `/products`, `/articles`, `/manufacturers`, `/about`, `/contact`, `/editorial-policy`, `/privacy`, `/cookies`, `/terms`, `/affiliate-disclosure` | — |
| **Total** | **160** | | |

Live public URLs not in the sitemap, by design: `/search` (noindex), the 4 thin manufacturer hubs
(live but noindex). So roughly **165 live public URLs, 160 submitted.**

The sitemap is unusually disciplined — `src/app/sitemap.ts` enforces four rules (published only,
not `seo_metadata.noindex`, self-canonical only, not a thin shell) and shares
`isManufacturerHubIndexable` / `isFamilyHubIndexable` with the pages themselves so page-level
`noindex` and sitemap inclusion cannot drift apart. That discipline is an asset for the
multilingual phase and must be preserved rather than bypassed.

### 1.3 robots.txt — what it actually contains

Fetched live, verbatim:

```
User-Agent: *
Allow: /
Disallow: /admin
Disallow: /api/
Disallow: /auth/

Sitemap: https://www.techcarvalho.com/sitemap.xml
```

Generated by `src/app/robots.ts`. `/search` is deliberately *not* disallowed so crawlers can see
its page-level `noindex`. No locale-related rules exist, and none will be needed.

### 1.4 How canonicals are produced today

`src/lib/seo/site.ts` is 7 lines:

```ts
export const SITE_URL = (process.env.NEXT_PUBLIC_SITE_URL ?? "http://localhost:3000").replace(/\/$/, "");
export function absoluteUrl(path: string): string {
  return `${SITE_URL}${path.startsWith("/") ? path : `/${path}`}`;
}
```

`src/lib/seo/metadata.ts` `buildMetadata({ path, canonicalUrl, ... })` sets
`alternates: { canonical }` where `canonical = normalizeCanonical(canonicalUrl) ?? absoluteUrl(path)`.
So: **self-referencing canonical by default**, overridable per row by `seo_metadata.canonical_url`,
which `normalizeCanonical()` sanitises down to same-origin URLs or root-relative paths only.

Verified live — every page returns exactly one self-referencing canonical and nothing else:

```
/          → <link rel="canonical" href="https://www.techcarvalho.com"/>
/articles  → <link rel="canonical" href="https://www.techcarvalho.com/articles"/>
/products  → <link rel="canonical" href="https://www.techcarvalho.com/products"/>
/articles/pc-game-system-requirements-what-they-mean → self
```

**No `<link rel="alternate" hreflang=…>` is emitted anywhere. No `og:locale`.**

### 1.5 Existing locale handling — confirmed: there is none

Your belief is correct. A repo-wide grep for `hreflang`, `alternates.languages`, `inLanguage`,
`locale`, `lang=` across `src/**` returns exactly three non-incidental hits, and none of them is
i18n:

- `src/app/layout.tsx:37` — the hardcoded `lang="en"`.
- `src/components/public/launch-pricing.tsx` — `Intl.NumberFormat` currency formatting only.
- `src/lib/media/providers/chaos-support.ts` — `lang="en"` inside canned HTML error-page fixtures.

There is no locale column anywhere in `supabase/migrations/*.sql`, no `next.config.ts` i18n key
(and none exists for the App Router — see §2.3), no locale logic in `src/proxy.ts`, and no
mention of Portuguese/Spanish/French/i18n/localisation in any of the 22 files in `docs/` except
incidental references to French- and Polish-titled Wikimedia media files.

### 1.6 Structured data — and whether it carries language

`src/lib/seo/jsonld.ts` emits, all `@context: https://schema.org`:

| Builder | Type | Where |
|---|---|---|
| `organizationJsonLd()` | `Organization` (`@id` `…/#organization`) | `src/app/(public)/layout.tsx` |
| `websiteJsonLd()` | `WebSite` (`@id` `…/#website`) + `SearchAction` | `src/app/(public)/layout.tsx` |
| `breadcrumbJsonLd()` | `BreadcrumbList` | `<Breadcrumbs>` |
| `itemListJsonLd()` | `ItemList` | hub pages |
| `collectionPageJsonLd()` | `CollectionPage` wrapping an `ItemList` in `mainEntity` | family / brand hubs |
| `productJsonLd()` | `Product` (`name`, `brand`, `mpn`, `releaseDate`, `category`, `image`, `url`) | product detail |
| `articleJsonLd()` | `Article` / `NewsArticle` | article detail |

**None of them carries language.** There is no `inLanguage` on `WebSite`, `Article`, `NewsArticle`
or `CollectionPage`, and no `@language` anywhere; confirmed both by reading the file and by
grepping the live HTML for `inLanguage` (zero hits). `SITE_URL` is baked into `ORGANIZATION_ID` and
`WEBSITE_ID` as bare origin-rooted values, which is fine and should stay that way — the
Organization and WebSite are language-independent entities and should keep one `@id` across all
four locales rather than fragmenting into four.

Note the file's governing rule, which constrains the multilingual phase too: *"Only ever emit a
field the database can actually back."* `inLanguage` will be backable the moment a `locale` column
exists, and not before.

### 1.7 `<html lang>`

`src/app/layout.tsx` line 37: `<html lang="en" …>` — a hardcoded literal, applied to **every page
on the site, admin included**. Confirmed live on `/`, `/articles`, `/products` and an article
detail page. There is one root layout (`src/app/layout.tsx`) and it owns the `<html>` element.

### 1.8 URL totals by type — the multiplication factor

160 submitted URLs today. A four-locale build is **640 URLs** (160 × 4), i.e. **+480 new URLs**,
against a corpus of **261,907 characters of published article body** (81 items; median 2,800 chars,
max 15,517) — roughly 44k words of source prose, so about **132k words to translate** for full
parity. That is a tractable volume for reviewed human-quality translation, which matters for §2.5.

---

## PART 2 — Migration risk

### 2.1 What moving English from `/` to `/en/` would actually cost

**In SEO terms, if done correctly, the cost is: a temporary fluctuation and a permanent redirect
obligation.** Google's current site-move guidance
([Site moves with URL changes](https://developers.google.com/search/docs/crawling-indexing/site-move-with-url-changes),
page last updated 2026-08-20, read 2026-08-22) says:

> "We recommend server side **permanent redirects** from the old URLs to the new URLs" … "Although
> Googlebot supports several kinds of redirects, we recommend that you use HTTP permanent redirects
> if possible, such as `301` and `308`."

> "**Keep the redirects for as long as possible, generally at least 1 year.** This timeframe allows
> Google to transfer all signals to the new URLs, including recrawling and reassigning links on
> other sites that point to your old URLs." … "From users' perspective, consider keeping redirects
> indefinitely."

> "**Expect temporary fluctuation in site ranking during the move.**" … "the visibility of your
> content in Search may fluctuate temporarily during the move. This is normal and a site's rankings
> will settle down over time."

> "As a general rule: for **medium-sized websites, it can take a few weeks or more** for Google to
> gradually start showing the new URLs instead of the old ones (and for larger sites, even longer)."

Note Google gives **no fixed recovery number** and does not quantify the size of the dip. "A few
weeks or more" is the whole commitment.

**Required redirect strategy (Option A).** One pattern rule, not 160 rules — but the exclusion list
is the part that bites:

1. A `308` (Next's permanent redirect status — `redirects.md`: *"`permanent` `true` … will use the
   308 status code which instructs clients/search engines to cache the redirect forever"*) from
   `/:path*` → `/en/:path*`.
2. **Must exclude**, or you break the site: `/_next/*`, `/api/*`, `/auth/*`, `/admin/*`,
   `/sitemap.xml`, `/robots.txt`, `/ads.txt`, `/icon`, `/apple-icon`, `/opengraph-image`, the
   `public/brand/*` assets, and the already-prefixed `/en|pt|es|fr/*`. This is the single most
   likely place to introduce a launch bug, because a naive `/:path*` rule swallows all of them.
3. Query strings must survive — the four `/articles?type=…` hub URLs are in the sitemap.
4. Regenerate `src/app/sitemap.ts` to emit only `/en/…` URLs, resubmit in Search Console, and
   (per Google) *"you can remove your old sitemap."*
5. Rewrite every internal link — Google: *"Change the internal links on the new site from the old
   URLs to the new URLs."* This touches every `<Link href=…>` and every `absoluteUrl()` call site.
6. Keep the redirects ≥1 year, realistically forever.

**Cost in this specific case:** with 1 day of index history, ~9 recorded sessions, no external
links, and no organic traffic, the equity being redirected is close to zero. The *operational* cost
(the exclusion list, the internal-link sweep, the permanent redirect layer) is real and unchanged
regardless.

### 2.2 The lower-risk alternative — and the honest trade-off

**Option B: English stays at `/`; add `/pt/`, `/es/`, `/fr/` only.**

This satisfies "clean, consistent language URL strategy" and Google's documentation does not
disagree, but it is important to be precise about what the documentation actually says, because
this area is thick with SEO folklore.

**On URL structure**, [Managing multi-regional and multilingual
sites](https://developers.google.com/search/docs/specialty/international/managing-multi-regional-sites)
(last updated 2025-12-10, read 2026-08-22) gives a pros/cons table for ccTLDs, subdomains and
subdirectories and **expresses no preference between them**. Subdirectories are listed with pros
"Easy to set up", "Low maintenance (same host)" and cons "Users might not recognize geotargeting
from the URL alone", "Single server location", "Separation of sites harder". The *only* structure
the page labels is URL parameters, marked **"Not recommended"**. It does state a preference on a
different axis:

> "Google recommends using different URLs for each language version of a page rather than using
> cookies or browser settings to adjust the content language on the page."

**On whether the default language may live at the root: the documentation is silent.** I looked
specifically. Neither the multi-regional page nor the hreflang page says the default language must
sit under a prefix, and neither discourages a root-hosted default. There is no rule to violate
here. The nearest related concept is `x-default`, which
[Localized versions of your page](https://developers.google.com/search/docs/specialty/international/localized-versions)
(last updated 2025-12-22, read 2026-08-22) describes as:

> "The reserved `x-default` value is used when no other language/region matches the user's browser
> setting."

— framed as a fallback for unmatched browser settings, with a language/country selector as the
worked example, and introduced with "**Consider** adding a fallback page". It is optional, and it
is *not* documented as "the place your default language lives."

**hreflang mechanics are identical under both options.** From the same page:

> "Each language version must list itself **as well as** all other language versions."

> "If two pages don't both point to each other, the tags will be ignored."

> "**Missing return links**: If page X links to page Y, page Y must link back to page X. If this is
> not the case for all pages that use `hreflang` annotations, those annotations may be ignored or
> not interpreted correctly."

> "There are three ways to indicate multiple language/locale versions of a page to Google: HTML,
> HTTP Headers, Sitemap." … "The three methods are equivalent from Google's perspective and you can
> choose the method that's the most convenient for your site. While you can use all three methods
> at the same time, there's no benefit in Search."

> "Only language codes listed in ISO 639-1 and region codes listed in ISO 3166-1 Alpha 2 are
> supported."

So a 4-way reciprocal, self-referencing cluster is required either way — `en ↔ pt ↔ es ↔ fr`, each
page listing all four including itself. Whether `en` resolves to `/articles/x` or `/en/articles/x`
is immaterial to the annotation's validity.

**On duplicate content across languages**, the decisive sentence is:

> "Localized versions of a page are only considered duplicates if the main content of the page
> remains untranslated."

Genuinely translated pages are **not** duplicates. This has a direct architectural consequence
recorded in §3.7: never render English body text under a `/pt/` URL as a fallback, because that is
precisely the condition the sentence describes.

**On canonicals and hreflang**, the relevant guidance is *not* on the hreflang page — it lives in
[Consolidate duplicate URLs](https://developers.google.com/search/docs/crawling-indexing/consolidate-duplicate-urls)
(last updated 2026-07-10, read 2026-08-22):

> "If you're using `hreflang` elements, make sure to specify a canonical page in the same language,
> or the best possible substitute language if a canonical page doesn't exist for the same language."

> "To help with sites' localization efforts, for canonicalization purposes Google prefers URLs that
> are part of `hreflang` clusters."

Two things follow, and both matter for §3. First: **each locale self-canonicalises.** Pointing
`/pt/articles/x`'s canonical at the English URL contradicts this directly and would suppress the
Portuguese page. The existing `normalizeCanonical()` behaviour (self-canonical by default) is
already the correct default and must be preserved per locale. Second: the widely-repeated claim
"hreflang is not a canonicalisation mechanism" **does not appear in Google's current docs** — the
docs say the opposite direction, that Google *prefers* hreflang-cluster URLs for canonicalisation.
I am flagging this because that folklore claim is the kind of thing that gets written into an
architecture doc and then quoted back as gospel.

### 2.3 Trade-off summary

| | **Option A — English at `/en/`** | **Option B — English at `/`** |
|---|---|---|
| Google-documented compliance | Fully compliant | Fully compliant (docs silent on default-at-root) |
| SEO risk to existing URLs | Temporary fluctuation, "a few weeks or more" reprocessing | **None** |
| Redirect obligation | ~Permanent, with a fiddly exclusion list | None |
| Route-tree symmetry | Perfect — every locale identical | Requires one asymmetric path helper |
| Risk of accidental duplicate | Low | `/en/x` must be actively 308'd to `/x` or it duplicates |
| Internal-link sweep | Every link + `absoluteUrl()` call site | Only the locale-aware ones |
| Cost trajectory | Cheapest **today**, grows with every indexed URL | Flat forever |
| `x-default` handling | Natural (point at `/` selector or at `en`) | Natural (point at `en` root) |

### 2.4 What Next.js 16.3.1 in *this repo* actually supports

Read from `node_modules/next/dist/docs/`, per AGENTS.md. The headline is important:

**There is no built-in i18n routing in the App Router.** The `i18n` key in `next.config.js` is a
**Pages Router** feature only. `node_modules/next/dist/docs/02-pages/02-guides/internationalization.md`
still documents it — *"Next.js has built-in support for internationalized (i18n) routing since
`v10.0.0`. You can provide a list of locales, the default locale, and domain-specific locales and
Next.js will automatically handle the routing"* — but there is **no `i18n.md` at all** in
`01-app/03-api-reference/05-config/01-next-config-js/` (I listed the directory; it is absent). The
migration guide states it outright:

> "The `locale`, `locales`, `defaultLocales`, `domainLocales` values have been removed because
> **built-in i18n Next.js features are no longer necessary in the `app` directory.**"
> — `01-app/02-guides/migrating/app-router-migration.md:509`

What the App Router *does* document, in `01-app/02-guides/internationalization.md`:

> "Routing can be internationalized by either the sub-path (`/fr/products`) or domain
> (`my-site.fr/products`). With this information, you can now redirect the user based on the locale
> inside [Proxy]."

> "Finally, ensure **all special files inside `app/` are nested under `app/[lang]`.** This enables
> the Next.js router to dynamically handle different locales in the route, and forward the `lang`
> parameter to every layout and page."

> "The root layout can also be nested in the new folder (e.g. `app/[lang]/layout.js`)."

And it shows `<html lang={(await params).lang}>` in `app/[lang]/layout.tsx` with
`generateStaticParams()` returning `[{ lang: 'en-US' }, { lang: 'de' }]`.

**The version-specific capability worth knowing about: `next/root-params`, introduced in v16.3.0 —
this repo runs 16.3.1, so it is available.** From
`01-app/03-api-reference/04-functions/next-root-params.md`:

> "The `next/root-params` module provides getter functions for accessing root-level parameters in
> Server Components. … The export names are generated from your dynamic segment folder names. For
> example, if your root layout is inside `app/[locale]`, you import `locale` from
> `next/root-params`." … "Unlike the regular `params` prop, root parameter getters can be called
> from any Server Component in your application **without prop drilling**."

This is materially better than the pre-16.3 story: `src/lib/seo/site.ts`, `metadata.ts`,
`jsonld.ts` and all of `src/lib/public/*.ts` could read the locale directly instead of threading it
through ~30 call sites. Its documented **restrictions matter here**:

> "`next/root-params` can be used in Server Components. It cannot be used in Client Components,
> Server Actions, or Route Handlers. Support for Route Handlers is planned for a future release."

> "Calling a root parameter getter inside `unstable_cache` will throw a runtime error. Use
> `"use cache"` instead."

> "Root parameter names must be valid JavaScript function identifiers. Kebab-cased segment names
> (e.g. `[post-slug]`) are not supported."

So `src/app/sitemap.ts` and `src/app/robots.ts` cannot use it and must build all four locales
explicitly — which is what you want anyway, since one sitemap should carry the whole hreflang
cluster.

**Metadata support is native and complete.** `generate-metadata.md` documents:

```jsx
alternates: {
  canonical: 'https://nextjs.org',
  languages: { 'en-US': 'https://nextjs.org/en-US', 'de-DE': 'https://nextjs.org/de-DE' },
}
```
```html
<link rel="canonical" href="https://nextjs.org" />
<link rel="alternate" hreflang="en-US" href="https://nextjs.org/en-US" />
<link rel="alternate" hreflang="de-DE" href="https://nextjs.org/de-DE" />
```

So `buildMetadata()` in `src/lib/seo/metadata.ts` gains hreflang by adding one
`alternates.languages` object — no new dependency.

**Sitemap hreflang is also native**, since v14.2.0 ("Add localizations support"). `sitemap.md`
documents `alternates: { languages: { es: …, de: … } }` per entry, producing
`<urlset xmlns:xhtml="http://www.w3.org/1999/xhtml">` with `<xhtml:link rel="alternate" hreflang=…>`
children. The `Sitemap` type is `{ url, lastModified?, changeFrequency?, priority?, alternates?: { languages?: Languages<string> } }`.

Given Google's "the three methods are equivalent … there's no benefit in Search" and "much harder
to manage three implementations instead of just picking one", **pick one**. Recommendation: the
`<head>` link tags via `buildMetadata()`, because they are generated at the same place the canonical
already is, which keeps canonical and hreflang structurally impossible to disagree.

**Proxy rewrites are supported** (`proxy.md`: `NextResponse.rewrite(new URL('/about-2', request.url))`,
and *"When you use `NextResponse.rewrite()`, Next.js automatically propagates the required RSC
rewrite headers upstream"*). This is what makes the recommended hybrid in §2.6 possible.

### 2.5 The structural constraint nobody has hit yet: the root-level `[category]` route

`src/app/(public)/[category]/page.tsx` matches **any single root segment**. Production has 10
category slugs: `action-cameras`, `ai-hardware`, `astrophotography`, `cameras-photography`,
`computing`, `drones-fpv`, `gaming`, `networking`, `smart-home-robots`, `smartphones`. None
currently collides with `en`/`pt`/`es`/`fr`.

But `taxonomy_categories.slug` is admin-authored free text with no reserved-word validation. An
admin creating a category slugged `pt` would, under Option B, produce a URL that is simultaneously
a category hub and a locale root. Under Option A the `[lang]/[category]` nesting makes this
unambiguous, which is a genuine (small) point in Option A's favour.

**Recommended guard either way:** reserve the locale codes against category slugs — a
`check (slug not in ('en','pt','es','fr'))` constraint on `taxonomy_categories`, or a FK-backed
check against a `locales` reference table (§3.6). Cheap, permanent, and it removes an entire class
of future 3am incident.

### 2.6 Recommended URL strategy

**Recommendation: English at the root (`/`), with `/pt/`, `/es/`, `/fr/` prefixes — implemented on a
symmetric `app/[lang]/` route tree, with English served at root via a proxy rewrite and `/en/*`
308-redirected to the bare path.**

This deliberately takes Option B's URL surface and Option A's code shape, because the two costs are
separable:

- **Public URLs:** `/articles/x`, `/pt/articles/x`, `/es/articles/x`, `/fr/articles/x`. Nothing
  currently indexed moves. Zero redirect obligation on existing URLs. No fluctuation window.
- **Code:** one route tree under `app/[lang]/`, one `<html lang={await lang()}>`, one set of page
  components, `next/root-params` available everywhere in `src/lib/public/*` and `src/lib/seo/*`. No
  duplicated route tree, no per-locale special-casing inside pages.
- **The seam** is exactly two rules in `src/proxy.ts`: rewrite a non-locale-prefixed public path to
  `/en{path}` internally; and 308-redirect an explicit `/en/{path}` request to `/{path}` so exactly
  one URL per locale exists and `/en/articles/x` can never become a live duplicate of
  `/articles/x`.
- Plus one pure helper, `localePath(locale, path)` → `path` when `locale === 'en'`, else
  `/${locale}${path}`, used by `absoluteUrl()`, the sitemap, the hreflang builder and every
  `<Link>`. It is a four-line function and belongs in `src/lib/seo/site.ts` next to `absoluteUrl`,
  with a unit test alongside `site.test.ts` (the repo's testing convention already covers exactly
  this kind of pure function).

**Why not simply `/en/`, given the site is one day old?** It is the closest call in this audit, and
the argument for it is real: the migration is cheapest today and never gets cheaper. I still come
down against it, for three reasons. (1) The benefit it buys — route symmetry — is obtainable
without moving any URL, via the hybrid above; the symmetry argument does not require the URL
change. (2) It creates a permanent redirect layer whose exclusion list (`/api`, `/auth`, `/admin`,
`/sitemap.xml`, `/robots.txt`, `/ads.txt`, the metadata-file routes) is the highest-risk piece of
the whole phase, in exchange for a benefit Google's documentation nowhere asks for. (3) A
"temporary fluctuation … a few weeks or more" during the exact window when a one-day-old site is
being discovered is a bad trade even when the absolute equity at risk is small — you would be
spending your discovery window on reprocessing.

**Two things to verify before building**, which I could not verify from the docs alone:

1. **Does `next/root-params` resolve correctly through a `NextResponse.rewrite()`?** The docs say
   root params come from "the dynamic segments that appear in the path up to the root layout file",
   and a rewrite changes the resolved path, so it *should* return `"en"` — but the docs never
   address the rewrite case explicitly. Prove it with a throwaway route before committing the
   architecture. If it does not work, fall back to reading the locale from `params` in
   `app/[lang]/layout.tsx` and threading it, or set a request header in the proxy.
2. **The root-layout restructure.** `app/[lang]/layout.tsx` becoming the root layout means
   `src/app/layout.tsx` is removed and `src/app/admin/layout.tsx` must become a **second root
   layout** owning its own `<html>`/`<body>`. `src/app/error.tsx` and `src/app/not-found.tsx` also
   need rehoming (Next 16 uses `global-not-found.tsx` for the no-layout case). `sitemap.ts`,
   `robots.ts`, `icon.tsx`, `apple-icon.tsx`, `opengraph-image.tsx`, `api/`, `auth/` stay at
   `app/` root, outside `[lang]`. This is the single largest mechanical change in the phase and it
   is identical under both options — it is a cost of going multilingual at all, not a cost of the
   URL choice.

**hreflang plan under the recommendation** — one method only, `<head>` link tags from
`buildMetadata()`:

```html
<link rel="canonical" href="https://www.techcarvalho.com/articles/x" />
<link rel="alternate" hreflang="en" href="https://www.techcarvalho.com/articles/x" />
<link rel="alternate" hreflang="pt" href="https://www.techcarvalho.com/pt/articles/x" />
<link rel="alternate" hreflang="es" href="https://www.techcarvalho.com/es/articles/x" />
<link rel="alternate" hreflang="fr" href="https://www.techcarvalho.com/fr/articles/x" />
<link rel="alternate" hreflang="x-default" href="https://www.techcarvalho.com/articles/x" />
```

Bare ISO 639-1 codes (`pt`, not `pt-PT`) unless and until you genuinely target pt-BR separately —
Google: *"If you have several alternate URLs targeted at users with the same language but in
different locales, it's a good idea to also provide a catchall URL"*, which bare `pt` already is.
Critically, **the `languages` map must list only locales in which this specific page actually
exists and is published** — a reciprocal annotation pointing at a 404 is a broken cluster, and the
"if two pages don't both point to each other, the tags will be ignored" rule means one wrong entry
degrades the whole set. This makes the annotation a *query* against the translation group (§3), not
a static template.

### 2.6a One more Google-policy point, on translation quality

Worth recording because it interacts with this repo's "Public site honesty" doctrine. The
[spam policies](https://developers.google.com/search/docs/essentials/spam-policies) page (last
updated 2026-05-15, read 2026-08-22) **no longer contains** the old bullet "Text translated by an
automated tool without human review or curation before publishing" — that section was folded into
**Scaled content abuse**. Translation now appears in exactly one bullet:

> "Scraping feeds, search results, or other content to generate many pages (including through
> automated transformations like synonymizing, **translating**, or other obfuscation techniques),
> where little value is provided to users"

The trigger is **scraped source + scale + little value**, not the use of a translation tool on your
own original writing. So machine-assisted translation of this site's own 81 articles is not a
policy violation on its face. But publishing **243 pages in one push with no human review** sits
close enough to "generate many pages without adding value" that it is not worth the risk, and it
conflicts with this repo's own stated doctrine. Recommendation: staged rollout, human review per
locale, and translate the highest-value subset first rather than all 81 × 3 at once. At ~44k source
words the reviewed path is affordable.

---

## PART 3 — Data-model feasibility

Design proposal only. **Nothing here has been built, and none of the SQL below has been run.** Per
CLAUDE.md, anything drafted-but-unapplied belongs in `supabase/migrations_pending/`, not
`supabase/migrations/`.

### 3.1 The organising principle

Every requirement in the brief resolves to one idea: **split every table's columns into IDENTITY /
FACT (never translated, exactly one copy) and PROSE (translated, N copies), and put the prose
somewhere the identity cannot reach.**

Done properly, requirement 3 ("product identities cannot be corrupted by translation") stops being
a policy that reviewers must enforce and becomes a structural impossibility: there is simply no
column anywhere in which a translator could write a localised product name.

### 3.2 `content_items` — EXTEND (row per locale)

An article's translation is a full editorial object: it has its own publish state, its own
`published_at`, its own SEO metadata, its own freshness clock, its own analytics. Making it a
first-class `content_items` row means every existing mechanism — the RLS publish gate, the sitemap
builder, `freshness_log`, `seo_metadata`, the analytics `content` dimension — keeps working with a
`locale` filter added, instead of being reimplemented against a side table.

```sql
-- DRAFT — not applied.
alter table public.content_items
  add column if not exists locale text not null default 'en',
  add column if not exists translation_group_id uuid,
  add column if not exists source_content_id uuid references public.content_items (id) on delete set null,
  add column if not exists translatable_revision integer not null default 1,
  add column if not exists source_revision_seen integer;

alter table public.content_items
  add constraint content_items_locale_check check (locale in ('en','pt','es','fr'));

-- backfill: every existing row is its own group's source
-- update public.content_items set translation_group_id = id where translation_group_id is null;
alter table public.content_items alter column translation_group_id set not null;

-- one row per (family, language)
create unique index content_items_group_locale_key
  on public.content_items (translation_group_id, locale);

-- slug uniqueness becomes per-locale: the PT article gets its own keyword-bearing slug
alter table public.content_items drop constraint content_items_slug_key;
create unique index content_items_locale_slug_key on public.content_items (locale, slug);

create index content_items_translation_group_idx on public.content_items (translation_group_id);
```

`translation_group_id` **is** the editorial family. It answers requirement 4 and drives the hreflang
cluster in §2.6.

**Slug policy.** `content_items.slug` becomes per-locale, so `/pt/articles/requisitos-de-sistema-…`
rather than a Portuguese page on an English slug — the article slug is the keyword-bearing part of
the URL and translating it is most of the point. The **route skeleton** (`/articles/`,
`/products/`, `/manufacturers/`, `/families/`) stays English in phase 1: localising it to
`/pt/artigos/` doubles the routing work and buys a marginal ranking benefit. Worth revisiting later;
not worth blocking on now.

**Rejected alternative:** a `content_item_translations(content_id, locale, title, body, …)` side
table. It has one genuine advantage — with a single `content_items` row, "the facts are shared" is
a *constraint* rather than a convention. It was rejected because status, `published_at`,
`seo_metadata`, `freshness_log`, `noindex` and analytics all need per-locale values anyway, so the
side table ends up re-implementing most of `content_items`; and because `src/app/sitemap.ts`, the
RLS policies and `analytics_daily_rollups` all key on `content_items.id`. §3.4 recovers the
shared-facts guarantee a different way.

### 3.3 Staleness on source change — derived, not stored

The repo already has an opinion about this. `20260820_editorial_workflow_statuses.sql` says, in its
own design note:

> "content becoming stale is already derivable from `freshness_log` (no review logged recently)
> without a stored status that can drift out of sync with the data that actually justifies it"

Apply the same reasoning. **A translation is STALE iff
`source.translatable_revision > translation.source_revision_seen`.** Purely derived; no stored flag
to drift; no cron job.

`updated_at` is the wrong signal — it fires on *any* column change, so flipping `status` or fixing
a category would falsely mark all three translations stale. Hence a dedicated counter bumped only
when translatable prose actually changes:

```sql
-- DRAFT — not applied.
create function public.bump_translatable_revision()
returns trigger language plpgsql as $$
begin
  if new.title is distinct from old.title
     or new.body is distinct from old.body then
    new.translatable_revision := old.translatable_revision + 1;
  end if;
  return new;
end;
$$;

create trigger bump_translatable_revision
  before update on public.content_items
  for each row execute function public.bump_translatable_revision();
```

A translator records `source_revision_seen = source.translatable_revision` at the moment they
translate. Admin surfacing then mirrors `src/lib/admin/freshness.ts` exactly: one place defining
the buckets, a badge on the content list, a count on the dashboard. Because `content_items.status`
already accepts `'needs_update'`, an editor can additionally *choose* to demote a badly-stale
translation out of public view — but the default should be the derived signal, not the stored
status, for the reason the migration note gives.

### 3.4 Shared facts — evidence, sources, media, products stay attached to the group

This is requirement 1, and it needs no schema change to the fact tables at all.

`evidence_records`, `source_records`, `content_products`, `content_media` and `content_tags` keep
pointing at `content_items.id` — specifically at the **source row's** id. Resolution moves to the
query layer: *"the evidence / sources / products / hero image for this article"* =
`translation_group_id` → source row → its attachments. Tags are taxonomy (shared by definition);
evidence and sources are factual records that are identical in every language; product associations
are identity links.

This is the same "store one direction, infer the rest at query time" pattern CLAUDE.md already
mandates for `product_relationships` and `content_relationships`. It means a Portuguese article
cannot accumulate its own divergent evidence trail, which is exactly the "not four parallel
universes" requirement.

The one genuine exception is **alt text and captions**, which are prose attached to a shared asset —
see §3.5.

**`content_relationships` (158 rows today) must not be quadrupled.** Same treatment: resolve
through the group. "Related content for this PT article" = look up the source EN row's
relationships, map each related EN id → its PT sibling via `translation_group_id`, and drop any
whose PT sibling is unpublished. Zero new rows, one query-layer change in
`src/lib/public/article-detail.ts` and `src/lib/public/content-cluster.ts`. Note that
`content-cluster.ts` already documents 33 pairs stored in both directions — normalise there, once,
not per locale.

### 3.5 Products, manufacturers, taxonomy, specs, media — NO locale column, ever

**Requirement 3 is satisfied by omission.** These tables get **zero** changes:

| Table | Identity / fact — never translated |
|---|---|
| `products` | `name`, `slug`, `model_number`, `release_date`, `status`, `manufacturer_id`, `category_id`, `family_id` |
| `manufacturers` | `name`, `slug`, `website` |
| `product_specs` | `value` (jsonb) |
| `spec_definitions` | `slug`, `data_type`, `unit` |
| `media_assets` | `license`, `attribution`, `creator`, `source_url`, `rights_status`, `owned`, `source_type`, `provenance_evidence`, `content_hash`, `storage_path`, `publication_status` |
| `taxonomy_categories` | `slug` |

"Canon EOS 60D", "RTX 5090" and "Wi-Fi 7" live in `products.name` / `taxonomy_tags.name`, and
`products.name` will have **no per-locale counterpart anywhere in the schema**. A translator has
nowhere to put "Canon EOS 60D (Portuguesa)" even if they try. Same for `model_number` and for every
rights/provenance field on `media_assets` — those are legal evidence and translating them would
corrupt the record, so they are structurally excluded.

Prose goes into narrow, NEW side tables. All five have the same shape, all mirror their parent's
RLS (reference data world-readable; media gated as its parent is):

```sql
-- DRAFT — not applied. One shape, five tables.
create table public.product_translations (
  product_id uuid not null references public.products (id) on delete cascade,
  locale text not null,
  summary text,                                   -- products.summary only
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key (product_id, locale)
);

create table public.manufacturer_translations (
  manufacturer_id uuid not null references public.manufacturers (id) on delete cascade,
  locale text not null,
  description text,                               -- manufacturers.description only
  primary key (manufacturer_id, locale)
);

create table public.taxonomy_category_translations (
  category_id uuid not null references public.taxonomy_categories (id) on delete cascade,
  locale text not null,
  name text not null,                             -- "Cameras & Photography" IS a display label
  description text,                               -- slug is NOT here, deliberately
  primary key (category_id, locale)
);

create table public.spec_definition_translations (
  spec_definition_id uuid not null references public.spec_definitions (id) on delete cascade,
  locale text not null,
  name text not null,                             -- "Sensor size"; unit and data_type are NOT here
  primary key (spec_definition_id, locale)
);

create table public.media_asset_translations (
  media_id uuid not null references public.media_assets (id) on delete cascade,
  locale text not null,
  alt_text text,
  caption text,
  primary key (media_id, locale)
);
```

Note what is *absent* from every one of them: no `name` on `product_translations`, no `slug`
anywhere, no `unit`, no rights fields. That absence is the guarantee.

**`product_specs.value` needs no locale.** The spec system is already category/definition-driven
(CLAUDE.md: *"the same mechanism for a camera's sensor size as a GPU's memory bus width"*), and for
`data_type in ('number','boolean')` the value is language-independent by construction. For
`'enum'`/`'text'`, translate the *label* via `spec_definition_translations` rather than the stored
value — 582 `product_specs` rows stay untouched.

**`taxonomy_tags`** is the one judgement call. Tag names are subject labels; tag *slugs* are
identity and are matched by slug equality against `manufacturers.slug` in `src/app/sitemap.ts` and
by `FORMAT_TAG_SLUGS` in `content-cluster.ts`. Recommendation: slug never translated; add
`taxonomy_tag_translations(tag_id, locale, name)` only if tag names become visitor-facing in
localised UI. Defer.

### 3.6 `seo_metadata` — EXTEND, and one new guard in `normalizeCanonical()`

Content-level SEO is already per-locale for free, because `content_id` now implies a locale. Product
and category SEO are not — a Portuguese product page needs its own meta description.

```sql
-- DRAFT — not applied.
alter table public.seo_metadata add column if not exists locale text not null default 'en';

alter table public.seo_metadata drop constraint seo_metadata_product_id_key;
alter table public.seo_metadata drop constraint seo_metadata_content_id_key;
alter table public.seo_metadata drop constraint seo_metadata_category_id_key;

create unique index seo_metadata_product_locale_key  on public.seo_metadata (product_id, locale);
create unique index seo_metadata_content_locale_key  on public.seo_metadata (content_id, locale);
create unique index seo_metadata_category_locale_key on public.seo_metadata (category_id, locale);
-- the existing check (num_nonnulls(product_id, content_id, category_id) = 1) stays as-is
```

**One code guard to add.** `normalizeCanonical()` in `src/lib/seo/metadata.ts` currently accepts any
same-origin URL. With four locales, an editor typing an English URL into a Portuguese page's
`canonical_url` would de-index that page — and Google's guidance is explicit that each version
should *"specify a canonical page in the same language."* The function should additionally reject a
canonical whose locale prefix differs from the page's own, falling back to the self-referencing
canonical. This is a pure function with an existing test file (`metadata.test.ts`), so it is cheap
and testable.

**A `locales` reference table is worth adding**, so the locale list is not hardcoded in the six or
so places it would otherwise appear (five `check` constraints, the route `generateStaticParams`, the
proxy, the sitemap, the hreflang builder):

```sql
create table public.locales (
  code text primary key,              -- ISO 639-1, per Google's requirement
  name text not null,
  is_default boolean not null default false,
  is_active boolean not null default false,
  sort_order integer not null default 0
);
```

FK the five `locale` columns to it, and use it for the reserved-category-slug guard from §2.5. It
also fits the existing generic admin CRUD system (`src/lib/admin/reference-service.ts` +
`ReferenceFieldConfig`) with no bespoke page — it is exactly the shape of the five reference tables
that system already serves.

### 3.7 Publication and fallback rules — the honesty constraint

Two rules, both following directly from Google's *"Localized versions of a page are only considered
duplicates if the main content of the page remains untranslated"* and from this repo's own
"Public site honesty" doctrine:

1. **Never render English body text under a `/pt/`, `/es/` or `/fr/` URL.** If no published
   translation exists for that locale, the localised URL must `notFound()`. Falling back to English
   is the exact condition Google names as duplication, and it also violates the repo's rule against
   presenting something as what it isn't. The one legitimate exception is *chrome* — nav, footer,
   legal boilerplate — which may lag translation, since Google explicitly contemplates *"If you keep
   the main content in a single language and translate only the template"* as the case that *does*
   count as untranslated.
2. **hreflang lists only locales where the page is actually published.** Because Google ignores
   non-reciprocal clusters entirely, a `languages` map is a live query against
   `translation_group_id` filtered by `status = 'published' and published_at <= now()`, not a
   template. This must be shared with `src/app/sitemap.ts` the same way
   `isManufacturerHubIndexable` is shared today, so the sitemap and the page can never disagree.

### 3.8 Making the cannibalisation logic see ONE editorial family

This is requirement 4, and the fix is a `where` clause, not new machinery.

**The rule: two `content_items` compete only if `a.locale = b.locale` AND
`a.translation_group_id <> b.translation_group_id`.** Both facts are columns on the row.

Without it, the failure is concrete and immediate. `src/lib/admin/cannibalisation.ts` matches on, in
priority order, exact `intent_fingerprint`, exact `primary_query`, then ≥0.7 title-token overlap. A
Portuguese translation that copies the source's `intent_fingerprint` (the natural thing to do)
trips rule 1 against its own English original — four variants produce six flagged pairs, and
`src/lib/engine/publication-gate.ts` raises a hard `intent_cannibalisation` **blocker** that would
stop the translation publishing at all. Conversely, if translations get localised fingerprints, the
detector goes silent for the wrong reason: `tokenize()` splits on `[^a-z0-9]+` with an
English-only `STOPWORDS` set, so a Portuguese title scores ~0 against its English source and real
cross-locale cannibalisation would also be invisible.

Call sites that need the scoping, all identified:

| Location | Change |
|---|---|
| `src/lib/admin/cannibalisation.ts` | add `locale` + `translation_group_id` to `ContentSignal`; filter in `findCannibalisationMatches` |
| `src/lib/admin/dashboard-service.ts` (~L159–178) | `possibleCannibalisation` count uses the same filter |
| `src/components/admin/cannibalisation-check.tsx` | pass the editing row's locale |
| `src/app/admin/(dashboard)/content/new/page.tsx`, `content/[id]/page.tsx` | select `locale`, `translation_group_id` |
| `engine_shadow_content_signals()` in `20260822_engine_shadow_evaluation.sql` | add both columns to the `select` |
| `src/lib/engine/shadow-io.ts` (~L81–90, 386–396) | map them into `ContentSignal` |
| `src/lib/engine/shadow-pipeline.ts` (~L748–806) | scope `titleSimilarity` nearest-match to same locale |
| `src/lib/engine/dedupe.ts` | prefix `buildDedupeKey` with locale so `engine_discoveries.dedupe_key`'s unique constraint doesn't collapse locales |
| `src/lib/public/content-cluster.ts` | cluster edges resolved within a locale (§3.4) |

**Keep `intent_fingerprint` identical across a translation group.** It is an intent identifier, not
a query string — holding it constant makes group membership self-evident and lets you ask "which
locales cover this intent?", while the same-locale filter prevents the false positive.
`primary_query` is genuinely per-locale (a Portuguese page targets a Portuguese query). Worth noting
that `intent_fingerprint` is currently set on only **34 of 81** published items, so the
highest-confidence rule mostly cannot fire today — a pre-existing gap
(`docs/seo-architecture.md` §6.2) that translation will make more visible, not create.

**Analytics.** `analytics_daily_rollups.dimension_type = 'content'` keys on the content id, so four
locales split into four rows. Reporting should aggregate by `translation_group_id` to answer "how
is this article doing across all languages" — a dashboard query change, no schema change.

### 3.9 Extend vs. new — the summary

**EXTEND (5 changes):**

| Table | Change |
|---|---|
| `content_items` | `+locale`, `+translation_group_id`, `+source_content_id`, `+translatable_revision`, `+source_revision_seen`; `unique(slug)` → `unique(locale, slug)`; `+unique(translation_group_id, locale)` |
| `seo_metadata` | `+locale`; three single-column uniques → three composite uniques |
| `taxonomy_categories` | reserved-slug check only (`slug not in ('en','pt','es','fr')`) |
| `content_relationships`, `content_products`, `content_media`, `content_tags`, `evidence_records`, `source_records`, `freshness_log` | **no schema change** — resolved through `translation_group_id` at query time |
| `engine_discoveries` | **no schema change** — locale folded into the `dedupe_key` string |

**NEW (6 tables, all narrow):** `product_translations`, `manufacturer_translations`,
`taxonomy_category_translations`, `spec_definition_translations`, `media_asset_translations`,
`locales`. Every one is prose-only or reference data; none can hold an identity value.

**UNCHANGED, deliberately:** `products`, `manufacturers`, `spec_definitions`, `product_specs`,
`media_assets`, `product_relationships`, `product_families`, `taxonomy_tags`, `product_offers`,
`product_launch_pricing`. Zero columns added. That is the identity guarantee, and it is worth
protecting in review.

**Also required:** RLS policies for all six new tables mirroring their parents' predicates, and
hand-edits to `src/lib/types/database.ts` — CLAUDE.md notes it is hand-written with no Supabase CLI
available, so every column above is a manual edit that will silently rot if skipped.

---

## Open questions

1. **Search Console index coverage** — unverified, no access. This is the one input that could
   change the §2.6 recommendation, and it takes 30 seconds to check.
2. **Does `next/root-params` resolve through `NextResponse.rewrite()`?** Undocumented. Prove before
   building.
3. **Localised route skeleton** (`/pt/artigos/` vs `/pt/articles/`) — deferred, not decided.
4. **Which locale is authoritative for a given article?** The model assumes English is always the
   source. If a Portuguese-first article is ever wanted, `source_content_id` supports it, but the
   staleness logic and the admin UI would need to stop assuming `en`.
5. **Translation production process** — out of scope for this audit, but §2.6a means it is a
   quality gate, not just a logistics question.
