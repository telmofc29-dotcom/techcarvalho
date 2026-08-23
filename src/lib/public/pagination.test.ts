import { test } from "node:test";
import assert from "node:assert/strict";
import {
  HUB_SECTION_PAGE_SIZE,
  pageCountFor,
  pageSlice,
  paginationWindow,
  parsePageParam,
  resolveHubPage,
} from "./pagination.ts";
import { canonicalPathWithParams } from "../seo/metadata.ts";

// --- parsePageParam --------------------------------------------------------

test("parsePageParam: a missing param is page 1", () => {
  assert.equal(parsePageParam(undefined), 1);
  assert.equal(parsePageParam(null), 1);
  assert.equal(parsePageParam(""), 1);
});

test("parsePageParam: a plain positive integer is taken at face value", () => {
  assert.equal(parsePageParam("2"), 2);
  assert.equal(parsePageParam("17"), 17);
});

test("parsePageParam: anything that is not a positive integer collapses to page 1", () => {
  // Each of these is accepted by a bare Number() and would then be echoed into
  // the canonical URL as a page number that does not exist.
  for (const junk of ["0", "-1", "2.5", "1e3", " 3 ", "abc", "3; drop", "٣", "Infinity", "NaN"]) {
    assert.equal(parsePageParam(junk), 1, `${JSON.stringify(junk)} should not be a page number`);
  }
});

test("parsePageParam: a repeated ?page= takes the first value, as URLSearchParams.get does", () => {
  assert.equal(parsePageParam(["2", "9"]), 2);
  assert.equal(parsePageParam([]), 1);
});

// --- pageCountFor ----------------------------------------------------------

test("pageCountFor: an empty hub is still page 1 of 1", () => {
  assert.equal(pageCountFor(0, 12), 1);
});

test("pageCountFor: a part-full last page still counts", () => {
  assert.equal(pageCountFor(12, 12), 1);
  assert.equal(pageCountFor(13, 12), 2);
  assert.equal(pageCountFor(24, 12), 2);
  assert.equal(pageCountFor(25, 12), 3);
});

// --- resolveHubPage --------------------------------------------------------

test("resolveHubPage: a hub has as many pages as its longest section needs", () => {
  // /manufacturers/canon against production: 22 published products, 11 brand
  // articles. The products are what makes it two pages.
  assert.deepEqual(resolveHubPage([22, 11], 1, HUB_SECTION_PAGE_SIZE), { page: 1, pageCount: 2 });
});

test("resolveHubPage: a hub that fits on one page reports one page", () => {
  // /families/canon-eos-r-full-frame: 5 products, 4 articles.
  assert.deepEqual(resolveHubPage([5, 4], 1, HUB_SECTION_PAGE_SIZE), { page: 1, pageCount: 1 });
  // …and a request for page 2 of a one-page hub is page 1, not an empty page.
  assert.deepEqual(resolveHubPage([5, 4], 2, HUB_SECTION_PAGE_SIZE), { page: 1, pageCount: 1 });
});

test("resolveHubPage: an out-of-range page clamps to the last real page", () => {
  // Without this, ?page=999 is an unbounded supply of crawlable near-empty
  // URLs, each self-canonicalising to its own junk page number.
  assert.deepEqual(resolveHubPage([22, 11], 999, HUB_SECTION_PAGE_SIZE), { page: 2, pageCount: 2 });
});

test("resolveHubPage: a hub with nothing published is page 1 of 1", () => {
  assert.deepEqual(resolveHubPage([0, 0], 3, HUB_SECTION_PAGE_SIZE), { page: 1, pageCount: 1 });
});

test("resolveHubPage: sections are paginated together, never independently", () => {
  // 22 products / 9 articles. Page 2 must carry the leftover products and NO
  // articles — independently-clamped sections would re-show all 9 articles on
  // every page, duplicating them across the paginated set.
  const { page, pageCount } = resolveHubPage([22, 9], 2, HUB_SECTION_PAGE_SIZE);
  assert.equal(pageCount, 2);
  assert.equal(page, 2);
  assert.equal(pageSlice(Array.from({ length: 9 }, (_, i) => i), page, HUB_SECTION_PAGE_SIZE).length, 0);
  assert.equal(pageSlice(Array.from({ length: 22 }, (_, i) => i), page, HUB_SECTION_PAGE_SIZE).length, 10);
});

// --- pageSlice -------------------------------------------------------------

test("pageSlice: consecutive pages partition the list with no gap and no overlap", () => {
  const items = Array.from({ length: 35 }, (_, i) => i);
  const p1 = pageSlice(items, 1, HUB_SECTION_PAGE_SIZE);
  const p2 = pageSlice(items, 2, HUB_SECTION_PAGE_SIZE);
  const p3 = pageSlice(items, 3, HUB_SECTION_PAGE_SIZE);
  assert.deepEqual([p1.length, p2.length, p3.length], [12, 12, 11]);
  assert.deepEqual([...p1, ...p2, ...p3], items, "every item appears exactly once across the pages");
});

test("pageSlice: an out-of-range page is empty rather than wrapping around", () => {
  assert.deepEqual(pageSlice([1, 2, 3], 9, 12), []);
  assert.deepEqual(pageSlice([1, 2, 3], 0, 12), []);
});

// --- paginationWindow ------------------------------------------------------

test("paginationWindow: a single page needs no navigation beyond itself", () => {
  assert.deepEqual(paginationWindow(1, 1), [1]);
});

test("paginationWindow: every page is listed while they fit", () => {
  assert.deepEqual(paginationWindow(1, 2), [1, 2]);
  assert.deepEqual(paginationWindow(3, 5), [1, 2, 3, 4, 5]);
});

test("paginationWindow: first and last are always present, so no page is more than two hops away", () => {
  for (const page of [1, 5, 10, 20]) {
    const slots = paginationWindow(page, 20);
    assert.ok(slots.includes(1), "first page must always be linked");
    assert.ok(slots.includes(20), "last page must always be linked");
    assert.ok(slots.includes(page), "the current page must always be shown");
  }
});

test("paginationWindow: the window slides with the current page and elides the rest", () => {
  assert.deepEqual(paginationWindow(1, 10), [1, 2, 3, 4, "gap", 10]);
  assert.deepEqual(paginationWindow(5, 10), [1, "gap", 4, 5, 6, "gap", 10]);
  assert.deepEqual(paginationWindow(10, 10), [1, "gap", 7, 8, 9, 10]);
});

test("paginationWindow: an out-of-range current page still produces a usable pager", () => {
  const slots = paginationWindow(99, 10);
  assert.deepEqual(slots, [1, "gap", 7, 8, 9, 10]);
});

// --- canonical composition -------------------------------------------------
//
// The pagination logic is only SEO-safe if the page number it resolves lands
// in the canonical correctly. canonicalPathWithParams already owns that rule
// (and is tested in src/lib/seo/metadata.test.ts); these assert the specific
// composition the hub routes rely on, so a change to either side is caught.

test("hub canonical: page 1 canonicalises to the bare hub path, not ?page=1", () => {
  const page = resolveHubPage([22, 11], parsePageParam(undefined), HUB_SECTION_PAGE_SIZE).page;
  assert.equal(canonicalPathWithParams("/cameras-photography", { page }, ["page"]), "/cameras-photography");
});

test("hub canonical: page 2 self-canonicalises to its own ?page=2 URL", () => {
  const page = resolveHubPage([22, 11], parsePageParam("2"), HUB_SECTION_PAGE_SIZE).page;
  assert.equal(canonicalPathWithParams("/manufacturers/canon", { page }, ["page"]), "/manufacturers/canon?page=2");
});

test("hub canonical: an out-of-range or junk page canonicalises to a page that exists", () => {
  // ?page=999 on a two-page hub → the real last page.
  const clamped = resolveHubPage([22, 11], parsePageParam("999"), HUB_SECTION_PAGE_SIZE).page;
  assert.equal(canonicalPathWithParams("/manufacturers/canon", { page: clamped }, ["page"]), "/manufacturers/canon?page=2");
  // ?page=abc → page 1 → the bare path.
  const junk = resolveHubPage([22, 11], parsePageParam("abc"), HUB_SECTION_PAGE_SIZE).page;
  assert.equal(canonicalPathWithParams("/manufacturers/canon", { page: junk }, ["page"]), "/manufacturers/canon");
});

test("hub canonical: tracking params never reach a hub canonical", () => {
  // The allow-list is the whole point — a hub only understands ?page=.
  assert.equal(
    canonicalPathWithParams("/computing", { page: 2, utm_source: "x", fbclid: "y" }, ["page"]),
    "/computing?page=2"
  );
});
