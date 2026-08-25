import { test } from "node:test";
import assert from "node:assert/strict";
import {
  decideCoverage,
  consolidateOpportunities,
  DECISION_LABELS,
  SAME_SUBJECT_THRESHOLD,
  type ExistingPiece,
} from "./coverage-decision.ts";

const NOW = new Date("2026-08-25T12:00:00Z");

function piece(over: Partial<ExistingPiece> = {}): ExistingPiece {
  return {
    id: "p1",
    title: "Wi-Fi 7 explained",
    slug: "wifi-7-explained",
    status: "published",
    categorySlug: "networking",
    publishedAt: "2026-08-01T00:00:00Z",
    ...over,
  };
}

function input(over: Partial<Parameters<typeof decideCoverage>[0]> = {}) {
  return decideCoverage({
    subject: "Something entirely new happened",
    categorySlug: "computing",
    independentOrigins: 3,
    framing: "reported" as const,
    claimCount: 8,
    existing: [],
    now: NOW,
    ...over,
  });
}

// ---------------------------------------------------------------------------
// The four decisions are all reachable
// ---------------------------------------------------------------------------

test("NEW_ARTICLE when nothing covers the subject", () => {
  const v = input({ existing: [piece()] });
  assert.equal(v.decision, "NEW_ARTICLE");
  assert.equal(v.target, null);
});

test("UPDATE_EXISTING when a page already covers it", () => {
  const v = input({
    subject: "Wi-Fi 7 explained",
    existing: [piece()],
  });
  assert.equal(v.decision, "UPDATE_EXISTING");
  assert.equal(v.target?.slug, "wifi-7-explained");
  assert.match(v.reasons.join(" "), /keeps the authority on one URL/i);
});

test("SUPPORTING when related, distinct and substantial", () => {
  const v = input({
    subject: "Wi-Fi 7 router placement in older houses",
    claimCount: 9,
    independentOrigins: 3,
    existing: [piece()],
  });
  assert.equal(v.decision, "SUPPORTING");
  assert.ok(v.target);
});

test("NO_COVERAGE when there is nothing to write", () => {
  const v = input({ claimCount: 1, existing: [] });
  assert.equal(v.decision, "NO_COVERAGE");
  assert.match(v.reasons[0], /Nothing to write/i);
});

test("every decision has a label", () => {
  for (const d of ["NEW_ARTICLE", "UPDATE_EXISTING", "SUPPORTING", "NO_COVERAGE"] as const) {
    assert.ok(DECISION_LABELS[d].length > 3);
  }
});

// ---------------------------------------------------------------------------
// The headline failure: five outlets, one development
// ---------------------------------------------------------------------------

test("five reports of one Samsung update consolidate into ONE opportunity", () => {
  const opportunities = [
    { subject: "Samsung One UI 8 rolls out to Galaxy S25", independentOrigins: 2 },
    { subject: "One UI 8 rolling out to Samsung Galaxy S25", independentOrigins: 4 },
    { subject: "Samsung begins One UI 8 rollout for Galaxy S25", independentOrigins: 1 },
    { subject: "Galaxy S25 gets One UI 8 update", independentOrigins: 3 },
    { subject: "Canon announces a new RF lens", independentOrigins: 2 },
  ];
  const groups = consolidateOpportunities(opportunities);
  // The four One UI reports collapse; Canon stays separate.
  assert.equal(groups.length, 2, JSON.stringify(groups.map((g) => g.primary.subject)));
  const oneUi = groups.find((g) => /One UI/i.test(g.primary.subject))!;
  assert.equal(oneUi.duplicates.length, 3);
  // The best-sourced report leads the group.
  assert.equal(oneUi.primary.independentOrigins, 4);
});

test("consolidation is deterministic regardless of input order", () => {
  const a = [
    { subject: "One UI 8 rollout begins", independentOrigins: 3 },
    { subject: "Samsung starts One UI 8 rollout", independentOrigins: 3 },
  ];
  const g1 = consolidateOpportunities(a).map((g) => g.primary.subject);
  const g2 = consolidateOpportunities([...a].reverse()).map((g) => g.primary.subject);
  assert.deepEqual(g1, g2);
});

test("unrelated opportunities are never collapsed", () => {
  const groups = consolidateOpportunities([
    { subject: "Canon RF 24-70mm announced", independentOrigins: 2 },
    { subject: "AMD Ryzen 9950X benchmarks", independentOrigins: 2 },
    { subject: "Bambu Lab X1 firmware update", independentOrigins: 2 },
  ]);
  assert.equal(groups.length, 3);
});

// ---------------------------------------------------------------------------
// A weak story cannot be laundered into an existing page
// ---------------------------------------------------------------------------

test("an insufficient opportunity never reaches UPDATE", () => {
  // Checked before similarity on purpose: reaching UPDATE on no evidence would
  // push a weak story into an existing strong page.
  const v = input({
    subject: "Wi-Fi 7 explained",
    framing: "insufficient",
    claimCount: 0,
    existing: [piece()],
  });
  assert.equal(v.decision, "NO_COVERAGE");
});

test("a thin related story updates rather than getting its own page", () => {
  const v = input({
    subject: "Wi-Fi 7 router placement tips",
    claimCount: 3,
    independentOrigins: 1,
    existing: [piece()],
  });
  assert.equal(v.decision, "UPDATE_EXISTING");
  assert.match(v.reasons.join(" "), /Too thin for its own page/i);
});

// ---------------------------------------------------------------------------
// Drafts
// ---------------------------------------------------------------------------

test("an existing DRAFT on the same subject stops a second piece", () => {
  const v = input({
    subject: "Wi-Fi 7 explained",
    existing: [piece({ status: "draft", publishedAt: null })],
  });
  assert.equal(v.decision, "NO_COVERAGE");
  assert.match(v.reasons.join(" "), /Finish that draft/i);
});

// ---------------------------------------------------------------------------
// Staleness
// ---------------------------------------------------------------------------

test("a very old page is flagged as a substantial refresh", () => {
  const v = input({
    subject: "Wi-Fi 7 explained",
    existing: [piece({ publishedAt: "2024-01-01T00:00:00Z" })],
  });
  assert.equal(v.decision, "UPDATE_EXISTING");
  assert.match(v.reasons.join(" "), /substantial refresh/i);
});

test("a missing publication date does not crash the decision", () => {
  const v = input({ subject: "Wi-Fi 7 explained", existing: [piece({ publishedAt: null })] });
  assert.equal(v.decision, "UPDATE_EXISTING");
});

// ---------------------------------------------------------------------------
// Transparency
// ---------------------------------------------------------------------------

test("what was considered is always reported", () => {
  const v = input({
    subject: "Wi-Fi 7 explained",
    existing: [piece(), piece({ id: "p2", title: "Wi-Fi 7 vs Wi-Fi 6E", slug: "w2" })],
  });
  assert.ok(v.nearby.length >= 1);
  assert.ok(v.nearby.every((n) => n.similarity >= SAME_SUBJECT_THRESHOLD));
});

test("every verdict explains itself", () => {
  const cases = [
    input({ existing: [] }),
    input({ subject: "Wi-Fi 7 explained", existing: [piece()] }),
    input({ claimCount: 0 }),
  ];
  for (const v of cases) {
    assert.ok(v.reasons.length > 0);
    assert.ok(v.reasons.every((r) => r.length > 15));
  }
});
