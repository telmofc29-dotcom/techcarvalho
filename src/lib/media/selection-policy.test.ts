import { test, describe } from "node:test";
import assert from "node:assert/strict";
import {
  isProtectedSelection,
  orderForSlot,
  explainRotation,
  ROTATION_BAND,
  type RotationCandidate,
} from "./selection-policy.ts";

describe("what the engine may reconsider", () => {
  test("a human choice is protected", () => {
    assert.equal(isProtectedSelection("human"), true);
  });

  // THE LOAD-BEARING ONE. 170 links predate the provenance column. Reading
  // `unknown` as "nobody chose it, take it" would licence the engine to
  // overwrite every image the owner picked before 2026-08-27.
  test("an unknown choice is protected, exactly like a human one", () => {
    assert.equal(isProtectedSelection("unknown"), true);
    assert.equal(isProtectedSelection(null), true, "a missing value is not an engine value");
    assert.equal(isProtectedSelection(undefined), true);
  });

  test("only an engine choice may be reconsidered", () => {
    assert.equal(isProtectedSelection("engine"), false);
  });
});

const c = (assetId: string, score: number, usageCount: number): RotationCandidate => ({
  assetId,
  score,
  usageCount,
});

describe("rotation never beats relevance", () => {
  test("a clearly better match wins however heavily it is already used", () => {
    const ordered = orderForSlot([c("overused-but-right", 90, 40), c("fresh-but-wrong", 30, 0)]);
    assert.equal(ordered[0].assetId, "overused-but-right");
  });

  test("the band is anchored on the leader, so a chain of small steps cannot ladder a bad image up", () => {
    // Every ADJACENT step here is inside the band, so a rolling comparison
    // would chain them into one group and let the completely unused
    // 30-points-worse candidate rotate to the front. Anchoring on the best
    // remaining score is what stops that.
    const ordered = orderForSlot([
      c("leader", 100, 9),
      c("minus5", 95, 8),
      c("minus10", 90, 7),
      c("minus15", 85, 6),
      c("minus30", 70, 0),
    ]);
    assert.equal(
      ordered[ordered.length - 1].assetId,
      "minus30",
      "the unused far-worse candidate must stay last despite having the lowest usage of all"
    );
    // The front is always a genuine band-equal of the leader — here minus5,
    // which really is within 6 points and really is used less. That is rotation
    // working, not relevance losing.
    assert.ok(
      100 - ordered[0].score <= ROTATION_BAND,
      `front runner scored ${ordered[0].score}, outside the leader's band`
    );
  });

  test("a single uniquely-best exact match is returned first every time, and is therefore reused", () => {
    const pool = [c("only-exact", 98, 12), c("family", 40, 0), c("topical", 22, 0)];
    for (let run = 0; run < 5; run++) {
      assert.equal(orderForSlot(pool)[0].assetId, "only-exact");
    }
  });

  test("scores exactly ROTATION_BAND apart are still equals; one point more is not", () => {
    const equal = orderForSlot([c("used", 80, 5), c("unused", 80 - ROTATION_BAND, 0)]);
    assert.equal(equal[0].assetId, "unused", "inside the band, the less-used one leads");

    const notEqual = orderForSlot([c("used", 80, 5), c("unused", 80 - ROTATION_BAND - 1, 0)]);
    assert.equal(notEqual[0].assetId, "used", "outside the band, the better match leads");
  });
});

describe("rotation among genuine equals", () => {
  test("equally good candidates rotate toward the one doing least work elsewhere", () => {
    const ordered = orderForSlot([c("a", 70, 9), c("b", 70, 0), c("d", 70, 4)]);
    assert.deepEqual(
      ordered.map((x) => x.assetId),
      ["b", "d", "a"]
    );
  });

  test("the order is stable, not dependent on how the rows arrived", () => {
    const one = orderForSlot([c("x", 70, 2), c("y", 70, 2), c("z", 70, 2)]).map((r) => r.assetId);
    const two = orderForSlot([c("z", 70, 2), c("y", 70, 2), c("x", 70, 2)]).map((r) => r.assetId);
    assert.deepEqual(one, two);
  });

  test("an empty pool is an empty answer, not a crash", () => {
    assert.deepEqual(orderForSlot([]), []);
  });
});

describe("rotation explains itself", () => {
  test("it says why it preferred one of two equals", () => {
    const why = explainRotation(c("fresh", 70, 0), c("tired", 70, 6));
    assert.match(why!, /nowhere else yet/);
    assert.match(why!, /against 6/);
  });

  test("it stays silent when the winner simply scored better", () => {
    assert.equal(explainRotation(c("best", 90, 3), c("worse", 40, 0)), null);
  });

  test("it stays silent when usage played no part", () => {
    assert.equal(explainRotation(c("a", 70, 2), c("b", 70, 2)), null);
  });

  test("it stays silent when there was no runner-up to prefer it over", () => {
    assert.equal(explainRotation(c("a", 70, 2), null), null);
  });
});
