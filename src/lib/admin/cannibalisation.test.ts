import { test } from "node:test";
import assert from "node:assert/strict";
import { findCannibalisationMatches, type ContentSignal } from "./cannibalisation.ts";

const existing: ContentSignal[] = [
  { id: "1", title: "Sony A7 IV Review", primary_query: "sony a7 iv review", intent_fingerprint: "sony-a7-iv" },
  { id: "2", title: "Best budget tripods 2026", primary_query: "best budget tripods", intent_fingerprint: null },
];

test("flags an exact intent_fingerprint match", () => {
  const matches = findCannibalisationMatches(
    { title: "Something else entirely", primary_query: "", intent_fingerprint: "Sony-A7-IV" },
    existing
  );
  assert.equal(matches.length, 1);
  assert.equal(matches[0].id, "1");
  assert.equal(matches[0].reason, "same intent fingerprint");
});

test("flags an exact primary_query match, case-insensitively", () => {
  const matches = findCannibalisationMatches(
    { title: "Different title", primary_query: "Sony A7 IV Review", intent_fingerprint: "" },
    existing
  );
  assert.equal(matches.length, 1);
  assert.equal(matches[0].reason, "same target query");
});

test("flags a very similar title via token overlap", () => {
  const matches = findCannibalisationMatches(
    { title: "Sony A7 IV In-Depth Review", primary_query: "", intent_fingerprint: "" },
    existing
  );
  assert.equal(matches.length, 1);
  assert.equal(matches[0].id, "1");
  assert.equal(matches[0].reason, "very similar title");
});

test("does not flag unrelated content", () => {
  const matches = findCannibalisationMatches(
    { title: "Nikon Z8 first impressions", primary_query: "nikon z8 hands on", intent_fingerprint: "nikon-z8" },
    existing
  );
  assert.equal(matches.length, 0);
});

test("empty candidate fields never match", () => {
  const matches = findCannibalisationMatches({ title: "", primary_query: "", intent_fingerprint: "" }, existing);
  assert.equal(matches.length, 0);
});

test("an item is never flagged as overlapping with itself when excluded by the caller", () => {
  const self = existing.filter((c) => c.id !== "1");
  const matches = findCannibalisationMatches(
    { title: "Sony A7 IV Review", primary_query: "sony a7 iv review", intent_fingerprint: "sony-a7-iv" },
    self
  );
  assert.equal(matches.length, 0);
});
