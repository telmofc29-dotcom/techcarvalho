import { test } from "node:test";
import assert from "node:assert/strict";
import {
  scoreMatch,
  matchesForAsset,
  matchesForTarget,
  classifyNature,
  depictsRealObject,
  assetVocabulary,
  proposeAltText,
  NATURE_LABELS,
  type MatchAsset,
  type MatchTarget,
} from "./match-engine.ts";
import { buildEntityVocabulary } from "./entity-vocabulary.ts";

// THE VOCABULARY THESE TESTS RUN AGAINST.
//
// Built exactly the way suggestion-service builds the real one — from
// catalogue-shaped reference data — because that is the input the matcher
// actually receives. These tests used to pass with NO vocabulary, which meant
// they were asserting that any word over two letters could establish relevance.
// Four of them went red when that stopped being true, and they were right to:
// "Ryzen" and "Wi-Fi" ARE things this publication covers, and they are in here
// for the same reason they are in production — because the catalogue names them.
const VOCAB = buildEntityVocabulary({
  manufacturers: ["AMD", "Canon", "NVIDIA", "Intel", "Sony", "Apple", "Samsung", "DJI", "Bambu Lab"],
  productNames: [
    "AMD Ryzen 9 9950X",
    "Canon EOS R5",
    "Canon EOS 5D Mark III",
    "NVIDIA GeForce RTX 5090",
    "Bambu Lab X1 Carbon",
    "Sony PlayStation 5",
  ],
  familyNames: ["Ryzen", "Canon EOS R", "GeForce RTX 50"],
  categorySlugs: ["cameras-photography", "computing", "networking", "gaming", "3d-printing"],
  tagNames: ["Wi-Fi 7", "Wi-Fi", "Mesh Wi-Fi", "Router", "CPU", "GPU", "Drone", "Console"],
});


/**
 * scoreMatch with the vocabulary supplied, which is how the app calls it.
 *
 * A test that omits it is testing a matcher that has been told the site covers
 * nothing, and will conclude that nothing is relevant to anything.
 */
const scoreMatchV = (a: Parameters<typeof scoreMatch>[0], t: Parameters<typeof scoreMatch>[1]) =>
  scoreMatch(a, t, { entityVocabulary: VOCAB });

function asset(over: Partial<MatchAsset> = {}): MatchAsset {
  return {
    id: "a1",
    storagePath: "image/photo.jpg",
    altText: null,
    caption: null,
    sourceType: "staff_photograph",
    assetRole: null,
    brandRole: null,
    owned: true,
    aiGenerated: false,
    publicationStatus: "published",
    rightsStatus: "verified",
    width: 2000,
    height: 1400,
    ...over,
  };
}

function target(over: Partial<MatchTarget> = {}): MatchTarget {
  return {
    id: "t1",
    kind: "content",
    title: "What a CPU actually does",
    manufacturerName: null,
    categorySlug: "computing",
    isModelSpecific: false,
    occupiedSlots: [],
    ...over,
  };
}

// ---------------------------------------------------------------------------
// THE SKU RULE
// ---------------------------------------------------------------------------

test("a family-level Ryzen photo matches general Ryzen material", () => {
  const m = scoreMatchV(asset({ storagePath: "image/ryzen-cpu-in-hand.jpg" }),
    target({ title: "Ryzen CPUs explained", isModelSpecific: false })
  );
  assert.equal(m.specificity, "family");
  assert.ok(m.proposedSlots.includes("hero"));
  assert.match(m.reasons.join(" "), /carries no model number/i);
});

test("the SAME photo is REFUSED for a specific SKU", () => {
  // The fabrication this prevents: presenting a generic Ryzen photo as a
  // picture of one exact part.
  const m = scoreMatchV(asset({ storagePath: "image/ryzen-cpu-in-hand.jpg" }),
    target({ title: "AMD Ryzen 9 9950X", kind: "product", isModelSpecific: true })
  );
  assert.deepEqual(m.proposedSlots, []);
  assert.match(m.withheld.join(" "), /identifies the family but not the model/i);
});

test("a photo whose OWN metadata names the model is allowed on that SKU", () => {
  const m = scoreMatchV(asset({ storagePath: "image/ryzen-9950x-installed.jpg" }),
    target({ title: "AMD Ryzen 9 9950X", kind: "product", isModelSpecific: true })
  );
  assert.equal(m.specificity, "exact_model");
  assert.ok(m.proposedSlots.includes("hero"));
  assert.match(m.reasons[0], /Names the exact model/i);
});

test("model evidence may come from owner-written alt text, not just the filename", () => {
  const m = scoreMatchV(asset({ storagePath: "image/IMG_4821.jpg", altText: "My Ryzen 9950X on the motherboard" }),
    target({ title: "AMD Ryzen 9 9950X", kind: "product", isModelSpecific: true })
  );
  assert.equal(m.specificity, "exact_model");
});

// ---------------------------------------------------------------------------
// Owner photography is the most valuable kind
// ---------------------------------------------------------------------------

test("owner photography outranks a concept render of the same subject", () => {
  const t = target({ title: "PlayStation 5 storage explained" });
  const photo = scoreMatchV(asset({ id: "own", storagePath: "image/playstation-5-console.jpg" }), t);
  const render = scoreMatchV(asset({
      id: "gen",
      storagePath: "image/playstation-5-console.png",
      sourceType: "tc_graphic",
      aiGenerated: true,
    }),
    t
  );
  assert.ok(photo.score > render.score, `${photo.score} vs ${render.score}`);
  assert.equal(photo.nature, "owner_photograph");
  assert.equal(render.nature, "concept_render");
});

test("owner photography outranks an official press image, all else equal", () => {
  const t = target({ title: "PlayStation 5 storage explained" });
  const own = scoreMatchV(asset({ id: "o", storagePath: "image/playstation-5.jpg" }), t);
  const press = scoreMatchV(asset({ id: "p", storagePath: "image/playstation-5.jpg", sourceType: "press_kit" }),
    t
  );
  assert.ok(own.score > press.score);
});

test("a boost never promotes across specificity", () => {
  // Being an owner photograph does not make it a picture of that exact SKU.
  const m = scoreMatchV(asset({ storagePath: "image/moon-through-telescope.jpg" }),
    target({ title: "AMD Ryzen 9 9950X", kind: "product", isModelSpecific: true })
  );
  assert.deepEqual(m.proposedSlots, []);
});

// ---------------------------------------------------------------------------
// Nature classification and its consequences
// ---------------------------------------------------------------------------

test("an AI-generated tc_graphic is a concept render, never photography", () => {
  assert.equal(classifyNature(asset({ sourceType: "tc_graphic", aiGenerated: true })), "concept_render");
  assert.equal(depictsRealObject("concept_render"), false);
});

test("an explicit concept_render role wins over anything that looks like photography", () => {
  assert.equal(
    classifyNature(asset({ sourceType: "staff_photograph", assetRole: "concept_render" })),
    "concept_render"
  );
});

test("a concept render may lead a general article but never a SKU page", () => {
  const render = asset({
    storagePath: "image/ps6-concept.png",
    sourceType: "tc_graphic",
    aiGenerated: true,
  });
  const general = scoreMatchV(render, target({ title: "PS6 rumours so far", isModelSpecific: false }));
  assert.ok(general.proposedSlots.includes("hero"));
  const sku = scoreMatchV(render,
    target({ title: "PlayStation 6", kind: "product", isModelSpecific: true })
  );
  assert.ok(!sku.proposedSlots.includes("hero"));
});

test("a diagram is offered for the gallery, not the lead", () => {
  const m = scoreMatchV(asset({
      storagePath: "image/wifi-generations-timeline.png",
      sourceType: "tc_graphic",
      assetRole: "diagram",
      aiGenerated: false,
    }),
    target({ title: "Wi-Fi generations explained" })
  );
  assert.ok(!m.proposedSlots.includes("hero"));
  assert.ok(m.proposedSlots.includes("gallery"));
  assert.match(m.withheld.join(" "), /explains rather than depicts/i);
});

// ---------------------------------------------------------------------------
// Human choices are protected
// ---------------------------------------------------------------------------

test("a human-selected hero is never proposed for replacement", () => {
  const m = scoreMatchV(asset({ storagePath: "image/ryzen-9950x.jpg" }),
    target({
      title: "AMD Ryzen 9 9950X",
      kind: "product",
      isModelSpecific: true,
      occupiedSlots: [{ role: "hero", humanSelected: true }],
    })
  );
  assert.ok(!m.proposedSlots.includes("hero"));
  assert.match(m.withheld.join(" "), /a human already chose the lead image/i);
});

test("an occupied but non-human hero is still not taken silently", () => {
  const m = scoreMatchV(asset({ storagePath: "image/ryzen-9950x.jpg" }),
    target({
      title: "AMD Ryzen 9 9950X",
      kind: "product",
      isModelSpecific: true,
      occupiedSlots: [{ role: "hero", humanSelected: false }],
    })
  );
  assert.ok(!m.proposedSlots.includes("hero"));
  assert.match(m.withheld.join(" "), /propose a replacement explicitly/i);
});

test("Hero + Thumbnail + Gallery can all be proposed for one asset", () => {
  const m = scoreMatchV(asset({ storagePath: "image/ryzen-9950x.jpg" }),
    target({ title: "AMD Ryzen 9 9950X", kind: "product", isModelSpecific: true })
  );
  assert.deepEqual(m.proposedSlots, ["hero", "thumbnail", "gallery"]);
});

// ---------------------------------------------------------------------------
// Rights and brand safety
// ---------------------------------------------------------------------------

test("restricted rights refuse every slot", () => {
  const m = scoreMatchV(asset({ storagePath: "image/ryzen-9950x.jpg", rightsStatus: "restricted" }),
    target({ title: "AMD Ryzen 9 9950X", kind: "product", isModelSpecific: true })
  );
  assert.deepEqual(m.proposedSlots, []);
  assert.match(m.withheld.join(" "), /restricted/i);
});

test("a logo is never editorial imagery", () => {
  const m = scoreMatchV(asset({ storagePath: "image/amd-logo.png", brandRole: "logo_full" }),
    target({ title: "AMD Ryzen 9 9950X", kind: "product", isModelSpecific: true })
  );
  assert.deepEqual(m.proposedSlots, []);
});

// ---------------------------------------------------------------------------
// Vocabulary
// ---------------------------------------------------------------------------

test("the upload uuid prefix does not become shared vocabulary", () => {
  const v = assetVocabulary(
    asset({ storagePath: "image/edf03930-2599-40af-b5c8-3abf3aaca323-router.png" })
  );
  assert.ok(v.fromFilename.has("router"));
  assert.ok(![...v.fromFilename].some((t) => t.includes("edf03930")));
});

test("written description scores above filename alone", () => {
  const t = target({ title: "Ryzen CPUs explained" });
  const named = scoreMatchV(asset({ id: "d", storagePath: "image/IMG_1.jpg", altText: "A Ryzen CPU" }), t);
  const filed = scoreMatchV(asset({ id: "f", storagePath: "image/ryzen.jpg" }), t);
  assert.ok(named.score > filed.score, `${named.score} vs ${filed.score}`);
});

// ---------------------------------------------------------------------------
// Both directions agree
// ---------------------------------------------------------------------------

test("media to content and content to media use the same scorer", () => {
  const a = asset({ storagePath: "image/ryzen-9950x.jpg" });
  const t = target({ title: "AMD Ryzen 9 9950X", kind: "product", isModelSpecific: true });
  const forward = matchesForAsset(a, [t]);
  const reverse = matchesForTarget(t, [a]);
  assert.equal(forward.length, 1);
  assert.equal(reverse.length, 1);
  assert.equal(forward[0].score, reverse[0].score);
});

test("weak and refused pairings never reach a suggestion list", () => {
  const a = asset({ storagePath: "image/moon.jpg" });
  assert.deepEqual(
    matchesForAsset(a, [
      target({ title: "AMD Ryzen 9 9950X", kind: "product", isModelSpecific: true }),
    ]),
    []
  );
});

// ---------------------------------------------------------------------------
// Alt text
// ---------------------------------------------------------------------------

test("proposed alt text describes the picture, never the specification", () => {
  const render = asset({
    storagePath: "image/iphone-18-concept.png",
    sourceType: "tc_graphic",
    aiGenerated: true,
  });
  const alt = proposeAltText(render, null) ?? "";
  assert.match(alt, /Concept render/i);
  assert.match(alt, /Not a photograph/i);
  assert.ok(!/official/i.test(alt));
  assert.ok(!/specification/i.test(alt));
});

test("owner photography is described as TechCarvalho's own", () => {
  const alt = proposeAltText(asset({ storagePath: "image/ryzen-9950x.jpg" }), null) ?? "";
  assert.match(alt, /TechCarvalho photograph/i);
});

test("nothing describable yields null rather than a guess", () => {
  assert.equal(proposeAltText(asset({ storagePath: "image/a1.jpg" }), null), null);
});

test("every nature has a label", () => {
  for (const n of Object.keys(NATURE_LABELS)) {
    assert.ok(NATURE_LABELS[n as keyof typeof NATURE_LABELS].length > 3);
  }
});

// ---------------------------------------------------------------------------
// Variant confusion — both found on the real library, not invented
// ---------------------------------------------------------------------------

test("a Mark III photograph is NOT an exact match for the Mark II", () => {
  // Found running the matcher over production: canon-eos-5d-mark-iii.jpg was
  // reported as an exact_model match for "Canon EOS 5D Mark II", because they
  // share the token "5d". That is the false-SKU claim this module exists to
  // prevent, produced by the rule meant to prevent it.
  const photo = asset({ storagePath: "image/canon-eos-5d-mark-iii.jpg", sourceType: "public_domain_or_cc" });

  const markIII = scoreMatchV(photo, target({ title: "Canon EOS 5D Mark III", kind: "product", isModelSpecific: true }));
  assert.equal(markIII.specificity, "exact_model", "its own model must still match");

  const markII = scoreMatchV(photo, target({ title: "Canon EOS 5D Mark II", kind: "product", isModelSpecific: true }));
  assert.notEqual(markII.specificity, "exact_model");
  assert.deepEqual(markII.proposedSlots, [], "and it must not be attachable there");
  assert.match(markII.reasons.join(" "), /different variant|distinguished by/i);
});

test("a Mark III photograph is not an exact match for the plain model either", () => {
  const photo = asset({ storagePath: "image/canon-eos-5d-mark-iii.jpg", sourceType: "public_domain_or_cc" });
  const plain = scoreMatchV(photo, target({ title: "Canon EOS 5D", kind: "product", isModelSpecific: true }));
  assert.notEqual(plain.specificity, "exact_model");
  assert.deepEqual(plain.proposedSlots, []);
});

test("a bare shared digit does not identify a product", () => {
  // Also from production: dji-mini-4-pro.png matched "Neptune 4 Pro", a 3D
  // printer, because both contain "4".
  const drone = asset({ storagePath: "image/dji-mini-4-pro.png", sourceType: "tc_graphic", aiGenerated: true });
  const printer = scoreMatchV(drone, target({ title: "Neptune 4 Pro", kind: "product", isModelSpecific: true }));
  assert.notEqual(printer.specificity, "exact_model");
  assert.deepEqual(printer.proposedSlots, []);
});

test("a series digit is not required for a genuine model match", () => {
  // The other direction of the same rule: requiring every digit token rejected
  // a correct match, because "Ryzen 9 9950X" carries a bare "9".
  const m = scoreMatchV(asset({ storagePath: "image/ryzen-9950x.jpg" }),
    target({ title: "AMD Ryzen 9 9950X", kind: "product", isModelSpecific: true })
  );
  assert.equal(m.specificity, "exact_model");
});

test("hyphenated and flat spellings of the same word unify", () => {
  // Found by the acceptance run: "wifi-7-router.jpg" missed "Wi-Fi 7
  // explained" entirely, because a filename almost never spells it the way a
  // title does.
  const m = scoreMatchV(asset({ storagePath: "image/wifi-7-router.jpg" }),
    target({ title: "Wi-Fi 7 explained" })
  );
  assert.ok(m.proposedSlots.includes("hero"), JSON.stringify(m.withheld));

  // And the reverse spelling.
  const m2 = scoreMatchV(asset({ storagePath: "image/wi-fi-mesh-node.jpg" }),
    target({ title: "Wifi mesh explained" })
  );
  assert.ok(m2.proposedSlots.length > 0);
});
