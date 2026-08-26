import { test } from "node:test";
import assert from "node:assert/strict";
import { scoreMatch, verifiedVerdict, type MatchAsset, type MatchTarget } from "./match-engine.ts";
import { identityTokens, VARIANT_WORDS } from "./subject-match.ts";

// FALSE-SKU PROTECTION FOR THE LIBRARY MATCHER.
//
// A plain "Canon EOS R5" photograph matched a "Canon EOS R5 Mark II" article as
// an EXACT MODEL and was offered for the hero slot — presenting a picture of
// one camera as a picture of a different, newer one.
//
// The variant logic in match-engine.ts was already correct. The TOKENISER was
// starving it: "mark" was a stopword and "ii" is two characters with no digit,
// so "Canon EOS R5 Mark II" reduced to {canon, eos, r5} and the variant
// vanished before any comparison happened.
//
// The equivalent protection in providers/entity-match.ts is tested separately
// and was never affected — which is exactly why this went unnoticed: the suite
// showed "Canon EOS R5 <-> Canon EOS R5 Mark II" passing, for a different
// matcher on a different code path.

const asset = (filename: string): MatchAsset => ({
  id: "asset", storagePath: `1234-uuid-${filename}.jpg`, altText: null, caption: null,
  sourceType: "staff_photograph", assetRole: "product_photo", brandRole: null,
  owned: true, aiGenerated: false, publicationStatus: "published",
  rightsStatus: "verified", width: 2400, height: 1600,
});

const target = (title: string, manufacturerName: string | null): MatchTarget => ({
  id: "target", kind: "content", title, manufacturerName,
  categorySlug: "cameras-photography", isModelSpecific: true, occupiedSlots: [],
});

/** Every pair the brief named as a collision that must never be exact. */
const MUST_NOT_BE_EXACT: [string, string, string][] = [
  ["canon-eos-r5-front", "Canon EOS R5 Mark II firmware update", "Canon"],
  ["canon-eos-r5-mark-iii", "Canon EOS R5 Mark II firmware update", "Canon"],
  ["canon-eos-6d", "Canon EOS 60D review", "Canon"],
  ["nvidia-geforce-rtx-5080", "NVIDIA RTX 5090 announced", "NVIDIA"],
  ["dji-mini-4k", "DJI Mini 4 Pro firmware", "DJI"],
  ["samsung-galaxy-s26", "Samsung Galaxy S26 Ultra launch", "Samsung"],
  ["apple-iphone-18", "iPhone 18 Pro event date", "Apple"],
  ["apple-mac-mini", "Apple Mac Studio M5 Ultra", "Apple"],
  ["sony-playstation-5", "PlayStation 5 Pro teardown", "Sony"],
  ["bambu-lab-x1c", "Bambu Lab H2D launch", "Bambu Lab"],
  ["nikon-z9", "Nikon Z8 firmware", "Nikon"],
];

for (const [file, title, maker] of MUST_NOT_BE_EXACT) {
  test(`"${file}" is not an exact match for "${title}"`, () => {
    const m = scoreMatch(asset(file), target(title, maker));
    assert.notEqual(m.specificity, "exact_model", `reasons: ${m.reasons.join(" | ")}`);
    // A model-specific target must not accept a family-level image into a
    // visible slot either — that is the rule that stops the wrong camera
    // appearing as the article's hero.
    assert.deepEqual(m.proposedSlots, [], `offered slots: ${m.proposedSlots.join(",")}`);
  });
}

// POSITIVE CONTROLS. A protection that refuses everything is not a protection.
const MUST_BE_EXACT: [string, string, string][] = [
  ["canon-eos-r5-mark-ii-front", "Canon EOS R5 Mark II firmware update", "Canon"],
  ["canon-eos-r5-front", "Canon EOS R5 review", "Canon"],
  ["nvidia-geforce-rtx-5090-fe", "NVIDIA RTX 5090 announced", "NVIDIA"],
];

for (const [file, title, maker] of MUST_BE_EXACT) {
  test(`"${file}" IS an exact match for "${title}"`, () => {
    const m = scoreMatch(asset(file), target(title, maker));
    assert.equal(m.specificity, "exact_model", `reasons: ${m.reasons.join(" | ")}`);
  });
}

test("roman-numeral variants survive tokenisation", () => {
  // The root cause, asserted directly so a future stopword or length filter
  // cannot quietly reintroduce it.
  const tokens = identityTokens("Canon EOS R5 Mark II");
  assert.ok(tokens.has("mark"), `mark missing: ${[...tokens].join(",")}`);
  assert.ok(tokens.has("ii"), `ii missing: ${[...tokens].join(",")}`);
  assert.ok(tokens.has("r5"));
});

test("the variant vocabulary covers the numerals that are short enough to be filtered", () => {
  for (const n of ["ii", "iii", "iv", "vi", "vii"]) {
    assert.ok(VARIANT_WORDS.has(n), `${n} is not protected from the length filter`);
  }
});

test("a refusal always explains itself", () => {
  const m = scoreMatch(asset("canon-eos-r5-front"), target("Canon EOS R5 Mark II firmware", "Canon"));
  assert.ok(
    m.reasons.length > 0 || m.withheld.length > 0,
    "an asset was demoted with no stated reason"
  );
});

// ---------------------------------------------------------------------------
// VERIFIED IDENTITY — what product_media says beats what the filename says
// ---------------------------------------------------------------------------

const linked = (filename: string, products: { productId: string; name: string; familyId: string | null }[]): MatchAsset => ({
  ...asset(filename),
  verifiedProducts: products.map((p) => ({ ...p, manufacturerName: "Canon" })),
});

const productTarget = (title: string, productId: string, familyId: string | null): MatchTarget => ({
  ...target(title, "Canon"), productId, familyId,
});

test("a recorded product link establishes identity rather than inferring it", () => {
  const m = scoreMatch(
    linked("img-4021", [{ productId: "p-r5m2", name: "Canon EOS R5 Mark II", familyId: "f-eos-r" }]),
    productTarget("Canon EOS R5 Mark II", "p-r5m2", "f-eos-r")
  );
  assert.equal(m.specificity, "exact_model");
  assert.match(m.reasons.join(" "), /recorded in the media library/i);
});

test("an image recorded as a DIFFERENT product is refused, whatever its filename says", () => {
  // The direction that matters most. The filename claims R5 Mark II; the
  // database says this is a picture of the R5. A recorded fact outvotes text.
  const m = scoreMatch(
    linked("canon-eos-r5-mark-ii-front", [{ productId: "p-r5", name: "Canon EOS R5", familyId: "f-eos-r" }]),
    productTarget("Canon EOS R6 Mark III", "p-r6m3", "f-other")
  );
  assert.equal(m.specificity, "topical");
  assert.deepEqual(m.proposedSlots, []);
  assert.match(m.reasons.join(" "), /recorded as a picture of Canon EOS R5/i);
  assert.ok(m.withheld.length > 0, "a refusal must say what it withheld");
});

test("a sibling product in the same family is family-level, not exact", () => {
  const m = scoreMatch(
    linked("canon-r-series", [{ productId: "p-r6", name: "Canon EOS R6", familyId: "f-eos-r" }]),
    productTarget("Canon EOS R5 Mark II", "p-r5m2", "f-eos-r")
  );
  assert.equal(m.specificity, "family");
  assert.match(m.reasons.join(" "), /exact identity of this model is not established/i);
});

test("verified matching is opt-in — assets without links behave exactly as before", () => {
  const withoutLinks = scoreMatch(asset("canon-eos-r5-front"), target("Canon EOS R5 review", "Canon"));
  assert.equal(withoutLinks.specificity, "exact_model", "existing text inference must be unaffected");
});

test("the verdict function is decidable on its own", () => {
  const a = linked("x", [{ productId: "p1", name: "P1", familyId: "f1" }]);
  assert.equal(verifiedVerdict(a, productTarget("P1", "p1", "f1")), "verified_exact");
  assert.equal(verifiedVerdict(a, productTarget("P2", "p2", "f1")), "verified_family");
  assert.equal(verifiedVerdict(a, productTarget("P3", "p3", "f9")), "verified_other_product");
  assert.equal(verifiedVerdict(asset("x"), productTarget("P1", "p1", "f1")), "unverified");
});
