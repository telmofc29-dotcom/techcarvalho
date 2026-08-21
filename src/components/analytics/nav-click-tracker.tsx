"use client";

import type { ReactNode, MouseEvent } from "react";
import { track } from "@/lib/analytics";

// Delegated navigation_click tracking for the site header's primary and
// mobile nav link lists — navigation_click was defined in the event
// taxonomy (src/lib/analytics/events.ts) but had zero call sites before
// this. Same event-delegation approach as InternalLinkTracker/
// RelatedContentTracker/SearchTracker.
export function NavClickTracker({ children }: { children: ReactNode }) {
  function handleClick(event: MouseEvent<HTMLElement>) {
    const target = event.target as HTMLElement;
    const anchor = target.closest("a");
    const href = anchor?.getAttribute("href");
    if (!href) return;
    const label = anchor?.textContent?.trim() || undefined;
    track("navigation_click", { link_position: "nav", destination: href, label });
  }

  return (
    <div onClick={handleClick} className="contents">
      {children}
    </div>
  );
}
