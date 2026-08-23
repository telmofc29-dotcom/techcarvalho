import "server-only";
import { cache } from "react";
import { createClient } from "@/lib/supabase/server";
import { getPublishedHeroImage, attachHeroImages, type HeroImage } from "./hero-image";
import { logQueryError } from "@/lib/log/query-error";
import type { RelationshipType } from "@/lib/types/database";
import { ROOT_LOCALE } from "@/lib/i18n/locales";

export type RelatedProduct = {
  label: string;
  product: { id: string; name: string; slug: string; summary: string | null; heroImage: HeroImage | null };
};

export type ProductOffer = {
  id: string;
  retailer: string;
  url: string;
  affiliate_status: "affiliate" | "non_affiliate" | "pending";
  price_note: string | null;
};

// From product_launch_pricing (see
// supabase/migrations_pending/20260821_product_launch_pricing.sql — not yet
// applied to production). Distinct from ProductOffer above: this is
// historical launch MSRP per currency, not a current retailer offer.
export type LaunchPricing = {
  currency: "USD" | "GBP" | "EUR";
  amount: number;
  is_estimated: boolean;
};

export type ProductDetail = {
  product: {
    id: string;
    name: string;
    slug: string;
    model_number: string | null;
    release_date: string | null;
    status: string;
    summary: string | null;
    updated_at: string;
  };
  manufacturer: { name: string; slug: string } | null;
  family: { name: string; slug: string } | null;
  category: { id: string; name: string; slug: string } | null;
  specs: { name: string; unit: string | null; value: unknown }[];
  tags: { name: string; slug: string }[];
  related: RelatedProduct[];
  articles: { id: string; title: string; slug: string; type: string; role: string; heroImage: HeroImage | null }[];
  heroImage: HeroImage | null;
  // seo_metadata row for this product, when an editor has created one. The
  // admin product form has written meta_title/meta_description/canonical_url/
  // noindex to this table since the table existed, but nothing on the public
  // side ever read it back for products — an editor ticking "noindex" got a
  // page that still rendered `index, follow`. generateMetadata() consumes it.
  seo: { meta_title: string | null; meta_description: string | null; canonical_url: string | null; noindex: boolean } | null;
  offers: ProductOffer[];
  launchPricing: LaunchPricing[];
  freshness: { reviewed_at: string; reason: string }[];
  // Counts only — the public page shows "N sources cited" rather than
  // reproducing the admin's full source/evidence editing UI.
  sourceCount: number;
  evidenceCount: number;
};

const FORWARD_LABELS: Record<RelationshipType, string> = {
  successor_of: "Predecessor",
  alternative_to: "Alternative",
  accessory_for: "Accessory for",
  compatible_with: "Compatible with",
  requires: "Requires",
  // Added with 20260827_knowledge_graph.sql. The pair must stay coherent:
  // relationships are stored one-directional and the reverse is inferred, so
  // every label here needs a REVERSE_LABELS counterpart that reads correctly
  // from the other product's page. Symmetric kinds use the same word twice.
  same_family: "Same family",
  modern_equivalent: "Modern equivalent",
  mount_successor: "Earlier mount version",
  requires_adapter: "Requires an adapter for",
  supports_extender: "Supports extender",
  competes_with: "Competes with",
};

const REVERSE_LABELS: Record<RelationshipType, string> = {
  successor_of: "Successor",
  alternative_to: "Alternative",
  accessory_for: "Accessories",
  compatible_with: "Compatible with",
  requires: "Required by",
  same_family: "Same family",
  modern_equivalent: "Earlier equivalent",
  mount_successor: "Newer mount version",
  requires_adapter: "Adapts to",
  supports_extender: "Extender for",
  competes_with: "Competes with",
};

// Cached per-request: generateMetadata() and the page component both need
// the same product, and without this each request would query it twice.
export const getProductDetail = cache(async (slug: string): Promise<ProductDetail | null> => {
  const supabase = await createClient();

  const { data: product, error: productError } = await supabase
    .from("products")
    .select("id, name, slug, model_number, release_date, status, summary, updated_at, manufacturer_id, category_id, family_id")
    .eq("slug", slug)
    .eq("is_published", true)
    .maybeSingle();
  logQueryError(`getProductDetail(${slug}) product`, productError);

  if (!product) return null;

  // Round trip 1: everything that only depends on the product row itself.
  const [
    { data: manufacturer, error: manufacturerError },
    { data: family, error: familyError },
    { data: category, error: categoryError },
    { data: specRows, error: specRowsError },
    { data: tagRows, error: tagRowsError },
    { data: outgoingRel, error: outgoingRelError },
    { data: incomingRel, error: incomingRelError },
    { data: contentLinks, error: contentLinksError },
    { data: offers, error: offersError },
    { data: launchPricingRows, error: launchPricingError },
    { data: freshnessRows, error: freshnessError },
    { data: seo, error: seoError },
    { count: sourceCount, error: sourceCountError },
    { count: evidenceCount, error: evidenceCountError },
    heroImage,
  ] = await Promise.all([
    supabase.from("manufacturers").select("name, slug").eq("id", product.manufacturer_id).maybeSingle(),
    product.family_id
      ? supabase.from("product_families").select("name, slug").eq("id", product.family_id).maybeSingle()
      : Promise.resolve({ data: null, error: null }),
    supabase.from("taxonomy_categories").select("id, name, slug").eq("id", product.category_id).maybeSingle(),
    supabase.from("product_specs").select("spec_definition_id, value").eq("product_id", product.id),
    supabase.from("product_tags").select("tag_id").eq("product_id", product.id),
    supabase
      .from("product_relationships")
      .select("related_product_id, relationship_type")
      .eq("product_id", product.id),
    supabase
      .from("product_relationships")
      .select("product_id, relationship_type")
      .eq("related_product_id", product.id),
    supabase.from("content_products").select("content_id, role").eq("product_id", product.id),
    supabase
      .from("product_offers")
      .select("id, retailer, url, affiliate_status, price_note")
      .eq("product_id", product.id)
      .eq("is_active", true),
    supabase
      .from("product_launch_pricing")
      .select("currency, amount, is_estimated")
      .eq("product_id", product.id),
    supabase
      .from("freshness_log")
      .select("reviewed_at, reason")
      .eq("product_id", product.id)
      .order("reviewed_at", { ascending: false })
      .limit(5),
    supabase
      .from("seo_metadata")
      .select("meta_title, meta_description, canonical_url, noindex")
      .eq("product_id", product.id)
      .maybeSingle(),
    supabase.from("source_records").select("id", { count: "exact", head: true }).eq("product_id", product.id),
    supabase.from("evidence_records").select("id", { count: "exact", head: true }).eq("product_id", product.id),
    getPublishedHeroImage("product", product.id),
  ]);
  for (const [ctx, err] of [
    ["manufacturer", manufacturerError],
    ["family", familyError],
    ["category", categoryError],
    ["specRows", specRowsError],
    ["tagRows", tagRowsError],
    ["outgoingRel", outgoingRelError],
    ["incomingRel", incomingRelError],
    ["contentLinks", contentLinksError],
    ["offers", offersError],
    ["launchPricing", launchPricingError],
    ["freshness", freshnessError],
    ["seo", seoError],
    ["sourceCount", sourceCountError],
    ["evidenceCount", evidenceCountError],
  ] as const) {
    logQueryError(`getProductDetail(${slug}) ${ctx}`, err);
  }

  const specDefIds = (specRows ?? []).map((s) => s.spec_definition_id);
  const tagIds = (tagRows ?? []).map((t) => t.tag_id);
  const relatedProductIds = [
    ...(outgoingRel ?? []).map((r) => r.related_product_id),
    ...(incomingRel ?? []).map((r) => r.product_id),
  ];
  const contentIds = (contentLinks ?? []).map((c) => c.content_id);

  // Round trip 2: everything derived from round trip 1's IDs, batched
  // together rather than run sequentially.
  const [
    { data: specDefs, error: specDefsError },
    { data: tags, error: tagsError },
    { data: relatedProducts, error: relatedProductsError },
    { data: articleRows, error: articleRowsError },
  ] = await Promise.all([
    specDefIds.length > 0
      ? supabase.from("spec_definitions").select("id, name, unit").in("id", specDefIds)
      : Promise.resolve({ data: [], error: null }),
    tagIds.length > 0
      ? supabase.from("taxonomy_tags").select("name, slug").in("id", tagIds)
      : Promise.resolve({ data: [], error: null }),
    relatedProductIds.length > 0
      ? supabase.from("products").select("id, name, slug, summary").in("id", relatedProductIds).eq("is_published", true)
      : Promise.resolve({ data: [], error: null }),
    contentIds.length > 0
      ? supabase
          .from("content_items")
          .select("id, title, slug, type, published_at, status")
          .in("id", contentIds)
          .eq("locale", ROOT_LOCALE)
          .eq("status", "published")
          .lte("published_at", new Date().toISOString())
      : Promise.resolve({ data: [], error: null }),
  ]);
  for (const [ctx, err] of [
    ["specDefs", specDefsError],
    ["tags", tagsError],
    ["relatedProducts", relatedProductsError],
    ["articleRows", articleRowsError],
  ] as const) {
    logQueryError(`getProductDetail(${slug}) ${ctx}`, err);
  }

  const specDefById = new Map((specDefs ?? []).map((d) => [d.id, d]));
  const specs = (specRows ?? [])
    .map((s) => {
      const def = specDefById.get(s.spec_definition_id);
      return def ? { name: def.name, unit: def.unit, value: s.value } : null;
    })
    .filter((s): s is { name: string; unit: string | null; value: unknown } => s !== null);

  const relatedProductsWithImages = await attachHeroImages(supabase, relatedProducts ?? [], "product");
  const relatedById = new Map(relatedProductsWithImages.map((p) => [p.id, p]));
  const related: RelatedProduct[] = [
    ...(outgoingRel ?? [])
      .map((r) => {
        const p = relatedById.get(r.related_product_id);
        return p ? { label: FORWARD_LABELS[r.relationship_type], product: p } : null;
      })
      .filter((r): r is RelatedProduct => r !== null),
    ...(incomingRel ?? [])
      .map((r) => {
        const p = relatedById.get(r.product_id);
        return p ? { label: REVERSE_LABELS[r.relationship_type], product: p } : null;
      })
      .filter((r): r is RelatedProduct => r !== null),
  ];

  const roleByContentId = new Map((contentLinks ?? []).map((c) => [c.content_id, c.role]));
  const articlesWithImages = await attachHeroImages(supabase, articleRows ?? [], "content");
  const articles = articlesWithImages.map((a) => ({
    id: a.id,
    title: a.title,
    slug: a.slug,
    type: a.type,
    role: roleByContentId.get(a.id) ?? "mentioned",
    heroImage: a.heroImage,
  }));

  return {
    product,
    manufacturer: manufacturer ?? null,
    family: family ?? null,
    category: category ?? null,
    specs,
    tags: tags ?? [],
    related,
    articles,
    heroImage,
    seo: seo ?? null,
    offers: offers ?? [],
    launchPricing: launchPricingRows ?? [],
    freshness: freshnessRows ?? [],
    sourceCount: sourceCount ?? 0,
    evidenceCount: evidenceCount ?? 0,
  };
});
