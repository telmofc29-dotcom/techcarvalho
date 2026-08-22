import { test } from "node:test";
import assert from "node:assert/strict";
import { freshnessLabel, absoluteDateLabel } from "./dates.ts";

const NOW = Date.parse("2026-08-22T12:00:00.000Z");
const hoursAgo = (h: number) => new Date(NOW - h * 3_600_000).toISOString();

test("freshnessLabel: under an hour reads as just published", () => {
  assert.equal(freshnessLabel(hoursAgo(0.5), NOW), "Just published");
});

test("freshnessLabel: within a day counts in hours", () => {
  assert.equal(freshnessLabel(hoursAgo(3), NOW), "3h ago");
  assert.equal(freshnessLabel(hoursAgo(23), NOW), "23h ago");
});

test("freshnessLabel: within a week counts in days", () => {
  assert.equal(freshnessLabel(hoursAgo(24), NOW), "1d ago");
  assert.equal(freshnessLabel(hoursAgo(24 * 6), NOW), "6d ago");
});

test("freshnessLabel: past a week falls back to an absolute date", () => {
  const published = hoursAgo(24 * 30);
  assert.equal(freshnessLabel(published, NOW), absoluteDateLabel(published));
});

// The honest-absence cases: a missing, unparseable, or future date produces no
// label at all rather than a plausible-looking one the reader would trust.
test("freshnessLabel: no date, bad date, and future dates produce no label", () => {
  assert.equal(freshnessLabel(null, NOW), null);
  assert.equal(freshnessLabel("not a date", NOW), null);
  assert.equal(freshnessLabel(hoursAgo(-5), NOW), null);
});

test("absoluteDateLabel: null in, null out — never a fabricated date", () => {
  assert.equal(absoluteDateLabel(null), null);
  assert.equal(absoluteDateLabel("nonsense"), null);
});
