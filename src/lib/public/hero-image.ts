import "server-only";
import { createClient } from "@/lib/supabase/server";
import { mediaPublicUrl } from "@/lib/media/public-url";
import { logQueryError } from "@/lib/log/query-error";

export type HeroImage = { url: string; alt: string | null };

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
      .select("alt_text, publication_status, public_storage_path")
      .eq("id", link.media_id)
      .maybeSingle();
    if (assetError) logQueryError(`getPublishedHeroImage(${kind}, ${id}) asset`, assetError);
    if (assetError || !asset) return null;
    if (asset.publication_status !== "published" || !asset.public_storage_path) return null;

    return { url: mediaPublicUrl(asset.public_storage_path), alt: asset.alt_text };
  } catch (e) {
    console.error(`[query-error] getPublishedHeroImage(${kind}, ${id}) threw`, e);
    return null;
  }
}
