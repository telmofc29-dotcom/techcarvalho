import "server-only";
import { cache } from "react";
import { createClient } from "@/lib/supabase/server";
import { attachHeroImages, type HeroImage } from "./hero-image";
import { attachExcerpts } from "./excerpt";
import { mediaPublicUrl } from "@/lib/media/public-url";
import { logQueryError } from "@/lib/log/query-error";

export type ManufacturerArticle = {
  id: string;
  title: string;
  slug: string;
  type: string;
  published_at: string | null;
  excerpt: string | null;
  heroImage: HeroImage | null;
};

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
  /** Published articles tagged with this brand. See getBrandArticles for the sourcing rule. */
  articles: ManufacturerArticle[];
  /** Newest real timestamp among the rows this hub lists. Null when it lists nothing. */
  lastModified: string | null;
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

  const [{ data: products, error: productsError }, logo, articles] = await Promise.all([
    supabase
      .from("products")
      .select("id, name, slug, summary, status, family_id, updated_at")
      .eq("manufacturer_id", manufacturer.id)
      .eq("is_published", true)
      .order("name"),
    getLogoImage(supabase, manufacturer.logo_media_id),
    getBrandArticles(supabase, manufacturer.slug),
  ]);
  logQueryError(`getManufacturerDetail(${slug}) products`, productsError);

  const familyIds = [...new Set((products ?? []).map((p) => p.family_id).filter((id): id is string => Boolean(id)))];
  const { data: families, error: familiesError } =
    familyIds.length > 0
      ? await supabase.from("product_families").select("id, name, slug").in("id", familyIds).order("name")
      : { data: [], error: null };
  logQueryError(`getManufacturerDetail(${slug}) families`, familiesError);

  const productsWithImages = await attachHeroImages(supabase, products ?? [], "product");

  const timestamps = [...(products ?? []).map((p) => p.updated_at), ...articles.map((a) => a.updated_at)];

  return {
    manufacturer: {
      id: manufacturer.id,
      name: manufacturer.name,
      slug: manufacturer.slug,
      website: manufacturer.website,
      description: manufacturer.description,
    },
    logo,
    // `updated_at` is fetched purely to derive `lastModified` above and is
    // mapped off here rather than leaking into the view model.
    products: productsWithImages.map((p) => ({
      id: p.id,
      name: p.name,
      slug: p.slug,
      summary: p.summary,
      status: p.status,
      family_id: p.family_id,
      heroImage: p.heroImage,
    })),
    families: families ?? [],
    articles: articles.map((a) => ({
      id: a.id,
      title: a.title,
      slug: a.slug,
      type: a.type,
      published_at: a.published_at,
      excerpt: a.excerpt,
      heroImage: a.heroImage,
    })),
    lastModified: timestamps.length > 0 ? timestamps.reduce((a, b) => (a > b ? a : b)) : null,
  };
});

// The brand's published coverage.
//
// WHY THE TAG AND NOT content_products. The obvious source is "articles linked
// to this manufacturer's products", and as an admin that returns real numbers
// (NVIDIA: 9, Sony: 9, DJI: 6). As `anon` it returns almost nothing, because
// content_products is only readable when BOTH sides are published
// ("public can read content-product links when both published",
// 20260819202305_rls_policies.sql) and this catalogue is 6-of-44 published.
// Verified directly against production with an anon client: 9 of 123 rows
// visible, all Canon. A hub built on that source would have rendered an empty
// state on every brand page while looking correct in every admin preview —
// precisely the "failure that looks like empty" this project has been bitten
// by before.
//
// content_tags, by contrast, is readable for any published piece (all 250 rows
// visible to anon), so the brand tag is the only source that actually works
// from the public side today. It is also the more honest signal: an editor
// tagging a piece "Canon" is asserting the piece is about Canon, whereas a
// `mentioned` content_products row can be a passing reference.
//
// The tag is matched by SLUG EQUALITY with the manufacturer — no hand-written
// manufacturer-to-tag mapping table. A mapping would be a place for someone to
// later write "DJI → drone", which would silently claim every drone article as
// DJI coverage. The cost of refusing that is real and is documented rather than
// papered over: brands whose tag doesn't exist (Sony, Microsoft, DJI, GoPro,
// TP-Link, Roborock, Amazon) get no coverage list, and their hubs stay thin
// until someone creates the tag. That is a content decision, correctly left to
// an editor.
async function getBrandArticles(
  supabase: Awaited<ReturnType<typeof createClient>>,
  manufacturerSlug: string
): Promise<(ManufacturerArticle & { updated_at: string })[]> {
  const { data: tag, error: tagError } = await supabase
    .from("taxonomy_tags")
    .select("id")
    .eq("slug", manufacturerSlug)
    .maybeSingle();
  logQueryError(`getBrandArticles(${manufacturerSlug}) tag`, tagError);
  if (!tag) return [];

  const { data: links, error: linksError } = await supabase
    .from("content_tags")
    .select("content_id")
    .eq("tag_id", tag.id);
  logQueryError(`getBrandArticles(${manufacturerSlug}) links`, linksError);

  const contentIds = [...new Set((links ?? []).map((l) => l.content_id))];
  if (contentIds.length === 0) return [];

  const { data: rows, error: rowsError } = await supabase
    .from("content_items")
    .select("id, title, slug, type, published_at, updated_at")
    .in("id", contentIds)
    .eq("status", "published")
    .lte("published_at", new Date().toISOString())
    .order("published_at", { ascending: false });
  logQueryError(`getBrandArticles(${manufacturerSlug}) rows`, rowsError);
  if (!rows || rows.length === 0) return [];

  const withExcerpts = await attachExcerpts(supabase, rows);
  const withImages = await attachHeroImages(supabase, withExcerpts, "content");
  return withImages;
}

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
