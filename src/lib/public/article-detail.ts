import "server-only";
import { cache } from "react";
import { createClient } from "@/lib/supabase/server";
import { getPublishedHeroImage, attachHeroImages, type HeroImage } from "./hero-image";
import { logQueryError } from "@/lib/log/query-error";

export type ArticleDetail = {
  content: {
    id: string;
    title: string;
    slug: string;
    type: string;
    body: string | null;
    published_at: string | null;
    updated_at: string;
    category_id: string | null;
  };
  // The article's taxonomy category, when it has one. Used for the visible
  // breadcrumb trail (Home > Category > Articles > piece) and for the
  // Article schema's articleSection — both were previously unavailable
  // because the query didn't select category_id at all.
  category: { name: string; slug: string } | null;
  products: { id: string; name: string; slug: string; role: string }[];
  tags: { name: string; slug: string }[];
  freshness: { reviewed_at: string; reason: string }[];
  seo: { meta_title: string | null; meta_description: string | null; canonical_url: string | null; noindex: boolean } | null;
  related: { id: string; title: string; slug: string; type: string; published_at: string | null; heroImage: HeroImage | null }[];
  heroImage: HeroImage | null;
};

// Cached per-request — see product-detail.ts for why.
export const getArticleDetail = cache(async (slug: string): Promise<ArticleDetail | null> => {
  const supabase = await createClient();

  const { data: content, error: contentError } = await supabase
    .from("content_items")
    .select("id, title, slug, type, body, published_at, updated_at, status, category_id")
    .eq("slug", slug)
    .eq("status", "published")
    .lte("published_at", new Date().toISOString())
    .maybeSingle();
  logQueryError(`getArticleDetail(${slug}) content`, contentError);

  if (!content) return null;

  const [
    { data: productLinks, error: productLinksError },
    { data: tagRows, error: tagRowsError },
    { data: freshnessRows, error: freshnessError },
    { data: seo, error: seoError },
    { data: sameTypeContent, error: sameTypeError },
    heroImage,
    { data: outgoingRelationships, error: outgoingRelationshipsError },
    { data: incomingRelationships, error: incomingRelationshipsError },
    { data: category, error: categoryError },
  ] = await Promise.all([
    supabase.from("content_products").select("product_id, role").eq("content_id", content.id),
    supabase.from("content_tags").select("tag_id").eq("content_id", content.id),
    supabase
      .from("freshness_log")
      .select("reviewed_at, reason")
      .eq("content_id", content.id)
      .order("reviewed_at", { ascending: false })
      .limit(5),
    supabase
      .from("seo_metadata")
      .select("meta_title, meta_description, canonical_url, noindex")
      .eq("content_id", content.id)
      .maybeSingle(),
    // Fallback only — see the shared-product query and the explicit
    // content_relationships query below, both preferred when they have
    // enough results, since they reflect a genuine editorial relationship
    // rather than just "published around the same time."
    supabase
      .from("content_items")
      .select("id, title, slug, type, published_at")
      .eq("type", content.type)
      .eq("status", "published")
      .neq("id", content.id)
      .lte("published_at", new Date().toISOString())
      .order("published_at", { ascending: false })
      .limit(3),
    getPublishedHeroImage("content", content.id),
    // Explicit editorial clustering (pillar_of/supporting_of/related_to),
    // curated via the admin content edit page — same directional-row +
    // reverse-inferred-at-query-time pattern as product_relationships (see
    // product-detail.ts). This is the highest-signal relationship source;
    // until this fix it was recorded but never actually surfaced to
    // visitors (see 20260820_content_relationships.sql's own header).
    supabase.from("content_relationships").select("related_content_id").eq("content_id", content.id),
    supabase.from("content_relationships").select("content_id").eq("related_content_id", content.id),
    content.category_id
      ? supabase.from("taxonomy_categories").select("name, slug").eq("id", content.category_id).maybeSingle()
      : Promise.resolve({ data: null, error: null }),
  ]);
  for (const [ctx, err] of [
    ["productLinks", productLinksError],
    ["tagRows", tagRowsError],
    ["freshness", freshnessError],
    ["seo", seoError],
    ["sameType", sameTypeError],
    ["outgoingRelationships", outgoingRelationshipsError],
    ["incomingRelationships", incomingRelationshipsError],
    ["category", categoryError],
  ] as const) {
    logQueryError(`getArticleDetail(${slug}) ${ctx}`, err);
  }

  const productIds = (productLinks ?? []).map((p) => p.product_id);
  const roleByProductId = new Map((productLinks ?? []).map((p) => [p.product_id, p.role]));
  const tagIds = (tagRows ?? []).map((t) => t.tag_id);
  const relationshipIds = [
    ...new Set([
      ...(outgoingRelationships ?? []).map((r) => r.related_content_id),
      ...(incomingRelationships ?? []).map((r) => r.content_id),
    ]),
  ];

  // Content genuinely related via a shared product mention (content_products)
  // — needs productIds from round 1, so this can't be batched into it.
  const { data: sharedProductLinks, error: sharedProductLinksError } =
    productIds.length > 0
      ? await supabase.from("content_products").select("content_id").in("product_id", productIds).neq("content_id", content.id)
      : { data: [], error: null };
  logQueryError(`getArticleDetail(${slug}) sharedProductLinks`, sharedProductLinksError);
  const relatedByProductIds = [...new Set((sharedProductLinks ?? []).map((c) => c.content_id))];

  const [
    { data: productRows, error: productRowsError },
    { data: tags, error: tagsError },
    { data: relatedByProduct, error: relatedByProductError },
    { data: relatedByRelationship, error: relatedByRelationshipError },
  ] = await Promise.all([
    productIds.length > 0
      ? supabase.from("products").select("id, name, slug").in("id", productIds).eq("is_published", true)
      : Promise.resolve({ data: [], error: null }),
    tagIds.length > 0
      ? supabase.from("taxonomy_tags").select("name, slug").in("id", tagIds)
      : Promise.resolve({ data: [], error: null }),
    relatedByProductIds.length > 0
      ? supabase
          .from("content_items")
          .select("id, title, slug, type, published_at")
          .in("id", relatedByProductIds)
          .eq("status", "published")
          .lte("published_at", new Date().toISOString())
          .order("published_at", { ascending: false })
          .limit(3)
      : Promise.resolve({ data: [], error: null }),
    relationshipIds.length > 0
      ? supabase
          .from("content_items")
          .select("id, title, slug, type, published_at")
          .in("id", relationshipIds)
          .eq("status", "published")
          .lte("published_at", new Date().toISOString())
      : Promise.resolve({ data: [], error: null }),
  ]);
  logQueryError(`getArticleDetail(${slug}) productRows`, productRowsError);
  logQueryError(`getArticleDetail(${slug}) tags`, tagsError);
  logQueryError(`getArticleDetail(${slug}) relatedByProduct`, relatedByProductError);
  logQueryError(`getArticleDetail(${slug}) relatedByRelationship`, relatedByRelationshipError);

  const products = (productRows ?? []).map((p) => ({ ...p, role: roleByProductId.get(p.id) ?? "mentioned" }));

  // Explicit editorial relationships rank first (real curation), then
  // shared-product association, then same-type recency as a last resort —
  // deduplicated so a piece related both ways only appears once.
  const relatedIds = new Set<string>();
  const related = [...(relatedByRelationship ?? []), ...(relatedByProduct ?? []), ...(sameTypeContent ?? [])].filter(
    (item) => {
      if (relatedIds.has(item.id)) return false;
      relatedIds.add(item.id);
      return true;
    }
  );
  const relatedWithImages = await attachHeroImages(supabase, related.slice(0, 3), "content");

  return {
    content,
    category: category ?? null,
    products,
    tags: tags ?? [],
    freshness: freshnessRows ?? [],
    seo: seo ?? null,
    related: relatedWithImages,
    heroImage,
  };
});
