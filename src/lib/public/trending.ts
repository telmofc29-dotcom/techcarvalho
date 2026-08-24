import "server-only";
import { cache } from "react";
import { createClient } from "@/lib/supabase/server";
import { logQueryError } from "@/lib/log/query-error";
import { attachExcerpts } from "./excerpt";
import { attachHeroImages, type HeroImage } from "./hero-image";
import { classifyMediaTier, tierRank, type MediaTier } from "@/lib/media/hierarchy";
// Shared with the rest of the public data layer so "3h ago" means the same
// thing in every rail on the page (see src/lib/public/dates.ts for why the
// clock is read here rather than in a component).
import { freshnessLabel } from "./dates";
import { diversifyByMedia, visualKind } from "./visual-variety";
import { ROOT_LOCALE } from "@/lib/i18n/locales";

// Deterministic "Trending Now" ranking for the public homepage and category
// pages.
//
// ---------------------------------------------------------------------------
// Why this does NOT use analytics
// ---------------------------------------------------------------------------
// The obvious ranking input would be engagement from analytics_daily_rollups.
// It is deliberately not used here, and this is a security decision rather than
// an oversight: that table is granted only to `authenticated` and carries an
// admin-only RLS policy (see 20260821_first_party_analytics.sql). The public
// homepage renders as `anon`, so reading it would mean granting anonymous
// visitors access to raw analytics — which this project explicitly forbids.
//
// Crucially, RLS denies by returning ZERO ROWS rather than an error. Querying
// it from the public path would therefore look exactly like "nothing is
// popular" forever, and would silently degrade with nothing in the logs — the
// precise failure mode of the 2026-08 anon-grant incident. So the public path
// does not query it at all.
//
// engine_trends is unavailable here for the same reason (admin-only RLS).
//
// ---------------------------------------------------------------------------
// What it uses instead — all publicly readable, all real
// ---------------------------------------------------------------------------
// 1. RECENCY, with a per-type half-life. A news item stops being "trending"
//    within days; an evergreen buying guide stays relevant for months. Using
//    one decay curve for both would either bury guides instantly or leave
//    stale news on the homepage.
// 2. CLUSTER CENTRALITY — how many content_relationships an article sits at
//    the centre of. This is publicly readable (scoped to published content)
//    and is a genuine editorial-importance signal: a pillar article that four
//    supporting pieces point at matters more than an unlinked one-off.
// 3. HERO IMAGE PRESENCE — a small bonus, used to prefer a visual lead. It is
//    a tie-breaker, never a filter: an item is never excluded for lacking an
//    image, because that would let a media gap silently suppress the best
//    story.
//
// None of these fabricate popularity. If the site has three articles, this
// ranks those three honestly rather than inventing a trend.

/** Half-life in hours, by content type. Governs how fast recency decays. */
const HALF_LIFE_HOURS: Record<string, number> = {
  news: 48, // ~2 days: news is stale fast
  comparison: 24 * 21, // 3 weeks
  review: 24 * 30, // 1 month
  troubleshooting: 24 * 45, // 6-7 weeks: problems stay relevant
  guide: 24 * 45,
};
const DEFAULT_HALF_LIFE_HOURS = 24 * 30;

/** Weighting of each signal in the final score. Documented and deterministic. */
const WEIGHTS = {
  recency: 70,
  centrality: 22,
  hero: 8,
} as const;

// How much each media tier contributes to the `hero` component.
//
// Previously this was binary — any hero image scored 1. That is how the
// homepage lead came to be a Wi-Fi certification TIMELINE: a diagram counted
// exactly as much as a photograph, so the slot went to whatever ranked highest
// on recency and centrality regardless of whether it showed anything.
//
// A visitor's first impression should be of a subject they recognise. This
// does not exclude anything: a data graphic still scores, and hero is only 8
// of ~100 points, so a genuinely stronger story still leads. It breaks ties
// toward showing the reader a real thing.
const HERO_TIER_SCORE: Record<MediaTier, number> = {
  real_subject: 1,
  original_photo: 1,
  official_permitted: 1,
  licensed_third_party: 0.85,
  original_render: 0.6,
  data_graphic: 0.4,
  generic_graphic: 0.2,
  missing: 0,
};

/**
 * Tier of a hero image, judged from what the data layer already carries.
 *
 * `url` stands in for `storage_path`: the public URL ends in the same
 * filename, and the filename prefix is what distinguishes a generated chart
 * from a generated title card.
 */
function heroTier(hero: HeroImage | null): MediaTier {
  if (!hero) return "missing";
  return classifyMediaTier({
    source_type: hero.sourceType ?? null,
    asset_role: null,
    owned: hero.owned ?? null,
    ai_generated: hero.aiGenerated ?? null,
    storage_path: hero.url,
    source_url: hero.sourceUrl ?? null,
    license: hero.license ?? null,
  });
}

/** Relationship count at which centrality is considered maxed out. */
const CENTRALITY_SOFT_CAP = 5;

export type TrendingItem = {
  id: string;
  title: string;
  slug: string;
  type: string;
  published_at: string | null;
  excerpt: string | null;
  heroImage: HeroImage | null;
  categorySlug: string | null;
  categoryLabel: string | null;
  /** 0-100, transparent and recomputed on every render. */
  trendScore: number;
  /** Whether an admin pinned this into position. */
  pinned: boolean;
  /**
   * Human-readable freshness ("3h ago", "2d ago", or an absolute date).
   * Computed here rather than in the card component because reading the clock
   * during render is an impure operation (react-hooks/purity) — the data layer
   * is the correct place for it.
   */
  freshnessLabel: string | null;
};

export type TrendingResult = {
  lead: TrendingItem | null;
  supporting: TrendingItem[];
  /**
   * True when ranking had nothing but recency to work with (no relationships,
   * no pins) — i.e. this is effectively "latest published". Surfaced so the UI
   * can label the section honestly rather than implying measured popularity.
   */
  isRecencyFallback: boolean;
};

function recencyScore(publishedAt: string | null, type: string): number {
  if (!publishedAt) return 0;
  const ageMs = Date.now() - new Date(publishedAt).getTime();
  if (Number.isNaN(ageMs)) return 0;
  const ageHours = Math.max(ageMs / 3_600_000, 0);
  const halfLife = HALF_LIFE_HOURS[type] ?? DEFAULT_HALF_LIFE_HOURS;
  // Exponential decay: 1.0 at publication, 0.5 at one half-life, etc.
  return Math.pow(0.5, ageHours / halfLife);
}

/**
 * Ranked trending content for the public site.
 *
 * @param categorySlug when set, restricts to a single category (used by
 *   category pages for their "trending in this category" block).
 */
export const getTrendingContent = cache(
  async (options?: { categorySlug?: string; supportingCount?: number }): Promise<TrendingResult> => {
    const supportingCount = Math.min(Math.max(options?.supportingCount ?? 4, 3), 5);
    const supabase = await createClient();

    // Pull a bounded recent window rather than the whole table. 40 is
    // comfortably more than the 1 lead + 5 supporting we can show, so
    // centrality/pin reordering has real candidates to work with, while
    // staying a single cheap query.
    let query = supabase
      .from("content_items")
      .select("id, title, slug, type, published_at, category_id")
      .eq("locale", ROOT_LOCALE)
      .eq("status", "published")
      .lte("published_at", new Date().toISOString())
      .order("published_at", { ascending: false })
      .limit(40);

    // Category pages filter to one category. Resolved to an id first because
    // content_items stores category_id, not the slug.
    let categoryId: string | null = null;
    let categoryLabelBySlug = new Map<string, string>();
    const { data: categories, error: categoriesError } = await supabase
      .from("taxonomy_categories")
      .select("id, slug, name");
    logQueryError("getTrendingContent categories", categoriesError);
    const categoryById = new Map((categories ?? []).map((c) => [c.id, c]));
    categoryLabelBySlug = new Map((categories ?? []).map((c) => [c.slug, c.name]));

    if (options?.categorySlug) {
      categoryId = (categories ?? []).find((c) => c.slug === options.categorySlug)?.id ?? null;
      // An unknown slug must return nothing, not silently rank the whole site.
      if (!categoryId) return { lead: null, supporting: [], isRecencyFallback: true };
      query = query.eq("category_id", categoryId);
    }

    const { data: rows, error } = await query;
    logQueryError(`getTrendingContent(${options?.categorySlug ?? "all"})`, error);
    if (!rows || rows.length === 0) {
      return { lead: null, supporting: [], isRecencyFallback: true };
    }

    // Admin overrides are NOT publicly readable — homepage_overrides has no
    // anon grant (see 20260822_phase5_secure_homepage.sql). Exposing it would
    // publish editorial intent: a `suppress` row reveals that an admin chose
    // to hide a specific published article.
    //
    // Instead the final selection comes from public_homepage_selection(), a
    // SECURITY DEFINER function that reads overrides inside the security
    // barrier and returns only the resulting set. We use it to learn WHICH
    // items are eligible and pinned; the richer presentation data (hero
    // images, excerpts, category labels) is still assembled here from
    // publicly-readable tables.
    // THE DAILY ROTATION IS THE AUTHORITY WHEN ONE HAS BEEN RECORDED.
    //
    // public_spotlight returns the rotation the nightly stage chose: the same
    // content_id/role shape as public_homepage_selection, so everything below
    // this point is unchanged. What differs is only WHICH items and which is
    // lead — score order versus whose turn it is.
    //
    // Without this the rotation was recorded and then ignored: the log filled
    // up, the admin panel showed a rotation, and readers still got the same
    // five score-ordered stories. That is a worse state than not rotating at
    // all, because everything looks like it is working.
    //
    // The fallback is not decoration. Before the rotation migration is applied,
    // and on any day the nightly stage did not run, public_spotlight returns
    // nothing and the existing ranking serves the page exactly as it always
    // has. The homepage is never empty because a rotation is missing.
    const [spotlightResult, selectionResult, relationshipsResult] = await Promise.all([
      supabase.rpc("public_spotlight", { p_rotation_date: null }),
      supabase.rpc("public_homepage_selection", { p_supporting: 8 }),
      supabase.from("content_relationships").select("content_id, related_content_id"),
    ]);
    logQueryError("getTrendingContent relationships", relationshipsResult.error);

    // The RPC is the authority on suppression and pinning. If it is
    // unavailable (not yet deployed), fall back to ranking WITHOUT overrides
    // rather than attempting to read the table directly — a fallback that
    // tried the table would fail closed to "no rows" under RLS and silently
    // look like "nothing is pinned" forever.
    const rotationRows = (spotlightResult.data ?? []) as { content_id: string; role: string }[];
    // A missing public_spotlight (PGRST202) is the expected state before the
    // rotation migration is applied, not a failure worth logging. Anything
    // else is.
    if (
      spotlightResult.error &&
      !/PGRST202|could not find the function/i.test(spotlightResult.error.message)
    ) {
      logQueryError("getTrendingContent public_spotlight", spotlightResult.error);
    }

    const rankingRows = (selectionResult.data ?? []) as { content_id: string; role: string }[];
    if (selectionResult.error) {
      logQueryError("getTrendingContent public_homepage_selection", selectionResult.error);
    }

    const selectionRows = rotationRows.length > 0 ? rotationRows : rankingRows;
    const selectionAvailable = selectionRows.length > 0;

    const allowedIds = selectionAvailable ? new Set(selectionRows.map((r) => r.content_id)) : null;
    const overrideMode = new Map<string, string>(
      selectionRows.filter((r) => r.role === "lead").map((r) => [r.content_id, "pin_lead"])
    );

    // Degree = how many published relationships touch this item, in either
    // direction. RLS already scopes these rows to published content.
    const degree = new Map<string, number>();
    for (const rel of relationshipsResult.data ?? []) {
      degree.set(rel.content_id, (degree.get(rel.content_id) ?? 0) + 1);
      degree.set(rel.related_content_id, (degree.get(rel.related_content_id) ?? 0) + 1);
    }

    // Suppression is enforced by the RPC: anything it omitted is either
    // suppressed or did not rank, and we cannot (and need not) tell which.
    // When the RPC is unavailable we rank everything rather than guessing.
    const candidates = allowedIds ? rows.filter((r) => allowedIds.has(r.id)) : rows;
    if (candidates.length === 0) {
      return { lead: null, supporting: [], isRecencyFallback: true };
    }

    const withMedia = await attachHeroImages(
      supabase,
      await attachExcerpts(supabase, candidates),
      "content"
    );

    const scored: TrendingItem[] = withMedia.map((row) => {
      const recency = recencyScore(row.published_at, row.type);
      const centrality = Math.min((degree.get(row.id) ?? 0) / CENTRALITY_SOFT_CAP, 1);
      const hero = HERO_TIER_SCORE[heroTier(row.heroImage)];
      const score =
        recency * WEIGHTS.recency + centrality * WEIGHTS.centrality + hero * WEIGHTS.hero;
      const category = row.category_id ? categoryById.get(row.category_id) : undefined;
      return {
        id: row.id,
        title: row.title,
        slug: row.slug,
        type: row.type,
        published_at: row.published_at,
        excerpt: row.excerpt,
        heroImage: row.heroImage,
        categorySlug: category?.slug ?? null,
        categoryLabel: category?.name ?? categoryLabelBySlug.get(options?.categorySlug ?? "") ?? null,
        trendScore: Number(Math.min(score, 100).toFixed(2)),
        pinned: overrideMode.has(row.id),
        freshnessLabel: freshnessLabel(row.published_at),
      };
    });

    scored.sort((a, b) => b.trendScore - a.trendScore);

    // Admin pins win over the computed score.
    const pinnedLead = scored.find((s) => overrideMode.get(s.id) === "pin_lead") ?? null;
    const pinnedSupporting = scored.filter((s) => overrideMode.get(s.id) === "pin_supporting");

    // Prefer a lead that actually has an image — a "highly visual lead" is the
    // whole point of the section. This only reorders among the strongest
    // candidates; it never promotes a weak item just for having a picture, and
    // never excludes an item for lacking one.
    let lead = pinnedLead;
    if (!lead) {
      // Among the strongest candidates, prefer the one that actually shows
      // its subject — a photograph over a chart, a chart over a title card.
      // Still never promotes a weak story just for having a picture: the
      // slice is already the top five by score.
      const topSlice = scored.slice(0, 5);
      lead =
        [...topSlice].sort((a, b) => tierRank(heroTier(a.heroImage)) - tierRank(heroTier(b.heroImage)))[0] ??
        scored[0] ??
        null;
    }

    const supporting: TrendingItem[] = [];
    const used = new Set<string>(lead ? [lead.id] : []);
    for (const item of [...pinnedSupporting, ...scored]) {
      if (supporting.length >= supportingCount) break;
      if (used.has(item.id)) continue;
      used.add(item.id);
      supporting.push(item);
    }

    // VISUAL VARIETY, measured from the live homepage before this existed:
    //   above the fold  4 of 4  images were generated graphics (100%)
    //   first ten       9 of 10                                 (90%)
    //   whole page      9 of 44                                 (20%)
    //
    // The site is not short of photography. Every photograph was simply below
    // the fold, because ranking is by recency and centrality and the pieces
    // that rank highest are the explainers — which legitimately carry diagrams.
    // So the first thing a reader saw was four diagrams in a row, and the page
    // read as synthetic despite four fifths of its images being photographs.
    //
    // This reorders the supporting rail ONLY. It changes nothing about which
    // stories are selected, moves nothing more than two places from its ranked
    // position, and breaks a run of photographs exactly as readily as a run of
    // graphics — a diagram is frequently the best image a story has, and
    // demoting graphics as a class would be a different mistake. Pinned items
    // keep their editorial position because a pin IS the decision.
    const pinnedIds = new Set(pinnedSupporting.map((p) => p.id));
    const diversified = diversifyByMedia(
      supporting.map((item, index) => ({
        item,
        rank: index,
        kind: pinnedIds.has(item.id)
          ? ("none" as const)
          : visualKind({
              hasImage: !!item.heroImage,
              sourceType: item.heroImage?.sourceType ?? null,
              assetRole: null,
            }),
      }))
    ).map((w) => w.item);
    supporting.length = 0;
    supporting.push(...diversified);

    // If nothing has relationships and nothing is pinned, the ordering is
    // recency alone — the UI is told so it can avoid claiming more than that.
    const hasSignalBeyondRecency =
      overrideMode.size > 0 || scored.some((s) => (degree.get(s.id) ?? 0) > 0);

    return { lead, supporting, isRecencyFallback: !hasSignalBeyondRecency };
  }
);
