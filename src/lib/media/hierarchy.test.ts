import { test } from "node:test";
import assert from "node:assert/strict";
import {
  classifyMediaTier, evaluateHero, inferSubjectKind, tierRank,
  type ClassifiableAsset,
} from "./hierarchy.ts";

const asset = (o: Partial<ClassifiableAsset>): ClassifiableAsset => ({
  source_type: null, asset_role: null, owned: null, ai_generated: null,
  storage_path: null, source_url: null, license: null, ...o,
});

test("a Commons product photograph is real_subject", () => {
  // The shape of all 36 product heroes now live.
  assert.equal(classifyMediaTier(asset({
    source_type: "public_domain_or_cc", asset_role: "product_photo",
    source_url: "https://commons.wikimedia.org/wiki/File:Canon_EOS_7D.jpg",
    license: "CC BY-SA 4.0",
  })), "real_subject");
});

test("external imagery without a source URL cannot claim real_subject", () => {
  // Provenance has to be showable — the credit line is a licence condition.
  assert.equal(classifyMediaTier(asset({
    source_type: "public_domain_or_cc", asset_role: "product_photo", source_url: null,
  })), "licensed_third_party");
});

test("generated title cards are generic_graphic, even when topic-specific", () => {
  for (const p of ["x-hero-gaming.png", "y-hero-canon-ef-lenses-worth-buying-used.png"]) {
    assert.equal(classifyMediaTier(asset({
      source_type: "tc_graphic", asset_role: "article_hero", storage_path: p, owned: true,
    })), "generic_graphic", p);
  }
});

test("generated charts and comparisons are data_graphic, not generic", () => {
  for (const p of ["a-cmp-rtx5090-vs-5080.png", "b-chart-memory-bandwidth.png",
                   "c-spec_diagram-sensor.png", "d-timeline-wifi.png", "e-p3-bortle-scale.png"]) {
    assert.equal(classifyMediaTier(asset({
      source_type: "tc_graphic", asset_role: "article_hero", storage_path: p, owned: true,
    })), "data_graphic", p);
  }
});

test("filename wins over a retroactively applied asset_role", () => {
  // asset_role was backfilled; a chart carrying 'article_hero' is still a chart.
  assert.equal(classifyMediaTier(asset({
    source_type: "tc_graphic", asset_role: "article_hero", storage_path: "z-cmp-ps5-vs-ps5pro.png",
  })), "data_graphic");
});

test("staff photography and press kits get their own tiers", () => {
  assert.equal(classifyMediaTier(asset({ source_type: "staff_photograph" })), "original_photo");
  assert.equal(classifyMediaTier(asset({ source_type: "press_kit" })), "official_permitted");
});

test("no asset is missing", () => {
  assert.equal(classifyMediaTier(null), "missing");
  assert.equal(classifyMediaTier(undefined), "missing");
});

test("our own photography ranks with real subject imagery", () => {
  assert.equal(tierRank("original_photo"), tierRank("real_subject"));
  assert.ok(tierRank("real_subject") < tierRank("data_graphic"));
  assert.ok(tierRank("data_graphic") < tierRank("generic_graphic"));
  assert.ok(tierRank("generic_graphic") < tierRank("missing"));
});

// --- the load-bearing judgement ---

test("a chart is RIGHT on a comparison and WRONG on a product page", () => {
  assert.equal(evaluateHero("data_graphic", "comparison").acceptable, true);
  assert.equal(evaluateHero("data_graphic", "product").acceptable, false);
  assert.equal(evaluateHero("data_graphic", "named_media").acceptable, false);
});

test("a diagram on an explainer is doing real work, not substituting", () => {
  const v = evaluateHero("data_graphic", "conceptual");
  assert.equal(v.acceptable, true);
  assert.equal(v.shouldReplace, false);
  assert.ok(v.reason.includes("real work"));
});

test("a generic title card is never acceptable on a recognisable subject", () => {
  for (const s of ["product", "named_media", "comparison"] as const) {
    const v = evaluateHero("generic_graphic", s);
    assert.equal(v.acceptable, false, s);
    assert.equal(v.shouldReplace, true, s);
  }
});

test("a title card IS acceptable on a conceptual piece with nothing to photograph", () => {
  const v = evaluateHero("generic_graphic", "conceptual");
  assert.equal(v.acceptable, true);
  assert.equal(v.shouldReplace, false);
});

test("real subject imagery is always acceptable and never flagged", () => {
  for (const s of ["product", "named_media", "comparison", "conceptual"] as const) {
    for (const t of ["real_subject", "official_permitted", "original_photo"] as const) {
      const v = evaluateHero(t, s);
      assert.equal(v.acceptable, true, `${t}/${s}`);
      assert.equal(v.shouldReplace, false, `${t}/${s}`);
    }
  }
});

test("an original render is honest but still worth upgrading on a product page", () => {
  const v = evaluateHero("original_render", "product");
  assert.equal(v.acceptable, true);
  assert.equal(v.shouldReplace, true);
  assert.ok(v.reason.includes("is not the subject"));
});

// --- subject inference ---

test("named consoles and games are recognised as visual subjects", () => {
  for (const t of [
    "GTA 6: What's Actually Confirmed About the Release Date",
    "PS5 Storage Expansion Explained",
    "What HDMI 2.1 Actually Changes for PS5 and Xbox Gaming",
    "Nintendo Switch 2 hands on",
  ]) {
    assert.equal(inferSubjectKind({ contentType: "news", title: t }), "named_media", t);
  }
});

test("comparisons are detected by type or by title", () => {
  assert.equal(inferSubjectKind({ contentType: "comparison", title: "Anything" }), "comparison");
  assert.equal(inferSubjectKind({ contentType: "guide", title: "Mesh Wi-Fi vs a Single Router" }), "comparison");
});

test("standards and how-tos are conceptual", () => {
  for (const t of [
    "Matter Explained: The Smart Home Standard",
    "Wi-Fi 7 Explained — What Actually Changes",
    "Planning an Astrophotography Night: Moon Phase, Twilight and Timing",
  ]) {
    assert.equal(inferSubjectKind({ contentType: "guide", title: t }), "conceptual", t);
  }
});

test("products are always product, whatever the title says", () => {
  assert.equal(inferSubjectKind({ title: "Some Concept Explained", isProduct: true }), "product");
});
