import "server-only";
import { cache } from "react";
import { createClient } from "@/lib/supabase/server";
import { attachHeroImages, type HeroImage } from "./hero-image";
import { attachExcerpts } from "./excerpt";
import { logQueryError } from "@/lib/log/query-error";

// ---------------------------------------------------------------------------
// Product-family hubs (/families/[slug]).
//
// A family is the natural comparison cluster — "Canon EOS 5D", "Canon EOS xxD"
// — and maps onto a real, high-intent query shape ("which Canon 5D should I
// buy", "70D vs 80D vs 90D"). Until now `product_families` had 7 rows, full
// admin CRUD, and no public route at all: products/[slug] rendered the family
// name as plain text.
//
// THE PARTLY-UNPUBLISHED PROBLEM. Most of this catalogue is unpublished while
// media rights are cleared (6 of 44 products published at the time of writing),
// and other agents are publishing more concurrently. A family hub therefore has
// to be correct for a family whose members are *mostly* invisible:
//
//   - Products are queried with `is_published = true`, so an unpublished body
//     is never linked. Linking one would be a public 404 (products/[slug]
//     filters on is_published too).
//   - Nothing states or implies how many members the line has in total. The
//     page describes what it shows, never what is being withheld.
//   - Every gate is computed from live rows, so a family flips from empty to
//     populated to indexable on its own as products publish — no code change
//     and no editorial step.
//
// ARTICLES ARE THE OTHER HALF. A family with one published body is not much of
// a hub, but a family with one published body and four published articles about
// the line is a real one. Article discovery goes through `content_products` —
// which, verified against production, `anon` may only read when BOTH sides are
// published ("public can read content-product links when both published"). That
// is 9 of 123 rows. This is not a bug to work around: an article about three
// unpublished bodies genuinely has no public link to them. It does mean the
// article list here grows as the catalogue publishes, which is the correct
// behaviour, not a limitation.
// ---------------------------------------------------------------------------

export type FamilyProduct = {
  id: string;
  name: string;
  slug: string;
  summary: string | null;
  status: string;
  release_date: string | null;
  heroImage: HeroImage | null;
};

export type FamilyArticle = {
  id: string;
  title: string;
  slug: string;
  type: string;
  published_at: string | null;
  excerpt: string | null;
  heroImage: HeroImage | null;
};

export type FamilyDetail = {
  family: { id: string; name: string; slug: string; description: string | null };
  category: { id: string; name: string; slug: string } | null;
  manufacturers: { id: string; name: string; slug: string }[];
  products: FamilyProduct[];
  articles: FamilyArticle[];
  /** Newest real timestamp among the rows this hub lists, for `lastmod`. Null when it lists nothing. */
  lastModified: string | null;
};

export const getFamilyDetail = cache(async (slug: string): Promise<FamilyDetail | null> => {
  const supabase = await createClient();

  // product_families is world-readable reference data (no publish gating) —
  // "public can read product families ... using (true)" — so the row is found
  // whether or not anything under it is published, exactly like manufacturers.
  const { data: family, error: familyError } = await supabase
    .from("product_families")
    .select("id, name, slug, description, category_id")
    .eq("slug", slug)
    .maybeSingle();
  logQueryError(`getFamilyDetail(${slug}) family`, familyError);

  if (!family) return null;

  const [{ data: productRows, error: productsError }, { data: category, error: categoryError }] = await Promise.all([
    supabase
      .from("products")
      .select("id, name, slug, summary, status, release_date, updated_at, manufacturer_id")
      .eq("family_id", family.id)
      .eq("is_published", true)
      // Oldest first: a family is a generational line, and reading it in
      // release order is what makes "what changed between generations"
      // legible. Nulls sort last so an undated row doesn't lead.
      .order("release_date", { ascending: true, nullsFirst: false })
      .order("name"),
    family.category_id
      ? supabase.from("taxonomy_categories").select("id, name, slug").eq("id", family.category_id).maybeSingle()
      : Promise.resolve({ data: null, error: null }),
  ]);
  logQueryError(`getFamilyDetail(${slug}) products`, productsError);
  logQueryError(`getFamilyDetail(${slug}) category`, categoryError);

  const products = productRows ?? [];
  const productIds = products.map((p) => p.id);
  const manufacturerIds = [...new Set(products.map((p) => p.manufacturer_id))];

  const [{ data: contentLinks, error: contentLinksError }, { data: manufacturerRows, error: manufacturersError }] =
    await Promise.all([
      productIds.length > 0
        ? supabase.from("content_products").select("content_id").in("product_id", productIds)
        : Promise.resolve({ data: [], error: null }),
      manufacturerIds.length > 0
        ? supabase.from("manufacturers").select("id, name, slug").in("id", manufacturerIds).order("name")
        : Promise.resolve({ data: [], error: null }),
    ]);
  logQueryError(`getFamilyDetail(${slug}) contentLinks`, contentLinksError);
  logQueryError(`getFamilyDetail(${slug}) manufacturers`, manufacturersError);

  const contentIds = [...new Set((contentLinks ?? []).map((c) => c.content_id))];
  const { data: articleRows, error: articlesError } =
    contentIds.length > 0
      ? await supabase
          .from("content_items")
          .select("id, title, slug, type, published_at, updated_at")
          .in("id", contentIds)
          .eq("status", "published")
          .lte("published_at", new Date().toISOString())
          .order("published_at", { ascending: false })
      : { data: [], error: null };
  logQueryError(`getFamilyDetail(${slug}) articles`, articlesError);

  const [productsWithImages, articlesWithExcerpts] = await Promise.all([
    attachHeroImages(supabase, products, "product"),
    attachExcerpts(supabase, articleRows ?? []),
  ]);
  const articlesWithImages = await attachHeroImages(supabase, articlesWithExcerpts, "content");

  // Only ever a timestamp that really exists on a row this page lists. A
  // synthetic `now()` would tell crawlers every family changed on every crawl.
  const timestamps = [...products.map((p) => p.updated_at), ...(articleRows ?? []).map((a) => a.updated_at)];
  const lastModified = timestamps.length > 0 ? timestamps.reduce((a, b) => (a > b ? a : b)) : null;

  return {
    family: { id: family.id, name: family.name, slug: family.slug, description: family.description },
    category: category ?? null,
    manufacturers: manufacturerRows ?? [],
    products: productsWithImages.map((p) => ({
      id: p.id,
      name: p.name,
      slug: p.slug,
      summary: p.summary,
      status: p.status,
      release_date: p.release_date,
      heroImage: p.heroImage,
    })),
    articles: articlesWithImages.map((a) => ({
      id: a.id,
      title: a.title,
      slug: a.slug,
      type: a.type,
      published_at: a.published_at,
      excerpt: a.excerpt,
      heroImage: a.heroImage,
    })),
    lastModified,
  };
});

export type FamilySummary = {
  id: string;
  name: string;
  slug: string;
  productCount: number;
  articleCount: number;
  lastModified: string | null;
};

// Every family that currently has published material, with the counts the
// indexability gate needs. Used by sitemap.ts (which must not submit an empty
// family) and by the manufacturer hub (which must not link to one).
//
// Deliberately counts only what a public visitor can see: published products,
// and published articles reachable through an anon-visible content_products
// row. Same numbers the hub page itself will render.
export const listFamiliesWithPublishedMaterial = cache(async (): Promise<FamilySummary[]> => {
  const supabase = await createClient();

  const [{ data: families, error: familiesError }, { data: products, error: productsError }] = await Promise.all([
    supabase.from("product_families").select("id, name, slug").order("name"),
    supabase.from("products").select("id, family_id, updated_at").eq("is_published", true),
  ]);
  logQueryError("listFamiliesWithPublishedMaterial families", familiesError);
  logQueryError("listFamiliesWithPublishedMaterial products", productsError);

  if (!families || families.length === 0) return [];

  const publishedProducts = (products ?? []).filter((p) => p.family_id !== null);
  const productIds = publishedProducts.map((p) => p.id);

  const { data: contentLinks, error: contentLinksError } =
    productIds.length > 0
      ? await supabase.from("content_products").select("content_id, product_id").in("product_id", productIds)
      : { data: [], error: null };
  logQueryError("listFamiliesWithPublishedMaterial contentLinks", contentLinksError);

  const contentIds = [...new Set((contentLinks ?? []).map((c) => c.content_id))];
  const { data: articles, error: articlesError } =
    contentIds.length > 0
      ? await supabase
          .from("content_items")
          .select("id, updated_at")
          .in("id", contentIds)
          .eq("status", "published")
          .lte("published_at", new Date().toISOString())
      : { data: [], error: null };
  logQueryError("listFamiliesWithPublishedMaterial articles", articlesError);

  const publishedArticleById = new Map((articles ?? []).map((a) => [a.id, a]));
  const familyIdByProductId = new Map(publishedProducts.map((p) => [p.id, p.family_id as string]));

  const productCountByFamily = new Map<string, number>();
  const articleIdsByFamily = new Map<string, Set<string>>();
  const latestByFamily = new Map<string, string>();

  const noteLatest = (familyId: string, timestamp: string | null | undefined) => {
    if (!timestamp) return;
    const current = latestByFamily.get(familyId);
    if (!current || timestamp > current) latestByFamily.set(familyId, timestamp);
  };

  for (const product of publishedProducts) {
    const familyId = product.family_id as string;
    productCountByFamily.set(familyId, (productCountByFamily.get(familyId) ?? 0) + 1);
    noteLatest(familyId, product.updated_at);
  }

  for (const link of contentLinks ?? []) {
    const familyId = familyIdByProductId.get(link.product_id);
    const article = publishedArticleById.get(link.content_id);
    if (!familyId || !article) continue;
    if (!articleIdsByFamily.has(familyId)) articleIdsByFamily.set(familyId, new Set());
    articleIdsByFamily.get(familyId)!.add(link.content_id);
    noteLatest(familyId, article.updated_at);
  }

  return families
    .map((f) => ({
      id: f.id,
      name: f.name,
      slug: f.slug,
      productCount: productCountByFamily.get(f.id) ?? 0,
      articleCount: articleIdsByFamily.get(f.id)?.size ?? 0,
      lastModified: latestByFamily.get(f.id) ?? null,
    }))
    .filter((f) => f.productCount > 0 || f.articleCount > 0);
});
