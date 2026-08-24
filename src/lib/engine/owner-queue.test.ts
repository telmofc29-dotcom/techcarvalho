import { test } from "node:test";
import assert from "node:assert/strict";
import {
  briefQueueItem,
  mediaRightsQueueItem,
  updateProposalQueueItem,
  freshnessQueueItem,
  rankOwnerQueue,
  summariseOwnerQueue,
  waitingDays,
  QUEUE_ITEM_KINDS,
  QUEUE_KIND_LABELS,
  type OwnerQueueItem,
} from "./owner-queue.ts";
import { classifyBriefQuality, type BriefQualityInput } from "./brief-quality.ts";

const NOW = new Date("2026-08-24T12:00:00Z");

function qualityOf(over: Partial<BriefQualityInput> = {}) {
  return classifyBriefQuality(
    {
      title: "Something real happened",
      briefKind: "news",
      contentType: "news",
      verifiedFacts: ["a", "b", "c"],
      uncertainties: ["u1"],
      sourceUrls: ["https://www.reuters.com/a", "https://www.theverge.com/b"],
      freshnessSensitivity: null,
      hasDiscovery: true,
      hasOpportunity: false,
      createdAt: "2026-08-23T12:00:00Z",
      ...over,
    },
    NOW
  );
}

function readyBrief(over: Record<string, unknown> = {}): OwnerQueueItem {
  const item = briefQueueItem({
    id: "b1",
    title: "Something real happened",
    quality: qualityOf(),
    freshnessSensitivity: null,
    createdAt: "2026-08-23T12:00:00Z",
    productLinkMissing: false,
    ...over,
  } as Parameters<typeof briefQueueItem>[0]);
  assert.ok(item, "expected a queue item");
  return item;
}

// ---------------------------------------------------------------------------
// Admission — the queue stays narrow
// ---------------------------------------------------------------------------

test("a weak brief never reaches the queue, whatever else is true of it", () => {
  // The real production shape: catalogue combinatorics.
  const weak = qualityOf({
    title: "Canon EOS 5D Mark IV vs Canon EOS 90D",
    briefKind: "comparison",
    contentType: "comparison",
    verifiedFacts: [],
    uncertainties: [],
    sourceUrls: [],
    hasDiscovery: false,
    hasOpportunity: false,
  });
  const item = briefQueueItem({
    id: "b-weak",
    title: "Canon EOS 5D Mark IV vs Canon EOS 90D",
    quality: weak,
    freshnessSensitivity: "breaking",
    createdAt: "2026-08-01T12:00:00Z",
    productLinkMissing: true,
  });
  assert.equal(item, null);
});

test("a single-publisher brief is excluded even with many facts", () => {
  const weak = qualityOf({
    verifiedFacts: ["a", "b", "c", "d", "e"],
    sourceUrls: ["https://www.macrumors.com/a", "https://www.macrumors.com/b"],
  });
  assert.equal(
    briefQueueItem({
      id: "b2",
      title: "x",
      quality: weak,
      freshnessSensitivity: null,
      createdAt: "2026-08-23T12:00:00Z",
      productLinkMissing: false,
    }),
    null
  );
});

test("a brief clearing the bar carries its evidence on the row", () => {
  const item = readyBrief();
  assert.equal(item.kind, "brief");
  assert.match(item.signals.map((s) => s.label).join(" | "), /3 verified facts/);
  assert.match(item.signals.map((s) => s.label).join(" | "), /2 independent publishers/);
  assert.ok(item.why.length > 20);
});

test("low-severity ageing content is maintenance, not an owner decision", () => {
  const base = { id: "f1", title: "Old guide", reason: "No review in 400 days", detectedAt: "2026-01-01T00:00:00Z" };
  assert.equal(freshnessQueueItem({ ...base, severity: "low" }), null);
  assert.equal(freshnessQueueItem({ ...base, severity: "medium" }), null);
  assert.ok(freshnessQueueItem({ ...base, severity: "high" }));
});

test("every unresolved rights question reaches the owner, with no threshold", () => {
  const item = mediaRightsQueueItem({
    id: "m1",
    title: "Some press image",
    blockerReason: "Licence could not be established from the source page",
    forTitle: "iPhone 18 tracker",
    detectedAt: "2026-08-20T00:00:00Z",
  });
  assert.equal(item.kind, "media_rights");
  assert.match(item.why, /never assume rights/i);
  assert.deepEqual(item.gaps, ["Blocking: iPhone 18 tracker"]);
});

// ---------------------------------------------------------------------------
// Ranking
// ---------------------------------------------------------------------------

test("rights decisions outrank editorial work the engine could eventually do itself", () => {
  const rights = mediaRightsQueueItem({
    id: "m1",
    title: "Image",
    blockerReason: "Unknown licence",
    forTitle: null,
    detectedAt: "2026-08-24T00:00:00Z",
  });
  const brief = readyBrief({ freshnessSensitivity: "breaking" });
  const ranked = rankOwnerQueue([brief, rights]);
  assert.equal(ranked[0].kind, "media_rights");
});

test("breaking news outranks an equally-sourced evergreen brief", () => {
  const breaking = readyBrief({ id: "b-breaking", freshnessSensitivity: "breaking" });
  const evergreen = readyBrief({ id: "b-evergreen", freshnessSensitivity: "evergreen" });
  const ranked = rankOwnerQueue([evergreen, breaking]);
  assert.equal(ranked[0].id, "b-breaking");
});

test("evidence depth cannot let an evergreen brief outrank breaking news", () => {
  const deepEvergreen = briefQueueItem({
    id: "deep",
    title: "Deeply sourced guide",
    quality: qualityOf({
      verifiedFacts: Array.from({ length: 40 }, (_, i) => `f${i}`),
      sourceUrls: Array.from({ length: 30 }, (_, i) => `https://site${i}.com/a`),
    }),
    freshnessSensitivity: "evergreen",
    createdAt: "2026-08-23T12:00:00Z",
    productLinkMissing: false,
  });
  assert.ok(deepEvergreen);
  const thinBreaking = readyBrief({ id: "thin", freshnessSensitivity: "breaking" });
  assert.equal(rankOwnerQueue([deepEvergreen, thinBreaking])[0].id, "thin");
});

test("ties break oldest-first so a skipped item cannot be buried forever", () => {
  const old = readyBrief({ id: "old", createdAt: "2026-08-01T00:00:00Z" });
  const recent = readyBrief({ id: "recent", createdAt: "2026-08-24T00:00:00Z" });
  const ranked = rankOwnerQueue([recent, old]);
  assert.equal(ranked[0].id, "old");
});

test("ranking never mutates the caller's array", () => {
  const a = readyBrief({ id: "a", createdAt: "2026-08-01T00:00:00Z" });
  const b = readyBrief({ id: "b", createdAt: "2026-08-24T00:00:00Z" });
  const input = [b, a];
  rankOwnerQueue(input);
  assert.deepEqual(input.map((i) => i.id), ["b", "a"]);
});

// ---------------------------------------------------------------------------
// Summary and presentation invariants
// ---------------------------------------------------------------------------

test("the summary reports every kind explicitly, including empty ones", () => {
  const s = summariseOwnerQueue([readyBrief()]);
  for (const k of QUEUE_ITEM_KINDS) {
    assert.equal(typeof s.byKind[k], "number", `${k} must be present even at zero`);
  }
  assert.equal(s.byKind.brief, 1);
  assert.equal(s.byKind.media_rights, 0);
  assert.equal(s.total, 1);
});

test("the summary identifies the longest-waiting item", () => {
  const old = readyBrief({ id: "old", createdAt: "2026-08-01T00:00:00Z" });
  const recent = readyBrief({ id: "recent", createdAt: "2026-08-24T00:00:00Z" });
  assert.equal(summariseOwnerQueue([recent, old]).oldest?.id, "old");
});

test("an empty queue summarises without inventing an oldest item", () => {
  const s = summariseOwnerQueue([]);
  assert.equal(s.total, 0);
  assert.equal(s.oldest, null);
});

test("waiting days never goes negative on clock skew", () => {
  const future = readyBrief({ id: "f", createdAt: "2099-01-01T00:00:00Z" });
  assert.equal(waitingDays(future, NOW), 0);
});

test("waiting days counts whole days", () => {
  const item = readyBrief({ id: "w", createdAt: "2026-08-21T12:00:00Z" });
  assert.equal(waitingDays(item, NOW), 3);
});

test("a malformed timestamp degrades to zero rather than NaN", () => {
  const item = readyBrief({ id: "bad", createdAt: "not-a-date" });
  assert.equal(waitingDays(item, NOW), 0);
  // and must not throw or corrupt the sort
  assert.equal(rankOwnerQueue([item]).length, 1);
});

test("every kind has a label and every item offers a details route", () => {
  const items: OwnerQueueItem[] = [
    readyBrief(),
    mediaRightsQueueItem({ id: "m", title: "t", blockerReason: "r", forTitle: null, detectedAt: NOW.toISOString() }),
    updateProposalQueueItem({
      id: "u",
      title: "t",
      targetTitle: "Existing page",
      reason: "Spec changed",
      sourceCount: 2,
      detectedAt: NOW.toISOString(),
    }),
    freshnessQueueItem({ id: "f", title: "t", reason: "r", severity: "high", detectedAt: NOW.toISOString() })!,
  ];
  for (const k of QUEUE_ITEM_KINDS) {
    assert.equal(typeof QUEUE_KIND_LABELS[k], "string", `${k} label`);
  }
  for (const i of items) {
    assert.ok(i.href.startsWith("/admin/"), `${i.kind} must link somewhere real`);
    assert.ok(i.actions.includes("details"), `${i.kind} must offer details`);
    assert.ok(i.why.length > 20, `${i.kind} must explain itself`);
    assert.equal(i.key, `${i.kind}:${i.id}`);
  }
});

test("an update proposal prefers the existing page's title over the discovery's", () => {
  const item = updateProposalQueueItem({
    id: "u",
    title: "Some vendor headline",
    targetTitle: "Our existing iPhone tracker",
    reason: "Spec changed",
    sourceCount: 1,
    detectedAt: NOW.toISOString(),
  });
  assert.equal(item.title, "Our existing iPhone tracker");
});
