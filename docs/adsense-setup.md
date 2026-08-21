# AdSense setup — account created, site verification in progress

Publisher ID confirmed: **pub-8902041855720121** (from Google's verification
screen). `public/ads.txt` now serves the real entry Google asked for:

```
google.com, pub-8902041855720121, DIRECT, f08c47fec0942fa0
```

Two pieces of architecture exist now: `src/components/ads/adsense-script.tsx`
(site-wide AdSense library loader — what Google's review process looks for)
and `src/components/ads/ad-slot.tsx` (individual ad placements — still fully
inert, deliberately). Both read from env vars, nothing is hardcoded.

## 1. AdSense account — done

Publisher ID above, confirmed by you from the verification screen.

## 2. Set the publisher ID env var (not yet done — needs you)

In Vercel, **Production only** (not Preview/Development — see the
production-host note below for why that matters here specifically):

```
NEXT_PUBLIC_ADSENSE_PUBLISHER_ID=ca-pub-8902041855720121
```

Note the `ca-pub-` prefix here, vs. the bare `pub-` form already in
`ads.txt` — both are the same numeric ID; Google just uses the two formats
in different places (ads.txt vs. the client-side library tag). This is a
well-established, deterministic Google convention, not a guess.

Leave `NEXT_PUBLIC_ADS_ENABLED` **unset** for now — that's the separate,
more conservative flag that turns on individual ad placements
(`AD_PLACEMENTS` in `src/lib/ads/config.ts`), which stays off until you
decide to actually place ads. Setting only the publisher ID loads the
AdSense library site-wide (for verification/review) without placing a
single ad unit.

## 3. ads.txt — done

Already serving the real line (see above). This is the mechanism that
directly satisfies what Google asked for — it's a static file, crawled
directly, no JS or consent dependency, so it works for Google's review
regardless of how anything else here is configured.

## 4. Site-wide verification script — built, waiting on the env var above

`src/components/ads/adsense-script.tsx` loads
`pagead2.googlesyndication.com/pagead/js/adsbygoogle.js` in `<head>` on
every public page, once `NEXT_PUBLIC_ADSENSE_PUBLISHER_ID` is set. Gated on:

- the publisher ID being configured,
- `consent.advertising` being granted (same principle as every other
  ad-related network call in this codebase — see the file's own header
  comment for why this doesn't conflict with satisfying Google's review,
  which is really ads.txt's job),
- **the real production hostname** (`src/lib/analytics/is-production-host.ts`)
  — won't fire on localhost or a Vercel preview deployment even if the env
  var is set broadly, so non-production traffic can't register against the
  AdSense account as invalid traffic. This is exactly why step 2 says
  "Production only": belt-and-suspenders, but simplest to just not set it
  elsewhere.

## 5. Wire real ad units — not started, deliberately

`AdSlot` (`src/components/ads/ad-slot.tsx`) still renders only an empty,
correctly-sized, consent-gated `<div>` per placement — no real
`<ins class="adsbygoogle">` markup yet, and `AdSlot` has zero call sites in
any page. This is intentional: the current objective is verification/review
readiness, not live ad placement. When you're ready for that:

1. Set `NEXT_PUBLIC_ADS_ENABLED=true` in Vercel.
2. Replace the placeholder comment inside `AdSlot` with the real
   `<ins class="adsbygoogle" data-ad-client="..." data-ad-slot="...">` tag.
3. Add `<AdSlot placement="..." id="..." />` to the actual pages you want
   ads on.

## 6. Placement review — not started

`AD_PLACEMENTS` in `src/lib/ads/config.ts` is the single source of truth
for where ads are allowed to render (`article_top`, `article_end`,
`sidebar`, `category_page`) and how much space each reserves. Review that
list against AdSense's placement policies before going live — density,
proximity to navigation, and never inside `/admin` (structurally enforced:
`AdSlot` calls `useConsent()`, which throws outside the public route
group's `ConsentProvider`).

## Consent note — unchanged, still real

AdSense requires a certified/IAB-registered CMP for trusted consent signals
in the UK/EEA. The consent banner in this repo
(`src/components/consent/consent-banner.tsx`) is homemade, not certified —
see the header comment in `src/lib/consent/consent-context.tsx`. Ads should
not go live in the UK/EEA until either a certified CMP replaces it, or
non-personalized-ads-only serving is explicitly configured in AdSense to
match what the homemade banner can actually attest to.
