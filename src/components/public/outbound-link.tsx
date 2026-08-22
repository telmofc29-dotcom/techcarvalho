"use client";

import type { AnchorHTMLAttributes } from "react";
import { track } from "@/lib/analytics";
import type { LinkPosition } from "@/lib/analytics/events";
import { recordOutboundClick } from "@/lib/analytics/first-party";
import { AFFILIATE_DISCLOSURE_LABEL, AFFILIATE_DISCLOSURE_TOOLTIP, relFor } from "@/lib/monetisation/affiliate";

type BaseProps = Omit<AnchorHTMLAttributes<HTMLAnchorElement>, "rel" | "target"> & {
  href: string;
  destinationDomain: string;
  // Excludes "home" — no outbound/affiliate link currently lives on the
  // homepage, and OutboundClickLinkPosition (the outbound_click_events
  // table's own CHECK constraint, see src/lib/types/database.ts) doesn't
  // include it either. Narrowing here keeps that DB-level constraint
  // enforced at compile time without widening the constraint itself for a
  // position no outbound link actually uses.
  //
  // "family_page" IS permitted: it was added to OutboundClickLinkPosition
  // alongside the /families/ hub routes, and the CHECK constraint was widened
  // to match by supabase/migrations/20260822_outbound_family_page_position.sql,
  // APPLIED and verified against production on 2026-08-22 — a 'family_page'
  // insert is accepted, and an invalid value still fails with 23514, so the
  // vocabulary stayed closed.
  //
  // Family hubs currently track internal navigation only (InternalLinkTracker),
  // so no outbound click carries this position yet. The constraint was widened
  // ahead of that rather than after: recordOutboundClick() fires the insert as
  // `void ... .insert()`, so a rejected row would have been lost silently and
  // looked exactly like "nobody clicked".
  linkPosition: Exclude<LinkPosition, "home">;
  contentId?: string;
  productId?: string;
};

// retailer is required for "affiliate" links (there's no such thing as an
// affiliate link with an unknown retailer) and disallowed for plain
// "outbound" links — enforced at the type level so a link can't silently
// fall through to the wrong (undisclosed / mistracked) branch below.
type OutboundLinkProps =
  | (BaseProps & { kind: "affiliate"; retailer: string })
  | (BaseProps & { kind: "outbound"; retailer?: never });

// The single sanctioned way to render a link that leaves the site. Never
// use a plain <a> for a retailer/affiliate/manufacturer link — this is what
// guarantees every such link is disclosed (when it's an affiliate link),
// carries the correct rel attributes, and is tracked through the typed
// event taxonomy rather than an ad-hoc handler.
export function OutboundLink({
  href,
  destinationDomain,
  linkPosition,
  kind,
  retailer,
  contentId,
  productId,
  children,
  onClick,
  ...rest
}: OutboundLinkProps) {
  return (
    <span className="inline-flex items-center gap-1.5">
      <a
        {...rest}
        href={href}
        target="_blank"
        rel={relFor(kind)}
        onClick={(event) => {
          const context = {
            destination_domain: destinationDomain,
            link_position: linkPosition,
            content_id: contentId,
            product_id: productId,
          };
          if (kind === "affiliate") {
            track("affiliate_click", { ...context, retailer });
          } else {
            track("outbound_link_click", context);
          }
          recordOutboundClick({
            kind,
            retailer: kind === "affiliate" ? retailer : undefined,
            destinationDomain,
            linkPosition,
            productId,
            contentId,
          });
          onClick?.(event);
        }}
      >
        {children}
        <span className="sr-only"> (opens in a new tab)</span>
      </a>
      {kind === "affiliate" && (
        <span
          className="text-xs text-zinc-400"
          title={AFFILIATE_DISCLOSURE_TOOLTIP}
          aria-label={AFFILIATE_DISCLOSURE_TOOLTIP}
        >
          ({AFFILIATE_DISCLOSURE_LABEL})
        </span>
      )}
    </span>
  );
}
