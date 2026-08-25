import { test } from "node:test";
import assert from "node:assert/strict";
import { categoryForSubject } from "./subject-category.ts";

const APPLE = ["smartphones", "computing"];
const SONY = ["cameras-photography", "gaming"];
const SAMSUNG = ["smartphones"];

test("a Mac story is computing, not smartphones", () => {
  // Every one of these was filed under smartphones because Apple's FIRST
  // watchlist category is smartphones.
  for (const s of [
    "Apple Announces New Mac Studio With M5 Ultra Chip",
    "Apple announces updated Mac mini, here's everything",
    "M6 MacBook Pro rumors: Improved performance",
    "Apple Mac Mini M6 and Mac Studio M5 Ultra: Specs, Price, Release",
  ]) {
    const c = categoryForSubject(s, APPLE);
    assert.equal(c.category, "computing", `${s} -> ${c.category}`);
    assert.equal(c.basis, "subject");
  }
});

test("an iPad story is computing, not smartphones", () => {
  assert.equal(categoryForSubject("New iPad Mini With Four Upgrades Expected", APPLE).category, "computing");
});

test("an iPhone story is still smartphones", () => {
  // The fix must not simply invert the bug.
  for (const s of [
    "Apple Will Announce iPhone 18 Pro Event Date",
    "iOS 27 beta 7 now available as Apple tests",
    "AirPods 5 to Launch as Early as Next Month",
  ]) {
    assert.equal(categoryForSubject(s, APPLE).category, "smartphones", s);
  }
});

test("one company's different product lines land in different sections", () => {
  // Sony is the clearest case: cameras and a games console under one name.
  assert.equal(categoryForSubject("An updated PS5 DualSense Edge controller is coming", SONY).category, "gaming");
  assert.equal(categoryForSubject("Sony A7 V mirrorless camera announced", SONY).category, "cameras-photography");
});

test("3D printing wins over the generic word 'printer'", () => {
  const c = categoryForSubject("Elegoo Launches Fiber-Reinforced Filament Series", ["3d-printing"]);
  assert.equal(c.category, "3d-printing");
});

test("a subject outside the company's declared categories still classifies", () => {
  // Samsung's watchlist entry lists only smartphones, but Samsung ships SSDs.
  const c = categoryForSubject("Samsung Unveils Next-Gen 3D-Memory Vision at FMS 2026", SAMSUNG);
  assert.equal(c.category, "computing");
  assert.equal(c.basis, "subject");
});

test("an unrecognisable subject falls back and says so", () => {
  const c = categoryForSubject("Company reveals its plans", APPLE);
  assert.equal(c.category, "smartphones");
  assert.equal(c.basis, "entity_default");
  assert.equal(c.matched, null);
});
