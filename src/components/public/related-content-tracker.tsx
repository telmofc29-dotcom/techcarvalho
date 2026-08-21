"use client";

import type { ReactNode, MouseEvent } from "react";
import { track } from "@/lib/analytics";
import { sanitizeSlug } from "@/lib/analytics/events";

// A single, minimal client wrapper for a block of related-item links (cards
// rendered by server components like ContentCard/ProductCard), rather than
// converting those shared, widely-reused card components to "use client".
// Uses native event delegation — one listener for the whole block — so it
// stays consistent with the rest of the app's minimal-client-JS approach.
export function RelatedContentTracker({
  contentId,
  children,
}: {
  contentId?: string;
  children: ReactNode;
}) {
  function handleClick(event: MouseEvent<HTMLDivElement>) {
    const anchor = (event.target as HTMLElement).closest("a");
    const href = anchor?.getAttribute("href");
    if (!href) return;
    const destinationSlug = sanitizeSlug(href.split("/").filter(Boolean).pop() ?? "");
    if (!destinationSlug) return;
    track("related_content_click", { content_id: contentId, destination_slug: destinationSlug });
  }

  return <div onClick={handleClick}>{children}</div>;
}
