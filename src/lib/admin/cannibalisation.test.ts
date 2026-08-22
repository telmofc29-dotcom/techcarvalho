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

// Regression tests for the stopword fix. Run over the whole published corpus
// (81 items) the detector previously produced 2 flagged pairs, BOTH false
// positives from grammar collisions, and missed the strongest genuine conflict
// on the site. After the fix it produces 2 pairs, both real.
test("titles sharing only grammar are not flagged", () => {
  const corpus: ContentSignal[] = [
    { id: "ps5", title: "PS5 vs. PS5 Pro: Is the $200+ Upgrade Actually Worth It?", primary_query: "is ps5 pro worth it", intent_fingerprint: null },
  ];
  const matches = findCannibalisationMatches(
    {
      title: "Canon 6D vs 6D Mark II: Is the Upgrade Actually Worth It",
      primary_query: "canon 6d vs 6d mark ii",
      intent_fingerprint: "canon-6d-vs-6d-mark-ii",
    },
    corpus
  );
  assert.deepEqual(matches, [], 'shared "vs"/"worth"/"it"/"upgrade"/"actually" is not a shared subject');
});

test("stripping stopwords surfaces a real conflict the raw overlap missed", () => {
  const corpus: ContentSignal[] = [
    {
      id: "mesh-guide",
      title: "Mesh Router Buying Guide 2026 — Wi-Fi 6E vs. Wi-Fi 7",
      primary_query: "best mesh wifi router 2026",
      intent_fingerprint: null,
    },
  ];
  const matches = findCannibalisationMatches(
    {
      title: "Mesh Wi-Fi vs a Single Router: Do You Actually Need Mesh",
      primary_query: "mesh wifi vs single router",
      intent_fingerprint: "mesh-wifi-vs-single-router",
    },
    corpus
  );
  assert.equal(matches.length, 1);
  assert.equal(matches[0].id, "mesh-guide");
});

test("model names that look like stopwords are preserved", () => {
  // "Pro", "Air", "Mini" and "Max" are product names in this catalogue and are
  // deliberately absent from the stopword list.
  const corpus: ContentSignal[] = [
    { id: "air", title: "DJI Air 3S deep dive", primary_query: "dji air 3s", intent_fingerprint: null },
  ];
  const matches = findCannibalisationMatches(
    { title: "DJI Mini 4 Pro deep dive", primary_query: "dji mini 4 pro", intent_fingerprint: "" },
    corpus
  );
  assert.deepEqual(matches, [], "Mini/Pro must not collapse onto Air");
});

test("a title made entirely of stopwords scores zero instead of dividing by zero", () => {
  const corpus: ContentSignal[] = [
    { id: "x", title: "Do you actually need it", primary_query: "q1", intent_fingerprint: null },
  ];
  const matches = findCannibalisationMatches(
    { title: "Is it worth it", primary_query: "q2", intent_fingerprint: "" },
    corpus
  );
  assert.deepEqual(matches, []);
});

test("an item is never flagged as overlapping with itself when excluded by the caller", () => {
  const self = existing.filter((c) => c.id !== "1");
  const matches = findCannibalisationMatches(
    { title: "Sony A7 IV Review", primary_query: "sony a7 iv review", intent_fingerprint: "sony-a7-iv" },
    self
  );
  assert.equal(matches.length, 0);
});
