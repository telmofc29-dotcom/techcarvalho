// Outbound/affiliate link abstraction (Phase 20 readiness). No retailer API
// is integrated — this only standardizes how outbound links are rendered,
// disclosed, and tracked, so a real eBay/affiliate integration later slots
// into <OutboundLink> without touching every call site.
//
// product_offers is applied to production (supabase/migrations/
// 20260820_product_offers.sql) and queried by src/lib/public/product-
// detail.ts, rendered as the "Where to buy" section on the product page.

export type AffiliateStatus = "affiliate" | "non_affiliate" | "pending";

export type OutboundLinkKind = "affiliate" | "outbound";

// A single, honest disclosure string — never omitted, never softened, for
// any link marked affiliate. Advertising Standards Authority / FTC
// disclosure requirements exist precisely to stop affiliate links being
// disguised as ordinary editorial links.
export const AFFILIATE_DISCLOSURE_LABEL = "Affiliate link";
export const AFFILIATE_DISCLOSURE_TOOLTIP =
  "We may earn a commission if you buy through this link, at no extra cost to you.";

// Maps an offer's affiliate_status to how its link should actually be
// rendered — kept as an explicit function (not a trivial lookup) because
// "pending" (an affiliate relationship being set up but not yet live)
// must never be presented as an active affiliate link.
export function outboundLinkKindFor(affiliateStatus: AffiliateStatus): OutboundLinkKind {
  return affiliateStatus === "affiliate" ? "affiliate" : "outbound";
}

// rel values follow Google's guidance for paid/affiliate links (sponsored)
// vs. plain uncurated outbound links (nofollow is still appropriate since
// this app has not editorially vouched for the destination's content).
export function relFor(kind: OutboundLinkKind): string {
  return kind === "affiliate" ? "nofollow sponsored noreferrer" : "nofollow noreferrer";
}

export function destinationDomainOf(url: string): string {
  try {
    return new URL(url).hostname.replace(/^www\./, "");
  } catch {
    return "";
  }
}
