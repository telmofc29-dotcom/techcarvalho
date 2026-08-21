import "server-only";
import { cache } from "react";
import { createClient } from "@/lib/supabase/server";
import { attachHeroImages, type HeroImage } from "./hero-image";
import { mediaPublicUrl } from "@/lib/media/public-url";
import { logQueryError } from "@/lib/log/query-error";

export type ManufacturerDetail = {
  manufacturer: { id: string; name: string; slug: string; website: string | null; description: string | null };
  logo: HeroImage | null;
  products: {
    id: string;
    name: string;
    slug: string;
    summary: string | null;
    status: string;
    family_id: string | null;
    heroImage: HeroImage | null;
  }[];
  families: { id: string; name: string; slug: string }[];
};

// manufacturers is world-readable reference data (no publish gating) per
// the applied RLS — but its products are only shown here if published,
// same as everywhere else on the public site. Product families have no
// direct manufacturer_id column in the schema, so "families" here is
// derived from the distinct families actually used by this manufacturer's
// published products — real data, not a fabricated relationship.
// Cached per-request — see product-detail.ts for why.
export const getManufacturerDetail = cache(async (slug: string): Promise<ManufacturerDetail | null> => {
  const supabase = await createClient();

  const { data: manufacturer, error: manufacturerError } = await supabase
    .from("manufacturers")
    .select("id, name, slug, website, description, logo_media_id")
    .eq("slug", slug)
    .maybeSingle();
  logQueryError(`getManufacturerDetail(${slug}) manufacturer`, manufacturerError);

  if (!manufacturer) return null;

  const [{ data: products, error: productsError }, logo] = await Promise.all([
    supabase
      .from("products")
      .select("id, name, slug, summary, status, family_id")
      .eq("manufacturer_id", manufacturer.id)
      .eq("is_published", true)
      .order("name"),
    getLogoImage(supabase, manufacturer.logo_media_id),
  ]);
  logQueryError(`getManufacturerDetail(${slug}) products`, productsError);

  const familyIds = [...new Set((products ?? []).map((p) => p.family_id).filter((id): id is string => Boolean(id)))];
  const { data: families, error: familiesError } =
    familyIds.length > 0
      ? await supabase.from("product_families").select("id, name, slug").in("id", familyIds).order("name")
      : { data: [], error: null };
  logQueryError(`getManufacturerDetail(${slug}) families`, familiesError);

  const productsWithImages = await attachHeroImages(supabase, products ?? [], "product");

  return {
    manufacturer: {
      id: manufacturer.id,
      name: manufacturer.name,
      slug: manufacturer.slug,
      website: manufacturer.website,
      description: manufacturer.description,
    },
    logo,
    products: productsWithImages,
    families: families ?? [],
  };
});

// Same publication-gating discipline as getPublishedHeroImage — a
// logo_media_id that points at a private/unpublished asset (e.g. mid
// rights-review) must never leak onto the public site just because the
// admin has already linked it.
async function getLogoImage(
  supabase: Awaited<ReturnType<typeof createClient>>,
  logoMediaId: string | null
): Promise<HeroImage | null> {
  if (!logoMediaId) return null;
  const { data: asset, error } = await supabase
    .from("media_assets")
    .select("alt_text, publication_status, public_storage_path")
    .eq("id", logoMediaId)
    .maybeSingle();
  logQueryError(`getLogoImage(${logoMediaId})`, error);
  if (!asset || asset.publication_status !== "published" || !asset.public_storage_path) return null;
  return { url: mediaPublicUrl(asset.public_storage_path), alt: asset.alt_text };
}
