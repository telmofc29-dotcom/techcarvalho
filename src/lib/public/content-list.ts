import "server-only";
import { createClient } from "@/lib/supabase/server";
import { logQueryError } from "@/lib/log/query-error";
import { attachExcerpts } from "./excerpt";
import { attachHeroImages, type HeroImage } from "./hero-image";
import type { ContentType } from "@/lib/types/database";

const PAGE_SIZE = 24;

export async function getPublishedContentPage(page: number, type?: ContentType) {
  const supabase = await createClient();
  const from = (page - 1) * PAGE_SIZE;
  const to = from + PAGE_SIZE - 1;

  let query = supabase
    .from("content_items")
    .select("id, title, slug, type, published_at", { count: "exact" })
    .eq("status", "published")
    .lte("published_at", new Date().toISOString())
    .order("published_at", { ascending: false })
    .range(from, to);
  if (type) query = query.eq("type", type);

  const { data, count, error } = await query;
  logQueryError(`getPublishedContentPage(${page}, ${type ?? "all"})`, error);
  const total = count ?? 0;
  const content = await attachHeroImages(supabase, await attachExcerpts(supabase, data ?? []), "content");

  return { content, total, pageCount: Math.max(1, Math.ceil(total / PAGE_SIZE)) };
}

// ---------------------------------------------------------------------------
// A category hub's article list, split into "which rows" and "enrich the ones
// this page shows".
//
// This is the paginated counterpart of getPublishedContentForCategory() in
// queries.ts, which returns every published article for a category and remains
// what getCategoryPublishedCounts() uses to decide whether a hub is empty at
// all. The association rules are identical and deliberately so: an article
// belongs to a category directly (content_items.category_id) or through the
// category of the product it is the primary subject of.
//
// WHY THE SPLIT. The row fetch is cheap text columns, and having the whole
// ordered list in hand is what lets the hub compute an exact page count across
// BOTH of its card sections before it commits to a page number. What actually
// costs bytes and round trips is the ENRICHMENT — excerpts (another table),
// hero images (two more queries), and then one image download per rendered
// card. So every row is listed, and only the twelve this page renders are
// enriched. Before this, /cameras-photography enriched and rendered all 35 of
// its cards on every single visit.
//
// ORDERING. The hub renders guides and comparisons above everything else, and
// that split has to survive pagination: bucketing per-page would scatter the
// guides across pages and leave page 2 with a "Guides & comparisons" heading
// over whatever happened to land there. Ordering the whole list guides-first,
// then by recency, keeps each page's slice contiguous within a bucket, and
// makes a hub that fits on one page render exactly as it did before
// pagination existed.
// ---------------------------------------------------------------------------

/** Types the category hub promotes into its "Guides & comparisons" section. */
const EVERGREEN_TYPES = new Set(["guide", "comparison"]);

export type CategoryContentRow = {
  id: string;
  title: string;
  slug: string;
  type: string;
  published_at: string | null;
};

/** Every published article on a category hub, in render order. Unenriched — see enrichContentCards. */
export async function getCategoryContentRows(categoryId: string): Promise<CategoryContentRow[]> {
  const supabase = await createClient();
  const now = new Date().toISOString();

  const [{ data: directContent, error: directError }, { data: productsInCategory, error: productsError }] =
    await Promise.all([
      supabase
        .from("content_items")
        .select("id, title, slug, type, published_at")
        .eq("category_id", categoryId)
        .eq("status", "published")
        .lte("published_at", now),
      supabase.from("products").select("id").eq("category_id", categoryId),
    ]);
  logQueryError(`getCategoryContentRows(${categoryId}) direct`, directError);
  logQueryError(`getCategoryContentRows(${categoryId}) products`, productsError);

  const contentById = new Map<string, CategoryContentRow>((directContent ?? []).map((c) => [c.id, c]));

  const productIds = (productsInCategory ?? []).map((p) => p.id);
  if (productIds.length > 0) {
    const { data: links, error: linksError } = await supabase
      .from("content_products")
      .select("content_id")
      .eq("role", "primary_subject")
      .in("product_id", productIds);
    logQueryError(`getCategoryContentRows(${categoryId}) links`, linksError);
    const indirectIds = [...new Set((links ?? []).map((l) => l.content_id))].filter((id) => !contentById.has(id));

    if (indirectIds.length > 0) {
      const { data: indirectContent, error: indirectError } = await supabase
        .from("content_items")
        .select("id, title, slug, type, published_at")
        .in("id", indirectIds)
        .eq("status", "published")
        .lte("published_at", now);
      logQueryError(`getCategoryContentRows(${categoryId}) indirect`, indirectError);
      for (const c of indirectContent ?? []) contentById.set(c.id, c);
    }
  }

  return [...contentById.values()].sort((a, b) => {
    const evergreen = Number(EVERGREEN_TYPES.has(b.type)) - Number(EVERGREEN_TYPES.has(a.type));
    if (evergreen !== 0) return evergreen;
    return (b.published_at ?? "").localeCompare(a.published_at ?? "");
  });
}

/** Attaches excerpts and hero images to the article rows a page actually renders. */
export async function enrichContentCards<T extends { id: string }>(
  rows: T[]
): Promise<(T & { excerpt: string | null; heroImage: HeroImage | null })[]> {
  if (rows.length === 0) return [];
  const supabase = await createClient();
  return attachHeroImages(supabase, await attachExcerpts(supabase, rows), "content");
}
