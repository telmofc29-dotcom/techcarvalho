import "server-only";
import { createClient } from "@/lib/supabase/server";
import { getPublishedHeroImage, type HeroImage } from "./hero-image";
import { logQueryError } from "@/lib/log/query-error";
import type { RelationshipType } from "@/lib/types/database";

export type RelatedProduct = {
  label: string;
  product: { id: string; name: string; slug: string; summary: string | null };
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
  articles: { id: string; title: string; slug: string; type: string; role: string }[];
  heroImage: HeroImage | null;
};

const FORWARD_LABELS: Record<RelationshipType, string> = {
  successor_of: "Predecessor",
  alternative_to: "Alternative",
  accessory_for: "Accessory for",
  compatible_with: "Compatible with",
  requires: "Requires",
};

const REVERSE_LABELS: Record<RelationshipType, string> = {
  successor_of: "Successor",
  alternative_to: "Alternative",
  accessory_for: "Accessories",
  compatible_with: "Compatible with",
  requires: "Required by",
};

export async function getProductDetail(slug: string): Promise<ProductDetail | null> {
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

  const relatedById = new Map((relatedProducts ?? []).map((p) => [p.id, p]));
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
  const articles = (articleRows ?? []).map((a) => ({
    id: a.id,
    title: a.title,
    slug: a.slug,
    type: a.type,
    role: roleByContentId.get(a.id) ?? "mentioned",
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
  };
}
