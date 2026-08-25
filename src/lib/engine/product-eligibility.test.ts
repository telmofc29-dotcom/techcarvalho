import { test } from "node:test";
import assert from "node:assert/strict";
import {
  assessProductIdentity,
  isProductEligible,
  looksLikeDesignation,
} from "./product-eligibility.ts";

const MAKERS = [
  "Canon", "Nikon", "Sony", "Apple", "Samsung", "AMD", "Intel", "NVIDIA",
  "Bambu Lab", "Prusa Research", "DJI", "GoPro", "Microsoft", "Elegoo",
];

// ---------------------------------------------------------------------------
// The bug that motivated this: "filament" reported as product eligible
// ---------------------------------------------------------------------------

test("filament is a material category, not a product", () => {
  const r = isProductEligible({
    subject: "filament",
    knownMakers: MAKERS,
    independentOrigins: 5,
    framing: "reported",
    aboutUnreleasedProduct: false,
  });
  assert.equal(r.eligible, false);
  assert.match(r.reasons.join(" "), /names a category/i);
});

test("strong evidence does not turn a category into a product", () => {
  // The whole failure: evidence strength answering the wrong question.
  for (const subject of ["3D printing", "PLA filament", "resin", "Wi-Fi 7", "camera lenses", "NVMe storage"]) {
    const r = isProductEligible({
      subject,
      knownMakers: MAKERS,
      independentOrigins: 9,
      framing: "confirmed",
      aboutUnreleasedProduct: false,
    });
    assert.equal(r.eligible, false, `${subject} must not be product eligible`);
  }
});

// ---------------------------------------------------------------------------
// Genuine products
// ---------------------------------------------------------------------------

test("a maker plus a designation is an identifiable product", () => {
  for (const subject of [
    "Bambu Lab X1 Carbon",
    "Canon RF 24-70mm F2.8 L IS USM",
    "AMD Ryzen 9 9950X",
    "Sony A7 IV",
  ]) {
    const id = assessProductIdentity(subject, MAKERS);
    assert.equal(id.isIdentifiableProduct, true, `${subject} should be identifiable`);
    assert.ok(id.maker, `${subject} should resolve a maker`);
    assert.ok(id.designation.length > 0, `${subject} should resolve a designation`);
  }
});

test("an identifiable product still needs evidence", () => {
  const weak = isProductEligible({
    subject: "Bambu Lab X1 Carbon",
    knownMakers: MAKERS,
    independentOrigins: 1,
    framing: "reported",
    aboutUnreleasedProduct: false,
  });
  assert.equal(weak.eligible, false);
  assert.match(weak.reasons.join(" "), /identity is established but the evidence is not/i);

  const strong = isProductEligible({
    subject: "Bambu Lab X1 Carbon",
    knownMakers: MAKERS,
    independentOrigins: 3,
    framing: "reported",
    aboutUnreleasedProduct: false,
  });
  assert.equal(strong.eligible, true);
});

test("maker confirmation is enough on its own", () => {
  const r = isProductEligible({
    subject: "Canon RF 24-70mm F2.8 L IS USM",
    knownMakers: MAKERS,
    independentOrigins: 1,
    framing: "confirmed",
    aboutUnreleasedProduct: false,
  });
  assert.equal(r.eligible, true);
});

test("an unreleased product never gets a catalogue entry", () => {
  const r = isProductEligible({
    subject: "Apple iPhone 18 Pro",
    knownMakers: MAKERS,
    independentOrigins: 8,
    framing: "reported",
    aboutUnreleasedProduct: true,
  });
  assert.equal(r.eligible, false);
  assert.match(r.reasons.join(" "), /has not confirmed this exists/i);
});

// ---------------------------------------------------------------------------
// Both halves are required
// ---------------------------------------------------------------------------

test("a maker with no designation is coverage of the maker", () => {
  const id = assessProductIdentity("Canon", MAKERS);
  assert.equal(id.isIdentifiableProduct, false);
  assert.equal(id.maker, "Canon");
  assert.match(id.reasons.join(" "), /nothing in "Canon" designates a specific model/i);
});

test("a designation with no maker cannot be attributed", () => {
  const id = assessProductIdentity("24-70mm F2.8", MAKERS);
  assert.equal(id.isIdentifiableProduct, false);
  assert.equal(id.maker, null);
  assert.match(id.reasons.join(" "), /no known manufacturer/i);
});

test("a multi-word maker is recognised", () => {
  assert.equal(assessProductIdentity("Bambu Lab X1 Carbon", MAKERS).maker, "Bambu Lab");
});

// ---------------------------------------------------------------------------
// Designation rules
// ---------------------------------------------------------------------------

test("a bare digit is a series position, not a designation", () => {
  // The same token that matched a DJI drone to an Elegoo printer.
  assert.equal(looksLikeDesignation("4"), false);
  assert.equal(looksLikeDesignation("9"), false);
  assert.equal(looksLikeDesignation("x1"), true);
  assert.equal(looksLikeDesignation("9950x"), true);
  assert.equal(looksLikeDesignation("24-70mm"), true);
});

test("a year is a date, not a model", () => {
  assert.equal(looksLikeDesignation("2026"), false);
  assert.equal(assessProductIdentity("Canon news 2026", MAKERS).isIdentifiableProduct, false);
});

test("marketing suffixes alone do not designate", () => {
  for (const t of ["pro", "max", "ultra", "plus", "mini", "mark"]) {
    assert.equal(looksLikeDesignation(t), false, `${t} must not designate`);
  }
  assert.equal(assessProductIdentity("Canon Pro", MAKERS).isIdentifiableProduct, false);
});

// ---------------------------------------------------------------------------
// The category list is a shortcut, not the rule
// ---------------------------------------------------------------------------

test("an unlisted category noun still fails on maker+designation", () => {
  // "sintering powder" is in no word list, and must still be refused.
  const id = assessProductIdentity("sintering powder", MAKERS);
  assert.equal(id.isIdentifiableProduct, false);
});

test("a category word inside a real product name does not disqualify it", () => {
  // "Camera" appears here, but so does a maker and a designation.
  const id = assessProductIdentity("Canon EOS R5 camera", MAKERS);
  assert.equal(id.isIdentifiableProduct, true);
});

test("every refusal explains which half was missing", () => {
  for (const s of ["filament", "Canon", "24-70mm", "3D printing"]) {
    const r = isProductEligible({
      subject: s,
      knownMakers: MAKERS,
      independentOrigins: 5,
      framing: "reported",
      aboutUnreleasedProduct: false,
    });
    assert.equal(r.eligible, false);
    assert.ok(r.reasons.length >= 2, `${s} should explain itself`);
    assert.ok(r.reasons.every((x) => x.length > 20));
  }
});
