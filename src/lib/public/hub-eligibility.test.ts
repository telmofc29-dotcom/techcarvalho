import { test } from "node:test";
import assert from "node:assert/strict";
import {
  isManufacturerHubIndexable,
  isFamilyHubIndexable,
  hubHasContent,
  MIN_HUB_ARTICLES,
} from "./hub-eligibility.ts";

// --- manufacturer hubs -----------------------------------------------------

test("a brand with any published product is indexable, as it always was", () => {
  assert.equal(isManufacturerHubIndexable({ productCount: 1, articleCount: 0 }), true);
});

test("a brand with no products and no coverage is not indexable", () => {
  // The regression this whole gate exists for: 14 of 15 manufacturer routes
  // rendered "No published products yet" and were all submitted to Google.
  assert.equal(isManufacturerHubIndexable({ productCount: 0, articleCount: 0 }), false);
});

test("a brand carried entirely by published coverage is indexable", () => {
  // Against production: NVIDIA has 6 published articles and 0 published
  // products; AMD has 5 and 0. The old products-only rule called both thin.
  assert.equal(isManufacturerHubIndexable({ productCount: 0, articleCount: 6 }), true);
  assert.equal(isManufacturerHubIndexable({ productCount: 0, articleCount: 5 }), true);
});

test("one or two loosely-tagged articles is still a stub", () => {
  // Apple, Samsung and Google each carry exactly 2 brand-tagged articles, all
  // of them multi-brand flagship comparisons. That is not brand coverage.
  assert.equal(isManufacturerHubIndexable({ productCount: 0, articleCount: 2 }), false);
  assert.equal(isManufacturerHubIndexable({ productCount: 0, articleCount: MIN_HUB_ARTICLES - 1 }), false);
  assert.equal(isManufacturerHubIndexable({ productCount: 0, articleCount: MIN_HUB_ARTICLES }), true);
});

// --- family hubs -----------------------------------------------------------

test("two published bodies make a line worth comparing", () => {
  assert.equal(isFamilyHubIndexable({ productCount: 2, articleCount: 0 }), true);
});

test("a single published body with no coverage is a worse version of that product's page", () => {
  assert.equal(isFamilyHubIndexable({ productCount: 1, articleCount: 0 }), false);
  assert.equal(isFamilyHubIndexable({ productCount: 1, articleCount: 1 }), false);
});

test("a single published body plus real coverage of the line does earn a hub", () => {
  // Canon EOS xxD: 1 published body (the 90D) and 4 published articles.
  // Canon EOS R full-frame: 1 published body (the R5) and 3 published articles.
  assert.equal(isFamilyHubIndexable({ productCount: 1, articleCount: 4 }), true);
  assert.equal(isFamilyHubIndexable({ productCount: 1, articleCount: 3 }), true);
});

test("articles alone never make a family hub indexable", () => {
  // A page whose only content is a couple of article links duplicates the
  // category hub, and most families in this catalogue are unpublished while
  // media rights are cleared.
  assert.equal(isFamilyHubIndexable({ productCount: 0, articleCount: 9 }), false);
});

// --- hubHasContent ---------------------------------------------------------

test("hubHasContent is a lower bar than indexability", () => {
  const oneProduct = { productCount: 1, articleCount: 0 };
  assert.equal(hubHasContent(oneProduct), true, "worth rendering and linking internally");
  assert.equal(isFamilyHubIndexable(oneProduct), false, "not worth asking Google to index");
});

test("hubHasContent is false only when the hub would render an empty state", () => {
  assert.equal(hubHasContent({ productCount: 0, articleCount: 0 }), false);
  assert.equal(hubHasContent({ productCount: 0, articleCount: 1 }), true);
});
