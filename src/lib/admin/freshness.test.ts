import { test } from "node:test";
import assert from "node:assert/strict";
import { bucketForReviewDate, FRESHNESS_OVERDUE_DAYS, FRESHNESS_DUE_SOON_DAYS } from "./freshness.ts";

function daysAgo(n: number): string {
  return new Date(Date.now() - n * 24 * 60 * 60 * 1000).toISOString();
}

test("null reviewed_at is no_review", () => {
  assert.equal(bucketForReviewDate(null), "no_review");
});

test("recently reviewed is recent", () => {
  assert.equal(bucketForReviewDate(daysAgo(1)), "recent");
});

test("just under the due-soon threshold is still recent", () => {
  assert.equal(bucketForReviewDate(daysAgo(FRESHNESS_DUE_SOON_DAYS - 1)), "recent");
});

test("at the due-soon threshold is due_soon", () => {
  assert.equal(bucketForReviewDate(daysAgo(FRESHNESS_DUE_SOON_DAYS)), "due_soon");
});

test("at the overdue threshold is overdue", () => {
  assert.equal(bucketForReviewDate(daysAgo(FRESHNESS_OVERDUE_DAYS)), "overdue");
});

test("far in the past is overdue", () => {
  assert.equal(bucketForReviewDate(daysAgo(1000)), "overdue");
});
