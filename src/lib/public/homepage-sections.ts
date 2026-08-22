import type { HeroImage } from "./hero-image";

// The homepage's section rules, split out from the fetching in ./homepage.ts.
//
// This file is deliberately pure and free of `server-only` so the rules can be
// unit tested (`npm test`) — they are the business rules that decide whether a
// section is honest enough to exist, which is exactly the class of thing this
// project tests. `import type` on HeroImage is erased at compile time, so
// nothing pulls the server-only data layer in behind it.
//
// The rule every threshold below serves: a section appears only when there is
// enough REAL published content to fill it. There is no decorative section, no
// placeholder row, and no filler. A section that would have to be padded out
// simply does not render.

/** A category needs at least this many available stories to earn a section. */
export const CATEGORY_SECTION_MIN_STORIES = 4;
/** Stories rendered inside one category section (1 lead + the rest as rows). */
export const CATEGORY_SECTION_SIZE = 4;
/**
 * Cap on category sections. Not a data limit — an editorial one: past roughly
 * half a dozen the page stops reading as a front page and starts reading as a
 * sitemap.
 */
export const MAX_CATEGORY_SECTIONS = 6;

/** "Most referenced" needs enough entries to read as a ranking, not a fluke. */
export const REFERENCED_GUIDES_MIN = 3;
export const REFERENCED_GUIDES_MAX = 4;

/** The question rail is a grid; below a full grid it looks like an accident. */
export const QUESTION_RAIL_MIN = 9;
export const QUESTION_RAIL_MAX = 12;
export const QUESTIONS_PER_CATEGORY = 2;

/**
 * How recently a product must have been released to count as a "new release".
 * A catalogue of well-documented older hardware is a legitimate thing to have;
 * calling it "latest launches" would not be, so the section simply does not
 * render when nothing falls inside the window.
 */
export const LAUNCH_WINDOW_MONTHS = 18;
export const LAUNCH_SECTION_MIN = 3;

export const LATEST_GRID_SIZE = 6;
export const CATALOGUE_GRID_SIZE = 6;

export type HomeStory = {
  id: string;
  title: string;
  slug: string;
  type: string;
  publishedAt: string | null;
  /** "3h ago" / "2d ago" / an absolute date. Never fabricated when absent. */
  freshness: string | null;
  dateLabel: string | null;
  excerpt: string | null;
  heroImage: HeroImage | null;
  categorySlug: string | null;
  categoryLabel: string | null;
  /** The single question this piece was written to answer, when recorded. */
  primaryQuery: string | null;
  /**
   * How many published articles this one is linked to or from. Real, publicly
   * readable editorial structure — NOT a popularity or traffic measure.
   */
  referenceCount: number;
};

export type HomeProduct = {
  id: string;
  name: string;
  slug: string;
  summary: string | null;
  status: string;
  releaseDate: string | null;
  releaseLabel: string | null;
  manufacturerName: string | null;
  heroImage: HeroImage | null;
};

export type SubjectArea = {
  slug: string;
  name: string;
  articleCount: number;
  productCount: number;
};

export type HomepageData = {
  /** Recent published content, newest first, with media and excerpts attached. */
  stories: HomeStory[];
  /** Top-level categories with real published counts across the whole site. */
  subjectAreas: SubjectArea[];
  totalArticles: number;
  /** Freshness of the newest published article, or null if nothing is live. */
  lastPublished: string | null;
  products: HomeProduct[];
  recentLaunches: HomeProduct[];
};

export type CategorySection = {
  slug: string;
  name: string;
  lead: HomeStory;
  rest: HomeStory[];
};

export type HomeQuestion = {
  id: string;
  slug: string;
  query: string;
  categoryLabel: string | null;
};

export type HomepageSections = {
  latest: HomeStory[];
  categorySections: CategorySection[];
  referencedGuides: HomeStory[];
  questions: HomeQuestion[];
  catalogue: HomeProduct[];
  recentLaunches: HomeProduct[];
};

/**
 * Turns the fetched data into the page's sections.
 *
 * Pure, so the "does this section have enough real content to exist?" rules are
 * all in one readable, testable place. `excludeIds` carries whatever the
 * Trending block already used, so no story appears twice on one screen.
 */
export function composeHomepage(data: HomepageData, excludeIds: Iterable<string>): HomepageSections {
  const used = new Set<string>(excludeIds);
  const take = (items: HomeStory[], count: number): HomeStory[] => {
    const picked: HomeStory[] = [];
    for (const item of items) {
      if (picked.length >= count) break;
      if (used.has(item.id)) continue;
      used.add(item.id);
      picked.push(item);
    }
    return picked;
  };

  const latest = take(data.stories, LATEST_GRID_SIZE);

  // Category sections: only categories that still have a full section's worth
  // of unused stories qualify, richest first so the strongest areas lead.
  const remainingByCategory = new Map<string, HomeStory[]>();
  for (const story of data.stories) {
    if (used.has(story.id) || !story.categorySlug) continue;
    const bucket = remainingByCategory.get(story.categorySlug);
    if (bucket) bucket.push(story);
    else remainingByCategory.set(story.categorySlug, [story]);
  }

  const categorySections: CategorySection[] = [...remainingByCategory.entries()]
    .filter(([, items]) => items.length >= CATEGORY_SECTION_MIN_STORIES)
    .sort((a, b) => b[1].length - a[1].length || a[0].localeCompare(b[0]))
    .slice(0, MAX_CATEGORY_SECTIONS)
    .flatMap(([slug, items]): CategorySection[] => {
      const picked = take(items, CATEGORY_SECTION_SIZE);
      if (picked.length === 0) return [];
      // Prefer a lead that has real imagery, but never drop a story for
      // lacking one — a media gap must not silently suppress coverage.
      const leadIndex = Math.max(
        picked.findIndex((s) => s.heroImage),
        0
      );
      const [lead] = picked.splice(leadIndex, 1);
      return [{ slug, name: items[0].categoryLabel ?? slug, lead, rest: picked }];
    });

  // "Most referenced" is the content graph, not traffic: how many other
  // published articles point at this guide. Anything with no inbound or
  // outbound link is excluded rather than padded in at rank 4.
  const referencedGuides = data.stories
    .filter((s) => s.type === "guide" && s.referenceCount > 0)
    .sort((a, b) => b.referenceCount - a.referenceCount || (b.publishedAt ?? "").localeCompare(a.publishedAt ?? ""))
    .slice(0, REFERENCED_GUIDES_MAX);

  // The questions rail is content_items.primary_query — the question each piece
  // was written to answer. It is emphatically NOT search volume (no such data
  // is readable here), and the section copy says so. Spread across categories
  // so it reads as the breadth of the site rather than one topic repeated.
  const perCategory = new Map<string, number>();
  const questions: HomeQuestion[] = [];
  for (const story of data.stories) {
    if (questions.length >= QUESTION_RAIL_MAX) break;
    const query = story.primaryQuery?.trim();
    if (!query) continue;
    const key = story.categorySlug ?? "";
    const seen = perCategory.get(key) ?? 0;
    if (seen >= QUESTIONS_PER_CATEGORY) continue;
    perCategory.set(key, seen + 1);
    questions.push({ id: story.id, slug: story.slug, query, categoryLabel: story.categoryLabel });
  }

  return {
    latest,
    categorySections,
    referencedGuides: referencedGuides.length >= REFERENCED_GUIDES_MIN ? referencedGuides : [],
    questions: questions.length >= QUESTION_RAIL_MIN ? questions : [],
    catalogue: data.products.slice(0, CATALOGUE_GRID_SIZE),
    recentLaunches: data.recentLaunches.length >= LAUNCH_SECTION_MIN ? data.recentLaunches : [],
  };
}
