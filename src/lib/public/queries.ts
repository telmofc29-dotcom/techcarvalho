import "server-only";
import { createClient } from "@/lib/supabase/server";
import { logQueryError } from "@/lib/log/query-error";

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
//
// Every query logs its error server-side (see logQueryError) even though
// the return value still degrades to an empty/null result either way — a
// visitor should never see a raw error, but a real query failure (bad
// grants, RLS misconfiguration, etc.) must never look identical to
// "genuinely no data" in the server logs the way it did during the 2026-08
// anon-grant incident.

export async function getCategoryBySlug(slug: string) {
  const supabase = await createClient();
  const { data, error } = await supabase.from("taxonomy_categories").select("*").eq("slug", slug).maybeSingle();
  logQueryError(`getCategoryBySlug(${slug})`, error);
  return data;
}

export async function getSubcategories(categoryId: string) {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("taxonomy_categories")
    .select("id, name, slug")
    .eq("parent_id", categoryId)
    .order("sort_order");
  logQueryError(`getSubcategories(${categoryId})`, error);
  return data ?? [];
}

export async function getPublishedProductsForCategory(categoryId: string) {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("products")
    .select("id, name, slug, summary, status")
    .eq("category_id", categoryId)
    .eq("is_published", true)
    .order("name");
  logQueryError(`getPublishedProductsForCategory(${categoryId})`, error);
  return data ?? [];
}

// Content is associated with a category two ways: directly via
// content_items.category_id, or indirectly through a published content
// item whose primary-subject product belongs to this category. Both are
// combined (a piece may be tagged with a category directly without having
// any product association at all).
export async function getPublishedContentForCategory(categoryId: string) {
  const supabase = await createClient();

  const [{ data: directContent, error: directError }, { data: productsInCategory, error: productsError }] =
    await Promise.all([
      supabase
        .from("content_items")
        .select("id, title, slug, type, published_at")
        .eq("category_id", categoryId)
        .eq("status", "published")
        .lte("published_at", new Date().toISOString()),
      supabase.from("products").select("id").eq("category_id", categoryId),
    ]);
  logQueryError(`getPublishedContentForCategory(${categoryId}) direct`, directError);
  logQueryError(`getPublishedContentForCategory(${categoryId}) products`, productsError);

  const contentById = new Map((directContent ?? []).map((c) => [c.id, c]));

  const productIds = (productsInCategory ?? []).map((p) => p.id);
  if (productIds.length > 0) {
    const { data: links, error: linksError } = await supabase
      .from("content_products")
      .select("content_id")
      .eq("role", "primary_subject")
      .in("product_id", productIds);
    logQueryError(`getPublishedContentForCategory(${categoryId}) links`, linksError);
    const indirectIds = [...new Set((links ?? []).map((l) => l.content_id))].filter((id) => !contentById.has(id));

    if (indirectIds.length > 0) {
      const { data: indirectContent, error: indirectError } = await supabase
        .from("content_items")
        .select("id, title, slug, type, published_at")
        .in("id", indirectIds)
        .eq("status", "published")
        .lte("published_at", new Date().toISOString());
      logQueryError(`getPublishedContentForCategory(${categoryId}) indirect`, indirectError);
      for (const c of indirectContent ?? []) contentById.set(c.id, c);
    }
  }

  return [...contentById.values()].sort((a, b) => (b.published_at ?? "").localeCompare(a.published_at ?? ""));
}

export async function getLatestPublishedContent(limit = 6) {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("content_items")
    .select("id, title, slug, type, published_at")
    .eq("status", "published")
    .lte("published_at", new Date().toISOString())
    .order("published_at", { ascending: false })
    .limit(limit);
  logQueryError("getLatestPublishedContent", error);
  return data ?? [];
}

export async function getLatestPublishedProducts(limit = 6) {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("products")
    .select("id, name, slug, summary, status")
    .eq("is_published", true)
    .order("updated_at", { ascending: false })
    .limit(limit);
  logQueryError("getLatestPublishedProducts", error);
  return data ?? [];
}
