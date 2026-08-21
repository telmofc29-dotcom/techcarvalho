import { test } from "node:test";
import assert from "node:assert/strict";
import { buildDedupeKey, titleSimilarity, isNearDuplicate } from "./dedupe.ts";

test("same story from different outlets produces the same dedupe key", () => {
  const a = buildDedupeKey({
    title: "Sony officially announces the PlayStation 5 Pro",
    discoveryType: "product_launch",
  });
  const b = buildDedupeKey({
    title: "PlayStation 5 Pro announced by Sony",
    discoveryType: "product_launch",
  });
  assert.equal(a, b);
});

test("different discovery types about the same device do not collapse", () => {
  const launch = buildDedupeKey({ title: "PlayStation 5 Pro", discoveryType: "product_launch" });
  const spec = buildDedupeKey({ title: "PlayStation 5 Pro", discoveryType: "spec_change" });
  assert.notEqual(launch, spec);
});

test("genuinely different stories produce different keys", () => {
  const a = buildDedupeKey({ title: "Sony announces PlayStation 5 Pro", discoveryType: "product_launch" });
  const b = buildDedupeKey({ title: "Nintendo reveals Switch 2 pricing", discoveryType: "product_launch" });
  assert.notEqual(a, b);
});

test("marketing filler words do not affect the key", () => {
  const a = buildDedupeKey({ title: "The new RTX 5090 is officially here", discoveryType: "product_launch" });
  const b = buildDedupeKey({ title: "RTX 5090", discoveryType: "product_launch" });
  assert.equal(a, b);
});

test("titleSimilarity is high for reworded versions of one story", () => {
  const s = titleSimilarity(
    "Nintendo confirms Switch 2 price increase to $499",
    "Switch 2 price increases to $499, Nintendo confirms"
  );
  assert.ok(s > 0.8, `expected high similarity, got ${s}`);
});

test("titleSimilarity is low for unrelated stories", () => {
  const s = titleSimilarity("Nintendo confirms Switch 2 price increase", "AMD releases new Ryzen CPU");
  assert.ok(s < 0.2, `expected low similarity, got ${s}`);
});

test("isNearDuplicate catches near-identical headlines", () => {
  assert.equal(
    isNearDuplicate("Apple unveils iPhone 17 Pro", "Apple unveils the iPhone 17 Pro today"),
    true
  );
});

test("empty or stopword-only titles never register as duplicates of each other", () => {
  assert.equal(titleSimilarity("the a an", "of in on"), 0);
});
