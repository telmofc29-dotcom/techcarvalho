"use client";

import { useEffect } from "react";
import { usePathname } from "next/navigation";
import { track } from "@/lib/analytics";

// Fires the first-party page_view event (see
// src/lib/analytics/session-events.ts) with optional entity context, once
// per genuine mount. Unlike RouteChangeTracker (GA4's own pageview
// tracker), this needs no "skip the first effect run" guard — GA4's
// gtag.js auto-sends its own landing pageview independently, but nothing
// here does that, so every mount of this component (including the very
// first page a visitor lands on) is a real, exactly-once page view for
// the first-party system. Renders nothing.
//
// One instance per distinct page/route "kind" (see call sites: homepage,
// category page, product/article/manufacturer detail, products/articles
// index, search) — not a single global instance in the root layout,
// because entity context (which product/article/category) is only known
// where the page itself is rendered.
export function PageViewTracker({
  entityType,
  entityId,
  categorySlug,
}: {
  entityType?: "product" | "content" | "manufacturer" | "category";
  entityId?: string;
  categorySlug?: string;
}) {
  const pathname = usePathname();

  useEffect(() => {
    track("page_view", { path: pathname, entity_type: entityType, entity_id: entityId, category_slug: categorySlug });
  }, [pathname, entityType, entityId, categorySlug]);

  return null;
}
