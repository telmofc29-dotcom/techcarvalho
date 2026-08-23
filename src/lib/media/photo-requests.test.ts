import { test } from "node:test";
import assert from "node:assert/strict";
import { rankPhotoRequests, BASE_SHOT_LIST, type PhotoRequestInput } from "./photo-requests.ts";

function input(over: Partial<PhotoRequestInput> = {}): PhotoRequestInput {
  return {
    productId: "p1", productName: "Canon EOS 60D", productSlug: "canon-eos-60d",
    articleTitles: ["An article"], productPublished: true,
    currentMedia: "generic_graphic", hasRealPhotograph: false,
    ...over,
  };
}

test("a product we already photograph ourselves is never requested again", () => {
  assert.deepEqual(rankPhotoRequests([input({ currentMedia: "owned_original" })]), []);
});

test("a DATA GRAPHIC is left alone — replacing it would make the page worse", () => {
  // A chart explaining what a spec means is frequently the right lead image.
  // Asking for a photograph to replace it sends the owner to shoot something
  // that would downgrade the page.
  assert.deepEqual(rankPhotoRequests([input({ currentMedia: "data_graphic" })]), []);
});

test("ranking is by pages improved, not by product prominence", () => {
  const out = rankPhotoRequests([
    input({ productId: "a", productName: "Alpha", articleTitles: ["one"] }),
    input({ productId: "b", productName: "Beta", articleTitles: ["one", "two", "three", "four"] }),
  ]);
  assert.equal(out[0].productName, "Beta");
  assert.equal(out[0].pagesAffected, 5);
  assert.equal(out[0].priority, "high");
});

test("a single unpublished product nobody links to ranks low, not high", () => {
  const out = rankPhotoRequests([
    input({ articleTitles: ["only one"], productPublished: false }),
  ]);
  assert.equal(out[0].priority, "low");
  assert.equal(out[0].pagesAffected, 1);
});

test("a request with no destination is not made at all", () => {
  // Nothing is requested merely to fill a queue.
  assert.deepEqual(rankPhotoRequests([input({ articleTitles: [], productPublished: false })]), []);
});

test("every request names its reason and its shots", () => {
  const [r] = rankPhotoRequests([input()]);
  assert.match(r.reason, /generated card/);
  assert.deepEqual(r.shotList, [...BASE_SHOT_LIST]);
  assert.ok(r.articleTitles.length > 0, "a request must name the pages that would use it");
});

test("a licensed third-party photo is still an upgrade opportunity, and says why", () => {
  const [r] = rankPhotoRequests([input({ currentMedia: "licensed_third_party" })]);
  assert.match(r.reason, /attribution obligation/);
});

test("a generic hero on a product that ALREADY has a photo flags the routing, not the camera", () => {
  // Shooting it would waste the owner's time on a problem that is a bug.
  const [r] = rankPhotoRequests([input({ hasRealPhotograph: true })]);
  assert.match(r.reason, /check the media routing before shooting/);
});

test("ordering is stable between runs", () => {
  const items = [
    input({ productId: "b", productName: "Beta" }),
    input({ productId: "a", productName: "Alpha" }),
  ];
  const first = rankPhotoRequests(items).map((r) => r.productId);
  const second = rankPhotoRequests([...items].reverse()).map((r) => r.productId);
  assert.deepEqual(first, second, "a reader must find the same row twice");
});
