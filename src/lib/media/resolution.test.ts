import { test } from "node:test";
import assert from "node:assert/strict";
import {
  resolveMediaStrategy,
  isShootable,
  ACCESS_RANK,
  type ResolutionInput,
} from "./resolution.ts";
import { rankPhotoRequests, type PhotoRequestInput } from "./photo-requests.ts";

const base: ResolutionInput = {
  subjectIsData: false,
  subjectIsAbstract: false,
  ownerAccess: "unknown",
  reusablePhotographAvailable: false,
  officialMediaCleared: false,
};

test("a numeric subject resolves to a data graphic even when a photo is available", () => {
  // The correctness ordering: what the page NEEDS is asked before what we CAN
  // GET. A chart of install sizes beats a photo of the box, always.
  const r = resolveMediaStrategy({
    ...base,
    subjectIsData: true,
    ownerAccess: "owned",
    reusablePhotographAvailable: true,
    officialMediaCleared: true,
  });
  assert.equal(r.resolution, "data_graphic");
  assert.equal(r.needsAction, false, "a correct chart is not outstanding work");
});

test("an abstract subject resolves to an illustration, never a stock photo", () => {
  const r = resolveMediaStrategy({
    ...base,
    subjectIsAbstract: true,
    reusablePhotographAvailable: true,
  });
  assert.equal(r.resolution, "original_illustration");
});

test("an owned or borrowable object is shot ourselves, ahead of licensed images", () => {
  for (const access of ["owned", "borrowable"] as const) {
    const r = resolveMediaStrategy({
      ...base,
      ownerAccess: access,
      reusablePhotographAvailable: true,
      officialMediaCleared: true,
    });
    assert.equal(r.resolution, "owned_original", `${access} should shoot our own`);
  }
});

test("a reusable photograph outranks official press media", () => {
  // An independent photograph of the real thing beats the maker's own framing.
  const r = resolveMediaStrategy({
    ...base,
    reusablePhotographAvailable: true,
    officialMediaCleared: true,
  });
  assert.equal(r.resolution, "legally_reusable_photograph");
});

test("official media is used only when it is actually cleared", () => {
  assert.equal(
    resolveMediaStrategy({ ...base, officialMediaCleared: true }).resolution,
    "rights_cleared_official"
  );
  // Existence is not permission — with nothing cleared there is no answer yet.
  assert.equal(resolveMediaStrategy({ ...base }).resolution, "unresolved");
});

test("retail display ranks below cleared media but above unresolved", () => {
  const withOfficial = resolveMediaStrategy({
    ...base,
    ownerAccess: "retail_display",
    officialMediaCleared: true,
  });
  assert.equal(withOfficial.resolution, "rights_cleared_official");

  const alone = resolveMediaStrategy({ ...base, ownerAccess: "retail_display" });
  assert.equal(alone.resolution, "owned_original");
  assert.match(alone.reason, /shop/i);
});

test("unresolved distinguishes 'nobody looked' from 'genuinely cannot'", () => {
  const unknown = resolveMediaStrategy({ ...base, ownerAccess: "unknown" });
  const cannot = resolveMediaStrategy({ ...base, ownerAccess: "not_accessible" });
  assert.equal(unknown.resolution, "unresolved");
  assert.equal(cannot.resolution, "unresolved");
  assert.notEqual(unknown.reason, cannot.reason, "the two must not read identically");
  assert.match(unknown.reason, /assessed/i);
});

test("unknown access is shootable — an unassessed product goes to triage", () => {
  assert.equal(isShootable("unknown"), true);
  assert.equal(isShootable("not_accessible"), false);
  assert.equal(isShootable("owned"), true);
});

test("access ranks easiest first", () => {
  assert.ok(ACCESS_RANK.owned < ACCESS_RANK.borrowable);
  assert.ok(ACCESS_RANK.borrowable < ACCESS_RANK.retail_display);
  assert.ok(ACCESS_RANK.unknown < ACCESS_RANK.not_accessible);
});

// --- the ranking integration ------------------------------------------------

const product = (over: Partial<PhotoRequestInput>): PhotoRequestInput => ({
  productId: over.productSlug ?? "id",
  productName: "Product",
  productSlug: "product",
  articleTitles: [],
  productPublished: true,
  currentMedia: "none",
  hasRealPhotograph: false,
  ...over,
});

test("an unobtainable product never opens the shooting list", () => {
  // Even when it would improve far more pages than anything else.
  const ranked = rankPhotoRequests([
    product({
      productSlug: "unobtainable",
      productName: "Rare Body",
      articleTitles: ["a", "b", "c", "d", "e"],
      ownerAccess: "not_accessible",
    }),
    product({ productSlug: "desk-router", productName: "Desk Router", ownerAccess: "owned" }),
  ]);
  assert.equal(ranked[0].productSlug, "desk-router");
  assert.equal(ranked[0].shootable, true);
  assert.equal(ranked[1].shootable, false);
  // It is still listed — the site's need for the image is real.
  assert.equal(ranked.length, 2);
  assert.match(ranked[1].reason, /not be fixed by a camera/i);
});

test("site value still beats convenience among shootable requests", () => {
  // Access is a tie-breaker, not the primary key: a photo fixing four pages
  // must not sit below one fixing a single page just because it is closer.
  const ranked = rankPhotoRequests([
    product({ productSlug: "close", productName: "Close", ownerAccess: "owned" }),
    product({
      productSlug: "valuable",
      productName: "Valuable",
      articleTitles: ["a", "b", "c"],
      ownerAccess: "borrowable",
    }),
  ]);
  assert.equal(ranked[0].productSlug, "valuable");
});

test("equal site value breaks toward the easier shot", () => {
  const ranked = rankPhotoRequests([
    product({ productSlug: "far", productName: "AAA Far", ownerAccess: "retail_display" }),
    product({ productSlug: "near", productName: "ZZZ Near", ownerAccess: "owned" }),
  ]);
  assert.equal(ranked[0].productSlug, "near", "same pages affected, so the owned one wins");
});

test("access defaults to unknown rather than being assumed", () => {
  const [r] = rankPhotoRequests([product({})]);
  assert.equal(r.ownerAccess, "unknown");
  assert.equal(r.shootable, true);
});
