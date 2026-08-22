"use client";

import { createClient } from "@/lib/supabase/client";
import type { OutboundClickKind, OutboundClickLinkPosition } from "@/lib/types/database";

// First-party outbound/affiliate click record — see
// supabase/migrations/20260820_outbound_click_events.sql. This table
// existed, with RLS and an admin dashboard reader already built, but
// nothing in the app ever inserted into it (docs/analytics-architecture.md
// flagged this explicitly as the next piece). Deliberately independent of
// GA4 configuration and analytics consent, per that migration's own design
// note: no PII columns, closed vocabularies, anon insert-only/no-select —
// this is what lets affiliate/outbound click reporting keep working even
// when a visitor declines analytics consent or GA4 isn't configured.
// Fire-and-forget: a failed insert must never block navigation or surface
// an error to the visitor.
export function recordOutboundClick(event: {
  kind: OutboundClickKind;
  retailer?: string;
  destinationDomain: string;
  linkPosition: OutboundClickLinkPosition;
  productId?: string;
  contentId?: string;
}): void {
  const supabase = createClient();
  // Fire-and-forget by design — a visitor's navigation must never wait on
  // analytics. But the rejection is LOGGED rather than swallowed: link_position
  // is a closed CHECK vocabulary, so adding a new position in TypeScript
  // without widening the constraint drops every click from that surface with
  // no exception and no dashboard entry. Silent loss is worse than a console
  // error nobody reads, because it looks exactly like "nobody clicked".
  void supabase
    .from("outbound_click_events")
    .insert({
      kind: event.kind,
      retailer: event.retailer ?? null,
      destination_domain: event.destinationDomain,
      link_position: event.linkPosition,
      product_id: event.productId ?? null,
      content_id: event.contentId ?? null,
    })
    .then(({ error }) => {
      if (error) {
        console.error("recordOutboundClick failed", {
          code: error.code,
          message: error.message,
          linkPosition: event.linkPosition,
        });
      }
    });
}
