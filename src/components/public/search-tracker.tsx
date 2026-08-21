"use client";

import { useEffect, type ReactNode, type MouseEvent } from "react";
import { track } from "@/lib/analytics";
import { sanitizeEventText, sanitizeSlug } from "@/lib/analytics/events";

type ResultType = "product" | "content" | "manufacturer" | "category";

// Fires `search` once per page load (a fresh GET /search?q=... navigation
// is a fresh search, so no dedup guard is needed the way RouteChangeTracker
// needs one for client-side navigations) and delegates result-link clicks
// to `search_result_click`. Result type/position are read from a
// data-result-type/data-result-position pair on the nearest ancestor
// marker element rather than requiring ContentCard/ProductCard themselves
// to accept tracking props, so those shared, widely-reused components stay
// untouched — same minimal-client-JS delegation approach as
// RelatedContentTracker.
export function SearchTracker({
  query,
  resultCount,
  children,
}: {
  query: string;
  resultCount: number;
  children: ReactNode;
}) {
  useEffect(() => {
    track("search", { query: sanitizeEventText(query), result_count: resultCount });
  }, [query, resultCount]);

  function handleClick(event: MouseEvent<HTMLDivElement>) {
    const target = event.target as HTMLElement;
    const anchor = target.closest("a");
    const marker = target.closest<HTMLElement>("[data-result-type]");
    const href = anchor?.getAttribute("href");
    const resultType = marker?.getAttribute("data-result-type") as ResultType | null;
    const position = marker?.getAttribute("data-result-position");
    if (!href || !resultType || !position) return;
    const destinationSlug = sanitizeSlug(href.split("/").filter(Boolean).pop() ?? "");
    if (!destinationSlug) return;
    track("search_result_click", {
      query: sanitizeEventText(query),
      result_type: resultType,
      destination_slug: destinationSlug,
      position: Number(position),
    });
  }

  return <div onClick={handleClick}>{children}</div>;
}
