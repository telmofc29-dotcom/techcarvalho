import "server-only";
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

export async function getArticleDetail(slug: string): Promise<ArticleDetail | null> {
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
    { data: siblingTypeContent, error: siblingError },
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
    ["sibling", siblingError],
  ] as const) {
    logQueryError(`getArticleDetail(${slug}) ${ctx}`, err);
  }

  const productIds = (productLinks ?? []).map((p) => p.product_id);
  const roleByProductId = new Map((productLinks ?? []).map((p) => [p.product_id, p.role]));
  const tagIds = (tagRows ?? []).map((t) => t.tag_id);

  const [{ data: productRows, error: productRowsError }, { data: tags, error: tagsError }] = await Promise.all([
    productIds.length > 0
      ? supabase.from("products").select("id, name, slug").in("id", productIds).eq("is_published", true)
      : Promise.resolve({ data: [], error: null }),
    tagIds.length > 0
      ? supabase.from("taxonomy_tags").select("name, slug").in("id", tagIds)
      : Promise.resolve({ data: [], error: null }),
  ]);
  logQueryError(`getArticleDetail(${slug}) productRows`, productRowsError);
  logQueryError(`getArticleDetail(${slug}) tags`, tagsError);

  const products = (productRows ?? []).map((p) => ({ ...p, role: roleByProductId.get(p.id) ?? "mentioned" }));

  return {
    content,
    products,
    tags: tags ?? [],
    freshness: freshnessRows ?? [],
    seo: seo ?? null,
    related: siblingTypeContent ?? [],
    heroImage,
  };
}
