import { test } from "node:test";
import assert from "node:assert/strict";
import { classifyProductMedia, ORIGINAL_GRAPHIC_LABEL } from "./presentation.ts";

test("no asset at all is stated plainly, not left blank", () => {
  const r = classifyProductMedia(null);
  assert.equal(r.kind, "none");
  assert.ok(r.kind === "none" && r.label.length > 0);
});

test("a TechCarvalho original graphic is never presented as a photograph", () => {
  const r = classifyProductMedia({ source_type: "tc_graphic", owned: true });
  assert.equal(r.kind, "original_graphic");
  assert.equal(r.kind === "original_graphic" && r.label, ORIGINAL_GRAPHIC_LABEL);
});

test("ai_generated wins over a photographic source_type — fail closed", () => {
  // A mislabelled row must not be able to present generated imagery as a
  // photograph of a real product. This is the single most important case in
  // this file.
  const r = classifyProductMedia({ source_type: "manufacturer", ai_generated: true });
  assert.equal(r.kind, "original_graphic");
});

test("ai_generated wins even when the row claims a staff photograph", () => {
  const r = classifyProductMedia({ source_type: "staff_photograph", ai_generated: true, owned: true });
  assert.equal(r.kind, "original_graphic");
});

test("a CC-licensed Commons photo is a photograph and carries its credit", () => {
  const r = classifyProductMedia({
    source_type: "public_domain_or_cc",
    attribution_required: true,
    attribution: "Photo: decltype, CC BY-SA 3.0, via Wikimedia Commons",
  });
  assert.equal(r.kind, "photograph");
  assert.equal(r.kind === "photograph" && r.attribution, "Photo: decltype, CC BY-SA 3.0, via Wikimedia Commons");
});

test("attribution falls back to creator when no attribution string is set", () => {
  const r = classifyProductMedia({
    source_type: "public_domain_or_cc",
    attribution_required: true,
    creator: "Ashley Pomeroy",
  });
  assert.equal(r.kind === "photograph" && r.attribution, "Ashley Pomeroy");
});

test("no credit line is emitted when attribution is not required", () => {
  const r = classifyProductMedia({
    source_type: "staff_photograph",
    attribution_required: false,
    creator: "Someone",
  });
  assert.equal(r.kind === "photograph" && r.attribution, null);
});

test("a staff photograph is a photograph", () => {
  assert.equal(classifyProductMedia({ source_type: "staff_photograph" }).kind, "photograph");
});

test("an unclassified asset is still credited, never relabelled as a graphic", () => {
  // Several live rows predate the source_type vocabulary and carry 'other' or
  // null. They are real photographs a human published; the page must not claim
  // otherwise in either direction.
  const r = classifyProductMedia({
    source_type: "other",
    attribution_required: true,
    attribution: "Photo: Harrison Jones, CC BY-SA 4.0, via Wikimedia Commons",
  });
  assert.equal(r.kind, "photograph");
  assert.equal(r.kind === "photograph" && r.attribution, "Photo: Harrison Jones, CC BY-SA 4.0, via Wikimedia Commons");
});

test("a null source_type behaves the same as 'other'", () => {
  const r = classifyProductMedia({ source_type: null, attribution_required: true, creator: "Mlogic (Yan Li)" });
  assert.equal(r.kind, "photograph");
  assert.equal(r.kind === "photograph" && r.attribution, "Mlogic (Yan Li)");
});
