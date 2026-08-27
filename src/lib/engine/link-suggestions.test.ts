import { test } from "node:test";
import assert from "node:assert/strict";
import {
  topicTerms, relatedness, findOrphans, suggestLinksFor, pairKey, AUTO_LINK_THRESHOLD,
  type LinkCandidate,
} from "./link-suggestions.ts";
import { buildEntityVocabulary } from "../media/entity-vocabulary.ts";

const c = (id: string, title: string, categoryId = "cat1", type = "guide"): LinkCandidate =>
  ({ id, title, categoryId, type });

test("stopwords and house phrasing are stripped", () => {
  const t = topicTerms("Do You Actually Need an RTX 5090 for 1440p Gaming?");
  assert.ok(t.has("rtx"), [...t].join(","));
  assert.ok(t.has("5090"));
  assert.ok(!t.has("actually"));
  assert.ok(!t.has("need"));
  assert.ok(!t.has("you"));
});

test("genuinely related pieces score above the auto-link bar", () => {
  const s = relatedness(
    c("a", "Why There Are Almost No New Nvidia GPUs in 2026", "cat1", "news"),
    c("b", "Why AMD Doesn't Have a 2026 Flagship GPU", "cat1", "news")
  );
  assert.ok(s >= AUTO_LINK_THRESHOLD, `scored ${s}`);
});

test("unrelated pieces score at or near zero", () => {
  assert.equal(
    relatedness(c("a", "Solar Photography Safety"), c("b", "Mesh Wi-Fi vs a Single Router", "cat2")),
    0
  );
});

test("same category alone does not create a link", () => {
  // Both astrophotography, but about different things.
  const s = relatedness(
    c("a", "Equatorial Mounts Explained"),
    c("b", "The Bortle Scale and Sky Class")
  );
  assert.ok(s < AUTO_LINK_THRESHOLD, `scored ${s} — category should be a nudge, not a link`);
});

test("orphans are exactly the unconnected published items", () => {
  const pub = [c("a", "One"), c("b", "Two"), c("c", "Three")];
  const orphans = findOrphans(pub, new Set(["a", "b"]));
  assert.deepEqual(orphans.map((o) => o.id), ["c"]);
});

test("a product association counts as connection, not orphanhood", () => {
  // linkedIds is documented as including product-associated ids.
  assert.deepEqual(findOrphans([c("a", "One")], new Set(["a"])), []);
});

test("existing relationships are excluded in BOTH directions", () => {
  const item = c("a", "RTX 5090 vs RTX 5080");
  const cands = [c("b", "Do You Need an RTX 5090 for 1440p Gaming")];
  // Stored as b->a; suggesting a->b would duplicate it, since the reverse is
  // inferred at query time.
  const existing = new Set([pairKey("b", "a")]);
  assert.equal(suggestLinksFor(item, cands, existing).length, 0);
});

test("suggestions are ranked and capped", () => {
  const item = c("a", "RTX 5090 Power Supply Requirements");
  const cands = [
    c("b", "RTX 5090 vs RTX 5080"),
    c("c", "Do You Need an RTX 5090 for 1440p Gaming"),
    c("d", "PC Building Basics"),
    c("e", "Solar Photography Safety", "cat9"),
    c("f", "RTX 5090 Cooling"),
  ];
  const s = suggestLinksFor(item, cands, new Set(), 3);
  assert.ok(s.length <= 3);
  for (let i = 1; i < s.length; i++) assert.ok(s[i - 1].score >= s[i].score);
  assert.ok(!s.some((x) => x.toId === "e"), "unrelated item must not be suggested");
});

test("every suggestion explains itself", () => {
  const s = suggestLinksFor(c("a", "RTX 5090 vs RTX 5080"), [c("b", "RTX 5090 Power Supply")], new Set());
  assert.ok(s.length > 0);
  // The explanation now names the EVIDENCE rather than counting title words.
  // Two RTX pieces with no recorded associations still explain themselves by
  // what their titles name in common.
  assert.ok(s[0].reason.includes("name the same things"), s[0].reason);
  assert.ok(s[0].reason.includes("Score"), s[0].reason);
});

test("pairKey is order-independent", () => {
  assert.equal(pairKey("x", "y"), pairKey("y", "x"));
});

test("an item never suggests itself", () => {
  const item = c("a", "RTX 5090 vs RTX 5080");
  assert.equal(suggestLinksFor(item, [item], new Set()).length, 0);
});

// ---------------------------------------------------------------------------
// EVIDENCE OVER KEYWORDS.
//
// relatedness() was shared-term overlap over titles — raw keyword matching. On
// this site's headlines that links on ordinary English. It now reads the
// associations the site already records, and the title term is unchanged but
// filtered to words that NAME something.
// ---------------------------------------------------------------------------
const VOCAB = buildEntityVocabulary({
  manufacturers: ["Samsung", "Canon", "NVIDIA"],
  productNames: ["Samsung Galaxy S26 Ultra", "Samsung Galaxy Watch", "Canon EOS R5"],
  categorySlugs: ["smartphones", "cameras-photography"],
  tagNames: ["Camera", "Android"],
});

const withEvidence = (
  id: string,
  title: string,
  evidence: LinkCandidate["evidence"],
  categoryId = "cat1",
  type = "guide"
): LinkCandidate => ({ id, title, categoryId, type, evidence });

test("two pieces about the SAME product are strongly related", () => {
  const s = relatedness(
    withEvidence("a", "Galaxy S26 Ultra camera deep dive", { productIds: ["p1"] }),
    withEvidence("b", "Galaxy S26 Ultra battery life", { productIds: ["p1"] }),
    { entityVocabulary: VOCAB }
  );
  assert.ok(s >= AUTO_LINK_THRESHOLD, `scored ${s}`);
});

test("a shared MANUFACTURER alone never reaches the auto-link bar", () => {
  // The brief's own example of a link that must not be made: two unrelated
  // products from one company. Manufacturer overlap is weighted at 0.08 so it
  // can contribute but can never carry a pairing.
  const s = relatedness(
    withEvidence("a", "Galaxy Watch fitness tracking", { manufacturerIds: ["samsung"], productIds: ["p9"] }, "cat1"),
    withEvidence("b", "Galaxy S26 Ultra display", { manufacturerIds: ["samsung"], productIds: ["p1"] }, "cat2"),
    { entityVocabulary: VOCAB }
  );
  assert.ok(s < AUTO_LINK_THRESHOLD, `scored ${s} — a shared company is not a relationship`);
});

test("ordinary shared wording creates no link when a vocabulary is supplied", () => {
  const s = relatedness(
    c("a", "What They Actually Promise"),
    c("b", "What You Actually Need"),
    { entityVocabulary: VOCAB }
  );
  assert.ok(s < AUTO_LINK_THRESHOLD, `scored ${s}`);
});

test("evidence is strictly additive — no vocabulary means the old behaviour", () => {
  // Adding this must not have weakened any pairing that already worked.
  const before = relatedness(
    c("a", "Why There Are Almost No New Nvidia GPUs in 2026", "cat1", "news"),
    c("b", "Why AMD Doesn't Have a 2026 Flagship GPU", "cat1", "news")
  );
  assert.ok(before >= AUTO_LINK_THRESHOLD, `scored ${before}`);
});

test("different models are capped below the auto-link bar, not discarded", () => {
  // An R5 review and an R5 Mark II review are RELATED reading and are not
  // interchangeable. Same veto the coverage engine and media matcher use.
  const s = relatedness(
    withEvidence("a", "Canon EOS R5 review", { productIds: ["p1"], tagIds: ["t1"] }),
    withEvidence("b", "Canon EOS R5 Mark II review", { productIds: ["p2"], tagIds: ["t1"] }),
    { entityVocabulary: VOCAB }
  );
  assert.ok(s > 0, "a sibling model is still related");
  assert.ok(s < AUTO_LINK_THRESHOLD, `scored ${s} — different models must not auto-link`);
});

test("a suggestion names the evidence it used", () => {
  const s = suggestLinksFor(
    withEvidence("a", "Galaxy S26 Ultra camera", { productIds: ["p1"], tagIds: ["t1"] }),
    [withEvidence("b", "Galaxy S26 Ultra battery", { productIds: ["p1"], tagIds: ["t1"] })],
    new Set(),
    4,
    { entityVocabulary: VOCAB }
  );
  assert.ok(s.length > 0);
  assert.match(s[0].reason, /same product/);
});
