"use client";

import { useEffect, useRef } from "react";
import { track } from "@/lib/analytics";

const MILESTONES = [25, 50, 75, 90, 100] as const;

// Fires scroll_depth once per milestone per page view (a ref, not state —
// this never needs to trigger a re-render, and reset happens naturally on
// remount since it's a fresh ref per mount). Wired only on article/product
// detail pages, where "how far did they read/explore" is a meaningful
// question — not on list/index pages.
//
// Note: scroll_depth's params type (src/lib/analytics/events.ts) is
// `ContentContext & { milestone }` — content_id/content_slug only, no
// product_id field. On product detail pages this component therefore
// fires scroll_depth with no entity id at all; the event still lands with
// the correct path (session-events.ts falls back to
// window.location.pathname when an event has no explicit `path` field, as
// scroll_depth doesn't), so a product page's scroll depth is still
// recorded and attributable by path — just not joinable to products.id
// the way an article's is to content_items.id. Left as-is per this fork's
// directive (foundation types are the coordinator's to change, not this
// task's) — worth extending scroll_depth's type with an optional
// product_id later if per-product scroll-depth analysis turns out to
// matter.
export function ScrollDepthTracker({
  contentId,
  contentSlug,
}: {
  contentId?: string;
  contentSlug?: string;
}) {
  const fired = useRef<Set<number>>(new Set());

  useEffect(() => {
    fired.current = new Set();

    function handleScroll() {
      const scrollableHeight = document.documentElement.scrollHeight - window.innerHeight;
      if (scrollableHeight <= 0) return;
      const pct = (window.scrollY / scrollableHeight) * 100;
      for (const milestone of MILESTONES) {
        if (pct >= milestone && !fired.current.has(milestone)) {
          fired.current.add(milestone);
          track("scroll_depth", { milestone, content_id: contentId, content_slug: contentSlug });
        }
      }
    }

    window.addEventListener("scroll", handleScroll, { passive: true });
    return () => window.removeEventListener("scroll", handleScroll);
  }, [contentId, contentSlug]);

  return null;
}
