import { test } from "node:test";
import assert from "node:assert/strict";
import {
  computeTrend,
  byTrendScore,
  decayTrend,
  rankTrends,
  evidenceAgeHours,
  TREND_EVIDENCE_HALF_LIFE_HOURS,
  TREND_EXPIRY_SCORE,
  TREND_EVIDENCE_HORIZON_HOURS,
  TREND_DECAY_GRACE_HOURS,
} from "./trends.ts";

const zero = {
  recentDiscoveries: 0, relevantDiscoveries: 0, recentViews: 0, priorViews: 0,
  searches: 0, zeroResultSearches: 0, commercialClicks: 0, publishedCoverage: 0,
  hoursSinceNewestDiscovery: null,
};

test("no measurable signal yields null, not zero", () => {
  const r = computeTrend(zero);
  assert.equal(r.score, null);
  assert.ok(r.whyTrending.includes("unscored rather than zero"));
});

test("feed volume alone produces low confidence and says so", () => {
  const r = computeTrend({ ...zero, recentDiscoveries: 30, relevantDiscoveries: 25, hoursSinceNewestDiscovery: 2 });
  assert.notEqual(r.score, null);
  assert.equal(r.hasAudienceSignal, false);
  assert.ok(r.confidence < 0.3, `confidence should be low, got ${r.confidence}`);
  assert.ok(r.whyTrending.includes("no audience data"));
  assert.ok(r.whyTrending.includes("not reader interest") || r.whyTrending.includes("not reader"));
});

test("audience signal outweighs pure feed volume", () => {
  const feedOnly = computeTrend({ ...zero, relevantDiscoveries: 12, hoursSinceNewestDiscovery: 1 });
  const audience = computeTrend({ ...zero, recentViews: 120, searches: 30, priorViews: 40 });
  assert.ok(audience.score !== null && feedOnly.score !== null);
  assert.ok(audience.score > feedOnly.score, `audience ${audience.score} should beat feed ${feedOnly.score}`);
  assert.ok(audience.confidence > feedOnly.confidence);
});

test("zero-result searches raise the score as unmet demand", () => {
  const without = computeTrend({ ...zero, recentViews: 30, searches: 10 });
  const with_ = computeTrend({ ...zero, recentViews: 30, searches: 10, zeroResultSearches: 6 });
  assert.ok(with_.score !== null && without.score !== null);
  assert.ok(with_.score > without.score);
  assert.ok(with_.whyTrending.includes("returned nothing"));
});

test("velocity is null without a prior baseline, computed with one", () => {
  assert.equal(computeTrend({ ...zero, recentViews: 20 }).velocity, null);
  const r = computeTrend({ ...zero, recentViews: 20, priorViews: 10 });
  assert.equal(r.velocity, 100);
});

test("score never exceeds 100", () => {
  const r = computeTrend({
    recentDiscoveries: 9999, relevantDiscoveries: 9999, recentViews: 99999, priorViews: 1,
    searches: 9999, zeroResultSearches: 9999, commercialClicks: 9999, publishedCoverage: 0,
    hoursSinceNewestDiscovery: 0,
  });
  assert.ok(r.score !== null && r.score <= 100);
});

test("unmet search demand recommends a guide", () => {
  assert.equal(computeTrend({ ...zero, searches: 5, zeroResultSearches: 3 }).recommendedContentType, "guide");
});

test("commercial clicks recommend a comparison", () => {
  assert.equal(computeTrend({ ...zero, recentViews: 10, commercialClicks: 4 }).recommendedContentType, "comparison");
});

test("relevant news with no coverage recommends news", () => {
  assert.equal(
    computeTrend({ ...zero, relevantDiscoveries: 3, publishedCoverage: 0, hoursSinceNewestDiscovery: 5 }).recommendedContentType,
    "news"
  );
});

test("every scored trend explains itself", () => {
  const r = computeTrend({ ...zero, recentViews: 40, searches: 10, priorViews: 20 });
  assert.ok(r.whyTrending.length > 20);
  assert.ok(Object.keys(r.signals).length > 0);
});

test("byTrendScore sorts nulls last", () => {
  const sorted = [{ score: null }, { score: 50 }, { score: null }, { score: 90 }].sort(byTrendScore);
  assert.equal(sorted[0].score, 90);
  assert.equal(sorted[1].score, 50);
  assert.equal(sorted[3].score, null);
});

// ---------------------------------------------------------------------------
// Decay, expiry and re-ranking
// ---------------------------------------------------------------------------

test("decay reduces the ranking score as evidence ages", () => {
  const fresh = decayTrend({ score: 60 }, 0);
  const day = decayTrend({ score: 60 }, 24);
  const week = decayTrend({ score: 60 }, 168);

  assert.equal(fresh.rankScore, 60);
  assert.ok(day.rankScore! < fresh.rankScore!, `24h ${day.rankScore} should be below fresh ${fresh.rankScore}`);
  assert.ok(week.rankScore! < day.rankScore!, `168h ${week.rankScore} should be below 24h ${day.rankScore}`);
});

test("one half-life halves the ranking score, by definition", () => {
  const d = decayTrend({ score: 80 }, TREND_EVIDENCE_HALF_LIFE_HOURS);
  assert.equal(d.rankScore, 40);
  assert.equal(d.decayFactor, 0.5);
});

test("decay never rewrites the measurement it discounts", () => {
  const d = decayTrend({ score: 73.5 }, 200);
  assert.equal(d.measuredScore, 73.5, "the measured score must survive decay untouched");
  assert.ok(d.rankScore! < 73.5);
  // The note must attribute the discount to evidence age, not to the audience.
  assert.ok(d.decayNote.includes("73.5"));
  assert.ok(/evidence|age|measured/i.test(d.decayNote));
});

test("a fresh trend outranks an identical stale one", () => {
  const now = Date.UTC(2026, 7, 22, 12, 0, 0);
  const hoursAgo = (h: number) => new Date(now - h * 3_600_000).toISOString();

  const ranked = rankTrends(
    [
      { key: "stale", score: 70, lastObservedAt: hoursAgo(96) },
      { key: "fresh", score: 70, lastObservedAt: hoursAgo(1) },
      { key: "middling", score: 70, lastObservedAt: hoursAgo(36) },
    ],
    now
  );

  assert.deepEqual(ranked.map((r) => r.key), ["fresh", "middling", "stale"]);
  // Same measurement throughout — only the age differs.
  assert.ok(ranked.every((r) => r.decay.measuredScore === 70));
});

test("a lower but current score can outrank a higher stale one", () => {
  const now = Date.UTC(2026, 7, 22, 12, 0, 0);
  const ranked = rankTrends(
    [
      { key: "old_star", score: 90, lastObservedAt: new Date(now - 240 * 3_600_000).toISOString() },
      { key: "today", score: 30, lastObservedAt: new Date(now).toISOString() },
    ],
    now
  );
  assert.equal(ranked[0].key, "today");
});

test("the expiry floor retires a trend whose evidence has gone stale", () => {
  // 40 measured, decayed under the floor: 40 * 0.5^(t/72) < 5 at t > 216h.
  const stillLive = decayTrend({ score: 40 }, 200);
  assert.equal(stillLive.lifecycle, "decaying");
  assert.equal(stillLive.isActive, true);
  assert.ok(stillLive.rankScore! >= TREND_EXPIRY_SCORE);

  const expired = decayTrend({ score: 40 }, 230);
  assert.ok(expired.rankScore! < TREND_EXPIRY_SCORE);
  assert.equal(expired.lifecycle, "expired");
  assert.equal(expired.isActive, false);
  // Still reports what was measured — expiry retires the claim, not the record.
  assert.equal(expired.measuredScore, 40);
});

test("the grace period protects a low but CURRENT measurement from the floor", () => {
  const fresh = decayTrend({ score: 2 }, 1);
  assert.equal(fresh.lifecycle, "measured", "a weak score measured today is current, not stale");
  assert.equal(fresh.isActive, true);

  const stale = decayTrend({ score: 2 }, TREND_DECAY_GRACE_HOURS + 1);
  assert.equal(stale.lifecycle, "expired");
});

test("the evidence horizon expires even a perfect score", () => {
  const d = decayTrend({ score: 100 }, TREND_EVIDENCE_HORIZON_HOURS);
  assert.equal(d.lifecycle, "expired");
  assert.equal(d.isActive, false);
});

test("half-life and floor are chosen so nothing outlives the 14-day window", () => {
  // The documented guarantee: 100 x 0.5^(t/halfLife) crosses the floor before
  // the measurement window has fully elapsed. If someone raises the half-life
  // or lowers the floor without thinking, this fails.
  const crossingHours = TREND_EVIDENCE_HALF_LIFE_HOURS * Math.log2(100 / TREND_EXPIRY_SCORE);
  assert.ok(
    crossingHours < TREND_EVIDENCE_HORIZON_HOURS,
    `a maximal score would stay active ${crossingHours}h, past the ${TREND_EVIDENCE_HORIZON_HOURS}h window`
  );
});

test("decay never turns an unscored trend into a number", () => {
  for (const age of [0, 24, 100, TREND_EVIDENCE_HORIZON_HOURS, 100_000]) {
    const d = decayTrend({ score: null }, age);
    assert.equal(d.measuredScore, null, `age ${age} fabricated a measurement`);
    assert.equal(d.rankScore, null, `age ${age} fabricated a ranking score`);
  }
  // In particular it must never become 0 — "no data" and "no interest" are
  // different claims and decay must not merge them.
  assert.notEqual(decayTrend({ score: null }, 500).rankScore, 0);
});

test("an unscored trend is unscored, not expired, while still being measured", () => {
  assert.equal(decayTrend({ score: null }, 0).lifecycle, "unscored");
  assert.equal(decayTrend({ score: null }, 24).lifecycle, "unscored");
  // ...but stops being reported once nothing has looked at it for a full window.
  assert.equal(decayTrend({ score: null }, TREND_EVIDENCE_HORIZON_HOURS).lifecycle, "expired");
});

test("a decayed computeTrend null result stays null end to end", () => {
  const measured = computeTrend(zero);
  const decayed = decayTrend(measured, 300);
  assert.equal(measured.score, null);
  assert.equal(decayed.rankScore, null);
  assert.equal(decayed.measuredScore, null);
});

test("expired rows sort below everything still live, whatever they scored", () => {
  const now = Date.UTC(2026, 7, 22, 12, 0, 0);
  const ranked = rankTrends(
    [
      { key: "expired_high", score: 95, lastObservedAt: new Date(now - 400 * 3_600_000).toISOString() },
      { key: "live_low", score: 12, lastObservedAt: new Date(now).toISOString() },
      { key: "unscored", score: null, lastObservedAt: new Date(now).toISOString() },
    ],
    now
  );
  assert.deepEqual(ranked.map((r) => r.key), ["live_low", "unscored", "expired_high"]);
});

test("an undatable measurement is treated as beyond the horizon, not as fresh", () => {
  assert.equal(evidenceAgeHours(null), Number.POSITIVE_INFINITY);
  assert.equal(evidenceAgeHours("not a date"), Number.POSITIVE_INFINITY);
  const d = decayTrend({ score: 90 }, evidenceAgeHours(null));
  assert.equal(d.lifecycle, "expired");
  assert.equal(d.rankScore, 0);
});

test("a future timestamp is age zero, never negative age or an inflated score", () => {
  const now = Date.UTC(2026, 7, 22, 12, 0, 0);
  const age = evidenceAgeHours(new Date(now + 10 * 3_600_000).toISOString(), now);
  assert.equal(age, 0);
  const d = decayTrend({ score: 50 }, age);
  assert.equal(d.rankScore, 50, "decay must never amplify a score above what was measured");
  assert.equal(d.decayFactor, 1);
});

test("re-ranking is deterministic — same inputs, same order and same numbers", () => {
  const now = Date.UTC(2026, 7, 22, 12, 0, 0);
  const rows = [
    { key: "a", score: 44, lastObservedAt: new Date(now - 30 * 3_600_000).toISOString() },
    { key: "b", score: 51, lastObservedAt: new Date(now - 90 * 3_600_000).toISOString() },
  ];
  assert.deepEqual(rankTrends(rows, now), rankTrends(rows, now));
});
