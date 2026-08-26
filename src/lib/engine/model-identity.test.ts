import { test } from "node:test";
import assert from "node:assert/strict";
import { compareModelIdentity, coversSameModel } from "./model-identity.ts";
import { titleSimilarity } from "./dedupe.ts";

// Every pair below scored ABOVE the 0.42 "already covered" threshold on word
// overlap, so the newer product's development was reported as covered by the
// older product's article. Eight of eight.

const DIFFERENT_MODELS: [string, string][] = [
  ["Canon EOS R5 Mark II firmware update", "Canon EOS R5 firmware update"],
  ["NVIDIA RTX 5090 review", "NVIDIA RTX 5080 review"],
  ["Galaxy S26 Ultra announced", "Galaxy S26 announced"],
  ["iPhone 18 Pro event date", "iPhone 18 event date"],
  ["PlayStation 5 Pro announced", "PlayStation 5 announced"],
  ["Bambu Lab H2D launch", "Bambu Lab X1C launch"],
  ["Nikon Z8 firmware 3.0", "Nikon Z9 firmware 3.0"],
  ["DJI Mini 4 Pro firmware", "DJI Mini 4K firmware"],
];

for (const [subject, existing] of DIFFERENT_MODELS) {
  test(`"${subject}" is NOT covered by "${existing}"`, () => {
    // The bug this exists to stop: word overlap says covered.
    assert.ok(
      titleSimilarity(subject, existing) >= 0.42,
      "fixture no longer reproduces the overlap that caused the bug"
    );
    const v = compareModelIdentity(subject, existing);
    assert.equal(v.sameModel, false, v.reason);
    assert.ok(v.differing.length > 0, "a refusal must name what differs");
  });
}

test("the same model IS still the same model", () => {
  // A veto that vetoes everything would block all update detection.
  for (const [a, b] of [
    ["Canon EOS R5 Mark II firmware update", "Canon EOS R5 Mark II gets pre-capture"],
    ["iPhone 18 Pro event date confirmed", "Apple confirms iPhone 18 Pro event date"],
    ["Nikon Z8 firmware 3.0 released", "Nikon Z8 gets firmware 3.0"],
  ] as [string, string][]) {
    assert.equal(coversSameModel(a, b), true, `${a} vs ${b}`);
  }
});

test("a topical subject naming no model is left to similarity", () => {
  const v = compareModelIdentity("Best mirrorless cameras for beginners", "How to choose a mirrorless camera");
  assert.equal(v.sameModel, true);
  assert.match(v.reason, /neither subject names a specific model/i);
});

test("tier words are identity, not noise", () => {
  // "Pro", "Ultra" and "Max" are how these products are distinguished. Treating
  // them as filler is what let "iPhone 18 Pro" be answered by "iPhone 18".
  assert.equal(coversSameModel("iPhone 18 Pro", "iPhone 18"), false);
  assert.equal(coversSameModel("Galaxy S26 Ultra", "Galaxy S26"), false);
  assert.equal(coversSameModel("Mac Studio M5 Max", "Mac Studio M5"), false);
});

test("roman-numeral variants are identity too", () => {
  assert.equal(coversSameModel("Canon EOS 5D Mark III", "Canon EOS 5D Mark II"), false);
  assert.equal(coversSameModel("Canon EOS 5D Mark II", "Canon EOS 5D"), false);
});

test("every verdict explains itself", () => {
  for (const [a, b] of DIFFERENT_MODELS) {
    assert.ok(compareModelIdentity(a, b).reason.length > 20, `${a} vs ${b}`);
  }
});
