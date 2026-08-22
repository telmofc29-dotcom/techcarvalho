import { test } from "node:test";
import assert from "node:assert/strict";
import {
  topicTerms, relatedness, findOrphans, suggestLinksFor, pairKey, AUTO_LINK_THRESHOLD,
  type LinkCandidate,
} from "./link-suggestions.ts";

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
  assert.ok(s[0].reason.includes("topic term"));
  assert.ok(s[0].reason.includes("Score"));
});

test("pairKey is order-independent", () => {
  assert.equal(pairKey("x", "y"), pairKey("y", "x"));
});

test("an item never suggests itself", () => {
  const item = c("a", "RTX 5090 vs RTX 5080");
  assert.equal(suggestLinksFor(item, [item], new Set()).length, 0);
});
