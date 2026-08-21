"use client";

import Script from "next/script";
import { ADSENSE_PUBLISHER_ID } from "@/lib/ads/config";
import { useConsent } from "@/lib/consent/consent-context";
import { useIsProductionHost } from "@/lib/analytics/is-production-host";

// Site-wide AdSense library loader — separate from, and a prerequisite for,
// <AdSlot> (src/components/ads/ad-slot.tsx). This is what Google's
// verification/review process looks for on the site; <AdSlot> is what
// actually renders an ad unit once specific placements are turned on.
// Deliberately NOT gated on ADS_ENABLED (src/lib/ads/config.ts) — that flag
// controls whether individual ad placements render real markup ("plastering
// adverts around the site"), which stays off until a deliberate later
// decision. This script loading is the narrower, safe-to-turn-on-now half:
// it makes the site verifiable/reviewable without placing a single ad.
//
// Gated on consent.advertising, same principle as every other
// advertising-related network call in this codebase (AdSlot, and the ad_*
// Consent Mode signals in consent-context.tsx) — no ad-network script loads
// before a visitor has actually granted advertising consent. This means the
// script won't be present for Google's own crawler unless it's the one
// visiting with consent already granted, which it won't be — the mechanism
// that actually satisfies AdSense's stated verification requirement here is
// the ads.txt entry (public/ads.txt), which is crawled directly as a static
// file with no JS/consent dependency at all. This script is the separate,
// consent-respecting piece of the architecture needed for later ad serving.
// Also gated on useIsProductionHost() — never loads on localhost or a
// Vercel preview deployment, even if the publisher ID env var happens to be
// set there too, so non-production traffic can't register against the
// AdSense account.
export function AdSenseScript() {
  const { consent } = useConsent();
  const isProductionHost = useIsProductionHost();

  if (!ADSENSE_PUBLISHER_ID || !consent.advertising || !isProductionHost) return null;

  return (
    <Script
      async
      src={`https://pagead2.googlesyndication.com/pagead/js/adsbygoogle.js?client=${ADSENSE_PUBLISHER_ID}`}
      crossOrigin="anonymous"
      strategy="afterInteractive"
    />
  );
}
