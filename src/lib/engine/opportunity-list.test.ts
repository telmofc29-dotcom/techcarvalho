import { test } from "node:test";
import assert from "node:assert/strict";
import { partitionOpportunities, unscoredReason, isWatchlistOpportunity } from "./opportunity-list.ts";

// Fixtures mirror real production rows: 38 scored watchlist developments and
// 12 category rows the scoring job deliberately left NULL because there is not
// enough measured demand to score them honestly.
const row = (key: string, score: number | null, explanation = "") => ({
  subject_type: key.startsWith("watchlist:") ? "topic" : "category",
  subject_key: key,
  label: key,
  score,
  explanation,
  inputs: null,
});

const UNSCORED_REASON =
  "Not enough measured demand to score (0 combined searches/views, minimum 5). Reported as unscored rather than guessed.";

test("an unscored opportunity can never outrank a scored one", () => {
  // PostgreSQL puts NULLs FIRST on ORDER BY score DESC, so a screen ranking
  // these would have shown twelve unscored categories above every urgent
  // fully-scored development.
  const rows = [
    row("ai-hardware", null, UNSCORED_REASON),
    row("watchlist:apple-m6", 95.3),
    row("3d-printing", null, UNSCORED_REASON),
    row("watchlist:nvidia-dlss", 84.59),
  ];
  const { ranked, awaitingData } = partitionOpportunities(rows);
  assert.deepEqual(ranked.map((r) => r.subject_key), ["watchlist:apple-m6", "watchlist:nvidia-dlss"]);
  assert.equal(awaitingData.length, 2);
  // The guarantee, stated directly: nothing unscored is in the ranking at all.
  assert.ok(ranked.every((r) => r.score !== null));
});

test("nothing is hidden — every unscored row is still returned", () => {
  const rows = [row("a", null), row("b", null), row("c", 10)];
  const { ranked, awaitingData } = partitionOpportunities(rows);
  assert.equal(ranked.length + awaitingData.length, rows.length);
});

test("a zero score is a score, not missing data", () => {
  // Number(null) is 0. Treating them alike would sort a genuinely unscored row
  // into the ranking as if it had scored zero.
  const { ranked, awaitingData } = partitionOpportunities([row("zero", 0), row("null", null)]);
  assert.deepEqual(ranked.map((r) => r.subject_key), ["zero"]);
  assert.deepEqual(awaitingData.map((r) => r.subject_key), ["null"]);
});

test("undefined and NaN are treated as unscored, not as zero", () => {
  const rows = [
    { ...row("undef", 0), score: undefined as unknown as number | null },
    { ...row("nan", 0), score: Number.NaN },
    row("real", 50),
  ];
  const { ranked, awaitingData } = partitionOpportunities(rows);
  assert.deepEqual(ranked.map((r) => r.subject_key), ["real"]);
  assert.equal(awaitingData.length, 2);
});

test("the ranking is stable across reloads", () => {
  // Equal scores must not reshuffle, or the top of the list changes for no
  // reason between visits.
  const rows = [row("watchlist:b", 90), row("watchlist:a", 90), row("watchlist:c", 95)];
  const first = partitionOpportunities(rows).ranked.map((r) => r.subject_key);
  const second = partitionOpportunities([...rows].reverse()).ranked.map((r) => r.subject_key);
  assert.deepEqual(first, second);
  assert.deepEqual(first, ["watchlist:c", "watchlist:a", "watchlist:b"]);
});

test("the unscored list is ordered visibly arbitrarily, not by a fake rank", () => {
  // Alphabetical signals "these are not ranked". Any other order would imply a
  // comparison that cannot be made.
  const { awaitingData } = partitionOpportunities([row("zeta", null), row("alpha", null), row("mid", null)]);
  assert.deepEqual(awaitingData.map((r) => r.subject_key), ["alpha", "mid", "zeta"]);
});

test("an unscored row explains itself using the job's own words", () => {
  assert.equal(unscoredReason(row("a", null, UNSCORED_REASON)), UNSCORED_REASON);
  // The fallback states the absence; it never invents a cause.
  const fallback = unscoredReason(row("a", null));
  assert.match(fallback, /not enough measured demand/i);
  assert.doesNotMatch(fallback, /search volume|traffic estimate|popularity/i);
});

test("nothingScored lets a screen say so plainly", () => {
  assert.equal(partitionOpportunities([row("a", null)]).nothingScored, true);
  assert.equal(partitionOpportunities([row("a", 1)]).nothingScored, false);
});

test("watchlist rows are distinguishable from section signals", () => {
  assert.equal(isWatchlistOpportunity(row("watchlist:x", 1)), true);
  assert.equal(isWatchlistOpportunity(row("computing", null)), false);
});
