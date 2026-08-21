# Monetisation & affiliate readiness

Status as of this batch: **no affiliate program is active** (see the public
`/affiliate-disclosure` page, which says exactly that). This document
covers the abstraction built so a real retailer/affiliate integration (eBay
Partner Network being the most likely first one) slots in later without a
rewrite, and what's still missing.

## What exists today

- **Event taxonomy**: `affiliate_click` and `outbound_link_click` in
  `src/lib/analytics/events.ts` — distinct event names so affiliate revenue
  attribution is never mixed up with ordinary outbound links (e.g. a
  manufacturer's website).
- **Rendering + disclosure**: `src/components/public/outbound-link.tsx`
  (`<OutboundLink>`) is the single sanctioned way to render a link that
  leaves the site. It:
  - Sets the correct `rel` per link kind (`nofollow sponsored noreferrer`
    for affiliate, `nofollow noreferrer` for plain outbound) via
    `relFor()` in `src/lib/monetisation/affiliate.ts`.
  - Fires the correct typed event on click.
  - Renders a visible "(Affiliate link)" disclosure with a tooltip
    whenever `kind="affiliate"` — this cannot be omitted; there is no prop
    to render an affiliate link without disclosure.
  - Requires `retailer` at the *type* level when `kind="affiliate"` (a
    discriminated union, not an optional field), so an affiliate link can't
    silently render without a retailer name and get misclassified as a
    plain outbound click in analytics.
- **Status mapping**: `outboundLinkKindFor(affiliateStatus)` maps a
  `product_offers` row's `affiliate_status` (`'affiliate' | 'non_affiliate'
  | 'pending'`) to the link kind actually rendered. `'pending'` (an
  affiliate relationship being set up but not yet live) always renders as
  a plain outbound link — never presented as an active affiliate link
  before it genuinely is one.

## What's missing (genuine gap, not built yet)

There is currently **no schema at all** for "where to buy this product" —
product pages have nothing to attach a retailer link to. See the proposed
(not applied) migration
`supabase/migrations_pending/20260820_product_offers.sql` for the drafted
`product_offers` table: `product_id`, `retailer`, `url`,
`affiliate_status`, an optional manually-entered `price_note` (never a live
price feed — this app integrates no retailer API), `is_active`. RLS mirrors
the existing pattern: publicly readable only for active offers of published
products, full read/write for admins.

Once that migration is applied, the remaining work is: an admin CRUD screen
for `product_offers` (follow the same pattern as the Source Records /
Evidence Records admin screens), and a "Where to buy" section on the
product detail page rendering each offer through `<OutboundLink>`.

## eBay specifically

No eBay API integration exists and none was added in this batch (explicitly
out of scope). When it's time: `product_offers.retailer = 'ebay'`,
`affiliate_status` starts at `'pending'` until an EPN (eBay Partner
Network) account exists and the URL is a real tracked affiliate link, then
flips to `'affiliate'`. Nothing else in the abstraction above needs to
change for that.

## First-party click events (Supabase)

See the *proposed, not applied* migration
`supabase/migrations_pending/20260820_outbound_click_events.sql` for a
first-party record of affiliate/outbound clicks, independent of whether a
visitor has GA4 analytics consent granted — useful for monetisation
reporting even before/without GA4. Its header comment documents the full
abuse-mitigation design (anonymous insert-only RLS with no read-back, no
PII columns, closed vocabularies via CHECK constraints, no free-text
injection surface). Not applied to production; no write endpoint exists
yet, since one would have nothing to write to.
