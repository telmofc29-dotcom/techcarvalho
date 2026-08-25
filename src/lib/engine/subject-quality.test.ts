import { test } from "node:test";
import assert from "node:assert/strict";
import { assessSubject } from "./subject-quality.ts";

// Every rejected string below reached a live draft before this gate existed.

test("a body-text fragment is not a subject", () => {
  const v = assessSubject("When Apple announced its event");
  assert.equal(v.usable, false);
  assert.equal(v.flaw, "opens_mid_sentence");
});

test("a first-person headline is a column, not a report", () => {
  // "Apple is about to launch five new products that I'm very excited about"
  // was drafted as news. TechCarvalho has no "I".
  for (const s of [
    "Apple is about to launch five new products that I’m very excited about",
    "It Took Apple 8 Years to Listen to Me",
    "My favourite thing about the new Pixel",
  ]) {
    const v = assessSubject(s);
    assert.equal(v.usable, false, s);
    assert.ok(v.flaw === "first_person" || v.flaw === "opens_mid_sentence", `${s} -> ${v.flaw}`);
  }
});

test("a truncated subject is rejected", () => {
  assert.equal(assessSubject("Windows 11 to Get Unified Memory Control Options Ahead").flaw, "dangling_end");
  assert.equal(assessSubject("Intel Xeon 7 comes with").flaw, "dangling_end");
});

test("a bare company name is not a development", () => {
  assert.equal(assessSubject("Insta360 Ace").flaw, "bare_subject");
  assert.equal(assessSubject("Bambu Lab").flaw, "bare_subject");
});

test("real developments pass", () => {
  // The gate must not be so strict that it blocks the work it exists to protect.
  for (const s of [
    "Apple Announces New Mac Studio With M5 Ultra Chip",
    "Bambu Lab launches PLA Pure filament",
    "Samsung Unveils Next-Gen 3D-Memory Vision at FMS 2026",
    "Arm and UNICEF launch AI in Play",
    "Canon EOS 6D vs Canon EOS 6D Mark II",
  ]) {
    const v = assessSubject(s);
    assert.equal(v.usable, true, `${s} rejected as ${v.flaw}`);
  }
});

test("a verdict always explains itself", () => {
  const v = assessSubject("It");
  assert.equal(v.usable, false);
  assert.ok(v.reason.length > 5);
});
