"use client";

import { ADS_ENABLED, AD_PLACEMENTS, type AdPlacementId } from "@/lib/ads/config";
import { useConsent } from "@/lib/consent/consent-context";

// Placement abstraction only — no ad network is wired in yet. Reserves
// stable dimensions per placement (see AD_PLACEMENTS) so turning ads on
// later never causes layout shift for content already on the page.
//
// Gated on advertising consent (useConsent()), the same pattern as
// AnalyticsScripts is gated on analytics consent — no ad request is ever
// made pre-consent. Calling this outside a ConsentProvider throws (see
// useConsent), which structurally keeps it out of /admin: only the
// (public) route group mounts a ConsentProvider.
//
// Renders nothing at all — not even reserved space — when ads aren't
// configured/enabled, so the public site shows no placeholder boxes until
// an admin has deliberately turned this on with a real publisher ID.
export function AdSlot({ id, placement, className }: { id: string; placement: AdPlacementId; className?: string }) {
  const { consent } = useConsent();

  if (!ADS_ENABLED) return null;

  const { reservedHeight, maxWidth } = AD_PLACEMENTS[placement];

  return (
    <div
      id={`ad-slot-${id}`}
      data-ad-slot={id}
      data-ad-placement={placement}
      data-consent-granted={consent.advertising}
      aria-hidden="true"
      className={`mx-auto w-full ${className ?? ""}`}
      style={{ minHeight: reservedHeight, maxWidth }}
    >
      {/* Ad network markup goes here once one is configured, only when
          consent.advertising is true — space above is already reserved so
          inserting it never shifts layout. */}
    </div>
  );
}
