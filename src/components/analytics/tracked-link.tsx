"use client";

import Link from "next/link";
import type { ReactNode } from "react";
import { track } from "@/lib/analytics";
import type { LinkPosition } from "@/lib/analytics/events";

// For a single, non-repeated link (e.g. a product detail page's link to
// its manufacturer) where the event-delegation wrapper pattern used for
// grids/lists (InternalLinkTracker) would be unnecessary indirection for
// exactly one anchor. Fires internal_link_click directly on click.
export function TrackedLink({
  href,
  linkPosition,
  productId,
  contentId,
  manufacturerId,
  categorySlug,
  className,
  children,
}: {
  href: string;
  linkPosition: LinkPosition;
  productId?: string;
  contentId?: string;
  manufacturerId?: string;
  categorySlug?: string;
  className?: string;
  children: ReactNode;
}) {
  return (
    <Link
      href={href}
      className={className}
      onClick={() =>
        track("internal_link_click", {
          destination: href,
          link_position: linkPosition,
          product_id: productId,
          content_id: contentId,
          manufacturer_id: manufacturerId,
          category_slug: categorySlug,
        })
      }
    >
      {children}
    </Link>
  );
}
