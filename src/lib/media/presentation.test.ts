import { test } from "node:test";
import assert from "node:assert/strict";
import {
  classifyProductMedia,
  ORIGINAL_GRAPHIC_LABEL,
  mediaFit,
  isDataGraphic,
  frameAspectRatio,
  isUnderSizedFor,
  dimensionsUnknown,
} from "./presentation.ts";

test("no asset at all is stated plainly, not left blank", () => {
  const r = classifyProductMedia(null);
  assert.equal(r.kind, "none");
  assert.ok(r.kind === "none" && r.label.length > 0);
});

test("a TechCarvalho original graphic is never presented as a photograph", () => {
  const r = classifyProductMedia({ source_type: "tc_graphic", owned: true });
  assert.equal(r.kind, "original_graphic");
  assert.equal(r.kind === "original_graphic" && r.label, ORIGINAL_GRAPHIC_LABEL);
});

test("ai_generated wins over a photographic source_type — fail closed", () => {
  // A mislabelled row must not be able to present generated imagery as a
  // photograph of a real product. This is the single most important case in
  // this file.
  const r = classifyProductMedia({ source_type: "manufacturer", ai_generated: true });
  assert.equal(r.kind, "original_graphic");
});

test("ai_generated wins even when the row claims a staff photograph", () => {
  const r = classifyProductMedia({ source_type: "staff_photograph", ai_generated: true, owned: true });
  assert.equal(r.kind, "original_graphic");
});

test("a CC-licensed Commons photo is a photograph and carries its credit", () => {
  const r = classifyProductMedia({
    source_type: "public_domain_or_cc",
    attribution_required: true,
    attribution: "Photo: decltype, CC BY-SA 3.0, via Wikimedia Commons",
  });
  assert.equal(r.kind, "photograph");
  assert.equal(r.kind === "photograph" && r.attribution, "Photo: decltype, CC BY-SA 3.0, via Wikimedia Commons");
});

test("attribution falls back to creator when no attribution string is set", () => {
  const r = classifyProductMedia({
    source_type: "public_domain_or_cc",
    attribution_required: true,
    creator: "Ashley Pomeroy",
  });
  assert.equal(r.kind === "photograph" && r.attribution, "Ashley Pomeroy");
});

test("no credit line is emitted when attribution is not required", () => {
  const r = classifyProductMedia({
    source_type: "staff_photograph",
    attribution_required: false,
    creator: "Someone",
  });
  assert.equal(r.kind === "photograph" && r.attribution, null);
});

test("a staff photograph is a photograph", () => {
  assert.equal(classifyProductMedia({ source_type: "staff_photograph" }).kind, "photograph");
});

test("an unclassified asset is still credited, never relabelled as a graphic", () => {
  // Several live rows predate the source_type vocabulary and carry 'other' or
  // null. They are real photographs a human published; the page must not claim
  // otherwise in either direction.
  const r = classifyProductMedia({
    source_type: "other",
    attribution_required: true,
    attribution: "Photo: Harrison Jones, CC BY-SA 4.0, via Wikimedia Commons",
  });
  assert.equal(r.kind, "photograph");
  assert.equal(r.kind === "photograph" && r.attribution, "Photo: Harrison Jones, CC BY-SA 4.0, via Wikimedia Commons");
});

test("a null source_type behaves the same as 'other'", () => {
  const r = classifyProductMedia({ source_type: null, attribution_required: true, creator: "Mlogic (Yan Li)" });
  assert.equal(r.kind, "photograph");
  assert.equal(r.kind === "photograph" && r.attribution, "Mlogic (Yan Li)");
});

// ---------------------------------------------------------------------------
// Fit and frame — the mixed-media half
// ---------------------------------------------------------------------------

const photo = {
  source_type: "public_domain_or_cc",
  asset_role: "product_photo",
  owned: false,
  ai_generated: false,
  storage_path: "image/uuid-canon-eos-5d-mark-iv-03.jpg",
  source_url: "https://commons.wikimedia.org/wiki/File:Canon.jpg",
  license: "CC BY-SA 4.0",
};

const chart = {
  source_type: "tc_graphic",
  asset_role: "comparison_graphic",
  owned: true,
  ai_generated: false,
  storage_path: "image/uuid-cmp-rtx5090-vs-5080.png",
  source_url: null,
  license: null,
};

const titleCard = {
  source_type: "tc_graphic",
  asset_role: "article_hero",
  owned: true,
  ai_generated: false,
  storage_path: "image/uuid-hero-smartphones.png",
  source_url: null,
  license: null,
};

test("a photograph may be cropped to fill its frame", () => {
  assert.equal(mediaFit(photo), "cover");
});

test("a comparison chart is never cropped — its content runs to the edges", () => {
  assert.equal(mediaFit(chart), "contain");
});

test("a title card is not cropped either — cropping one cuts the words", () => {
  assert.equal(mediaFit(titleCard), "contain");
});

test("an unknown asset defaults to cover, not to a floating letterboxed thumbnail", () => {
  // Failing the other way would take every asset the classifier cannot place
  // and shrink it inside its slot, which is the exact "tiny image in a huge
  // card" complaint this work exists to fix.
  assert.equal(mediaFit(null), "cover");
  assert.equal(mediaFit(undefined), "cover");
});

test("only charts/diagrams/tables count as data graphics, not title cards", () => {
  assert.equal(isDataGraphic(chart), true);
  assert.equal(isDataGraphic(titleCard), false);
  assert.equal(isDataGraphic(photo), false);
  assert.equal(isDataGraphic(null), false);
});

test("the frame takes the image's own ratio, so nothing is cropped", () => {
  assert.equal(frameAspectRatio(1600, 900), "1600 / 900");
  assert.equal(frameAspectRatio(1600, 1067), "1600 / 1067");
  assert.equal(frameAspectRatio(1280, 853), "1280 / 853");
});

test("a portrait image is clamped to square rather than making the page a column", () => {
  // 1600x2133 is a real phone photograph in the catalogue. Its own ratio would
  // give a frame taller than most viewports; 1:1 crops the minimum needed.
  assert.equal(frameAspectRatio(1600, 2133), "1 / 1");
  assert.equal(frameAspectRatio(1536, 2048), "1 / 1");
});

test("a panorama is clamped to 16:9 rather than becoming a letterbox strip", () => {
  assert.equal(frameAspectRatio(4000, 1000), "16 / 9");
});

test("a square image is kept square — it is exactly at the clamp boundary", () => {
  assert.equal(frameAspectRatio(1600, 1600), "1600 / 1600");
});

test("missing or nonsense dimensions fall back to 4:3 rather than collapsing", () => {
  // Five published rows still have null width/height, and inspecting the real
  // files shows three of them are PORTRAIT. A 16:9 fallback would centre-crop
  // those to about 40% of the picture; 4:3 is the least-wrong guess. A frame
  // with no ratio at all would have zero height and not render.
  assert.equal(frameAspectRatio(null, null), "4 / 3");
  assert.equal(frameAspectRatio(1600, null), "4 / 3");
  assert.equal(frameAspectRatio(0, 0), "4 / 3");
  assert.equal(frameAspectRatio(-5, 10), "4 / 3");
});

test("unknown dimensions are never cropped — you cannot crop a shape you do not know", () => {
  assert.equal(dimensionsUnknown(null, null), true);
  assert.equal(dimensionsUnknown(1600, null), true);
  assert.equal(dimensionsUnknown(0, 900), true);
  assert.equal(dimensionsUnknown(1600, 900), false);
});

test("under-sizing is only reported when the asset really is smaller", () => {
  assert.equal(isUnderSizedFor(320, 720), true);
  assert.equal(isUnderSizedFor(1600, 720), false);
  // Unknown width is not evidence of a problem either way.
  assert.equal(isUnderSizedFor(null, 720), false);
});
