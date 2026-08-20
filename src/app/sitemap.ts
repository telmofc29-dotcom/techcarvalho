import type { MetadataRoute } from "next";
import { createClient } from "@/lib/supabase/server";
import { absoluteUrl } from "@/lib/seo/site";
import { PLANNED_CATEGORIES } from "@/lib/public/categories";
import { logQueryError } from "@/lib/log/query-error";

export default async function sitemap(): Promise<MetadataRoute.Sitemap> {
  const supabase = await createClient();

  const [
    { data: products, error: productsError },
    { data: content, error: contentError },
    { data: manufacturers, error: manufacturersError },
  ] = await Promise.all([
    supabase.from("products").select("slug, updated_at").eq("is_published", true),
    supabase
      .from("content_items")
      .select("slug, updated_at, published_at")
      .eq("status", "published")
      .lte("published_at", new Date().toISOString()),
    supabase.from("manufacturers").select("slug"),
  ]);
  logQueryError("sitemap products", productsError);
  logQueryError("sitemap content", contentError);
  logQueryError("sitemap manufacturers", manufacturersError);

  // /search is intentionally excluded: its metadata is noindex (query-driven,
  // low value for crawlers) so it has no business in the sitemap either.
  const staticEntries: MetadataRoute.Sitemap = [
    { url: absoluteUrl("/"), changeFrequency: "daily", priority: 1 },
    { url: absoluteUrl("/products"), changeFrequency: "daily", priority: 0.7 },
    { url: absoluteUrl("/articles"), changeFrequency: "daily", priority: 0.7 },
    { url: absoluteUrl("/manufacturers"), changeFrequency: "weekly", priority: 0.5 },
    { url: absoluteUrl("/privacy"), changeFrequency: "yearly", priority: 0.2 },
    { url: absoluteUrl("/cookies"), changeFrequency: "yearly", priority: 0.2 },
    { url: absoluteUrl("/terms"), changeFrequency: "yearly", priority: 0.2 },
    { url: absoluteUrl("/affiliate-disclosure"), changeFrequency: "yearly", priority: 0.2 },
    { url: absoluteUrl("/editorial-policy"), changeFrequency: "yearly", priority: 0.2 },
  ];

  const categoryEntries: MetadataRoute.Sitemap = PLANNED_CATEGORIES.map((c) => ({
    url: absoluteUrl(`/${c.slug}`),
    changeFrequency: "weekly",
    priority: 0.6,
  }));

  const manufacturerEntries: MetadataRoute.Sitemap = (manufacturers ?? []).map((m) => ({
    url: absoluteUrl(`/manufacturers/${m.slug}`),
    changeFrequency: "weekly",
    priority: 0.4,
  }));

  const productEntries: MetadataRoute.Sitemap = (products ?? []).map((p) => ({
    url: absoluteUrl(`/products/${p.slug}`),
    lastModified: p.updated_at,
    changeFrequency: "weekly",
    priority: 0.7,
  }));

  const contentEntries: MetadataRoute.Sitemap = (content ?? []).map((c) => ({
    url: absoluteUrl(`/articles/${c.slug}`),
    lastModified: c.updated_at,
    changeFrequency: "monthly",
    priority: 0.5,
  }));

  return [
    ...staticEntries,
    ...categoryEntries,
    ...manufacturerEntries,
    ...productEntries,
    ...contentEntries,
  ];
}
