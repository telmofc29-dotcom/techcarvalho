"use client";

import Link from "next/link";
import type { ReactNode } from "react";
import { track } from "@/lib/analytics";
import type { LinkPosition } from "@/lib/analytics/events";

// For the small number of genuinely distinct calls-to-action on the site
// (e.g. homepage's "View all articles/guides/products" section links) —
// deliberately not wired onto every button, per the directive's explicit
// "meaningful interactions, not every DOM click." Direct onClick, same as
// TrackedLink, since these are single, non-repeated links.
export function CtaLink({
  href,
  ctaId,
  linkPosition,
  className,
  children,
}: {
  href: string;
  ctaId: string;
  linkPosition: LinkPosition;
  className?: string;
  children: ReactNode;
}) {
  return (
    <Link href={href} className={className} onClick={() => track("cta_click", { cta_id: ctaId, link_position: linkPosition, destination: href })}>
      {children}
    </Link>
  );
}
