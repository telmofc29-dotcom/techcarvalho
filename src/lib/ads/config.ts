// Central ad configuration. No fake/placeholder publisher ID is ever
// defined here — until NEXT_PUBLIC_ADSENSE_PUBLISHER_ID is set in the
// deployment environment, every placement stays inert (reserved space, no
// ad network script, no ad markup). See docs/adsense-setup.md for what has
// to happen (an AdSense account, manual approval, ads.txt) before this can
// go live.

export const ADSENSE_PUBLISHER_ID = process.env.NEXT_PUBLIC_ADSENSE_PUBLISHER_ID;
export const ADS_ENABLED = process.env.NEXT_PUBLIC_ADS_ENABLED === "true" && Boolean(ADSENSE_PUBLISHER_ID);

export type AdPlacementId = "article_top" | "article_end" | "sidebar" | "category_page";

// One row per placement this codebase is allowed to render. Adding a new
// placement means adding it here first — components never invent a
// placement id inline. `reservedHeight` keeps layout stable (avoids CLS)
// whether or not an ad ever actually renders in that slot.
export const AD_PLACEMENTS: Record<AdPlacementId, { label: string; reservedHeight: number; maxWidth: number }> = {
  article_top: { label: "Article top", reservedHeight: 250, maxWidth: 728 },
  article_end: { label: "Article end", reservedHeight: 250, maxWidth: 728 },
  sidebar: { label: "Sidebar", reservedHeight: 600, maxWidth: 300 },
  category_page: { label: "Category page", reservedHeight: 250, maxWidth: 728 },
};

export function isValidPlacement(id: string): id is AdPlacementId {
  return id in AD_PLACEMENTS;
}
