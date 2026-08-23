import { test } from "node:test";
import assert from "node:assert/strict";
import {
  OWNER_ACCESS_VALUES,
  isOwnerAccess,
  isAssessed,
  isConfirmedShootable,
  orderForTriage,
  summariseAssessment,
  assessmentHeadline,
} from "./photography-triage.ts";
import { isShootable, type OwnerAccess } from "./resolution.ts";
import { rankPhotoRequests, type PhotoRequestInput } from "./photo-requests.ts";

function input(over: Partial<PhotoRequestInput> = {}): PhotoRequestInput {
  return {
    productId: "p1",
    productName: "Canon EOS 60D",
    productSlug: "canon-eos-60d",
    articleTitles: ["An article"],
    productPublished: true,
    currentMedia: "generic_graphic",
    hasRealPhotograph: false,
    ...over,
  };
}

test("the accepted values are exactly the five the CHECK constraint allows", () => {
  assert.deepEqual([...OWNER_ACCESS_VALUES], [
    "owned",
    "borrowable",
    "retail_display",
    "not_accessible",
    "unknown",
  ]);
});

test("anything outside the five is rejected — a form field is not trusted", () => {
  for (const value of OWNER_ACCESS_VALUES) assert.equal(isOwnerAccess(value), true);
  for (const value of ["maybe", "OWNED", "", " owned", "true", null, undefined, 1, {}]) {
    assert.equal(isOwnerAccess(value), false, `${JSON.stringify(value)} must not pass`);
  }
});

test("'unknown' is not an assessment", () => {
  assert.equal(isAssessed("unknown"), false);
  for (const value of ["owned", "borrowable", "retail_display", "not_accessible"] as OwnerAccess[]) {
    assert.equal(isAssessed(value), true);
  }
});

test("confirmed-shootable is narrower than isShootable, and that is the point", () => {
  // resolution.ts keeps 'unknown' in the backlog by calling it shootable. A
  // headline total must not repeat that as a measurement — nobody has looked.
  assert.equal(isShootable("unknown"), true);
  assert.equal(isConfirmedShootable("unknown"), false);

  assert.equal(isConfirmedShootable("owned"), true);
  assert.equal(isConfirmedShootable("borrowable"), true);
  assert.equal(isConfirmedShootable("retail_display"), true);
  assert.equal(isConfirmedShootable("not_accessible"), false);
});

test("triage puts unassessed products first", () => {
  const ordered = orderForTriage([
    { id: "a", ownerAccess: "owned" as OwnerAccess },
    { id: "b", ownerAccess: "unknown" as OwnerAccess },
    { id: "c", ownerAccess: "not_accessible" as OwnerAccess },
    { id: "d", ownerAccess: "unknown" as OwnerAccess },
  ]);
  assert.deepEqual(ordered.map((r) => r.id), ["b", "d", "a", "c"]);
});

test("triage does not re-rank — it only partitions the ranking it was given", () => {
  // Two unassessed products, the second worth far more pages. rankPhotoRequests
  // puts the high-impact one first; orderForTriage must not disturb that, and
  // must not promote the assessed high-impact one above the unassessed ones
  // either.
  const ranked = rankPhotoRequests([
    input({ productId: "low", productName: "Low impact", articleTitles: ["one"] }),
    input({
      productId: "high",
      productName: "High impact",
      articleTitles: ["one", "two", "three", "four"],
    }),
    input({
      productId: "assessed",
      productName: "Assessed and huge",
      articleTitles: ["1", "2", "3", "4", "5", "6", "7", "8"],
      ownerAccess: "owned",
    }),
  ]);
  // Sanity: the underlying ranking is by pages improved.
  assert.deepEqual(ranked.map((r) => r.productId), ["assessed", "high", "low"]);

  const ordered = orderForTriage(ranked);
  assert.deepEqual(ordered.map((r) => r.productId), ["high", "low", "assessed"]);
  // Within the unassessed group, the ranking's own order survived intact.
  assert.equal(ordered[0].pagesAffected, 5);
  assert.equal(ordered[1].pagesAffected, 2);
});

test("triage does not mutate the array it is handed", () => {
  const ranked = [
    { id: "a", ownerAccess: "owned" as OwnerAccess },
    { id: "b", ownerAccess: "unknown" as OwnerAccess },
  ];
  orderForTriage(ranked);
  assert.deepEqual(ranked.map((r) => r.id), ["a", "b"]);
});

test("nothing assessed reports no progress rather than 0%", () => {
  const totals = summariseAssessment(Array(44).fill("unknown"));
  assert.equal(totals.products, 44);
  assert.equal(totals.assessed, 0);
  assert.equal(totals.unassessed, 44);
  assert.equal(totals.hasProgress, false);
  // The crucial one: 'unknown' is never counted as something we can shoot.
  assert.equal(totals.confirmedShootable, 0);
  assert.equal(totals.notAccessible, 0);
});

test("totals split assessed, reachable and out-of-reach without overlap", () => {
  const totals = summariseAssessment([
    "owned",
    "owned",
    "borrowable",
    "retail_display",
    "not_accessible",
    "unknown",
    "unknown",
    "unknown",
  ]);
  assert.equal(totals.products, 8);
  assert.equal(totals.assessed, 5);
  assert.equal(totals.unassessed, 3);
  assert.equal(totals.confirmedShootable, 4);
  assert.equal(totals.notAccessible, 1);
  assert.equal(totals.assessed, totals.confirmedShootable + totals.notAccessible);
  assert.equal(totals.products, totals.assessed + totals.unassessed);
  assert.equal(totals.hasProgress, true);
  assert.deepEqual(totals.byAccess, {
    owned: 2,
    borrowable: 1,
    retail_display: 1,
    not_accessible: 1,
    unknown: 3,
  });
});

test("an empty catalogue is stated as empty, not as 0% assessed", () => {
  const totals = summariseAssessment([]);
  assert.equal(totals.hasProgress, false);
  assert.match(assessmentHeadline(totals), /No products in the catalogue/);
});

test("the headline says nobody has looked, not that nothing is photographable", () => {
  const headline = assessmentHeadline(summariseAssessment(Array(44).fill("unknown")));
  assert.match(headline, /Nobody has assessed any of the 44 products/);
  assert.match(headline, /no one has looked/);
  assert.doesNotMatch(headline, /0 of 44/);
});

test("once something is assessed the headline reports real counts", () => {
  const headline = assessmentHeadline(
    summariseAssessment(["owned", "not_accessible", "unknown", "unknown"])
  );
  assert.match(headline, /2 of 4 assessed/);
  assert.match(headline, /1 confirmed reachable/);
  assert.match(headline, /1 out of reach/);
  assert.match(headline, /2 still untouched/);
});
