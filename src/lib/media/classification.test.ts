import { test } from "node:test";
import assert from "node:assert/strict";
import {
  classifyMedia,
  isDepictionOfRealProduct,
  isUsableAsEvidence,
  requiredDisclosure,
  canTakeRole,
  type ClassifiableMedia,
} from "./classification.ts";

const asset = (over: Partial<ClassifiableMedia> = {}): ClassifiableMedia => ({
  source_type: "public_domain_or_cc",
  asset_role: "product_photo",
  brand_role: null,
  owned: false,
  ai_generated: false,
  rights_status: "verified",
  ...over,
});

// --- the concept-render invariant, which is why this file exists ------------

const ps6Concept = asset({
  source_type: "tc_graphic",
  asset_role: "concept_render",
  ai_generated: true,
  owned: true,
  rights_status: "verified",
});

test("A CONCEPT RENDER IS NEVER A DEPICTION OF A REAL PRODUCT", () => {
  // An imagined PlayStation 6 must not be presentable as the product, however
  // thoroughly we own it and however verified its rights are.
  assert.equal(classifyMedia(ps6Concept), "generated_concept");
  assert.equal(isDepictionOfRealProduct(ps6Concept), false);
});

test("A CONCEPT RENDER IS NEVER EVIDENCE", () => {
  // It must not support a claim about dimensions, ports or appearance.
  assert.equal(isUsableAsEvidence(ps6Concept), false);
});

test("A CONCEPT RENDER CARRIES A MANDATORY DISCLOSURE, DERIVED NOT TYPED", () => {
  // A caption someone has to remember to write is one that will be missing on
  // the page where it mattered most.
  const d = requiredDisclosure(ps6Concept);
  assert.ok(d, "a concept render must always produce a disclosure");
  assert.match(d, /not official product imagery/i);
  assert.match(d, /has not been revealed/i);
});

test("A CONCEPT RENDER CANNOT BE SAVED AS PRODUCT PHOTOGRAPHY", () => {
  // The specific mistake: an imagined PS6 landing on a product page as though
  // it were a photograph. Refused server-side, not merely hidden in the UI.
  const r = canTakeRole(ps6Concept, "product_photo");
  assert.equal(r.allowed, false);
  assert.match(r.allowed === false ? r.reason : "", /cannot be a product photograph/i);
});

test("ownership and verified rights do NOT upgrade a concept render", () => {
  // The tempting bug: "we own it and the rights are verified, so it's fine."
  const owned = classifyMedia({ ...ps6Concept, owned: true, source_type: "staff_photograph" });
  assert.equal(owned, "generated_concept", "the role decides, not the source or ownership");
  assert.equal(isDepictionOfRealProduct({ ...ps6Concept, source_type: "staff_photograph" }), false);
});

// --- the honest taxonomy ---------------------------------------------------

test("our own photograph is distinguishable from a licensed one", () => {
  assert.equal(classifyMedia(asset({ source_type: "staff_photograph", owned: true })), "owned_original_photo");
  assert.equal(classifyMedia(asset({ source_type: "public_domain_or_cc" })), "third_party_rights_verified_photo");
  assert.notEqual(
    classifyMedia(asset({ source_type: "staff_photograph" })),
    classifyMedia(asset({ source_type: "public_domain_or_cc" }))
  );
});

test("official manufacturer media is its own class", () => {
  assert.equal(classifyMedia(asset({ source_type: "press_kit" })), "official_rights_verified_media");
  assert.equal(classifyMedia(asset({ source_type: "manufacturer" })), "official_rights_verified_media");
});

test("UNVERIFIED RIGHTS DOWNGRADE A PHOTOGRAPH — they never upgrade it", () => {
  for (const status of ["unknown", "pending_verification", "restricted", null]) {
    assert.equal(
      classifyMedia(asset({ source_type: "public_domain_or_cc", rights_status: status })),
      "unverified_photo",
      `rights_status=${status}`
    );
  }
  assert.equal(isDepictionOfRealProduct(asset({ rights_status: "unknown" })), false);
});

test("graphics keep their specific kind rather than collapsing to 'image'", () => {
  assert.equal(classifyMedia(asset({ source_type: "tc_graphic", asset_role: "chart" })), "data_graphic");
  assert.equal(classifyMedia(asset({ source_type: "tc_graphic", asset_role: "diagram" })), "diagram");
  assert.equal(classifyMedia(asset({ source_type: "tc_graphic", asset_role: "comparison_graphic" })), "comparison_graphic");
  assert.equal(classifyMedia(asset({ source_type: "tc_graphic", asset_role: "article_hero" })), "generated_editorial");
});

test("a logo is a logo whichever field says so", () => {
  assert.equal(classifyMedia(asset({ brand_role: "wordmark" })), "logo_brand");
  assert.equal(classifyMedia(asset({ asset_role: "logo_brand" })), "logo_brand");
  assert.equal(classifyMedia(asset({ asset_role: "icon" })), "logo_brand");
  // And a logo is never a depiction of a product.
  assert.equal(isDepictionOfRealProduct(asset({ brand_role: "wordmark" })), false);
});

test("a screenshot is not a photograph of hardware", () => {
  assert.equal(classifyMedia(asset({ asset_role: "screenshot" })), "screenshot");
  assert.equal(isDepictionOfRealProduct(asset({ asset_role: "screenshot" })), false);
  // It IS usable as evidence — it records what a screen actually showed.
  assert.equal(isUsableAsEvidence(asset({ asset_role: "screenshot" })), true);
});

// --- disclosures -----------------------------------------------------------

test("an ordinary photograph needs no disclosure", () => {
  assert.equal(requiredDisclosure(asset({ source_type: "staff_photograph" })), null);
  assert.equal(requiredDisclosure(asset()), null);
});

test("an AI editorial illustration discloses that it is not a photograph", () => {
  const d = requiredDisclosure(asset({ source_type: "tc_graphic", asset_role: "article_hero", ai_generated: true }));
  assert.ok(d);
  assert.match(d, /not a photograph/i);
});

test("a hand-made editorial graphic needs no AI disclosure", () => {
  assert.equal(
    requiredDisclosure(asset({ source_type: "tc_graphic", asset_role: "article_hero", ai_generated: false })),
    null
  );
});

// --- totality --------------------------------------------------------------

test("null and empty assets classify rather than throw", () => {
  assert.equal(classifyMedia(null), "unclassified");
  assert.equal(classifyMedia(undefined), "unclassified");
  assert.equal(classifyMedia({}), "unclassified");
  assert.equal(isDepictionOfRealProduct(null), false);
  assert.equal(isUsableAsEvidence(null), false);
  assert.equal(requiredDisclosure(null), null);
});

test("an ordinary product photo may take the product_photo role", () => {
  // The guard must not block the normal case, or it will be removed.
  assert.equal(canTakeRole(asset({ source_type: "staff_photograph", ai_generated: false }), "product_photo").allowed, true);
});
