import "server-only";
import { createClient } from "@/lib/supabase/server";
import { mediaPublicUrl } from "@/lib/media/public-url";
import { logQueryError } from "@/lib/log/query-error";
import type { MediaSourceType } from "@/lib/types/database";

// Provenance travels with the hero image because the PAGE has to disclose it.
// See src/lib/media/presentation.ts: a TechCarvalho original graphic occupying
// the hero slot must be labelled as a graphic, and a required credit line must
// actually reach the reader. Both are impossible if the query drops these
// columns, so they are part of the type rather than an optional extra lookup.
// Optional so the many call sites that only need url+alt are unaffected.
export type HeroImage = {
  url: string;
  alt: string | null;
  sourceType?: MediaSourceType | null;
  owned?: boolean;
  aiGenerated?: boolean;
  attribution?: string | null;
  attributionRequired?: boolean;
  creator?: string | null;
  sourceUrl?: string | null;
};

export type GalleryImage = {
  url: string;
  alt: string | null;
  caption: string | null;
  attribution: string | null;
  attributionRequired: boolean;
  creator: string | null;
  sourceUrl: string | null;
};

// Degrades to "no image" on any error rather than crashing product/article
// pages — a missing hero image link, a media row deleted out from under a
// stale join, etc. should never take down the page it's decorating. Errors
// are still logged server-side so a real failure doesn't look identical to
// "this product just has no hero image".
export async function getPublishedHeroImage(
  kind: "product" | "content",
  id: string
): Promise<HeroImage | null> {
  const supabase = await createClient();

  try {
    const { data: link, error: linkError } =
      kind === "product"
        ? await supabase.from("product_media").select("media_id").eq("product_id", id).eq("role", "hero").limit(1).maybeSingle()
        : await supabase.from("content_media").select("media_id").eq("content_id", id).eq("role", "hero").limit(1).maybeSingle();
    if (linkError) logQueryError(`getPublishedHeroImage(${kind}, ${id}) link`, linkError);
    if (linkError || !link) return null;

    const { data: asset, error: assetError } = await supabase
      .from("media_assets")
      .select(
        "alt_text, publication_status, public_storage_path, source_type, owned, ai_generated, attribution, attribution_required, creator, source_url"
      )
      .eq("id", link.media_id)
      .maybeSingle();
    if (assetError) logQueryError(`getPublishedHeroImage(${kind}, ${id}) asset`, assetError);
    if (assetError || !asset) return null;
    if (asset.publication_status !== "published" || !asset.public_storage_path) return null;

    return {
      url: mediaPublicUrl(asset.public_storage_path),
      alt: asset.alt_text,
      sourceType: asset.source_type,
      owned: asset.owned,
      aiGenerated: asset.ai_generated,
      attribution: asset.attribution,
      attributionRequired: asset.attribution_required,
      creator: asset.creator,
    };
  } catch (e) {
    console.error(`[query-error] getPublishedHeroImage(${kind}, ${id}) threw`, e);
    return null;
  }
}

// Batched hero-image lookup for LIST pages (homepage rails, category/
// products/articles indexes, search results, manufacturer product lists,
// related-item rails) — one query pair for the whole list rather than
// calling getPublishedHeroImage per row, same fixed-round-trip-count
// discipline as attachExcerpts in ./excerpt.ts. Rows with no hero (or an
// unpublished/deleted one) get heroImage: null, never an error.
export async function attachHeroImages<T extends { id: string }>(
  supabase: Awaited<ReturnType<typeof createClient>>,
  rows: T[],
  kind: "product" | "content"
): Promise<(T & { heroImage: HeroImage | null })[]> {
  if (rows.length === 0) return [];
  const ids = rows.map((r) => r.id);

  try {
    const linksResult =
      kind === "product"
        ? await supabase.from("product_media").select("product_id, media_id").in("product_id", ids).eq("role", "hero")
        : await supabase.from("content_media").select("content_id, media_id").in("content_id", ids).eq("role", "hero");
    logQueryError(`attachHeroImages(${kind}) links`, linksResult.error);

    const links: { entityId: string; media_id: string }[] = (linksResult.data ?? []).map((l) =>
      kind === "product"
        ? { entityId: (l as { product_id: string; media_id: string }).product_id, media_id: l.media_id }
        : { entityId: (l as { content_id: string; media_id: string }).content_id, media_id: l.media_id }
    );
    if (links.length === 0) return rows.map((r) => ({ ...r, heroImage: null }));

    const mediaIds = [...new Set(links.map((l) => l.media_id))];
    const { data: assets, error: assetError } = await supabase
      .from("media_assets")
      .select("id, alt_text, publication_status, public_storage_path")
      .in("id", mediaIds);
    logQueryError(`attachHeroImages(${kind}) assets`, assetError);

    const assetById = new Map((assets ?? []).map((a) => [a.id, a]));
    const heroByEntityId = new Map<string, HeroImage>();
    for (const link of links) {
      if (heroByEntityId.has(link.entityId)) continue;
      const asset = assetById.get(link.media_id);
      if (!asset || asset.publication_status !== "published" || !asset.public_storage_path) continue;
      heroByEntityId.set(link.entityId, { url: mediaPublicUrl(asset.public_storage_path), alt: asset.alt_text });
    }

    return rows.map((r) => ({ ...r, heroImage: heroByEntityId.get(r.id) ?? null }));
  } catch (e) {
    console.error(`[query-error] attachHeroImages(${kind}) threw`, e);
    return rows.map((r) => ({ ...r, heroImage: null }));
  }
}

// Detail-page gallery: role='gallery' only (deliberately excludes 'hero' —
// the hero image is already shown separately/prominently by
// getPublishedHeroImage, so including it here would show it twice),
// ordered by sort_order. Carries caption/attribution so a required credit
// is never silently dropped on the page that actually needs it.
export async function getPublishedGallery(kind: "product" | "content", id: string): Promise<GalleryImage[]> {
  const supabase = await createClient();

  try {
    const linksResult =
      kind === "product"
        ? await supabase.from("product_media").select("media_id, sort_order").eq("product_id", id).eq("role", "gallery").order("sort_order")
        : await supabase.from("content_media").select("media_id, sort_order").eq("content_id", id).eq("role", "gallery").order("sort_order");
    logQueryError(`getPublishedGallery(${kind}, ${id}) links`, linksResult.error);
    const links = linksResult.data ?? [];
    if (links.length === 0) return [];

    const mediaIds = links.map((l) => l.media_id);
    const { data: assets, error: assetError } = await supabase
      .from("media_assets")
      .select("id, alt_text, caption, attribution, attribution_required, creator, source_url, publication_status, public_storage_path")
      .in("id", mediaIds);
    logQueryError(`getPublishedGallery(${kind}, ${id}) assets`, assetError);

    const assetById = new Map((assets ?? []).map((a) => [a.id, a]));
    const images: GalleryImage[] = [];
    for (const link of links) {
      const asset = assetById.get(link.media_id);
      if (!asset || asset.publication_status !== "published" || !asset.public_storage_path) continue;
      images.push({
        url: mediaPublicUrl(asset.public_storage_path),
        alt: asset.alt_text,
        caption: asset.caption,
        attribution: asset.attribution,
        attributionRequired: asset.attribution_required,
        creator: asset.creator,
        sourceUrl: asset.source_url,
      });
    }
    return images;
  } catch (e) {
    console.error(`[query-error] getPublishedGallery(${kind}, ${id}) threw`, e);
    return [];
  }
}
