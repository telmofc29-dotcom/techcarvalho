import { test } from "node:test";
import assert from "node:assert/strict";
import {
  judgeAsset,
  judgeSubject,
  identityTokens,
  modelTokens,
  hasExactSubjectMedia,
  type SubjectMediaAsset,
  type Subject,
} from "./subject-match.ts";

const R7: Subject = { name: "Canon EOS R7", manufacturerName: "Canon" };
const asset = (over: Partial<SubjectMediaAsset> = {}): SubjectMediaAsset => ({
  id: "a", altText: null, caption: null, sourceType: "public_domain_or_cc",
  assetRole: "product_photo", brandRole: null, ...over,
});

// --- the identity rule -----------------------------------------------------

test("SHORT DIGIT-BEARING TOKENS SURVIVE — they are the whole identity", () => {
  // "R7" is two characters and is the only thing separating this from an R5.
  // A minimum-length filter discards exactly the token that matters, which is
  // how a naive matcher once reduced every Canon product to "canon".
  const t = identityTokens("Canon EOS R7");
  assert.ok(t.has("r7"), [...t].join(","));
  assert.deepEqual([...modelTokens("Canon EOS R7")], ["r7"]);
  assert.ok(modelTokens("Canon EOS 60D").has("60d"));
  assert.ok(modelTokens("Sony a1").has("a1"));
});

test("generic nouns are not identity", () => {
  const t = identityTokens("Canon EOS R7 camera body");
  assert.ok(!t.has("camera"));
  assert.ok(!t.has("body"));
  assert.ok(t.has("canon"));
});

// --- the failure this exists to measure ------------------------------------

test("A CANON CAMERA IS NOT A CANON EOS R7", () => {
  // The exact failure the owner described: a photograph is accepted because the
  // manufacturer matches, and the page claims to show a product it does not.
  const v = judgeAsset(asset({ altText: "A Canon mirrorless camera on a table" }), R7);
  assert.equal(v, "acceptable", "related, but NOT strong");
  assert.notEqual(v, "strong");
});

test("naming the exact model is strong", () => {
  assert.equal(judgeAsset(asset({ altText: "Canon EOS R7 with the RF-S 18-150mm" }), R7), "strong");
});

test("the WRONG model in the same range is not strong", () => {
  const v = judgeAsset(asset({ altText: "Canon EOS R5 front view" }), R7);
  assert.notEqual(v, "strong");
});

test("a generated title card is a placeholder even when it names the subject", () => {
  // Naming a product does not make an image a picture of it. This is the
  // 65-of-112 problem.
  const v = judgeAsset(
    asset({ altText: "Canon EOS R7 — everything you need to know", sourceType: "tc_graphic", assetRole: "article_hero" }),
    R7
  );
  assert.equal(v, "generic_placeholder");
});

test("an image with NO description is undescribed, not missing", () => {
  // A documentation gap must not be reported as an imagery gap — they need
  // different work from different people.
  assert.equal(judgeAsset(asset({ altText: null, caption: null }), R7), "undescribed");
});

// --- data graphics are judged on their own terms ---------------------------

test("A CHART ABOUT THE SUBJECT IS STRONG, NOT A PLACEHOLDER", () => {
  // A chart explaining a specification is frequently the RIGHT lead image, and
  // demanding a photograph instead would make the page worse.
  const v = judgeAsset(
    asset({ altText: "Canon EOS R7 burst rate compared across modes", sourceType: "tc_graphic", assetRole: "chart" }),
    R7
  );
  assert.equal(v, "strong");
});

test("a chart about something else is wrong, not merely generic", () => {
  const v = judgeAsset(
    asset({ altText: "PC game install sizes in GB", sourceType: "tc_graphic", assetRole: "chart" }),
    R7
  );
  assert.equal(v, "wrong_subject");
});

// --- subject-level judgement -----------------------------------------------

test("nothing attached is 'missing'", () => {
  assert.equal(judgeSubject([], R7), "missing");
  assert.equal(hasExactSubjectMedia([], R7), false);
});

test("THE BEST ASSET DECIDES", () => {
  // A page with one real photograph and three title cards is illustrated.
  // Reporting it as a placeholder problem sends someone to fix a page that is fine.
  const assets = [
    asset({ id: "1", altText: "generic hero", sourceType: "tc_graphic" }),
    asset({ id: "2", altText: "Canon EOS R7 body, three-quarter view" }),
    asset({ id: "3", altText: "another card", sourceType: "tc_graphic" }),
  ];
  assert.equal(judgeSubject(assets, R7), "strong");
  assert.equal(hasExactSubjectMedia(assets, R7), true);
});

test("only placeholders means the subject reads as a placeholder", () => {
  const assets = [
    asset({ id: "1", altText: "Canon EOS R7 explained", sourceType: "tc_graphic" }),
    asset({ id: "2", altText: "Cameras and photography", sourceType: "tc_graphic" }),
  ];
  assert.equal(judgeSubject(assets, R7), "generic_placeholder");
});

test("a lens names its focal range as identity", () => {
  const lens: Subject = { name: "Canon RF 24-70mm F2.8 L IS USM", manufacturerName: "Canon" };
  assert.ok(modelTokens(lens.name).has("24-70mm"));
  assert.equal(
    judgeAsset(asset({ altText: "Canon RF 24-70mm F2.8 L IS USM on a white background" }), lens),
    "strong"
  );
  // A different zoom from the same maker is not this lens.
  assert.notEqual(
    judgeAsset(asset({ altText: "Canon RF 70-200mm F2.8 L IS USM" }), lens),
    "strong"
  );
});

test("a subject with no digits at all still works", () => {
  // Not every product carries a number. With no model token to key on, naming
  // the product's actual words IS the strongest evidence available.
  const s: Subject = { name: "Steam Deck", manufacturerName: "Valve" };
  assert.equal(judgeAsset(asset({ altText: "A Steam Deck handheld" }), s), "strong");
  assert.equal(judgeAsset(asset({ altText: "A washing machine" }), s), "wrong_subject");
});

test("AN ARTICLE'S OWN DATA GRAPHIC IS NOT 'WRONG SUBJECT'", () => {
  // The false accusation that made the first measurement untrustworthy. Article
  // titles rarely contain a model number, so requiring digit-bearing tokens made
  // every data graphic on every article fail — including this one, whose entire
  // subject is minimum versus recommended specifications.
  const article: Subject = {
    name: "Minimum and Recommended System Requirements: What They Actually Promise",
    manufacturerName: null,
  };
  const hero = asset({
    altText: "Original Tech Carvalho comparison graphic: Minimum spec versus Recommended spec, comparing 10 specifications",
    sourceType: "tc_graphic",
    assetRole: "comparison_graphic",
  });
  // "acceptable", NOT "strong", and deliberately not "wrong_subject".
  //
  // The bug was the false accusation. The fix is not to swing to false
  // confidence: an article title carries filler ("what", "they", "actually")
  // that no image description will echo, so alt text can show a graphic is
  // RELATED to an article but cannot prove it is the right one. Saying
  // "acceptable" is the limit of what the evidence supports.
  assert.notEqual(judgeAsset(hero, article), "wrong_subject");
  assert.equal(judgeAsset(hero, article), "acceptable");
});

test("a graphic about a genuinely different topic is still wrong", () => {
  // The fallback must not accept everything — that would make the measurement
  // useless in the other direction.
  const article: Subject = { name: "How to Photograph the Moon Without a Telescope", manufacturerName: null };
  const unrelated = asset({
    altText: "Original Tech Carvalho bar chart: PC game install sizes in GB across 10 titles",
    sourceType: "tc_graphic",
    assetRole: "chart",
  });
  assert.equal(judgeAsset(unrelated, article), "wrong_subject");
});

test("a product still needs its FULL model designation to score strong", () => {
  // The article fallback must not loosen the product rule: "Canon EOS R5" text
  // on an R7 page shares 'canon' and 'eos' and is still not the R7.
  assert.notEqual(judgeAsset(asset({ altText: "Canon EOS R5 front view" }), R7), "strong");
  assert.equal(judgeAsset(asset({ altText: "Canon EOS R7 front view" }), R7), "strong");
});

test("A CONCEPT RENDER NEVER COUNTS AS SHOWING THE PRODUCT", () => {
  // The trap: an imagined PlayStation 6 whose alt text names the subject
  // perfectly matches every identity token and would score "strong" — the one
  // claim it must never make. Media coverage that counted it would report a
  // product as illustrated when nobody has seen the hardware.
  const ps6: Subject = { name: "Sony PlayStation 6", manufacturerName: "Sony" };
  const render = asset({
    altText: "Sony PlayStation 6 concept render, three-quarter view",
    sourceType: "tc_graphic",
    assetRole: "concept_render",
  });
  assert.notEqual(judgeAsset(render, ps6), "strong");
  assert.equal(judgeSubject([render], ps6), "generic_placeholder");
  assert.equal(hasExactSubjectMedia([render], ps6), false);
});

test("a concept render does not rescue a product's coverage", () => {
  // Even alongside other assets, it must not be the thing that makes a product
  // count as having exact-subject imagery.
  const ps6: Subject = { name: "Sony PlayStation 6", manufacturerName: "Sony" };
  const assets = [
    asset({ id: "1", altText: "Sony PlayStation 6 concept", sourceType: "tc_graphic", assetRole: "concept_render" }),
    asset({ id: "2", altText: "A generic gaming setup", sourceType: "tc_graphic" }),
  ];
  assert.equal(hasExactSubjectMedia(assets, ps6), false);
});
