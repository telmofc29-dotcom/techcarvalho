import { test } from "node:test";
import assert from "node:assert/strict";
import {
  composeHomepage,
  CATEGORY_SECTION_MIN_STORIES,
  MAX_CATEGORY_SECTIONS,
  REFERENCED_GUIDES_MIN,
  QUESTION_RAIL_MIN,
  QUESTIONS_PER_CATEGORY,
  LAUNCH_SECTION_MIN,
  type HomeProduct,
  type HomeStory,
  type HomepageData,
} from "./homepage-sections.ts";

// These tests exist because the rules they cover ARE the honesty policy for the
// front page: a section may only appear when enough real published content
// exists to fill it, nothing may be shown twice, and no rail may be padded out
// with items that don't meet its own stated criterion.

let seq = 0;
function story(overrides: Partial<HomeStory> = {}): HomeStory {
  seq += 1;
  return {
    id: `story-${seq}`,
    title: `Story ${seq}`,
    slug: `story-${seq}`,
    type: "guide",
    publishedAt: "2026-08-20T10:00:00.000Z",
    freshness: "2d ago",
    dateLabel: "20 Aug 2026",
    excerpt: null,
    heroImage: null,
    categorySlug: "computing",
    categoryLabel: "Computing",
    primaryQuery: null,
    referenceCount: 0,
    ...overrides,
  };
}

function product(overrides: Partial<HomeProduct> = {}): HomeProduct {
  seq += 1;
  return {
    id: `product-${seq}`,
    name: `Product ${seq}`,
    slug: `product-${seq}`,
    summary: null,
    status: "active",
    releaseDate: "2026-01-01",
    releaseLabel: "1 Jan 2026",
    manufacturerName: "Acme",
    heroImage: null,
    ...overrides,
  };
}

function data(overrides: Partial<HomepageData> = {}): HomepageData {
  return {
    stories: [],
    subjectAreas: [],
    totalArticles: 0,
    lastPublished: null,
    products: [],
    recentLaunches: [],
    ...overrides,
  };
}

function storiesFor(categorySlug: string, count: number, overrides: Partial<HomeStory> = {}): HomeStory[] {
  return Array.from({ length: count }, () =>
    story({ categorySlug, categoryLabel: categorySlug, ...overrides })
  );
}

test("an empty site produces no sections at all — never an empty shell", () => {
  const sections = composeHomepage(data(), []);
  assert.deepEqual(sections.latest, []);
  assert.deepEqual(sections.categorySections, []);
  assert.deepEqual(sections.referencedGuides, []);
  assert.deepEqual(sections.questions, []);
  assert.deepEqual(sections.catalogue, []);
  assert.deepEqual(sections.recentLaunches, []);
});

test("stories already shown by the trending block are never repeated below it", () => {
  const stories = storiesFor("computing", 8);
  const excluded = stories.slice(0, 3).map((s) => s.id);
  const sections = composeHomepage(data({ stories }), excluded);

  const shown = [
    ...sections.latest,
    ...sections.categorySections.flatMap((c) => [c.lead, ...c.rest]),
  ].map((s) => s.id);
  for (const id of excluded) assert.ok(!shown.includes(id), `${id} was shown twice`);
});

test("no story is used by more than one section", () => {
  const stories = [...storiesFor("computing", 10), ...storiesFor("gaming", 10)];
  const sections = composeHomepage(data({ stories }), []);
  const shown = [
    ...sections.latest,
    ...sections.categorySections.flatMap((c) => [c.lead, ...c.rest]),
  ].map((s) => s.id);
  assert.equal(new Set(shown).size, shown.length);
});

test("a category short of a full section's worth of stories gets no section", () => {
  // Enough to fill "Latest" out of one category, then a second category left
  // one story below the threshold.
  const stories = [
    ...storiesFor("computing", 6),
    ...storiesFor("gaming", CATEGORY_SECTION_MIN_STORIES - 1),
  ];
  const sections = composeHomepage(data({ stories }), []);
  assert.ok(!sections.categorySections.some((c) => c.slug === "gaming"));
});

test("a category with enough stories does get a section, lead plus the rest", () => {
  const stories = [...storiesFor("computing", 6), ...storiesFor("gaming", CATEGORY_SECTION_MIN_STORIES)];
  const sections = composeHomepage(data({ stories }), []);
  const gaming = sections.categorySections.find((c) => c.slug === "gaming");
  assert.ok(gaming);
  assert.equal(1 + gaming.rest.length, CATEGORY_SECTION_MIN_STORIES);
});

test("category sections are capped so the front page doesn't become a sitemap", () => {
  const stories = Array.from({ length: MAX_CATEGORY_SECTIONS + 3 }, (_, i) =>
    storiesFor(`cat-${i}`, CATEGORY_SECTION_MIN_STORIES + 6)
  ).flat();
  const sections = composeHomepage(data({ stories }), []);
  assert.equal(sections.categorySections.length, MAX_CATEGORY_SECTIONS);
});

test("a category lead prefers real imagery but a story is never dropped for lacking it", () => {
  const withImage = story({
    categorySlug: "gaming",
    categoryLabel: "Gaming",
    heroImage: { url: "https://example.test/a.png", alt: "A" },
  });
  const stories = [
    ...storiesFor("computing", 6),
    ...storiesFor("gaming", CATEGORY_SECTION_MIN_STORIES - 1),
    withImage,
  ];
  const sections = composeHomepage(data({ stories }), []);
  const gaming = sections.categorySections.find((c) => c.slug === "gaming");
  assert.ok(gaming);
  assert.equal(gaming.lead.id, withImage.id);
  // The image-less stories are still present, just as rows.
  assert.equal(gaming.rest.length, CATEGORY_SECTION_MIN_STORIES - 1);
});

test("most-referenced guides excludes anything with no link in the content graph", () => {
  const linked = Array.from({ length: REFERENCED_GUIDES_MIN }, (_, i) =>
    story({ categorySlug: `c${i}`, type: "guide", referenceCount: i + 1 })
  );
  const unlinked = story({ type: "guide", referenceCount: 0 });
  const sections = composeHomepage(data({ stories: [...linked, unlinked] }), []);
  assert.ok(!sections.referencedGuides.some((g) => g.id === unlinked.id));
  // Ranked by real link count, highest first.
  assert.deepEqual(
    sections.referencedGuides.map((g) => g.referenceCount),
    [...sections.referencedGuides].map((g) => g.referenceCount).sort((a, b) => b - a)
  );
});

test("most-referenced guides is suppressed entirely below its minimum", () => {
  const stories = [story({ type: "guide", referenceCount: 9 }), story({ type: "guide", referenceCount: 4 })];
  assert.ok(stories.length < REFERENCED_GUIDES_MIN);
  assert.deepEqual(composeHomepage(data({ stories }), []).referencedGuides, []);
});

test("only guides reach the guide rail, whatever their link count", () => {
  const stories = Array.from({ length: REFERENCED_GUIDES_MIN + 2 }, (_, i) =>
    story({ type: i === 0 ? "news" : "guide", referenceCount: 5 })
  );
  const sections = composeHomepage(data({ stories }), []);
  assert.ok(sections.referencedGuides.every((g) => g.type === "guide"));
});

test("the question rail is suppressed below a full grid", () => {
  const stories = Array.from({ length: QUESTION_RAIL_MIN - 1 }, (_, i) =>
    story({ categorySlug: `c${i}`, primaryQuery: `question ${i}` })
  );
  assert.deepEqual(composeHomepage(data({ stories }), []).questions, []);
});

test("the question rail spreads across categories and ignores blank queries", () => {
  const stories = [
    ...Array.from({ length: 10 }, () => story({ categorySlug: "computing", primaryQuery: "a computing question" })),
    ...Array.from({ length: 10 }, (_, i) => story({ categorySlug: `c${i}`, primaryQuery: `question ${i}` })),
    story({ categorySlug: "gaming", primaryQuery: "   " }),
    story({ categorySlug: "gaming", primaryQuery: null }),
  ];
  const { questions } = composeHomepage(data({ stories }), []);
  assert.ok(questions.length >= QUESTION_RAIL_MIN);
  assert.ok(questions.every((q) => q.query.trim().length > 0));
  const computing = questions.filter((q) => q.query === "a computing question");
  assert.ok(computing.length <= QUESTIONS_PER_CATEGORY);
});

test("new releases is suppressed below its minimum rather than padded", () => {
  const one = [product()];
  assert.ok(one.length < LAUNCH_SECTION_MIN);
  assert.deepEqual(composeHomepage(data({ recentLaunches: one }), []).recentLaunches, []);

  const enough = Array.from({ length: LAUNCH_SECTION_MIN }, () => product());
  assert.equal(composeHomepage(data({ recentLaunches: enough }), []).recentLaunches.length, LAUNCH_SECTION_MIN);
});

test("the catalogue rail shows real products and nothing when there are none", () => {
  assert.deepEqual(composeHomepage(data({ products: [] }), []).catalogue, []);
  const products = Array.from({ length: 3 }, () => product());
  assert.equal(composeHomepage(data({ products }), []).catalogue.length, 3);
});
