// ---------------------------------------------------------------------------
// Hub pagination arithmetic.
//
// /articles and /products have paginated at 24 cards since they were built.
// The three *hub* families — /[category], /families/[slug],
// /manufacturers/[slug] — did not, and were unbounded: a hub rendered every
// published row it could find. Measured against production,
// /cameras-photography was 35 cards / 15,930px tall and /manufacturers/canon
// 33 cards / 15,138px, and both grow with the catalogue rather than with
// anything a visitor asked for.
//
// A hub is not shaped like an index. An index is one list; a hub carries TWO
// card lists (products and articles) plus rails. So the hub page size is
// expressed per SECTION, at half the 24-card index budget, which keeps the
// total card budget of a hub page identical to the budget of an /articles or
// /products page. One `?page=` param drives both sections — two independent
// page params would multiply the crawlable URL space of every hub by itself
// for no reader benefit.
//
// Pure and dependency-free (no "server-only", no imports) so the arithmetic is
// unit-testable and so the pagination COMPONENT can share the same window
// logic as the pages.
// ---------------------------------------------------------------------------

/**
 * Cards per section per hub page. Half of the 24 an index page shows, because
 * a hub page shows up to two sections — so a full hub page and a full index
 * page cost the reader the same 24 cards.
 */
export const HUB_SECTION_PAGE_SIZE = 12;

/**
 * Reads a `?page=` value off a Next.js searchParams bag.
 *
 * Deliberately strict: only a run of digits is a page number. `Number()` alone
 * accepts "2.5", "1e3", " 3 " and "-0", each of which would then be echoed
 * back into the canonical URL as if it were a real page. Anything that is not
 * a plain positive integer resolves to page 1, whose canonical is the bare
 * path — so junk collapses onto the hub itself instead of minting a crawlable
 * variant.
 */
export function parsePageParam(raw: string | string[] | undefined | null): number {
  const value = Array.isArray(raw) ? raw[0] : raw;
  if (value === undefined || value === null) return 1;
  const text = String(value);
  if (!/^\d+$/.test(text)) return 1;
  const parsed = Number(text);
  if (!Number.isSafeInteger(parsed) || parsed < 1) return 1;
  return parsed;
}

/** Pages needed to show `total` items at `pageSize`. Never less than 1: a hub with nothing on it is still page 1 of 1. */
export function pageCountFor(total: number, pageSize: number): number {
  if (!Number.isFinite(total) || total <= 0) return 1;
  if (!Number.isFinite(pageSize) || pageSize <= 0) return 1;
  return Math.max(1, Math.ceil(total / pageSize));
}

/**
 * Resolves the one page number a multi-section hub is on.
 *
 * `sectionTotals` is the total row count of each card section (products,
 * articles, …). The hub has as many pages as its longest section needs, so a
 * hub with 22 products and 9 articles is 2 pages: page 2 carries the remaining
 * products and no articles, rather than repeating the articles.
 *
 * The requested page is CLAMPED into range rather than rendering an empty
 * page. `?page=999` would otherwise be an unbounded supply of crawlable,
 * self-canonicalising near-empty URLs; clamping means it renders the real last
 * page and — because the caller canonicalises the *returned* page, not the
 * requested one — declares that real page as its canonical.
 */
export function resolveHubPage(
  sectionTotals: number[],
  requestedPage: number,
  pageSize: number
): { page: number; pageCount: number } {
  const pageCount = sectionTotals.reduce((most, total) => Math.max(most, pageCountFor(total, pageSize)), 1);
  const page = Math.min(Math.max(1, Math.floor(requestedPage) || 1), pageCount);
  return { page, pageCount };
}

/** The slice of `items` belonging to 1-based `page`. Out-of-range pages yield an empty slice. */
export function pageSlice<T>(items: readonly T[], page: number, pageSize: number): T[] {
  if (page < 1 || pageSize < 1) return [];
  const from = (page - 1) * pageSize;
  return items.slice(from, from + pageSize);
}

export type PaginationSlot = number | "gap";

/**
 * The page numbers a pager should render.
 *
 * Previous/Next alone puts page 5 four clicks — and four crawl hops — from
 * page 1, which is how paginated content ends up effectively orphaned. Numbered
 * links keep the first page, the last page and the neighbourhood of the current
 * page all one hop away, with "gap" markers standing in for the runs that are
 * elided. First and last are always present so no page is ever unreachable in
 * two hops.
 */
export function paginationWindow(page: number, pageCount: number, maxNumbered = 5): PaginationSlot[] {
  if (pageCount < 1) return [];
  if (pageCount === 1) return [1];
  const numbered = Math.max(3, Math.floor(maxNumbered));
  if (pageCount <= numbered) return Array.from({ length: pageCount }, (_, i) => i + 1);

  // Slots left for the moving window once first and last are reserved.
  const innerCount = numbered - 2;
  const current = Math.min(Math.max(1, page), pageCount);
  let start = current - Math.floor((innerCount - 1) / 2);
  let end = start + innerCount - 1;
  if (start < 2) {
    start = 2;
    end = start + innerCount - 1;
  }
  if (end > pageCount - 1) {
    end = pageCount - 1;
    start = end - innerCount + 1;
  }

  const slots: PaginationSlot[] = [1];
  if (start > 2) slots.push("gap");
  for (let p = start; p <= end; p++) slots.push(p);
  if (end < pageCount - 1) slots.push("gap");
  slots.push(pageCount);
  return slots;
}
