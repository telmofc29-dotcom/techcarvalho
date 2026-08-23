import { test } from "node:test";
import assert from "node:assert/strict";
import {
  areComparable,
  comparisonBriefs,
  conceptBriefs,
  generateBriefs,
  focalClass,
  comparisonKey,
  rangeOverlap,
  MIN_SHARED_SPECS,
  MAX_COMPARISONS_PER_PRODUCT,
  type BriefProduct,
  type BriefConcept,
  type ExistingCoverage,
} from "./brief-generator.ts";

const NONE: ExistingCoverage = { subjectKeys: new Set(), primaryQueries: new Set() };

const specs = (over: Record<string, string | number | boolean> = {}) => ({
  "lens-mount-type": "RF",
  "lens-type": "zoom",
  "focal-length-min": 24,
  "focal-length-max": 70,
  "aperture-max": 2.8,
  "lens-weight": 900,
  "filter-diameter": 82,
  "optical-elements": 21,
  ...over,
});

const lens = (slug: string, over: Record<string, string | number | boolean> = {}): BriefProduct => ({
  slug,
  name: slug,
  categorySlug: "camera-lenses",
  manufacturerSlug: "canon",
  specs: specs(over),
});

// --- the refusals ----------------------------------------------------------

test("A COMPARISON NEEDS SHARED GROUND, NOT JUST TWO PRODUCTS", () => {
  // Otherwise the page is a table of blanks wearing a comparison's clothes.
  const rich = lens("a");
  const bare: BriefProduct = {
    slug: "b", name: "b", categorySlug: "camera-lenses", manufacturerSlug: "canon",
    specs: { "lens-mount-type": "RF", "lens-type": "zoom", "focal-length-min": 24 },
  };
  assert.equal(areComparable(rich, bare), false);
  assert.ok(Object.keys(bare.specs).length < MIN_SHARED_SPECS);
});

test("lenses of different mounts are never comparable", () => {
  assert.equal(areComparable(lens("a"), lens("b", { "lens-mount-type": "EF" })), false);
});

test("a prime and a zoom are not the same question", () => {
  assert.equal(areComparable(lens("a"), lens("b", { "lens-type": "prime" })), false);
});

test("A 16MM AND A 600MM ARE NOT A COMPARISON", () => {
  // Nobody choosing a portrait lens is also considering a wildlife supertele.
  // Comparing across focal classes produces pages that rank for nothing.
  const wide = lens("a", { "focal-length-min": 16, "focal-length-max": 35 });
  const tele = lens("b", { "focal-length-min": 200, "focal-length-max": 600 });
  assert.equal(areComparable(wide, tele), false);
  assert.equal(focalClass(wide.specs), "ultra-wide", "classified by where it starts, not its midpoint");
  assert.equal(focalClass(tele.specs), "telephoto");
});

test("products in different categories are never comparable", () => {
  const printer: BriefProduct = { ...lens("p"), categorySlug: "3d-printing" };
  assert.equal(areComparable(lens("a"), printer), false);
});

test("a product is never comparable with itself", () => {
  assert.equal(areComparable(lens("a"), lens("a")), false);
});

test("genuinely substitutable lenses ARE comparable", () => {
  // The case that broke the first version: classifying a zoom by its MIDPOINT
  // put the 24-70 (47mm, "standard") and the 24-105 (64.5mm, "portrait") in
  // different classes and blocked the most obvious comparison on the site.
  const a = lens("canon-rf24-70", { "lens-weight": 900 });
  const b = lens("canon-rf24-105", { "lens-weight": 700, "focal-length-max": 105 });
  assert.equal(areComparable(a, b), true);
});

test("overlap is measured against the NARROWER range", () => {
  // A 24-70 sits entirely inside a 24-240, so the superzoom does not escape
  // comparison merely by being wider.
  const tight = lens("a");                                        // 24-70
  const superzoom = lens("b", { "focal-length-max": 240 });        // 24-240
  assert.equal(rangeOverlap(tight.specs, superzoom.specs), 1);
  assert.equal(areComparable(tight, superzoom), true);
});

test("two primes at different focal lengths do not overlap at all", () => {
  const fifty = lens("a", { "lens-type": "prime", "focal-length-min": 50, "focal-length-max": 50 });
  const eightyfive = lens("b", { "lens-type": "prime", "focal-length-min": 85, "focal-length-max": 85 });
  assert.equal(rangeOverlap(fifty.specs, eightyfive.specs), 0);
  assert.equal(areComparable(fifty, eightyfive), false);
});

test("two primes at the SAME focal length are the classic comparison", () => {
  const a = lens("a", { "lens-type": "prime", "focal-length-min": 50, "focal-length-max": 50, "aperture-max": 1.2 });
  const b = lens("b", { "lens-type": "prime", "focal-length-min": 50, "focal-length-max": 50, "aperture-max": 1.8 });
  assert.equal(rangeOverlap(a.specs, b.specs), 1);
  assert.equal(areComparable(a, b), true);
});

// --- the volume controls ---------------------------------------------------

test("ONE POPULAR LENS CANNOT GENERATE FORTY PAGES", () => {
  // This is how a catalogue becomes a doorway-page farm. The cap is per product,
  // not per run, so a hub lens cannot appear in every comparison.
  const products = Array.from({ length: 12 }, (_, i) => lens(`lens-${i}`, { "lens-weight": 800 + i }));
  const briefs = comparisonBriefs(products, NONE);
  const counts = new Map<string, number>();
  for (const b of briefs) for (const s of b.relatedProductSlugs) counts.set(s, (counts.get(s) ?? 0) + 1);
  for (const [slug, n] of counts) {
    assert.ok(n <= MAX_COMPARISONS_PER_PRODUCT, `${slug} appears in ${n} comparisons`);
  }
});

test("a comparison is proposed once, whichever order the pair arrives in", () => {
  assert.equal(comparisonKey("b", "a"), comparisonKey("a", "b"));
  const briefs = comparisonBriefs([lens("a"), lens("b")], NONE);
  assert.equal(briefs.length, 1);
});

test("existing coverage suppresses a duplicate proposal", () => {
  const existing: ExistingCoverage = {
    subjectKeys: new Set([`comparison:${comparisonKey("a", "b")}`]),
    primaryQueries: new Set(),
  };
  assert.equal(comparisonBriefs([lens("a"), lens("b")], existing).length, 0);
});

test("an already-claimed primary query suppresses a proposal", () => {
  const existing: ExistingCoverage = { subjectKeys: new Set(), primaryQueries: new Set(["a vs b"]) };
  assert.equal(comparisonBriefs([lens("a"), lens("b")], existing).length, 0);
});

// --- concepts --------------------------------------------------------------

const concept = (over: Partial<BriefConcept> = {}): BriefConcept => ({
  slug: "canon-nano-usm",
  name: "Canon Nano USM",
  kind: "focus_motor",
  manufacturerSlug: "canon",
  categorySlug: "camera-lenses",
  hasSummary: true,
  ...over,
});

test("A CONCEPT WITH NO RESEARCH GETS NO BRIEF", () => {
  // Commissioning an article about something nobody has researched commissions
  // the research and the article at once, and the research has to happen first.
  const briefs = conceptBriefs([concept({ hasSummary: false })], new Map(), NONE);
  assert.equal(briefs.length, 0);
});

test("a researched concept produces one explainer with a real question", () => {
  const briefs = conceptBriefs([concept()], new Map([["canon-nano-usm", ["p1", "p2"]]]), NONE);
  assert.equal(briefs.length, 1);
  assert.equal(briefs[0].kind, "concept_explainer");
  assert.match(briefs[0].title, /What does Canon Nano USM mean\?/);
  assert.deepEqual(briefs[0].relatedProductSlugs, ["p1", "p2"]);
  assert.match(briefs[0].rationale, /2 products/);
});

test("a mount concept asks the mount question, not the generic one", () => {
  const briefs = conceptBriefs([concept({ slug: "rf-mount", name: "Canon RF mount", kind: "mount" })], new Map(), NONE);
  assert.match(briefs[0].title, /^What is the Canon RF mount\?$/);
});

// --- what must never be generated -----------------------------------------

test("NO BRIEF EVER COMMISSIONS A REVIEW", () => {
  // This site publishes no hands-on testing. A brief called "review" would
  // commission a lie, so the type is not in the vocabulary at all.
  const products = Array.from({ length: 8 }, (_, i) => lens(`l-${i}`, { "lens-weight": 700 + i }));
  const all = generateBriefs({
    concepts: [concept()],
    productsByConcept: new Map([["canon-nano-usm", ["l-0"]]]),
    products,
    existing: NONE,
  });
  assert.ok(all.length > 0, "expected some briefs, or this assertion is vacuous");
  for (const b of all) {
    assert.notEqual(b.contentType, "review");
    assert.doesNotMatch(b.title, /\breview\b/i);
    assert.doesNotMatch(b.title, /\b(best|top \d|greatest)\b/i);
    assert.ok(b.kind !== ("review" as never));
  }
});

test("every generated brief has a unique slug", () => {
  const products = Array.from({ length: 10 }, (_, i) => lens(`l-${i}`, { "lens-weight": 700 + i }));
  const all = generateBriefs({ concepts: [], productsByConcept: new Map(), products, existing: NONE });
  const slugs = all.map((b) => b.slug);
  assert.equal(new Set(slugs).size, slugs.length);
});

test("concepts are ordered before comparisons", () => {
  // An explainer is reusable by every comparison that links to it; writing the
  // comparisons first leaves nowhere to send a confused reader.
  const all = generateBriefs({
    concepts: [concept()],
    productsByConcept: new Map([["canon-nano-usm", ["a"]]]),
    products: [lens("a"), lens("b")],
    existing: NONE,
  });
  assert.equal(all[0].kind, "concept_explainer");
});

test("every brief carries a rationale a human can approve or reject", () => {
  const all = generateBriefs({
    concepts: [concept()],
    productsByConcept: new Map([["canon-nano-usm", ["a"]]]),
    products: [lens("a"), lens("b")],
    existing: NONE,
  });
  for (const b of all) {
    assert.ok(b.rationale.length > 40, `thin rationale: ${b.rationale}`);
    assert.ok(b.subjectKey.length > 0);
    assert.ok(b.primaryQuery.length > 0);
  }
});
