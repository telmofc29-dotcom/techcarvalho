import { test } from "node:test";
import assert from "node:assert/strict";
import { detectProductAnnouncement, productStatusFor } from "./product-signals.ts";

const makers = [
  { slug: "canon", name: "Canon" },
  { slug: "sony", name: "Sony" },
  { slug: "asus", name: "ASUS" },
  { slug: "asus-rog", name: "ASUS ROG" },
];

test("a real announcement from a known manufacturer is detected", () => {
  const s = detectProductAnnouncement("Canon announces the EOS R7 Mark II", null, makers);
  assert.equal(s?.manufacturerSlug, "canon");
  assert.ok(s.productName.includes("R7"));
});

test("an UNKNOWN manufacturer never creates a product", () => {
  // The engine must not invent a manufacturer record to satisfy a NOT NULL.
  assert.equal(detectProductAnnouncement("Fujifilm announces the X-T6", null, makers), null);
});

test("reviews, comparisons and deals are not announcements", () => {
  for (const t of [
    "Canon EOS R5 review: still the one to beat",
    "Canon EOS R5 vs Sony A7 IV",
    "Best Canon cameras in 2026",
    "Canon EOS R5 deal drops to $2,999",
    "Canon releases firmware 1.8 for the EOS R5",
  ]) {
    assert.equal(detectProductAnnouncement(t, null, makers), null, t);
  }
});

test("a rumour is not treated as an announcement", () => {
  assert.equal(detectProductAnnouncement("Canon rumoured to announce the R1 soon", null, makers), null);
});

test("a vague headline with no model name yields nothing", () => {
  assert.equal(detectProductAnnouncement("Canon announces a new camera", null, makers), null);
  assert.equal(detectProductAnnouncement("Sony launches its latest lineup", null, makers), null);
});

test("the longest matching manufacturer name wins", () => {
  const s = detectProductAnnouncement("ASUS ROG unveils the Ally X2", null, makers);
  assert.equal(s?.manufacturerSlug, "asus-rog");
});

test("a manufacturer mentioned only in the summary is not enough", () => {
  // Attributing a product to a maker named in passing would misfile it.
  assert.equal(
    detectProductAnnouncement("New handheld unveiled at the show", "Sony was also present.", makers),
    null
  );
});

test("every signal explains that specs are left for a human", () => {
  const s = detectProductAnnouncement("Sony unveils the WH-1000XM7", null, makers);
  assert.ok(s);
  assert.ok(s.explanation.includes("UNPUBLISHED"));
  assert.ok(s.explanation.includes("filled in by a human"));
});

test("unconfirmed products are marked rumored, not active", () => {
  assert.equal(productStatusFor("confirmed_primary"), "active");
  for (const s of ["reported_secondary", "leak", "rumour", "estimate", "unverified"]) {
    assert.equal(productStatusFor(s), "rumored", s);
  }
});
