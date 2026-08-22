import { test } from "node:test";
import assert from "node:assert/strict";
import {
  classifyClusterEdges,
  rankComparisonSiblings,
  subjectTags,
  FORMAT_TAG_SLUGS,
  type RelationshipEdge,
} from "./content-cluster.ts";

// --- classifyClusterEdges --------------------------------------------------

test("an outgoing pillar_of row makes this piece the pillar", () => {
  const roles = classifyClusterEdges([{ otherId: "kid", type: "pillar_of", direction: "outgoing" }]);
  assert.deepEqual(roles.supportedByIds, ["kid"]);
  assert.deepEqual(roles.pillarIds, []);
});

test("an incoming supporting_of row also makes this piece the pillar", () => {
  const roles = classifyClusterEdges([{ otherId: "kid", type: "supporting_of", direction: "incoming" }]);
  assert.deepEqual(roles.supportedByIds, ["kid"]);
});

test("an outgoing supporting_of row makes this piece a cluster member", () => {
  const roles = classifyClusterEdges([{ otherId: "hub", type: "supporting_of", direction: "outgoing" }]);
  assert.deepEqual(roles.pillarIds, ["hub"]);
  assert.deepEqual(roles.supportedByIds, []);
});

test("an incoming pillar_of row also makes this piece a cluster member", () => {
  const roles = classifyClusterEdges([{ otherId: "hub", type: "pillar_of", direction: "incoming" }]);
  assert.deepEqual(roles.pillarIds, ["hub"]);
});

// This is the case production actually contains: 33 of 128 distinct pairs are
// stored in BOTH directions, despite the migration documenting the reverse as
// inferred-at-query-time and never inserted. Without deduplication the same
// piece renders twice in the same section.
test("a pair stored in both directions yields one entry, not two", () => {
  const edges: RelationshipEdge[] = [
    { otherId: "kid", type: "pillar_of", direction: "outgoing" },
    { otherId: "kid", type: "supporting_of", direction: "incoming" },
  ];
  const roles = classifyClusterEdges(edges);
  assert.deepEqual(roles.supportedByIds, ["kid"]);
  assert.deepEqual(roles.pillarIds, []);
  assert.deepEqual(roles.relatedIds, []);
});

test("a hierarchical pair is never also listed as a peer", () => {
  const roles = classifyClusterEdges([
    { otherId: "kid", type: "pillar_of", direction: "outgoing" },
    { otherId: "kid", type: "related_to", direction: "outgoing" },
  ]);
  assert.deepEqual(roles.supportedByIds, ["kid"]);
  assert.deepEqual(roles.relatedIds, []);
});

test("a contradictory pair resolves to 'this piece is the hub' rather than to both", () => {
  const roles = classifyClusterEdges([
    { otherId: "other", type: "pillar_of", direction: "outgoing" },
    { otherId: "other", type: "supporting_of", direction: "outgoing" },
  ]);
  assert.deepEqual(roles.supportedByIds, ["other"]);
  assert.deepEqual(roles.pillarIds, [], "a piece must never be rendered as its own parent");
});

test("related_to in either direction is a peer", () => {
  const roles = classifyClusterEdges([
    { otherId: "a", type: "related_to", direction: "outgoing" },
    { otherId: "b", type: "related_to", direction: "incoming" },
  ]);
  assert.deepEqual(roles.relatedIds.sort(), ["a", "b"]);
});

test("no edges yields three empty buckets", () => {
  const roles = classifyClusterEdges([]);
  assert.deepEqual(roles, { supportedByIds: [], pillarIds: [], relatedIds: [] });
});

// --- subjectTags -----------------------------------------------------------

test("format tags are not subject tags", () => {
  assert.deepEqual(subjectTags(["canon", "comparison", "mirrorless", "buying-guide"]), ["canon", "mirrorless"]);
});

test("the format-tag list covers the two tags that span nearly every category", () => {
  // Measured against production: `buying-guide` appears on published pieces in
  // 9 categories and `comparison` in 8. Treating either as a subject would
  // cluster a camera guide with a robot-vacuum guide.
  assert.ok(FORMAT_TAG_SLUGS.has("buying-guide"));
  assert.ok(FORMAT_TAG_SLUGS.has("comparison"));
});

test("a piece with only format tags has no subject tags", () => {
  assert.deepEqual(subjectTags(["comparison", "buying-guide"]), []);
});

// --- rankComparisonSiblings ------------------------------------------------

const self = { id: "self", tagSlugs: ["canon", "mirrorless", "comparison"], categoryId: "cameras" };

test("ranks by number of shared subject tags, then by recency", () => {
  const ranked = rankComparisonSiblings(
    self,
    [
      { id: "one-tag", tagSlugs: ["canon", "dslr"], categoryId: "cameras", publishedAt: "2026-05-01" },
      { id: "two-tags", tagSlugs: ["canon", "mirrorless"], categoryId: "cameras", publishedAt: "2026-01-01" },
      { id: "one-tag-newer", tagSlugs: ["canon"], categoryId: "cameras", publishedAt: "2026-08-01" },
    ],
    5
  );
  assert.deepEqual(
    ranked.map((r) => r.id),
    ["two-tags", "one-tag-newer", "one-tag"]
  );
});

test("a shared FORMAT tag alone is not a relationship", () => {
  // Every comparison on the site carries the `comparison` tag. If that counted,
  // every comparison would be a sibling of every other one.
  const ranked = rankComparisonSiblings(
    { id: "self", tagSlugs: ["canon", "comparison"], categoryId: "cameras" },
    [{ id: "unrelated", tagSlugs: ["robot-vacuum", "comparison"], categoryId: "smart-home", publishedAt: "2026-01-01" }],
    5
  );
  assert.deepEqual(ranked, []);
});

test("same-category pieces fill the list only after real matches, and claim no shared tags", () => {
  const ranked = rankComparisonSiblings(
    self,
    [
      { id: "filler", tagSlugs: ["dslr"], categoryId: "cameras", publishedAt: "2026-08-01" },
      { id: "real", tagSlugs: ["canon"], categoryId: "cameras", publishedAt: "2026-01-01" },
    ],
    5
  );
  assert.deepEqual(
    ranked.map((r) => r.id),
    ["real", "filler"]
  );
  assert.deepEqual(ranked[1].sharedTags, [], "filler must not imply a shared subject");
  assert.deepEqual(ranked[0].sharedTags, ["canon"]);
});

test("filler never crosses a category boundary", () => {
  const ranked = rankComparisonSiblings(self, [
    { id: "other-category", tagSlugs: ["drone"], categoryId: "drones", publishedAt: "2026-08-01" },
  ], 5);
  assert.deepEqual(ranked, []);
});

test("an uncategorised piece pulls in no filler at all", () => {
  const ranked = rankComparisonSiblings({ id: "self", tagSlugs: ["canon"], categoryId: null }, [
    { id: "uncategorised", tagSlugs: ["dslr"], categoryId: null, publishedAt: "2026-08-01" },
  ], 5);
  assert.deepEqual(ranked, [], "categoryId null must not match categoryId null as 'same category'");
});

test("never returns the piece itself", () => {
  const ranked = rankComparisonSiblings(self, [
    { id: "self", tagSlugs: ["canon", "mirrorless"], categoryId: "cameras", publishedAt: "2026-08-01" },
  ], 5);
  assert.deepEqual(ranked, []);
});

test("respects the limit", () => {
  const candidates = Array.from({ length: 10 }, (_, i) => ({
    id: `c${i}`,
    tagSlugs: ["canon"],
    categoryId: "cameras",
    publishedAt: `2026-01-${String(i + 1).padStart(2, "0")}`,
  }));
  assert.equal(rankComparisonSiblings(self, candidates, 4).length, 4);
  assert.equal(rankComparisonSiblings(self, candidates, 0).length, 0);
});

test("a null published_at sorts last rather than throwing", () => {
  const ranked = rankComparisonSiblings(self, [
    { id: "undated", tagSlugs: ["canon"], categoryId: "cameras", publishedAt: null },
    { id: "dated", tagSlugs: ["canon"], categoryId: "cameras", publishedAt: "2026-01-01" },
  ], 5);
  assert.deepEqual(
    ranked.map((r) => r.id),
    ["dated", "undated"]
  );
});
