import "server-only";
import { cache } from "react";
import { createClient } from "@/lib/supabase/server";
import { logQueryError } from "@/lib/log/query-error";
import { descendantScope } from "./taxonomy-tree";
import { attachExcerpts } from "./excerpt";
import { attachHeroImages } from "./hero-image";
import { ROOT_LOCALE } from "@/lib/i18n/locales";

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

// Cached per-request — generateMetadata() and the page component both call
// this with the same slug.
export const getCategoryBySlug = cache(async (slug: string) => {
  const supabase = await createClient();
  const { data, error } = await supabase.from("taxonomy_categories").select("*").eq("slug", slug).maybeSingle();
  logQueryError(`getCategoryBySlug(${slug})`, error);
  return data;
});

// seo_metadata rows can be scoped to a category as well as to a product or a
// content item (the table has all three FK columns). Nothing on the public
// side read the category ones before, so an editor's category meta_title /
// meta_description / canonical_url / noindex went into the database and
// stopped there. Cached per-request: generateMetadata() and the page body
// both want it.
export const getCategorySeo = cache(async (categoryId: string) => {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("seo_metadata")
    .select("meta_title, meta_description, canonical_url, noindex")
    .eq("category_id", categoryId)
    .maybeSingle();
  logQueryError(`getCategorySeo(${categoryId})`, error);
  return data ?? null;
});


/**
 * Every category id a page for `categoryId` should draw content from: itself,
 * plus its descendants.
 *
 * WHY THIS EXISTS. taxonomy_categories has always had a parent_id column and
 * nothing populated it, so every subject page matched category_id EXACTLY.
 * With the hierarchy now set, an exact match would mean /cameras-photography
 * showed nothing about lenses while /camera-lenses held the only lens article
 * -- a parent that is emptier than its own child.
 *
 * Walking DOWN only is deliberate. A child must not inherit its parent's
 * content, or /camera-lenses becomes a copy of /cameras-photography wearing a
 * narrower name, which is worse than an empty page because it looks intended.
 *
 * Cached per request: a category page calls it several times.
 */
/** Every category as a tree node. Cached per request; used for breadcrumbs and scoping. */
export const getAllCategoryNodes = cache(async () => {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("taxonomy_categories")
    .select("id, slug, name, parent_id, sort_order");
  logQueryError("getAllCategoryNodes", error);
  return (data ?? []).map((c) => ({
    id: c.id,
    slug: c.slug,
    name: c.name,
    parentId: c.parent_id,
    sortOrder: c.sort_order,
  }));
});

export const getCategoryScopeIds = cache(async (categoryId: string): Promise<string[]> => {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("taxonomy_categories")
    .select("id, slug, name, parent_id, sort_order");
  logQueryError(`getCategoryScopeIds(${categoryId})`, error);
  // A failed read degrades to the category itself: narrower than intended, but
  // correct as far as it goes. Never wider -- guessing a scope would surface
  // content on a page it does not belong to.
  if (error || !data) return [categoryId];
  return descendantScope(
    categoryId,
    data.map((c) => ({
      id: c.id,
      slug: c.slug,
      name: c.name,
      parentId: c.parent_id,
      sortOrder: c.sort_order,
    }))
  );
});

// Whether a category hub has anything published behind it.
//
// PLANNED_CATEGORIES renders a route for all ten subject areas whether or not
// any of them has content, and most currently show "Coming soon". That is the
// honest thing to render, but it is also, to a crawler, ten near-identical
// thin pages — so this decides indexability and sitemap inclusion. Head-only
// counts: no rows are transferred, just the totals.
export const getCategoryPublishedCounts = cache(async (categoryId: string) => {
  const supabase = await createClient();
  const scope = await getCategoryScopeIds(categoryId);
  const [{ count: productCount, error: productError }, { count: directContentCount, error: contentError }] =
    await Promise.all([
      supabase
        .from("products")
        .select("id", { count: "exact", head: true })
        .in("category_id", scope)
        .eq("is_published", true),
      supabase
        .from("content_items")
        .select("id", { count: "exact", head: true })
        .in("category_id", scope)
        .eq("locale", ROOT_LOCALE)
        .eq("status", "published")
        .lte("published_at", new Date().toISOString()),
    ]);
  logQueryError(`getCategoryPublishedCounts(${categoryId}) products`, productError);
  logQueryError(`getCategoryPublishedCounts(${categoryId}) content`, contentError);

  const products = productCount ?? 0;
  const directContent = directContentCount ?? 0;
  if (products > 0 || directContent > 0) return { productCount: products, contentCount: directContent };

  // Nothing directly attached — but getPublishedContentForCategory also
  // surfaces content whose primary_subject product sits in this category,
  // and that path does not require the product itself to be published. If
  // that route yields anything, the hub is NOT empty, and calling it
  // noindex here would contradict the page the visitor actually gets.
  // Only reached for otherwise-empty categories, so it costs nothing in the
  // common case.
  const indirect = await getPublishedContentForCategory(categoryId);
  return { productCount: 0, contentCount: indirect.length };
});

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
  const scope = await getCategoryScopeIds(categoryId);
  const { data, error } = await supabase
    .from("products")
    .select("id, name, slug, summary, status")
    .in("category_id", scope)
    .eq("is_published", true)
    .order("name");
  logQueryError(`getPublishedProductsForCategory(${categoryId})`, error);
  return attachHeroImages(supabase, data ?? [], "product");
}

// Manufacturers with at least one published product in this category — a
// bounded two-round-trip lookup (product manufacturer_ids, then those
// manufacturers by id), not a per-manufacturer query, so it stays cheap
// even as the catalogue grows.
export async function getManufacturersForCategory(categoryId: string) {
  const supabase = await createClient();
  const scope = await getCategoryScopeIds(categoryId);
  const { data: productRows, error: productsError } = await supabase
    .from("products")
    .select("manufacturer_id")
    .in("category_id", scope)
    .eq("is_published", true);
  logQueryError(`getManufacturersForCategory(${categoryId}) products`, productsError);

  const manufacturerIds = [...new Set((productRows ?? []).map((p) => p.manufacturer_id))];
  if (manufacturerIds.length === 0) return [];

  const { data, error } = await supabase
    .from("manufacturers")
    .select("id, name, slug")
    .in("id", manufacturerIds)
    .order("name");
  logQueryError(`getManufacturersForCategory(${categoryId}) manufacturers`, error);
  return data ?? [];
}

// Content is associated with a category two ways: directly via
// content_items.category_id, or indirectly through a published content
// item whose primary-subject product belongs to this category. Both are
// combined (a piece may be tagged with a category directly without having
// any product association at all).
export async function getPublishedContentForCategory(categoryId: string) {
  const supabase = await createClient();
  const scope = await getCategoryScopeIds(categoryId);

  const [{ data: directContent, error: directError }, { data: productsInCategory, error: productsError }] =
    await Promise.all([
      supabase
        .from("content_items")
        .select("id, title, slug, type, published_at")
        .in("category_id", scope)
        .eq("locale", ROOT_LOCALE)
        .eq("status", "published")
        .lte("published_at", new Date().toISOString()),
      supabase.from("products").select("id").in("category_id", scope),
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
        .eq("locale", ROOT_LOCALE)
        .eq("status", "published")
        .lte("published_at", new Date().toISOString());
      logQueryError(`getPublishedContentForCategory(${categoryId}) indirect`, indirectError);
      for (const c of indirectContent ?? []) contentById.set(c.id, c);
    }
  }

  const sorted = [...contentById.values()].sort((a, b) => (b.published_at ?? "").localeCompare(a.published_at ?? ""));
  return attachHeroImages(supabase, await attachExcerpts(supabase, sorted), "content");
}

export async function getLatestPublishedContent(limit = 6) {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("content_items")
    .select("id, title, slug, type, published_at")
    .eq("locale", ROOT_LOCALE)
    .eq("status", "published")
    .lte("published_at", new Date().toISOString())
    .order("published_at", { ascending: false })
    .limit(limit);
  logQueryError("getLatestPublishedContent", error);
  return attachHeroImages(supabase, await attachExcerpts(supabase, data ?? []), "content");
}

export async function getLatestPublishedGuides(limit = 6) {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("content_items")
    .select("id, title, slug, type, published_at")
    .eq("type", "guide")
    .eq("locale", ROOT_LOCALE)
    .eq("status", "published")
    .lte("published_at", new Date().toISOString())
    .order("published_at", { ascending: false })
    .limit(limit);
  logQueryError("getLatestPublishedGuides", error);
  return attachHeroImages(supabase, await attachExcerpts(supabase, data ?? []), "content");
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
  return attachHeroImages(supabase, data ?? [], "product");
}
