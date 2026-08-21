import "server-only";
import { cache } from "react";
import { createClient } from "@/lib/supabase/server";
import { getPublishedHeroImage, type HeroImage } from "./hero-image";
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
  };
  products: { id: string; name: string; slug: string; role: string }[];
  tags: { name: string; slug: string }[];
  freshness: { reviewed_at: string; reason: string }[];
  seo: { meta_title: string | null; meta_description: string | null; canonical_url: string | null } | null;
  related: { id: string; title: string; slug: string; type: string; published_at: string | null }[];
  heroImage: HeroImage | null;
};

// Cached per-request — see product-detail.ts for why.
export const getArticleDetail = cache(async (slug: string): Promise<ArticleDetail | null> => {
  const supabase = await createClient();

  const { data: content, error: contentError } = await supabase
    .from("content_items")
    .select("id, title, slug, type, body, published_at, updated_at, status")
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
      .select("meta_title, meta_description, canonical_url")
      .eq("content_id", content.id)
      .maybeSingle(),
    // Fallback only — see the shared-product query below, which is
    // preferred when it has enough results, since it reflects a genuine
    // editorial relationship rather than just "published around the same
    // time."
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
  ]);
  for (const [ctx, err] of [
    ["productLinks", productLinksError],
    ["tagRows", tagRowsError],
    ["freshness", freshnessError],
    ["seo", seoError],
    ["sameType", sameTypeError],
  ] as const) {
    logQueryError(`getArticleDetail(${slug}) ${ctx}`, err);
  }

  const productIds = (productLinks ?? []).map((p) => p.product_id);
  const roleByProductId = new Map((productLinks ?? []).map((p) => [p.product_id, p.role]));
  const tagIds = (tagRows ?? []).map((t) => t.tag_id);

  // Content genuinely related via a shared product mention (content_products)
  // — the internal-journey signal that actually exists today, ahead of
  // content_relationships, which is still only a migration proposal. Needs
  // productIds from round 1, so this can't be batched into it.
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
  ]);
  logQueryError(`getArticleDetail(${slug}) productRows`, productRowsError);
  logQueryError(`getArticleDetail(${slug}) tags`, tagsError);
  logQueryError(`getArticleDetail(${slug}) relatedByProduct`, relatedByProductError);

  const products = (productRows ?? []).map((p) => ({ ...p, role: roleByProductId.get(p.id) ?? "mentioned" }));

  const relatedIds = new Set<string>();
  const related = [...(relatedByProduct ?? []), ...(sameTypeContent ?? [])].filter((item) => {
    if (relatedIds.has(item.id)) return false;
    relatedIds.add(item.id);
    return true;
  });

  return {
    content,
    products,
    tags: tags ?? [],
    freshness: freshnessRows ?? [],
    seo: seo ?? null,
    related: related.slice(0, 3),
    heroImage,
  };
});
