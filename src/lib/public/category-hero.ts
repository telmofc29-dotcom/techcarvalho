import "server-only";
import { cache } from "react";
import { createClient } from "@/lib/supabase/server";
import { mediaPublicUrl } from "@/lib/media/public-url";
import { logQueryError } from "@/lib/log/query-error";
import type { HeroImage } from "./hero-image";

// Category banner imagery.
//
// Looks for a published media asset tagged asset_role='category_hero' whose
// alt text or caption names the category. No such assets exist yet — the
// Phase 5 media-acquisition work is what will create them — so this is
// expected to return null for now, and every caller must have a real visual
// fallback rather than a blank banner.
//
// Deliberately matched on alt/caption text rather than a category_id column:
// media_assets has no category association, and adding one purely to decorate
// a banner would be a schema change carrying an ongoing sync burden for very
// little. If banner assets become numerous enough that text matching is
// fragile, that is the moment to add the column — not before.
export const getCategoryHeroImage = cache(
  async (categorySlug: string, categoryName: string): Promise<HeroImage | null> => {
    const supabase = await createClient();

    const { data, error } = await supabase
      .from("media_assets")
      .select("alt_text, caption, public_storage_path, publication_status, asset_role")
      .eq("asset_role", "category_hero")
      .eq("publication_status", "published")
      .limit(50);
    logQueryError(`getCategoryHeroImage(${categorySlug})`, error);
    if (!data || data.length === 0) return null;

    const needles = [categorySlug.replace(/-/g, " "), categoryName].map((s) => s.toLowerCase());
    const match = data.find((asset) => {
      const haystack = `${asset.alt_text ?? ""} ${asset.caption ?? ""}`.toLowerCase();
      return needles.some((n) => n.length > 2 && haystack.includes(n));
    });

    if (!match?.public_storage_path) return null;
    return { url: mediaPublicUrl(match.public_storage_path), alt: match.alt_text };
  }
);

/**
 * Deterministic gradient for a category, used when no banner asset exists.
 *
 * Keyed on the slug so a category always gets the same treatment, and drawn
 * from the site's own palette so it reads as designed rather than as a missing
 * image. This is decoration, never a claim that an image exists.
 */
export function categoryGradient(slug: string): string {
  const gradients: Record<string, string> = {
    "cameras-photography": "from-amber-500/25 via-orange-400/15 to-transparent",
    astrophotography: "from-indigo-600/30 via-violet-500/15 to-transparent",
    "drones-fpv": "from-sky-500/25 via-cyan-400/15 to-transparent",
    "action-cameras": "from-rose-500/25 via-orange-400/15 to-transparent",
    computing: "from-blue-600/25 via-indigo-400/15 to-transparent",
    networking: "from-teal-500/25 via-emerald-400/15 to-transparent",
    gaming: "from-violet-600/25 via-fuchsia-500/15 to-transparent",
    smartphones: "from-emerald-500/25 via-teal-400/15 to-transparent",
    "ai-hardware": "from-pink-500/25 via-purple-400/15 to-transparent",
    "smart-home-robots": "from-lime-500/25 via-green-400/15 to-transparent",
  };
  return gradients[slug] ?? "from-accent/20 via-accent-soft/40 to-transparent";
}
