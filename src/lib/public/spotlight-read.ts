import "server-only";

// READING THE CURRENT ROTATION, on the public path.
//
// The homepage asks for today's front page. If the nightly stage recorded one,
// that is what it gets — the same answer all day, for every visitor. If not, it
// falls back to the existing `public_homepage_selection` ranking.
//
// THE FALLBACK IS NOT A DETAIL. Until the rotation migration is applied there
// is no recorded rotation at all, and a homepage that renders empty because a
// migration is pending would be a far worse outcome than one that rotates less.
// The site keeps working; it simply does not yet rotate.
//
// `source` travels with the result so the admin view can say which of those two
// worlds it is in, rather than leaving someone to wonder why the front page
// looks static.

import { cache } from "react";
import { createClient } from "@/lib/supabase/server";
import { logQueryError } from "@/lib/log/query-error";

export type SpotlightEntry = {
  contentId: string;
  slug: string;
  title: string;
  contentType: string | null;
  categorySlug: string | null;
  publishedAt: string;
  role: "lead" | "supporting";
};

export type SpotlightRead = {
  entries: SpotlightEntry[];
  /**
   * `rotation` — a recorded daily rotation, stable for the day.
   * `ranking`  — the fallback, ordered purely by score.
   */
  source: "rotation" | "ranking";
  rotationAvailable: boolean;
  note: string | null;
};

/**
 * Today's front page.
 *
 * Wrapped in React's `cache` so a single render asks once, matching how
 * getTrendingContent already behaves.
 */
export const getSpotlight = cache(async (supporting = 4): Promise<SpotlightRead> => {
  const supabase = await createClient();

  const { data, error } = await supabase.rpc("public_spotlight", { p_rotation_date: null });

  if (!error && Array.isArray(data) && data.length > 0) {
    return {
      entries: (data as unknown as {
        content_id: string;
        slug: string;
        title: string;
        content_type: string | null;
        category_slug: string | null;
        published_at: string;
        role: string;
      }[]).map((r) => ({
        contentId: r.content_id,
        slug: r.slug,
        title: r.title,
        contentType: r.content_type,
        categorySlug: r.category_slug,
        publishedAt: r.published_at,
        role: r.role === "lead" ? "lead" : "supporting",
      })),
      source: "rotation",
      rotationAvailable: true,
      note: null,
    };
  }

  // Distinguish "not deployed" from "deployed and broken". Only the second is
  // worth logging as a failure — the first is the expected state until the
  // owner applies the migration.
  const notDeployed =
    !!error && /PGRST202|could not find the function/i.test(error.message);
  if (error && !notDeployed) {
    logQueryError("getSpotlight public_spotlight", error);
  }

  const fallback = await supabase.rpc("public_homepage_selection", { p_supporting: supporting });
  if (fallback.error) {
    logQueryError("getSpotlight fallback", fallback.error);
    return {
      entries: [],
      source: "ranking",
      rotationAvailable: false,
      note: "Neither the rotation nor the ranking could be read.",
    };
  }

  return {
    entries: (fallback.data ?? []).map((r: {
      content_id: string;
      slug: string;
      title: string;
      content_type: string | null;
      category_slug: string | null;
      published_at: string;
      role: string;
    }) => ({
      contentId: r.content_id,
      slug: r.slug,
      title: r.title,
      contentType: r.content_type,
      categorySlug: r.category_slug,
      publishedAt: r.published_at,
      role: r.role === "lead" ? "lead" : "supporting",
    })),
    source: "ranking",
    rotationAvailable: false,
    note: notDeployed
      ? "Daily rotation is not deployed yet, so the front page is ordered by score alone and does not rotate."
      : "No rotation has been recorded yet; showing the ranking.",
  };
});
