import type { MetadataRoute } from "next";
import { createClient } from "@/lib/supabase/server";
import { absoluteUrl } from "@/lib/seo/site";
import { normalizeCanonical } from "@/lib/seo/metadata";
import { PLANNED_CATEGORIES } from "@/lib/public/categories";
import { ARTICLE_HUBS } from "@/lib/public/article-hubs";
import { listFamiliesWithPublishedMaterial } from "@/lib/public/family-detail";
import { isManufacturerHubIndexable, isFamilyHubIndexable } from "@/lib/public/hub-eligibility";
import { logQueryError } from "@/lib/log/query-error";
import { ROOT_LOCALE } from "@/lib/i18n/locales";

// A sitemap is a set of assertions: "these URLs exist, they are canonical,
// they are worth indexing, and this is when they last changed." Every entry
// here has to survive all four. The rules, and what each one is fixing:
//
//  1. Published only — was already true for products/content.
//  2. NOT noindex. seo_metadata.noindex is editable from both admin detail
//     forms and was previously honoured nowhere: a product an editor had
//     explicitly excluded from the index was still submitted to Google here.
//  3. Self-canonical only. A row whose seo_metadata.canonical_url points at a
//     different URL is by definition not the canonical version of itself, and
//     submitting it contradicts its own <link rel="canonical">.
//  4. Not a thin/empty shell. Categories with nothing published and brands
//     with no published products render "Coming soon" / "No published
//     products yet" empty states, and both are now noindex on the page — so
//     they must not appear here either. A sitemap listing noindex URLs is the
//     single most common way a small site teaches Google to distrust it.
//
// /search is excluded for the same reason it is noindex on the page: it is
// query-driven and has no fixed content.

type SeoRow = { product_id: string | null; content_id: string | null; canonical_url: string | null; noindex: boolean };

// True when this row must be kept out of the sitemap: explicitly noindexed,
// or carrying a canonical that points somewhere other than its own URL.
function isExcludedBySeo(seo: SeoRow | undefined, ownUrl: string): boolean {
  if (!seo) return false;
  if (seo.noindex) return true;
  const canonical = normalizeCanonical(seo.canonical_url);
  return canonical !== null && canonical !== ownUrl;
}

export default async function sitemap(): Promise<MetadataRoute.Sitemap> {
  const supabase = await createClient();

  const [
    { data: products, error: productsError },
    { data: content, error: contentError },
    { data: manufacturers, error: manufacturersError },
    { data: seoRows, error: seoError },
    { data: categories, error: categoriesError },
    { data: allTags, error: allTagsError },
    { data: contentTagLinks, error: contentTagLinksError },
    families,
  ] = await Promise.all([
    supabase.from("products").select("id, slug, updated_at, manufacturer_id, category_id").eq("is_published", true),
    supabase
      .from("content_items")
      .select("id, slug, type, updated_at, published_at, category_id")
      .eq("locale", ROOT_LOCALE)
      .eq("status", "published")
      .lte("published_at", new Date().toISOString()),
    supabase.from("manufacturers").select("id, slug"),
    supabase.from("seo_metadata").select("product_id, content_id, canonical_url, noindex"),
    supabase.from("taxonomy_categories").select("id, slug"),
    // Brand-tag coverage. A manufacturer hub is no longer thin just because
    // its catalogue is unpublished — see hub-eligibility.ts. These two tiny
    // world-readable tables are what the hub itself uses to find its coverage,
    // so the count here is exactly the count the page will render.
    supabase.from("taxonomy_tags").select("id, slug"),
    supabase.from("content_tags").select("content_id, tag_id"),
    listFamiliesWithPublishedMaterial(),
  ]);
  logQueryError("sitemap products", productsError);
  logQueryError("sitemap content", contentError);
  logQueryError("sitemap manufacturers", manufacturersError);
  logQueryError("sitemap seo_metadata", seoError);
  logQueryError("sitemap categories", categoriesError);
  logQueryError("sitemap taxonomy_tags", allTagsError);
  logQueryError("sitemap content_tags", contentTagLinksError);

  const seoByProductId = new Map<string, SeoRow>();
  const seoByContentId = new Map<string, SeoRow>();
  for (const row of seoRows ?? []) {
    if (row.product_id) seoByProductId.set(row.product_id, row);
    if (row.content_id) seoByContentId.set(row.content_id, row);
  }

  const productEntries: MetadataRoute.Sitemap = [];
  const publishedProductsByManufacturer = new Map<string, string[]>();
  const categoryIdsWithPublishedContent = new Set<string>();
  // Newest real timestamp seen under each category/manufacturer, used as their
  // hub's lastmod. Derived from actual updated_at values on rows the hub
  // lists — never a synthetic "now", which would tell crawlers every hub
  // changed on every crawl.
  const latestByCategoryId = new Map<string, string>();
  const latestByManufacturerId = new Map<string, string>();

  const noteLatest = (map: Map<string, string>, key: string | null, timestamp: string | null) => {
    if (!key || !timestamp) return;
    const current = map.get(key);
    if (!current || timestamp > current) map.set(key, timestamp);
  };

  for (const product of products ?? []) {
    const url = absoluteUrl(`/products/${product.slug}`);
    // A manufacturer/category hub's own indexability depends on it having
    // published products at all, which is true regardless of whether an
    // individual product is noindexed — so record the relationship before
    // the exclusion check, not after.
    publishedProductsByManufacturer.set(product.manufacturer_id, [
      ...(publishedProductsByManufacturer.get(product.manufacturer_id) ?? []),
      product.id,
    ]);
    if (product.category_id) categoryIdsWithPublishedContent.add(product.category_id);
    noteLatest(latestByCategoryId, product.category_id, product.updated_at);
    noteLatest(latestByManufacturerId, product.manufacturer_id, product.updated_at);

    if (isExcludedBySeo(seoByProductId.get(product.id), url)) continue;
    productEntries.push({ url, lastModified: product.updated_at, changeFrequency: "weekly", priority: 0.7 });
  }

  const contentEntries: MetadataRoute.Sitemap = [];
  const latestByType = new Map<string, string>();
  for (const item of content ?? []) {
    const url = absoluteUrl(`/articles/${item.slug}`);
    if (item.category_id) categoryIdsWithPublishedContent.add(item.category_id);
    noteLatest(latestByCategoryId, item.category_id, item.updated_at);
    noteLatest(latestByType, item.type, item.updated_at);

    if (isExcludedBySeo(seoByContentId.get(item.id), url)) continue;
    contentEntries.push({ url, lastModified: item.updated_at, changeFrequency: "monthly", priority: 0.5 });
  }

  const categoryIdBySlug = new Map((categories ?? []).map((c) => [c.slug, c.id]));

  // PLANNED_CATEGORIES is the nav list; only the entries that both exist in
  // taxonomy_categories AND have something published are real, indexable hubs.
  const categoryEntries: MetadataRoute.Sitemap = PLANNED_CATEGORIES.flatMap((planned) => {
    const id = categoryIdBySlug.get(planned.slug);
    if (!id || !categoryIdsWithPublishedContent.has(id)) return [];
    const lastModified = latestByCategoryId.get(id);
    return [
      {
        url: absoluteUrl(`/${planned.slug}`),
        ...(lastModified ? { lastModified } : {}),
        changeFrequency: "weekly" as const,
        priority: 0.6,
      },
    ];
  });

  // Published articles per brand tag, matched by slug equality with the
  // manufacturer — the identical rule getBrandArticles() uses on the page, so
  // the sitemap can never advertise a hub that renders as empty, nor withhold
  // one that renders as full.
  const publishedContentById = new Map((content ?? []).map((c) => [c.id, c]));
  const tagIdBySlug = new Map((allTags ?? []).map((t) => [t.slug, t.id]));
  const publishedContentByTagId = new Map<string, { count: number; latest: string | null }>();
  for (const link of contentTagLinks ?? []) {
    const item = publishedContentById.get(link.content_id);
    if (!item) continue;
    const entry = publishedContentByTagId.get(link.tag_id) ?? { count: 0, latest: null };
    entry.count += 1;
    if (!entry.latest || item.updated_at > entry.latest) entry.latest = item.updated_at;
    publishedContentByTagId.set(link.tag_id, entry);
  }

  const manufacturerEntries: MetadataRoute.Sitemap = (manufacturers ?? []).flatMap((m) => {
    const productCount = publishedProductsByManufacturer.get(m.id)?.length ?? 0;
    const tagId = tagIdBySlug.get(m.slug);
    const coverage = tagId ? publishedContentByTagId.get(tagId) : undefined;
    const articleCount = coverage?.count ?? 0;
    // Shared with the page's own `noindex` decision. A sitemap listing a URL
    // that renders noindex is a direct contradiction; one definition, so the
    // two cannot drift apart.
    if (!isManufacturerHubIndexable({ productCount, articleCount })) return [];
    const candidates = [latestByManufacturerId.get(m.id), coverage?.latest].filter((t): t is string => Boolean(t));
    const lastModified = candidates.length > 0 ? candidates.reduce((a, b) => (a > b ? a : b)) : undefined;
    return [
      {
        url: absoluteUrl(`/manufacturers/${m.slug}`),
        ...(lastModified ? { lastModified } : {}),
        changeFrequency: "weekly" as const,
        priority: 0.4,
      },
    ];
  });

  // Product-family hubs (/families/[slug]). Same four rules as everything else
  // here: real route, published material only, not thin, real lastmod.
  // product_families is world-readable with no publish gating, so a row (and a
  // live route) exists the moment an admin creates a line — most of them have
  // nothing public under them today and are correctly absent.
  const familyEntries: MetadataRoute.Sitemap = families.flatMap((f) => {
    if (!isFamilyHubIndexable({ productCount: f.productCount, articleCount: f.articleCount })) return [];
    return [
      {
        url: absoluteUrl(`/families/${f.slug}`),
        ...(f.lastModified ? { lastModified: f.lastModified } : {}),
        changeFrequency: "weekly" as const,
        priority: 0.5,
      },
    ];
  });

  const staticEntries: MetadataRoute.Sitemap = [
    { url: absoluteUrl("/"), changeFrequency: "daily", priority: 1 },
    { url: absoluteUrl("/products"), changeFrequency: "daily", priority: 0.7 },
    { url: absoluteUrl("/articles"), changeFrequency: "daily", priority: 0.7 },
    { url: absoluteUrl("/manufacturers"), changeFrequency: "weekly", priority: 0.5 },
    // /about and /contact are linked from the footer of every page and are
    // exactly the pages an E-E-A-T assessment looks for. They were the only
    // two footer destinations missing from this list.
    { url: absoluteUrl("/about"), changeFrequency: "monthly", priority: 0.3 },
    { url: absoluteUrl("/contact"), changeFrequency: "yearly", priority: 0.2 },
    { url: absoluteUrl("/editorial-policy"), changeFrequency: "yearly", priority: 0.3 },
    { url: absoluteUrl("/privacy"), changeFrequency: "yearly", priority: 0.2 },
    { url: absoluteUrl("/cookies"), changeFrequency: "yearly", priority: 0.2 },
    { url: absoluteUrl("/terms"), changeFrequency: "yearly", priority: 0.2 },
    { url: absoluteUrl("/affiliate-disclosure"), changeFrequency: "yearly", priority: 0.2 },
  ];

  // The content-type hubs (/articles?type=review etc.). Each is a real,
  // indexable topic hub with its own title, description and self-referencing
  // canonical — but only submitted once it actually has pieces on it, and
  // only for the types the route recognises. `lastModified` is the newest
  // published piece of that type, which is genuinely when the hub changed.
  const typeHubEntries: MetadataRoute.Sitemap = ARTICLE_HUBS.flatMap((hub) => {
    const lastModified = latestByType.get(hub.type);
    if (!lastModified) return [];
    return [
      {
        url: absoluteUrl(`/articles?type=${hub.type}`),
        lastModified,
        changeFrequency: "weekly" as const,
        priority: 0.6,
      },
    ];
  });

  return [
    ...staticEntries,
    ...typeHubEntries,
    ...categoryEntries,
    ...manufacturerEntries,
    ...familyEntries,
    ...productEntries,
    ...contentEntries,
  ];
}
