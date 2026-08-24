import { test } from "node:test";
import assert from "node:assert/strict";
import {
  selectSpotlight,
  isEligible,
  rotationScore,
  agePriority,
  ageInDays,
  rotationOverlap,
  SPOTLIGHT_WINDOW_DAYS,
  NEVER_SPOTLIGHTED_BONUS,
  MAX_PER_CATEGORY,
  type SpotlightCandidate,
} from "./spotlight.ts";

const NOW = new Date("2026-08-24T12:00:00Z");
const MS_DAY = 86_400_000;

function daysAgo(n: number): string {
  return new Date(NOW.getTime() - n * MS_DAY).toISOString();
}

function candidate(over: Partial<SpotlightCandidate> = {}): SpotlightCandidate {
  return {
    contentId: over.contentId ?? `c-${Math.random().toString(36).slice(2, 8)}`,
    title: "A story",
    slug: "a-story",
    contentType: "news",
    categorySlug: "computing",
    publishedAt: daysAgo(1),
    baseScore: 60,
    lastSpotlightedAt: null,
    spotlightCount: 0,
    hasStrongMedia: false,
    ...over,
  };
}

function ids(sel: ReturnType<typeof selectSpotlight>): string[] {
  return [...(sel.lead ? [sel.lead.candidate.contentId] : []), ...sel.supporting.map((s) => s.candidate.contentId)];
}

// ---------------------------------------------------------------------------
// 8 & 9 — the 30-day window is hard
// ---------------------------------------------------------------------------

test("content older than 30 days cannot hold a spotlight position", () => {
  const old = candidate({ contentId: "old", publishedAt: daysAgo(31), baseScore: 999 });
  const fresh = candidate({ contentId: "fresh", publishedAt: daysAgo(1), baseScore: 10 });
  const sel = selectSpotlight({ candidates: [old, fresh], now: NOW, supportingSlots: 4 });

  assert.ok(!ids(sel).includes("old"), "a 31-day-old item must never be spotlighted");
  assert.equal(sel.lead?.candidate.contentId, "fresh");
  assert.match(sel.excluded.find((e) => e.candidate.contentId === "old")!.reason, /31 days ago/);
});

test("the window boundary is inclusive at 30 days and exclusive after", () => {
  assert.equal(isEligible(candidate({ publishedAt: daysAgo(SPOTLIGHT_WINDOW_DAYS) }), NOW).eligible, true);
  assert.equal(isEligible(candidate({ publishedAt: daysAgo(SPOTLIGHT_WINDOW_DAYS + 0.5) }), NOW).eligible, false);
});

test("an excellent evergreen guide is still excluded once it ages out", () => {
  // Stated explicitly because it is the exception someone will reach for.
  const guide = candidate({
    contentId: "guide",
    contentType: "guide",
    publishedAt: daysAgo(120),
    baseScore: 500,
  });
  const sel = selectSpotlight({ candidates: [guide, candidate({ contentId: "n" })], now: NOW, supportingSlots: 4 });
  assert.ok(!ids(sel).includes("guide"));
  assert.match(sel.excluded[0].reason, /available everywhere else/i);
});

test("a pin does NOT bypass the 30-day window", () => {
  // A stale pin nobody cleared must not rot the homepage.
  const stale = candidate({ contentId: "stale", publishedAt: daysAgo(90), pinnedLead: true, baseScore: 900 });
  const fresh = candidate({ contentId: "fresh" });
  const sel = selectSpotlight({ candidates: [stale, fresh], now: NOW, supportingSlots: 4 });
  assert.equal(sel.lead?.candidate.contentId, "fresh");
});

test("suppressed content never appears", () => {
  const sup = candidate({ contentId: "sup", suppressed: true, baseScore: 999 });
  const sel = selectSpotlight({ candidates: [sup, candidate({ contentId: "ok" })], now: NOW, supportingSlots: 4 });
  assert.ok(!ids(sel).includes("sup"));
});

// ---------------------------------------------------------------------------
// 10 & 11 — stable within a day, different on the next
// ---------------------------------------------------------------------------

test("the same day and the same inputs always produce the same selection", () => {
  const pool = Array.from({ length: 12 }, (_, i) =>
    candidate({ contentId: `c${i}`, baseScore: 50 + (i % 5), publishedAt: daysAgo(i % 10) })
  );
  const a = selectSpotlight({ candidates: pool, now: NOW, supportingSlots: 4 });
  const b = selectSpotlight({ candidates: [...pool].reverse(), now: NOW, supportingSlots: 4 });
  assert.deepEqual(ids(a), ids(b), "selection must not depend on input order");
});

test("the next rotation brings forward different content", () => {
  const pool = Array.from({ length: 12 }, (_, i) =>
    candidate({ contentId: `c${i}`, baseScore: 60 - i, publishedAt: daysAgo(2), categorySlug: `cat${i % 5}` })
  );

  const day1 = selectSpotlight({ candidates: pool, now: NOW, supportingSlots: 4 });
  const day1Ids = ids(day1);

  // Day 2: yesterday's picks carry their exposure.
  const tomorrow = new Date(NOW.getTime() + MS_DAY);
  const updated = pool.map((c) =>
    day1Ids.includes(c.contentId)
      ? { ...c, lastSpotlightedAt: NOW.toISOString(), spotlightCount: 1 }
      : c
  );
  const day2 = selectSpotlight({
    candidates: updated,
    now: tomorrow,
    supportingSlots: 4,
    history: {
      previousContentIds: day1Ids,
      previousCategories: [day1.lead?.candidate.categorySlug ?? ""].filter(Boolean),
    },
  });

  const overlap = rotationOverlap(day1Ids, ids(day2));
  assert.ok(overlap.changed >= 3, `expected real rotation, only ${overlap.changed} changed`);
  assert.notEqual(day2.lead?.candidate.contentId, day1.lead?.candidate.contentId, "the lead must give way");
});

test("five strong stories cannot monopolise the front page for a month", () => {
  // The headline failure: without rotation memory these five win every day.
  const strong = Array.from({ length: 5 }, (_, i) =>
    candidate({ contentId: `s${i}`, baseScore: 90, publishedAt: daysAgo(3), categorySlug: `cat${i}` })
  );
  const others = Array.from({ length: 10 }, (_, i) =>
    candidate({ contentId: `o${i}`, baseScore: 55, publishedAt: daysAgo(2), categorySlug: `cat${i % 5}` })
  );

  let pool = [...strong, ...others];
  let previousIds: string[] = [];
  const seen = new Set<string>();

  for (let day = 0; day < 4; day++) {
    const now = new Date(NOW.getTime() + day * MS_DAY);
    const sel = selectSpotlight({
      candidates: pool,
      now,
      supportingSlots: 4,
      history: { previousContentIds: previousIds, previousCategories: [] },
    });
    const picked = ids(sel);
    picked.forEach((id) => seen.add(id));
    pool = pool.map((c) =>
      picked.includes(c.contentId)
        ? { ...c, lastSpotlightedAt: now.toISOString(), spotlightCount: c.spotlightCount + 1 }
        : c
    );
    previousIds = picked;
  }

  assert.ok(seen.size >= 9, `only ${seen.size} distinct stories reached the spotlight in 4 days`);
  assert.ok([...seen].some((id) => id.startsWith("o")), "lower-scoring recent content must get a turn");
});

// ---------------------------------------------------------------------------
// 12 — fair exposure
// ---------------------------------------------------------------------------

test("never-spotlighted content gets a real advantage", () => {
  const veteran = candidate({
    contentId: "veteran",
    baseScore: 70,
    spotlightCount: 3,
    lastSpotlightedAt: daysAgo(1),
  });
  const newcomer = candidate({ contentId: "newcomer", baseScore: 55, spotlightCount: 0 });
  const sel = selectSpotlight({ candidates: [veteran, newcomer], now: NOW, supportingSlots: 2 });
  assert.equal(sel.lead?.candidate.contentId, "newcomer");
});

test("the never-spotlighted bonus cannot promote genuinely weak content", () => {
  // Fairness adjusts a good score; it does not manufacture one.
  const strong = candidate({ contentId: "strong", baseScore: 200, spotlightCount: 1, lastSpotlightedAt: daysAgo(10) });
  const weak = candidate({ contentId: "weak", baseScore: 5, spotlightCount: 0 });
  const sel = selectSpotlight({ candidates: [strong, weak], now: NOW, supportingSlots: 2 });
  assert.equal(sel.lead?.candidate.contentId, "strong");
});

test("the cool-down decays rather than switching off", () => {
  const base = { baseScore: 60, spotlightCount: 1 } as const;
  const yesterday = rotationScore(candidate({ ...base, lastSpotlightedAt: daysAgo(0.5) }), NOW, {
    previousCategories: [],
    previousContentIds: [],
  });
  const threeDays = rotationScore(candidate({ ...base, lastSpotlightedAt: daysAgo(3) }), NOW, {
    previousCategories: [],
    previousContentIds: [],
  });
  const week = rotationScore(candidate({ ...base, lastSpotlightedAt: daysAgo(7) }), NOW, {
    previousCategories: [],
    previousContentIds: [],
  });
  assert.ok(yesterday.score < threeDays.score, "yesterday must be penalised more than three days ago");
  assert.ok(threeDays.score < week.score, "the penalty must decay to nothing");
});

// ---------------------------------------------------------------------------
// 13 — important stories can return
// ---------------------------------------------------------------------------

test("a boosted developing story can return despite recent exposure", () => {
  const developing = candidate({
    contentId: "major",
    baseScore: 85,
    spotlightCount: 1,
    lastSpotlightedAt: daysAgo(1),
    boosted: true,
  });
  const ordinary = candidate({ contentId: "ordinary", baseScore: 60 });
  const sel = selectSpotlight({ candidates: [developing, ordinary], now: NOW, supportingSlots: 2 });
  assert.equal(sel.lead?.candidate.contentId, "major");
});

// ---------------------------------------------------------------------------
// 14 — freshness within the window
// ---------------------------------------------------------------------------

test("freshness is weighted within the eligibility window", () => {
  assert.ok(agePriority(1).weight > agePriority(5).weight);
  assert.ok(agePriority(5).weight > agePriority(10).weight);
  assert.ok(agePriority(10).weight > agePriority(25).weight);
  assert.equal(agePriority(31).weight, 0);
});

test("a fresher story beats an equal older one", () => {
  const fresh = candidate({ contentId: "fresh", publishedAt: daysAgo(1), baseScore: 60 });
  const older = candidate({ contentId: "older", publishedAt: daysAgo(20), baseScore: 60 });
  const sel = selectSpotlight({ candidates: [fresh, older], now: NOW, supportingSlots: 2 });
  assert.equal(sel.lead?.candidate.contentId, "fresh");
});

// ---------------------------------------------------------------------------
// 15 — category diversity
// ---------------------------------------------------------------------------

test("one category cannot take nine positions", () => {
  const gaming = Array.from({ length: 9 }, (_, i) =>
    candidate({ contentId: `g${i}`, categorySlug: "gaming", baseScore: 80 - i * 0.1, publishedAt: daysAgo(1) })
  );
  const others = [
    candidate({ contentId: "smart", categorySlug: "smartphones", baseScore: 50 }),
    candidate({ contentId: "cam", categorySlug: "cameras-photography", baseScore: 48 }),
    candidate({ contentId: "net", categorySlug: "networking", baseScore: 46 }),
  ];
  const sel = selectSpotlight({ candidates: [...gaming, ...others], now: NOW, supportingSlots: 4 });
  const picked = [sel.lead, ...sel.supporting].filter(Boolean);
  const gamingCount = picked.filter((s) => s!.candidate.categorySlug === "gaming").length;
  assert.ok(gamingCount <= MAX_PER_CATEGORY + 1, `gaming took ${gamingCount} of ${picked.length}`);
  assert.ok(picked.some((s) => s!.candidate.categorySlug !== "gaming"), "other categories must appear");
});

test("yesterday's prominent category yields to others today", () => {
  const gaming = candidate({ contentId: "game", categorySlug: "gaming", baseScore: 62 });
  const phone = candidate({ contentId: "phone", categorySlug: "smartphones", baseScore: 58 });
  const sel = selectSpotlight({
    candidates: [gaming, phone],
    now: NOW,
    supportingSlots: 1,
    history: { previousCategories: ["gaming"], previousContentIds: [] },
  });
  assert.equal(sel.lead?.candidate.contentId, "phone");
});

// ---------------------------------------------------------------------------
// 16 — pins win every other contest
// ---------------------------------------------------------------------------

test("a human pin overrides automatic rotation", () => {
  const pinned = candidate({
    contentId: "pinned",
    baseScore: 20,
    pinnedLead: true,
    spotlightCount: 5,
    lastSpotlightedAt: daysAgo(0.2),
  });
  const strong = candidate({ contentId: "strong", baseScore: 95 });
  const sel = selectSpotlight({ candidates: [pinned, strong], now: NOW, supportingSlots: 2 });
  assert.equal(sel.lead?.candidate.contentId, "pinned");
  assert.match(sel.lead!.reasons[0], /Pinned as the lead/);
});

test("pinned supporting items take supporting positions", () => {
  const pinned = candidate({ contentId: "ps", baseScore: 10, pinnedSupporting: true });
  const others = Array.from({ length: 6 }, (_, i) => candidate({ contentId: `x${i}`, baseScore: 90 - i }));
  const sel = selectSpotlight({ candidates: [pinned, ...others], now: NOW, supportingSlots: 3 });
  assert.ok(sel.supporting.some((s) => s.candidate.contentId === "ps"));
});

// ---------------------------------------------------------------------------
// Media is a tie-breaker, never a ranking
// ---------------------------------------------------------------------------

test("a beautiful image cannot outrank a materially better story", () => {
  const important = candidate({ contentId: "important", baseScore: 90, hasStrongMedia: false });
  const pretty = candidate({ contentId: "pretty", baseScore: 55, hasStrongMedia: true });
  const sel = selectSpotlight({ candidates: [important, pretty], now: NOW, supportingSlots: 2 });
  assert.equal(sel.lead?.candidate.contentId, "important");
});

test("media breaks a genuine tie", () => {
  const withImage = candidate({ contentId: "with", baseScore: 60, hasStrongMedia: true });
  const without = candidate({ contentId: "without", baseScore: 60, hasStrongMedia: false });
  const sel = selectSpotlight({ candidates: [withImage, without], now: NOW, supportingSlots: 2 });
  assert.equal(sel.lead?.candidate.contentId, "with");
});

// ---------------------------------------------------------------------------
// Shape and edges
// ---------------------------------------------------------------------------

test("an empty pool produces an empty selection rather than throwing", () => {
  const sel = selectSpotlight({ candidates: [], now: NOW, supportingSlots: 4 });
  assert.equal(sel.lead, null);
  assert.deepEqual(sel.supporting, []);
});

test("a malformed publication date is excluded, not treated as fresh", () => {
  const bad = candidate({ contentId: "bad", publishedAt: "not-a-date", baseScore: 900 });
  const sel = selectSpotlight({ candidates: [bad, candidate({ contentId: "ok" })], now: NOW, supportingSlots: 2 });
  assert.ok(!ids(sel).includes("bad"));
  assert.equal(ageInDays("not-a-date", NOW), Number.POSITIVE_INFINITY);
});

test("every chosen slot explains itself", () => {
  const pool = Array.from({ length: 6 }, (_, i) => candidate({ contentId: `c${i}`, baseScore: 70 - i }));
  const sel = selectSpotlight({ candidates: pool, now: NOW, supportingSlots: 3 });
  for (const slot of [sel.lead!, ...sel.supporting]) {
    assert.ok(slot.reasons.length > 0, `${slot.candidate.contentId} gave no reason`);
  }
});

test("nextUp lists eligible content that missed out", () => {
  const pool = Array.from({ length: 10 }, (_, i) => candidate({ contentId: `c${i}`, baseScore: 70 - i }));
  const sel = selectSpotlight({ candidates: pool, now: NOW, supportingSlots: 3 });
  const chosen = new Set(ids(sel));
  assert.ok(sel.nextUp.length > 0);
  assert.ok(sel.nextUp.every((c) => !chosen.has(c.contentId)));
});

test("rotationOverlap measures whether it actually rotated", () => {
  assert.deepEqual(rotationOverlap(["a", "b", "c"], ["a", "b", "c"]), { shared: 3, changed: 0, ratio: 1 });
  assert.deepEqual(rotationOverlap(["a", "b", "c"], ["d", "e", "f"]), { shared: 0, changed: 3, ratio: 0 });
  assert.equal(rotationOverlap([], []).ratio, 0);
});

test("the never-spotlighted bonus is large enough to matter", () => {
  // A timid value would leave incumbents winning forever, which is the bug.
  assert.ok(NEVER_SPOTLIGHTED_BONUS >= 20);
});
