import { test } from "node:test";
import assert from "node:assert/strict";
import { computeTrend, byTrendScore } from "./trends.ts";

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
