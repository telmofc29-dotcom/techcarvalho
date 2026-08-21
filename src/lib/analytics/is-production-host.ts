"use client";

import { useEffect, useState } from "react";
import { SITE_URL } from "@/lib/seo/site";

// Guards analytics/ad scripts from firing on anything that isn't the real
// production domain — localhost during development, and any Vercel preview
// deployment (a different generated hostname per branch/PR). Next.js inlines
// NEXT_PUBLIC_* values at build time, so if NEXT_PUBLIC_GA_MEASUREMENT_ID or
// NEXT_PUBLIC_ADSENSE_PUBLISHER_ID happen to be set for Preview/Development
// environments too (as NEXT_PUBLIC_SITE_URL already is, from an earlier
// session), those builds would otherwise send real events/ad requests under
// the production property/account, polluting GA4 data and risking AdSense
// invalid-traffic flags from non-approved domains. Comparing the actual
// browser hostname against the hostname baked into NEXT_PUBLIC_SITE_URL
// catches this regardless of which environments the analytics/ads env vars
// are set in — no separate "is this prod" env var needed.
//
// A hook, not a plain function: window.location.hostname doesn't exist
// during SSR, and checking it synchronously during the initial render would
// make the server render and the client's first render disagree on whether
// AnalyticsScripts/AdSenseScript render a <Script> tag — a real hydration
// mismatch, the same class of issue consent-context.tsx already documents
// for its own localStorage read. Same fix: start from the safe default
// (false — don't fire) and only flip to true after mount, once the real
// hostname is actually knowable.
export function useIsProductionHost(): boolean {
  const [isProd, setIsProd] = useState(false);

  useEffect(() => {
    try {
      // eslint-disable-next-line react-hooks/set-state-in-effect -- see comment above, same sanctioned exception as consent-context.tsx
      setIsProd(window.location.hostname === new URL(SITE_URL).hostname);
    } catch {
      // Leave isProd at its safe false default.
    }
  }, []);

  return isProd;
}
