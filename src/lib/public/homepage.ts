import "server-only";
import { cache } from "react";
import { createClient } from "@/lib/supabase/server";
import { logQueryError } from "@/lib/log/query-error";
import { attachExcerpts } from "./excerpt";
import { attachHeroImages } from "./hero-image";
import { freshnessLabel, absoluteDateLabel } from "./dates";
import { PLANNED_CATEGORIES } from "./categories";
import {
  LAUNCH_WINDOW_MONTHS,
  type HomeProduct,
  type HomeStory,
  type HomepageData,
  type SubjectArea,
} from "./homepage-sections";
import { ROOT_LOCALE } from "@/lib/i18n/locales";

// The section-building rules and their types live in ./homepage-sections.ts
// (pure, unit tested). Re-exported here so callers have a single import for the
// homepage's data layer.
export * from "./homepage-sections";

// The homepage's data layer.
//
// ---------------------------------------------------------------------------
// What this may and may not use
// ---------------------------------------------------------------------------
// Everything here is read as `anon`. That constrains what a homepage section
// can honestly be built out of, and the constraint is deliberate rather than
// incidental — see the long note at the top of ./trending.ts. In particular:
//
//   * analytics_daily_rollups / analytics_events / search_intelligence /
//     engine_trends are all admin-only. RLS denies by returning ZERO ROWS, not
//     an error, so querying them from here would look exactly like "nothing is
//     popular" forever and would degrade in silence. They are not queried.
//   * Consequently there is NO view count, traffic figure, or search-volume
//     number available to this page, and therefore no "most viewed" or "most
//     searched" section. Building one would mean inventing the number.
//
// What IS available is real and publicly readable: publication dates, the
// content graph (content_relationships), published hero media, category
// membership, each article's own target question (content_items.primary_query),
// and product release dates. Every section below is built from one of those and
// says only what that signal actually supports.
//
// ---------------------------------------------------------------------------
// Query shape
// ---------------------------------------------------------------------------
// One bounded fetch of recent published content, then every rail on the page is
// derived from it in memory. That keeps a rich homepage at a fixed, small
// number of round trips rather than one query per section. Counts for the
// subject-area grid come from a separate id-only query so they cover the whole
// catalogue, not just the fetched window.
//
// Every query calls logQueryError: a visitor still sees a graceful empty state,
// but a real failure must be visible in the server logs instead of looking
// identical to "nothing published yet" (the 2026-08 anon-grant incident).

/** How much recent content the in-memory section builder gets to work with. */
const STORY_FETCH_LIMIT = 80;
/** Bound on the product queries. Both are small, fixed-size page sections. */
const PRODUCT_FETCH_LIMIT = 60;
const LAUNCH_FETCH_LIMIT = 6;

function monthsAgoIsoDate(months: number, now: number): string {
  const date = new Date(now);
  date.setMonth(date.getMonth() - months);
  return date.toISOString().slice(0, 10);
}

export const getHomepageData = cache(async (): Promise<HomepageData> => {
  const supabase = await createClient();
  const nowIso = new Date().toISOString();
  const now = Date.now();

  const [
    categoriesResult,
    storiesResult,
    countRowsResult,
    productsResult,
    launchesResult,
    relationshipsResult,
  ] = await Promise.all([
      supabase.from("taxonomy_categories").select("id, slug, name, sort_order").is("parent_id", null).order("sort_order"),
      supabase
        .from("content_items")
        .select("id, title, slug, type, published_at, category_id, primary_query")
        .eq("locale", ROOT_LOCALE)
        .eq("status", "published")
        .lte("published_at", nowIso)
        .order("published_at", { ascending: false })
        .limit(STORY_FETCH_LIMIT),
      // id-only, unbounded: the subject-area grid must count the whole
      // catalogue, not just the window fetched above.
      supabase.from("content_items").select("id, category_id")
        .eq("locale", ROOT_LOCALE)
        .eq("status", "published").lte("published_at", nowIso),
      supabase
        .from("products")
        .select("id, name, slug, summary, status, release_date, manufacturer_id, category_id")
        .eq("is_published", true)
        .order("updated_at", { ascending: false })
        .limit(PRODUCT_FETCH_LIMIT),
      supabase
        .from("products")
        .select("id, name, slug, summary, status, release_date, manufacturer_id")
        .eq("is_published", true)
        .gte("release_date", monthsAgoIsoDate(LAUNCH_WINDOW_MONTHS, now))
        .order("release_date", { ascending: false })
        .limit(LAUNCH_FETCH_LIMIT),
      // The content graph, in both directions — the same signal
      // getTrendingContent uses, and readable by anon only when both sides of
      // the relationship are published.
      supabase.from("content_relationships").select("content_id, related_content_id"),
    ]);

  logQueryError("getHomepageData categories", categoriesResult.error);
  logQueryError("getHomepageData stories", storiesResult.error);
  logQueryError("getHomepageData counts", countRowsResult.error);
  logQueryError("getHomepageData products", productsResult.error);
  logQueryError("getHomepageData launches", launchesResult.error);
  logQueryError("getHomepageData relationships", relationshipsResult.error);

  const categories = categoriesResult.data ?? [];
  const categoryById = new Map(categories.map((c) => [c.id, c]));
  const rows = storiesResult.data ?? [];

  const degree = new Map<string, number>();
  for (const rel of relationshipsResult.data ?? []) {
    degree.set(rel.content_id, (degree.get(rel.content_id) ?? 0) + 1);
    degree.set(rel.related_content_id, (degree.get(rel.related_content_id) ?? 0) + 1);
  }

  const withMedia = await attachHeroImages(supabase, await attachExcerpts(supabase, rows), "content");
  const stories: HomeStory[] = withMedia.map((row) => {
    const category = row.category_id ? categoryById.get(row.category_id) : undefined;
    return {
      id: row.id,
      title: row.title,
      slug: row.slug,
      type: row.type,
      publishedAt: row.published_at,
      freshness: freshnessLabel(row.published_at, now),
      dateLabel: absoluteDateLabel(row.published_at),
      excerpt: row.excerpt,
      heroImage: row.heroImage,
      categorySlug: category?.slug ?? null,
      categoryLabel: category?.name ?? null,
      primaryQuery: row.primary_query,
      referenceCount: degree.get(row.id) ?? 0,
    };
  });

  const productRows = productsResult.data ?? [];
  const launchRows = launchesResult.data ?? [];

  // The two product queries overlap, so media and manufacturer names are
  // resolved once over the union rather than twice.
  type ProductRow = {
    id: string;
    name: string;
    slug: string;
    summary: string | null;
    status: string;
    release_date: string | null;
    manufacturer_id: string;
  };
  const productRowById = new Map<string, ProductRow>();
  for (const row of [...productRows, ...launchRows]) productRowById.set(row.id, row);
  const allProductRows = [...productRowById.values()];

  const manufacturerIds = [...new Set(allProductRows.map((p) => p.manufacturer_id))];
  const { data: manufacturerRows, error: manufacturersError } =
    manufacturerIds.length > 0
      ? await supabase.from("manufacturers").select("id, name").in("id", manufacturerIds)
      : { data: [] as { id: string; name: string }[], error: null };
  logQueryError("getHomepageData manufacturers", manufacturersError);
  const manufacturerNameById = new Map((manufacturerRows ?? []).map((m) => [m.id, m.name]));

  const productsWithMedia = await attachHeroImages(supabase, allProductRows, "product");
  const homeProductById = new Map<string, HomeProduct>(
    productsWithMedia.map((row) => [
      row.id,
      {
        id: row.id,
        name: row.name,
        slug: row.slug,
        summary: row.summary,
        status: row.status,
        releaseDate: row.release_date,
        releaseLabel: absoluteDateLabel(row.release_date),
        manufacturerName: manufacturerNameById.get(row.manufacturer_id) ?? null,
        heroImage: row.heroImage,
      },
    ])
  );

  const resolve = (ids: { id: string }[]): HomeProduct[] =>
    ids.map((r) => homeProductById.get(r.id)).filter((p): p is HomeProduct => Boolean(p));
  const products = resolve(productRows);
  const recentLaunches = resolve(launchRows);

  // Real counts, from real rows. Categories with nothing published show zero —
  // which is the honest thing for the grid to say, and is what distinguishes a
  // genuinely empty subject area from one the homepage merely didn't feature.
  const articleCountByCategoryId = new Map<string, number>();
  for (const row of countRowsResult.data ?? []) {
    if (!row.category_id) continue;
    articleCountByCategoryId.set(row.category_id, (articleCountByCategoryId.get(row.category_id) ?? 0) + 1);
  }
  const productCountByCategoryId = new Map<string, number>();
  for (const row of productRows) {
    productCountByCategoryId.set(row.category_id, (productCountByCategoryId.get(row.category_id) ?? 0) + 1);
  }

  const subjectAreas: SubjectArea[] = categories.map((c) => ({
    slug: c.slug,
    name: c.name,
    articleCount: articleCountByCategoryId.get(c.id) ?? 0,
    productCount: productCountByCategoryId.get(c.id) ?? 0,
  }));

  // The curated navigation list (PLANNED_CATEGORIES) is what the header and
  // footer link to, so an area advertised there but not yet created in
  // taxonomy_categories must still appear in the grid — with zero counts and an
  // honest "nothing published yet", not silently missing while the nav keeps
  // linking to it.
  const knownSlugs = new Set(subjectAreas.map((a) => a.slug));
  for (const planned of PLANNED_CATEGORIES) {
    if (knownSlugs.has(planned.slug)) continue;
    subjectAreas.push({ slug: planned.slug, name: planned.label, articleCount: 0, productCount: 0 });
  }

  return {
    stories,
    subjectAreas,
    totalArticles: (countRowsResult.data ?? []).length,
    lastPublished: stories[0]?.freshness ?? null,
    products,
    recentLaunches,
  };
});
