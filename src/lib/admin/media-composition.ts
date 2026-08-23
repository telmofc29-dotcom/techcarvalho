import "server-only";
import { createClient } from "@/lib/supabase/server";

// What is the media library actually MADE OF?
//
// WHY THIS EXISTS
// ---------------
// Every report on this project said "112 media assets", and the owner looking
// at /admin/media could not see 112 images. The audit settled the arithmetic —
// 112 rows, 112 distinct storage paths, 112 objects that genuinely exist, no
// duplicates, no broken files, shown 25 to a page across 5 pages — so the count
// was accurate.
//
// It was also useless. "112 assets" says nothing about whether the site has
// pictures of the things it writes about, and the honest breakdown is
// uncomfortable: 65 of the 112 are generated graphics, 39 are third-party
// Creative Commons photographs, 8 are logos, and ZERO are photographs this site
// took. That composition is exactly why the homepage looks synthetic, and no
// row count could have revealed it.
//
// So the admin shows the composition, not the total. A number that cannot
// change your mind is not worth displaying.
//
// Every query checks its own error and throws — an empty result here would
// render "0 generated graphics", which reads as good news.

export type MediaComposition = {
  records: number;
  distinctPaths: number;
  /** Photographs of real things: not generated, not a logo, not a diagram. */
  photographs: number;
  /** Ours. The number that matters most and is currently zero. */
  ownedPhotographs: number;
  /** Generated title cards, charts, diagrams, comparison graphics. */
  generated: number;
  logos: number;
  published: number;
  /** Rows attached to neither a product nor an article. */
  unattached: number;
};

const GENERATED_SOURCE_TYPES = new Set(["tc_graphic"]);
const GRAPHIC_ROLES = new Set(["diagram", "chart", "comparison_graphic"]);

export async function getMediaComposition(): Promise<MediaComposition> {
  const supabase = await createClient();

  const [assetsRes, productLinkRes, contentLinkRes] = await Promise.all([
    supabase.from("media_assets").select("id, storage_path, source_type, asset_role, brand_role, publication_status"),
    supabase.from("product_media").select("media_id"),
    supabase.from("content_media").select("media_id"),
  ]);
  for (const [label, res] of [
    ["media_assets", assetsRes],
    ["product_media", productLinkRes],
    ["content_media", contentLinkRes],
  ] as const) {
    if (res.error) throw new Error(`media composition: reading ${label} failed — ${res.error.message}`);
    if (res.data === null) throw new Error(`media composition: ${label} returned null rather than rows`);
  }

  const assets = assetsRes.data as {
    id: string; storage_path: string; source_type: string | null;
    asset_role: string | null; brand_role: string | null; publication_status: string;
  }[];

  const attached = new Set<string>();
  for (const r of productLinkRes.data as { media_id: string }[]) attached.add(r.media_id);
  for (const r of contentLinkRes.data as { media_id: string }[]) attached.add(r.media_id);

  const isLogo = (a: (typeof assets)[number]) =>
    a.brand_role !== null || a.asset_role === "logo_brand" || a.asset_role === "icon";
  const isGenerated = (a: (typeof assets)[number]) =>
    GENERATED_SOURCE_TYPES.has(a.source_type ?? "") || GRAPHIC_ROLES.has(a.asset_role ?? "");
  const isPhotograph = (a: (typeof assets)[number]) => !isLogo(a) && !isGenerated(a);

  return {
    records: assets.length,
    distinctPaths: new Set(assets.map((a) => a.storage_path)).size,
    photographs: assets.filter(isPhotograph).length,
    ownedPhotographs: assets.filter((a) => a.source_type === "staff_photograph").length,
    generated: assets.filter(isGenerated).length,
    logos: assets.filter(isLogo).length,
    published: assets.filter((a) => a.publication_status === "published").length,
    unattached: assets.filter((a) => !attached.has(a.id)).length,
  };
}
