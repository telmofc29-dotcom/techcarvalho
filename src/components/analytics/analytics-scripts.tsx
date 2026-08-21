"use client";

import { Suspense, useEffect, useRef } from "react";
import { usePathname, useSearchParams } from "next/navigation";
import Script from "next/script";
import { GA_MEASUREMENT_ID, trackPageview } from "@/lib/analytics";
import { useConsent } from "@/lib/consent/consent-context";
import { useIsProductionHost } from "@/lib/analytics/is-production-host";

// Consent Mode design note: Google distinguishes "basic" (don't load gtag.js
// at all until consent) from "advanced" (load it immediately and let it
// hold/limit pings based on a `consent default` signal). We deliberately
// implement basic mode — the whole tree below is gated on
// `consent.analytics` — because phase 2 requires no analytics activity
// before consent, not merely "consent-aware" analytics. If a certified CMP
// is wired in later and advanced mode becomes desirable (e.g. to support
// non-personalized ads pre-consent), the `gtag('consent', 'default', ...)`
// call and unconditional script load can be added here without touching
// call sites, since everything already goes through useConsent()/track().

// GA4's own `gtag('config', ...)` call (below) already reports the landing
// pageview the moment this mounts. This tracker exists only to report
// *subsequent* client-side (App Router) navigations, so its first effect
// run is deliberately skipped — otherwise every fresh mount (e.g. right
// after consent is granted) would double-count the very page currently
// being viewed.
function RouteChangeTracker() {
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const isFirstRender = useRef(true);

  useEffect(() => {
    if (isFirstRender.current) {
      isFirstRender.current = false;
      return;
    }
    const query = searchParams.toString();
    trackPageview(query ? `${pathname}?${query}` : pathname);
  }, [pathname, searchParams]);

  return null;
}

// Loads GA4 only when all three hold: an ID is configured (env var),
// consent has been granted, and the page is actually being viewed on the
// real production domain (see useIsProductionHost — guards against
// NEXT_PUBLIC_GA_MEASUREMENT_ID being set broadly across Vercel
// Production/Preview/Development, the way NEXT_PUBLIC_SITE_URL already is,
// which would otherwise send preview-deployment and local-dev traffic into
// the real GA4 property). None of the three hold today, so this renders
// nothing — ready for all three to be true later without code changes to
// callers.
export function AnalyticsScripts() {
  const { consent } = useConsent();
  const isProductionHost = useIsProductionHost();

  if (!GA_MEASUREMENT_ID || !consent.analytics || !isProductionHost) return null;

  return (
    <>
      <Script src={`https://www.googletagmanager.com/gtag/js?id=${GA_MEASUREMENT_ID}`} strategy="afterInteractive" />
      <Script id="ga4-init" strategy="afterInteractive">
        {`
          window.dataLayer = window.dataLayer || [];
          function gtag(){dataLayer.push(arguments);}
          gtag('js', new Date());
          gtag('config', '${GA_MEASUREMENT_ID}');
        `}
      </Script>
      {/* useSearchParams requires a Suspense boundary in the App Router */}
      <Suspense fallback={null}>
        <RouteChangeTracker />
      </Suspense>
    </>
  );
}
