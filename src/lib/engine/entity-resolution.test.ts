import { test } from "node:test";
import assert from "node:assert/strict";
import { normaliseEntityName, entitySimilarity, resolveEntity, proposeSlug } from "./entity-resolution.ts";

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
