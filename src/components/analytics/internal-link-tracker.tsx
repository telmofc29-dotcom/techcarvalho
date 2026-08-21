"use client";

import type { ReactNode, MouseEvent } from "react";
import { track } from "@/lib/analytics";
import type { LinkPosition } from "@/lib/analytics/events";

// Delegated internal_link_click tracking for a block of links (product/
// content cards, category/subcategory/manufacturer chip links) — same
// minimal-client-JS event-delegation approach as RelatedContentTracker and
// SearchTracker (one listener for the whole block, no per-card client
// component). Entity context is read from a data-entity-type/data-entity-id
// pair on the nearest ancestor marker element carrying them, so
// ProductCard/ContentCard/plain <Link> chips never need new props.
//
// `categorySlug` is a page-level default (e.g. "this block lives on the
// Cameras & Photography category page") applied to every click in this
// block; a marker's own data-category-slug (used for category/subcategory
// links, which have no product/content/manufacturer id of their own)
// overrides it, since in that case the category slug IS the thing that
// was clicked, not just page context.
export function InternalLinkTracker({
  linkPosition,
  categorySlug,
  children,
}: {
  linkPosition: LinkPosition;
  categorySlug?: string;
  children: ReactNode;
}) {
  function handleClick(event: MouseEvent<HTMLDivElement>) {
    const target = event.target as HTMLElement;
    const anchor = target.closest("a");
    const href = anchor?.getAttribute("href");
    if (!href) return;

    const marker = target.closest<HTMLElement>("[data-entity-type]");
    const entityType = marker?.getAttribute("data-entity-type");
    const entityId = marker?.getAttribute("data-entity-id") ?? undefined;
    const markerCategorySlug = marker?.getAttribute("data-category-slug") ?? undefined;

    track("internal_link_click", {
      destination: href,
      link_position: linkPosition,
      product_id: entityType === "product" ? entityId : undefined,
      content_id: entityType === "content" ? entityId : undefined,
      manufacturer_id: entityType === "manufacturer" ? entityId : undefined,
      category_slug: markerCategorySlug ?? categorySlug,
    });
  }

  return <div onClick={handleClick}>{children}</div>;
}
