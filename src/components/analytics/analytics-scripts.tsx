"use client";

import Script from "next/script";
import { GA_MEASUREMENT_ID } from "@/lib/analytics";
import { useConsent } from "@/lib/consent/consent-context";

// Loads GA4 only when both an ID is configured (env var) and consent has
// been granted. Neither is true today (no CMP wired up, no ID set), so this
// renders nothing — ready for both to be turned on later without code
// changes to callers.
export function AnalyticsScripts() {
  const { consent } = useConsent();

  if (!GA_MEASUREMENT_ID || !consent.analytics) return null;

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
    </>
  );
}
