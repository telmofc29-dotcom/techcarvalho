# Analytics architecture

Status as of this batch: `NEXT_PUBLIC_GA_MEASUREMENT_ID` (G-G1RRCQ59KD) and
`NEXT_PUBLIC_ADSENSE_PUBLISHER_ID` are set in Vercel for all environments,
and Production has been redeployed with this code live. Collection is
therefore active on real production traffic that grants analytics consent —
nothing loads until that consent is granted, and nothing loads at all on
localhost or a Vercel preview deployment (see the production-host guard
below). This document describes the architecture so any future change here
is incremental, not a rewrite.

## Two independent switches

Analytics only runs when **both** are true, on the real production domain.
Neither switch implies the other.

1. **Collection** — `NEXT_PUBLIC_GA_MEASUREMENT_ID` is set in the deployment
   environment, and the visitor has granted analytics consent (see
   [Consent](#consent-and-privacy) below). When both hold — and the page is
   actually being viewed on the real production hostname, see below —
   `AnalyticsScripts` (`src/components/analytics/analytics-scripts.tsx`)
   loads `gtag.js` and starts sending events to GA4.

   **Set the measurement ID for Production only** (not Preview/Development)
   in Vercel. `useIsProductionHost()`
   (`src/lib/analytics/is-production-host.ts`) is a belt-and-suspenders
   guard on top of that — it compares the real browser hostname against the
   one baked into `NEXT_PUBLIC_SITE_URL`, so even if the measurement ID
   env var did end up set broadly (the way `NEXT_PUBLIC_SITE_URL` itself
   is), a Vercel preview deployment or `localhost` still can't send events
   into the real GA4 property. The same guard applies to the AdSense
   library loader — see `docs/adsense-setup.md`.
2. **Reporting** — the `/admin/analytics` dashboard reads through
   `AnalyticsDataProvider` (`src/lib/analytics/dashboard-types.ts`). Today
   `getAnalyticsDataProvider()` always returns `NullAnalyticsProvider`, which
   reports "not connected" for every section — because reading GA4 data back
   out requires a **separate** credential: a Google Cloud service account
   with read access to the GA4 property via the GA4 Data API. That's a
   different setup step from (1) and can happen later, independently.

## What's needed later, exactly

To turn on collection:
- Create a GA4 property in Google Analytics (not done by this batch — no
  Google account access).
- Set `NEXT_PUBLIC_GA_MEASUREMENT_ID=G-XXXXXXX` in the Vercel production
  environment.

To turn on the admin dashboard's real numbers:
- Create a Google Cloud service account, grant it Viewer access to the GA4
  property, and enable the GA4 Data API.
- Implement a new `AnalyticsDataProvider` (e.g. `Ga4DataApiProvider`) in
  `src/lib/analytics/dashboard-types.ts`-adjacent code that calls the Data
  API using that service account's credentials (stored as a server-only env
  var, never exposed to the client — see `isAnalyticsConfiguredServer()` in
  `src/lib/analytics/server-status.ts` for the existing server/client
  credential-shape split).
- Swap the body of `getAnalyticsDataProvider()` to return it. Nothing else
  in `/admin/analytics` changes — every section already renders through the
  adapter interface.

## Event taxonomy

Every custom event fired anywhere in the app comes from the single typed
map in `src/lib/analytics/events.ts` (`TechCarvalhoEventMap`) — not ad-hoc
`gtag('event', 'whatever')` calls scattered through components. Sending an
event with the wrong parameter shape for its name is a TypeScript error, not
a silent typo that only shows up in GA4's UI weeks later.

Events cover: traffic (`page_view`, `navigation_click`), content journeys
(`internal_link_click`, `related_content_click`, `product_click` — the
data behind Phase 15's internal-journey work), search
(`search`, `search_result_click`), engagement (`scroll_depth`, `cta_click`),
outbound/monetisation (`outbound_link_click`, `affiliate_click` — see
`src/components/public/outbound-link.tsx`), and ad hooks (`ad_impression`,
`ad_click`, inert until an ad network is wired up).

**No PII, ever.** `sanitizeEventText()` and `sanitizeSlug()` in `events.ts`
strip anything that isn't plain text/slug characters and cap length, so a
search query or label can never carry HTML/script content or become an
unbounded payload. No raw IP is ever handled or stored by this codebase —
GA4 does its own IP-based geolocation server-side and discards the IP
itself; we never touch it.

All calls go through `track()` in `src/lib/analytics/index.ts`, which is a
silent no-op whenever `gtag` isn't loaded (not configured, or consent not
granted) — call sites never need to guard this themselves.

## Pageview tracking

GA4's own `gtag('config', ...)` call reports the landing pageview the
moment `AnalyticsScripts` mounts (which only happens once both switches in
[Two independent switches](#two-independent-switches) are on).
`RouteChangeTracker` (same file) reports only *subsequent* client-side App
Router navigations, deliberately skipping its own first effect run so the
landing pageview is never double-counted. See the comments in
`analytics-scripts.tsx` for the full reasoning.

## Consent and privacy

`src/lib/consent/consent-context.tsx` implements a minimal, homemade
consent gate — **not** a certified CMP (Consent Management Platform).
AdSense/Ad Manager require an IAB-registered or Google-certified CMP for
consent signals to be trusted for ad personalization in the UK/EEA; this
implementation must not be represented as one anywhere (see `/cookies` and
`/privacy`, which describe only what actually exists today).

Three consent categories: `necessary` (not really "consent" — exempt under
PECR/GDPR, kept only for a consistent shape), `analytics` (gates GA4),
`advertising` (gates any future ad network, see `docs/adsense-setup.md`).
Choice is made via `ConsentBanner` (`src/components/consent/consent-banner.tsx`),
persisted to `localStorage`, and re-applied on every load via a Google
Consent Mode v2 signal (`analytics_storage`/`ad_storage`/`ad_user_data`/
`ad_personalization`) sent through `applyConsentModeSignal()` whenever
`window.gtag` exists.

**Consent Mode design choice: basic, not advanced.** Google distinguishes
"basic" mode (don't load `gtag.js` at all until consent) from "advanced"
mode (load it immediately and let it hold/limit pings based on a
`consent default` signal, sent before the library loads). This app
deliberately implements basic mode — `AnalyticsScripts` renders nothing at
all pre-consent — because "no analytics before consent" is a hard
requirement here, not merely "consent-aware analytics." If a certified CMP
is adopted later and advanced mode becomes desirable (e.g. to support
non-personalized ads pre-consent), the `gtag('consent', 'default', ...)`
call and unconditional script load can be added without touching any call
site, since everything already goes through `useConsent()`/`track()`.

Swapping the homemade banner for a certified CMP later means replacing the
internals of `consent-context.tsx` — `useConsent()` and its four-field
shape (`consent`, `hasChosen`, `setConsent`, `acceptAll`/`rejectAll`) is the
only surface every other call site depends on.

## First-party business events (Supabase)

`public.outbound_click_events` — applied to production
(`supabase/migrations/20260820_outbound_click_events.sql`; see that file's
header for the abuse-mitigation design: anonymous insert-only RLS, no PII
columns, closed vocabularies via CHECK constraints). This exists
specifically so affiliate/outbound click reporting doesn't depend on GA4
being configured or a visitor having granted GA-specific consent — it's
read directly by `/admin/analytics`'s Monetisation section today (see
`getFirstPartyMonetisation()` in `src/lib/analytics/dashboard-types.ts`),
independent of the rest of that page's GA4-Data-API-gated sections.

No client-side insert endpoint exists yet — the table is applied and
readable by admins, but nothing in the public app writes to it yet. That's
the next piece of this specific area, not part of this batch.

## Performance

`AnalyticsScripts` uses `next/script` with `strategy="afterInteractive"`,
so GA4 never blocks the initial render or hurts Core Web Vitals, and the
whole tree is import-cost-free on any page where consent hasn't been
granted (it returns `null` before rendering any `<Script>`).
