import { test } from "node:test";
import assert from "node:assert/strict";
import { computeOpportunityScore, MIN_DEMAND_SIGNAL } from "./opportunity.ts";

const base = {
  searchVolume: 0,
  zeroResultSearches: 0,
  views: 0,
  previousViews: 0,
  existingContentCount: 0,
  commercialClicks: 0,
  daysSinceFreshest: null,
  hasActiveDiscovery: false,
};

test("insufficient demand returns null, not a fabricated score", () => {
  const r = computeOpportunityScore({ ...base, searchVolume: 2 });
  assert.equal(r.score, null);
  assert.ok(r.explanation.includes("Not enough measured demand"));
});

test("zero-result searches drive a high gap-led score", () => {
  const r = computeOpportunityScore({
    ...base,
    searchVolume: 40,
    zeroResultSearches: 18,
    existingContentCount: 0,
  });
  assert.ok(r.score !== null && r.score > 20, `expected meaningful score, got ${r.score}`);
  assert.ok(r.explanation.includes("returned no results"));
});

test("a news discovery alone cannot dominate measured demand", () => {
  const withoutNews = computeOpportunityScore({ ...base, searchVolume: 30, views: 30 });
  const withNews = computeOpportunityScore({
    ...base,
    searchVolume: 30,
    views: 30,
    hasActiveDiscovery: true,
  });
  assert.ok(withNews.score !== null && withoutNews.score !== null);
  // Bonus is explicitly capped at 5 points.
  assert.ok(withNews.score - withoutNews.score <= 5.01);
});

test("existing coverage reduces the gap component", () => {
  const uncovered = computeOpportunityScore({ ...base, searchVolume: 60, existingContentCount: 0 });
  const covered = computeOpportunityScore({ ...base, searchVolume: 60, existingContentCount: 5 });
  assert.ok(uncovered.score !== null && covered.score !== null);
  assert.ok(uncovered.score > covered.score, "uncovered demand should outrank covered demand");
});

test("scores never exceed 100", () => {
  const r = computeOpportunityScore({
    searchVolume: 100000,
    zeroResultSearches: 100000,
    views: 100000,
    previousViews: 1,
    existingContentCount: 0,
    commercialClicks: 100000,
    daysSinceFreshest: 100000,
    hasActiveDiscovery: true,
  });
  assert.ok(r.score !== null && r.score <= 100, `got ${r.score}`);
});

test("every scored result carries a non-empty explanation", () => {
  const r = computeOpportunityScore({ ...base, searchVolume: 25, views: 25, commercialClicks: 4 });
  assert.ok(r.score !== null);
  assert.ok(r.explanation.length > 20);
});

test("MIN_DEMAND_SIGNAL is the documented floor", () => {
  const justBelow = computeOpportunityScore({ ...base, views: MIN_DEMAND_SIGNAL - 1 });
  const atFloor = computeOpportunityScore({ ...base, views: MIN_DEMAND_SIGNAL });
  assert.equal(justBelow.score, null);
  assert.ok(atFloor.score !== null);
});
