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

To turn on the admin dashboard's real GA4-derived numbers (geography,
acquisition, device/browser/OS, GA4-side content performance): the
application side is fully built and waiting — `Ga4DataApiProvider`
(`src/lib/analytics/ga4-provider.ts`) implements the same
`AnalyticsDataProvider` interface `NullAnalyticsProvider` does, and
`getAnalyticsDataProvider()` already switches to it automatically the
moment the three env vars below exist — no further code change needed.
It is **untested against a real property** (no credentials exist in this
environment to exercise it) — do one real smoke test once configured
(open `/admin/analytics`, confirm the GA4 zone shows real numbers instead
of "not connected").

**Exact manual steps required (Google Cloud side — cannot be done from
this repository):**

1. **Google Cloud project**: use an existing one or create a new one at
   https://console.cloud.google.com — any project you control is fine,
   this doesn't need to be named after TechCarvalho specifically.
2. **Enable the GA4 Data API**: in that project, APIs & Services → Library
   → search "Google Analytics Data API" → Enable.
3. **Create a service account**: APIs & Services → Credentials → Create
   Credentials → Service account. Give it any name (e.g.
   `techcarvalho-analytics-reader`). No project-level IAM role is needed —
   access is granted at the GA4 property level in the next step, not via
   Cloud IAM.
4. **Create a key for that service account**: on the service account's
   page → Keys → Add key → Create new key → JSON. This downloads a JSON
   file containing `client_email` and `private_key` — these are the two
   values needed below. Treat this file as a secret; do not commit it, do
   not paste its contents anywhere public.
5. **Grant that service account access to the GA4 property**: in Google
   Analytics (analytics.google.com) → Admin → Property Access Management
   (for the TechCarvalho GA4 property specifically) → add the service
   account's email address (the `client_email` value, looks like
   `...@...iam.gserviceaccount.com`) → role **Viewer** (read-only —
   sufficient for everything this dashboard needs; do not grant Editor or
   Administrator).
6. **Find the GA4 property ID**: Google Analytics → Admin → Property
   Settings → the numeric Property ID at the top (not the Measurement ID
   `G-XXXXXXX` already configured for collection — a different, purely
   numeric identifier, e.g. `123456789`).

**Exactly which environment variables to set, and where:** in Vercel,
**Production environment only** (matching the existing
`NEXT_PUBLIC_GA_MEASUREMENT_ID` convention — no reason for a preview/dev
deployment to read the real property):
- `GA4_PROPERTY_ID` — the numeric property ID from step 6.
- `GA4_SERVICE_ACCOUNT_EMAIL` — the `client_email` value from the
  downloaded JSON key.
- `GA4_SERVICE_ACCOUNT_PRIVATE_KEY` — the `private_key` value from the
  same JSON file, pasted exactly as-is (it will contain literal `\n`
  sequences and `-----BEGIN PRIVATE KEY-----`/`-----END PRIVATE KEY-----`
  markers — `ga4-provider.ts`'s `getGa4Credentials()` un-escapes the `\n`
  sequences automatically, so paste the JSON value verbatim, don't try to
  reformat it into real newlines yourself).

**Critical — none of these three may ever be prefixed `NEXT_PUBLIC_`.**
That prefix tells Next.js to inline the value into every visitor's browser
JavaScript bundle. These three are read only inside `ga4-provider.ts`,
which is `server-only` (see that file's own import guard) and is never
imported by any Client Component — keep it that way in any future change.

**Production/deployment implications:** setting these three vars and
redeploying is the only step required after the Google-side configuration
above — `getAnalyticsDataProvider()` picks them up automatically, no code
change, no other environment (Preview/Development) needs them.

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
