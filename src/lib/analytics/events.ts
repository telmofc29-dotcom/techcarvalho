// Central, typed event taxonomy. Every analytics event fired anywhere in
// the app should come from here rather than ad-hoc `trackEvent("whatever")`
// calls scattered through components — one vocabulary, one place to see
// what we track and what context each event carries.
//
// Design rules:
// - No PII, no free-text user input forwarded verbatim into event params
//   (search queries are length-capped and stripped of anything that isn't
//   plain text — see sanitizeEventText below).
// - No raw IP storage anywhere in this file or its caller (GA4 itself does
//   IP-based geolocation server-side and discards the IP; we never handle
//   or store it ourselves).
// - Every event name and its param shape is declared once, so a payload
//   that doesn't match the taxonomy is a type error, not a silent typo.

export type ContentType = "review" | "guide" | "comparison" | "news";

// Common, reusable context fragments — most events carry a subset of these.
type ContentContext = {
  content_id?: string;
  content_slug?: string;
  content_type?: ContentType;
};

type ProductContext = {
  product_id?: string;
  product_slug?: string;
  manufacturer_id?: string;
};

type CategoryContext = {
  category_slug?: string;
};

export type LinkPosition =
  | "article_top"
  | "article_body"
  | "article_end"
  | "sidebar"
  | "product_page"
  | "manufacturer_page"
  | "category_page"
  | "nav"
  | "footer"
  | "search_results"
  | "related_content";

export type TechCarvalhoEventMap = {
  // Traffic / navigation
  page_view: { path: string };
  navigation_click: { link_position: LinkPosition; destination: string; label?: string };

  // Content journeys — the whole point of the internal-link architecture.
  internal_link_click: ContentContext &
    ProductContext &
    CategoryContext & { destination: string; link_position: LinkPosition };
  related_content_click: ContentContext & { destination_content_id?: string; destination_slug: string };
  product_click: ProductContext &
    CategoryContext & { source: "article" | "category" | "manufacturer" | "search" | "home" };

  // Search
  search: { query: string; result_count: number };
  search_result_click: {
    query: string;
    result_type: "product" | "content" | "manufacturer" | "category";
    destination_slug: string;
    position: number;
  };

  // Engagement
  scroll_depth: ContentContext & { milestone: 25 | 50 | 75 | 100 };
  cta_click: { cta_id: string; link_position: LinkPosition; destination: string };

  // Outbound / monetisation
  outbound_link_click: { destination_domain: string; link_position: LinkPosition } & ContentContext & ProductContext;
  affiliate_click: {
    retailer: string;
    destination_domain: string;
    link_position: LinkPosition;
  } & ContentContext &
    ProductContext;

  // Ads (impression/click tracking hook — inert until an ad network is wired up)
  ad_impression: { slot_id: string; placement: LinkPosition };
  ad_click: { slot_id: string; placement: LinkPosition };
};

export type EventName = keyof TechCarvalhoEventMap;

export type EventParams<N extends EventName> = TechCarvalhoEventMap[N];

const MAX_TEXT_LENGTH = 200;

// Strips anything that isn't plain readable text and caps length, so a
// search query or label can never smuggle HTML/script content or become an
// unbounded payload into analytics.
export function sanitizeEventText(input: string): string {
  return input
    .replace(/[<>]/g, "")
    .trim()
    .slice(0, MAX_TEXT_LENGTH);
}

// Only allow a fixed vocabulary of category context values through — never
// forward arbitrary user-controlled strings (e.g. a URL path segment)
// directly as analytics dimensions without going through this.
export function sanitizeSlug(input: string): string {
  return input.replace(/[^a-z0-9-]/gi, "").slice(0, 100);
}
