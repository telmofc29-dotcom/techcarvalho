import "server-only";
import { createClient } from "@/lib/supabase/server";

// Public-facing reads. Every table queried here has RLS policies that
// already scope results to published rows for the anon/authenticated
// roles — no additional filtering is required, but is_published/status
// filters are still applied explicitly for clarity and to avoid relying
// solely on RLS if a query is ever run with elevated privileges.
//
// Queries are written as separate round trips rather than PostgREST
// embedded-resource joins (`table(nested)`), because the hand-written
// Database type in src/lib/types/database.ts has no Relationships metadata
// for supabase-js to type an embed against.

export async function getCategoryBySlug(slug: string) {
  const supabase = await createClient();
  const { data } = await supabase.from("taxonomy_categories").select("*").eq("slug", slug).maybeSingle();
  return data;
}

export async function getPublishedProductsForCategory(categoryId: string) {
  const supabase = await createClient();
  const { data } = await supabase
    .from("products")
    .select("id, name, slug, summary, status")
    .eq("category_id", categoryId)
    .eq("is_published", true)
    .order("name");
  return data ?? [];
}

// Content is associated with a category indirectly: a published content
// item whose primary-subject product belongs to this category. content_items
// has no direct category column (see supabase/migrations_pending for a
// proposed one).
export async function getPublishedContentForCategory(categoryId: string) {
  const supabase = await createClient();

  const { data: productsInCategory } = await supabase.from("products").select("id").eq("category_id", categoryId);
  const productIds = (productsInCategory ?? []).map((p) => p.id);
  if (productIds.length === 0) return [];

  const { data: links } = await supabase
    .from("content_products")
    .select("content_id")
    .eq("role", "primary_subject")
    .in("product_id", productIds);
  const contentIds = [...new Set((links ?? []).map((l) => l.content_id))];
  if (contentIds.length === 0) return [];

  const { data: content } = await supabase
    .from("content_items")
    .select("id, title, slug, type, published_at")
    .in("id", contentIds)
    .eq("status", "published")
    .lte("published_at", new Date().toISOString())
    .order("published_at", { ascending: false });

  return content ?? [];
}

export async function getLatestPublishedContent(limit = 6) {
  const supabase = await createClient();
  const { data } = await supabase
    .from("content_items")
    .select("id, title, slug, type, published_at")
    .eq("status", "published")
    .lte("published_at", new Date().toISOString())
    .order("published_at", { ascending: false })
    .limit(limit);
  return data ?? [];
}

export async function getPublishedProductBySlug(slug: string) {
  const supabase = await createClient();
  const { data: product } = await supabase
    .from("products")
    .select("*")
    .eq("slug", slug)
    .eq("is_published", true)
    .maybeSingle();
  if (!product) return null;

  const [{ data: manufacturer }, { data: category }] = await Promise.all([
    supabase.from("manufacturers").select("name, slug").eq("id", product.manufacturer_id).maybeSingle(),
    supabase.from("taxonomy_categories").select("name, slug").eq("id", product.category_id).maybeSingle(),
  ]);

  return { ...product, manufacturer, category };
}

export async function getPublishedContentBySlug(slug: string) {
  const supabase = await createClient();
  const { data } = await supabase
    .from("content_items")
    .select("*")
    .eq("slug", slug)
    .eq("status", "published")
    .lte("published_at", new Date().toISOString())
    .maybeSingle();
  return data;
}
