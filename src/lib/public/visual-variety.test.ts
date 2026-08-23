import { test } from "node:test";
import assert from "node:assert/strict";
import {
  diversifyByMedia,
  visualKind,
  longestRun,
  MAX_DISPLACEMENT,
  MAX_RUN,
  type VisuallyRankable,
} from "./visual-variety.ts";

const item = (rank: number, kind: VisuallyRankable["kind"]): VisuallyRankable => ({ rank, kind });

// --- classification --------------------------------------------------------

test("a generated graphic is a graphic however it is labelled", () => {
  assert.equal(visualKind({ hasImage: true, sourceType: "tc_graphic" }), "graphic");
  assert.equal(visualKind({ hasImage: true, assetRole: "chart" }), "graphic");
  assert.equal(visualKind({ hasImage: true, assetRole: "comparison_graphic" }), "graphic");
});

test("a real photograph is a photograph", () => {
  assert.equal(visualKind({ hasImage: true, sourceType: "public_domain_or_cc", assetRole: "product_photo" }), "photograph");
});

test("NO IMAGE IS ITS OWN KIND, not a graphic", () => {
  // An empty card is a different visual event from a diagram; folding them
  // together would let two image-less cards sit next to each other.
  assert.equal(visualKind({ hasImage: false }), "none");
});

// --- the actual problem ----------------------------------------------------

test("FOUR DIAGRAMS IN A ROW GET BROKEN UP", () => {
  // The measured homepage: every image above the fold was a generated graphic.
  const ranked = [
    item(1, "graphic"), item(2, "graphic"), item(3, "graphic"), item(4, "graphic"),
    item(5, "photograph"), item(6, "photograph"),
  ];
  assert.equal(longestRun(ranked), 4, "the input really is monotonous");
  const out = diversifyByMedia(ranked);
  assert.ok(longestRun(out) < 4, `still ${longestRun(out)} in a row: ${out.map((i) => i.kind).join(",")}`);
});

test("A RUN OF PHOTOGRAPHS IS BROKEN UP JUST AS READILY", () => {
  // The fix must not become photograph-supremacy. A diagram is frequently the
  // best lead image, and a rule that only ever demoted graphics would make the
  // site worse in the other direction.
  const ranked = [
    item(1, "photograph"), item(2, "photograph"), item(3, "photograph"), item(4, "photograph"),
    item(5, "graphic"), item(6, "graphic"),
  ];
  const out = diversifyByMedia(ranked);
  assert.ok(longestRun(out) < 4, out.map((i) => i.kind).join(","));
});

// --- the limits that keep it honest ---------------------------------------

test("NOTHING MOVES FAR FROM ITS EDITORIAL RANK", () => {
  // Visual rhythm must never override editorial judgement. An item may shift a
  // couple of places; it may not be promoted from tenth to first because it
  // happens to have a photograph.
  const ranked = Array.from({ length: 12 }, (_, i) =>
    item(i + 1, i < 6 ? "graphic" : "photograph")
  );
  const out = diversifyByMedia(ranked);
  out.forEach((it, position) => {
    const displacement = Math.abs(it.rank - 1 - position);
    assert.ok(
      displacement <= MAX_DISPLACEMENT,
      `rank ${it.rank} moved to position ${position} (${displacement} places)`
    );
  });
});

test("the top-ranked item stays at or very near the front", () => {
  const ranked = [
    item(1, "graphic"), item(2, "graphic"), item(3, "graphic"), item(4, "photograph"),
  ];
  const out = diversifyByMedia(ranked);
  const topPosition = out.findIndex((i) => i.rank === 1);
  assert.ok(topPosition <= MAX_DISPLACEMENT, `best story fell to position ${topPosition}`);
});

test("a section that genuinely is ALL diagrams stays in rank order", () => {
  // Variety is a preference, never a mandate. With nothing to alternate with,
  // the editorial ordering must survive untouched.
  const ranked = [item(1, "graphic"), item(2, "graphic"), item(3, "graphic")];
  const out = diversifyByMedia(ranked);
  assert.deepEqual(out.map((i) => i.rank), [1, 2, 3]);
});

test("nothing is added, dropped or duplicated", () => {
  const ranked = [
    item(1, "graphic"), item(2, "graphic"), item(3, "photograph"),
    item(4, "none"), item(5, "graphic"), item(6, "photograph"),
  ];
  const out = diversifyByMedia(ranked);
  assert.equal(out.length, ranked.length);
  assert.deepEqual([...out.map((i) => i.rank)].sort((a, b) => a - b), [1, 2, 3, 4, 5, 6]);
});

test("an empty list and a single item are handled", () => {
  assert.deepEqual(diversifyByMedia([]), []);
  const one = [item(1, "graphic")];
  assert.deepEqual(diversifyByMedia(one), one);
});

test("MAX_RUN is what actually governs the break", () => {
  const ranked = Array.from({ length: 8 }, (_, i) => item(i + 1, i % 4 < 3 ? "graphic" : "photograph"));
  const out = diversifyByMedia(ranked);
  assert.ok(longestRun(out) <= MAX_RUN + 1, `run of ${longestRun(out)} with MAX_RUN ${MAX_RUN}`);
});
