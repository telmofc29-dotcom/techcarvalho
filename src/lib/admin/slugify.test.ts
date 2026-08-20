import { test } from "node:test";
import assert from "node:assert/strict";
import { slugify } from "./slugify.ts";

test("slugify: lowercases and hyphenates", () => {
  assert.equal(slugify("Canon EOS R5 Mark II"), "canon-eos-r5-mark-ii");
});

test("slugify: strips accents", () => {
  assert.equal(slugify("Étoile Café"), "etoile-cafe");
});

test("slugify: collapses non-alphanumeric runs to a single hyphen", () => {
  assert.equal(slugify("Hello!!!   World??"), "hello-world");
});

test("slugify: trims leading/trailing hyphens", () => {
  assert.equal(slugify("--already-slugged--"), "already-slugged");
});

test("slugify: empty input yields empty string", () => {
  assert.equal(slugify(""), "");
});

test("slugify: truncates to 200 characters", () => {
  const long = "a".repeat(500);
  assert.equal(slugify(long).length, 200);
});
