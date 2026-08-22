import { test } from "node:test";
import assert from "node:assert/strict";
import { normaliseEntityName, entitySimilarity, resolveEntity, proposeSlug, MATCH_THRESHOLD, AMBIGUOUS_THRESHOLD } from "./entity-resolution.ts";

test("brand synonyms collapse to one canonical form", () => {
  const a = normaliseEntityName("Sony PlayStation 5 Pro");
  const b = normaliseEntityName("PS5 Pro");
  assert.ok(entitySimilarity("Sony PlayStation 5 Pro", "PS5 Pro") >= 0.8, `${a} vs ${b}`);
});

test("marketing noise does not affect matching", () => {
  assert.ok(entitySimilarity("The new Canon EOS R5 is officially announced", "Canon EOS R5") >= 0.8);
});

test("genuinely different products do not match", () => {
  assert.ok(entitySimilarity("Canon EOS R5", "Canon EOS R6") < 0.8);
  assert.ok(entitySimilarity("PlayStation 5 Pro", "Xbox Series X") < 0.5);
});

test("mark/mk variants resolve together", () => {
  assert.ok(entitySimilarity("Canon EOS 6D Mark II", "Canon EOS 6D mk II") >= 0.8);
});

const existing = [
  { kind: "product" as const, id: "p1", name: "Canon EOS R5" },
  { kind: "product" as const, id: "p2", name: "Sony PlayStation 5 Pro" },
  { kind: "content" as const, id: "c1", name: "Mesh Wi-Fi vs a Single Router" },
];

test("an existing product is matched, not duplicated", () => {
  const r = resolveEntity("PS5 Pro", existing);
  assert.equal(r.decision, "matched_existing");
  assert.equal(r.matchedId, "p2");
  assert.ok(r.explanation.includes("rather than creating a duplicate"));
});

test("a genuinely new product is treated as new", () => {
  const r = resolveEntity("Framework Laptop 16", existing);
  assert.equal(r.decision, "new_entity");
});

test("a successor is never merged into its predecessor", () => {
  // Regression: containment-biased scoring alone rated this 1.00 against
  // "Canon EOS R5", which would have silently destroyed the successor.
  assert.ok(entitySimilarity("Canon EOS R5 Mark II", "Canon EOS R5") < 0.55);
  assert.equal(resolveEntity("Canon EOS R5 Mark II", existing).decision, "new_entity");
});

test("model numbers must match — R5 is not R6, 5080 is not 5090", () => {
  assert.ok(entitySimilarity("Canon EOS R5", "Canon EOS R6") < 0.55);
  assert.ok(entitySimilarity("GeForce RTX 5080", "GeForce RTX 5090") < 0.55);
});

test("variant tokens must match — a Pro is not a base model", () => {
  assert.ok(entitySimilarity("PlayStation 5 Pro", "PlayStation 5") < 0.55);
  assert.ok(entitySimilarity("Galaxy S26 Ultra", "Galaxy S26") < 0.55);
});

test("empty/noise-only names are ignored rather than creating junk", () => {
  const r = resolveEntity("The new官", existing);
  assert.ok(r.decision === "ignored" || r.decision === "new_entity");
});

test("every resolution carries an explanation", () => {
  for (const name of ["PS5 Pro", "Framework Laptop 16", "Canon EOS R5"]) {
    assert.ok(resolveEntity(name, existing).explanation.length > 20);
  }
});

test("proposeSlug avoids collisions", () => {
  const taken = new Set(["ps5-pro-review"]);
  assert.equal(proposeSlug("PS5 Pro Review", taken), "ps5-pro-review-2");
  assert.equal(proposeSlug("Brand New Topic", taken), "brand-new-topic");
});

// --- REGRESSION: bare-numeric successors (found 2026-08-22 by an adversarial
// --- review of the resolver, after the Mark II fix was believed complete) ---
//
// The Mark II guard only ever handled WORD-shaped discriminators. A successor
// whose predecessor carries no digit at all scored 1.00 and resolved to
// matched_existing — silently overwriting the predecessor's product row.
test("a bare generation number is not the same product as its predecessor", () => {
  const cases: [string, string][] = [
    ["Nintendo Switch 2", "Nintendo Switch"],
    ["Apple Vision Pro 2", "Apple Vision Pro"],
    ["Steam Deck 2", "Steam Deck"],
    ["Framework Laptop 16", "Framework Laptop"],
  ];
  for (const [successor, predecessor] of cases) {
    const s = entitySimilarity(successor, predecessor);
    assert.ok(s < 0.55, `"${successor}" vs "${predecessor}" scored ${s.toFixed(2)} — would merge`);
    const r = resolveEntity(successor, [{ kind: "product", id: "p1", name: predecessor }]);
    assert.notEqual(r.decision, "matched_existing", `${successor} must not merge into ${predecessor}`);
  }
});

test("an incidental spec number in a headline still matches the product", () => {
  // The other side of the same rule: "8K" is a specification mentioned in
  // passing, not a generation marker, and must not block resolution.
  for (const headline of [
    "Canon EOS R5 gets 8K firmware update",
    "Canon EOS R5 hits 45MP burst milestone",
  ]) {
    const s = entitySimilarity(headline, "Canon EOS R5");
    assert.ok(s >= 0.8, `"${headline}" scored ${s.toFixed(2)} — should still match the R5`);
  }
});

// ---------------------------------------------------------------------------
// ADVERSARIAL SUITE (Autonomous Engine Hardening, 2026-08-22)
//
// Entity resolution is the single point where a mistake silently DESTROYS
// data: a successor merged into its predecessor overwrites a real product row
// and nothing raises an error. Two such bugs have already shipped here — the
// Canon EOS R5 Mark II containment bug, and the bare-numeric Nintendo Switch 2
// bug that the first fix did not cover.
//
// Both directions are tested on purpose. A resolver tuned only against
// false positives becomes uselessly strict, and a resolver that never matches
// anything creates duplicates instead of overwrites — a different failure with
// the same root cause.
// ---------------------------------------------------------------------------

test("ADVERSARIAL: near-identical names that must NOT resolve to each other", () => {
  const pairs: [string, string][] = [
    // Generation markers
    ["Nintendo Switch", "Nintendo Switch 2"],
    ["Canon EOS R5", "Canon EOS R5 Mark II"],
    ["Canon EOS 6D", "Canon EOS 6D Mark II"],
    // Variant suffixes
    ["PS5", "PS5 Pro"],
    ["Sony PlayStation 5", "Sony PlayStation 5 Pro"],
    ["iPhone 17", "iPhone 17 Pro"],
    ["Galaxy S26", "Galaxy S26 Ultra"],
    // Adjacent model numbers in one family
    ["RTX 5080", "RTX 5090"],
    ["NVIDIA GeForce RTX 5080", "NVIDIA GeForce RTX 5090"],
    ["AMD Ryzen 9 9950X", "AMD Ryzen 7 9800X3D"],
    // A digit-vs-alphanumeric trap: "4 Pro" and "4K" are different products,
    // and "4K" would otherwise read as an incidental specification.
    ["DJI Mini 4 Pro", "DJI Mini 4K"],
    // Single-letter suffix carrying the whole distinction
    ["Xbox Series X", "Xbox Series S"],
    // Standards generations, where the suffix is the entire difference
    ["Wi-Fi 6", "Wi-Fi 6E"],
    ["Wi-Fi 6E", "Wi-Fi 7"],
    ["Wi-Fi 6", "Wi-Fi 7"],
  ];
  for (const [a, b] of pairs) {
    const s = entitySimilarity(a, b);
    assert.ok(s < AMBIGUOUS_THRESHOLD, `"${a}" vs "${b}" scored ${s.toFixed(2)} — would merge or be held as ambiguous`);
  }
});

test("ADVERSARIAL: the same product written differently MUST still resolve", () => {
  // False-negative pressure. Over-strictness creates duplicate catalogue rows
  // rather than overwrites, which is a quieter failure but still a failure.
  const pairs: [string, string][] = [
    ["PS5 Pro", "Sony PlayStation 5 Pro"],
    ["Nintendo Switch 2", "Switch 2"],
    ["NVIDIA GeForce RTX 5090", "RTX 5090"],
    ["Canon EOS 6D Mark II", "Canon EOS 6D mk II"],
    // A headline wrapping the product name
    ["Canon EOS R5", "The Canon EOS R5 review: still the one to beat"],
    // An incidental spec in the headline is not a generation marker
    ["Canon EOS R5", "Canon EOS R5 gets 8K firmware update"],
  ];
  for (const [a, b] of pairs) {
    const s = entitySimilarity(a, b);
    assert.ok(s >= MATCH_THRESHOLD, `"${a}" vs "${b}" scored ${s.toFixed(2)} — would create a duplicate`);
  }
});

test("ADVERSARIAL: similarity is symmetric", () => {
  // An asymmetric resolver would decide differently depending on which row the
  // scan happened to reach first — a race disguised as a judgement.
  const pairs: [string, string][] = [
    ["Nintendo Switch", "Nintendo Switch 2"],
    ["PS5 Pro", "Sony PlayStation 5 Pro"],
    ["Wi-Fi 6", "Wi-Fi 6E"],
    ["Canon EOS R5", "Canon EOS R5 gets 8K firmware update"],
  ];
  for (const [a, b] of pairs) {
    assert.equal(entitySimilarity(a, b), entitySimilarity(b, a), `${a} <-> ${b}`);
  }
});
