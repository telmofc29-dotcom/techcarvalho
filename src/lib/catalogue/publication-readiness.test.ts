import { test } from "node:test";
import assert from "node:assert/strict";
import {
  assessReadiness,
  summarise,
  commonestGaps,
  MIN_SPECS_FOR_PAGE,
  type ReadinessInput,
} from "./publication-readiness.ts";

const complete = (over: Partial<ReadinessInput> = {}): ReadinessInput => ({
  slug: "canon-rf50mm-f1-8-stm",
  name: "Canon RF 50mm F1.8 STM",
  specCount: 18,
  keySpecCount: 6,
  primarySourceCount: 1,
  sourceCount: 1,
  hasExactMedia: true,
  hasAnyMedia: true,
  relationshipCount: 2,
  technologyCount: 3,
  hasSummary: true,
  hasRightsIssue: false,
  identityUncertain: false,
  ...over,
});

test("a complete record is ready", () => {
  const r = assessReadiness(complete());
  assert.equal(r.verdict, "ready");
  assert.deepEqual(r.gaps, []);
  assert.deepEqual(r.blockers, []);
});

// --- blockers --------------------------------------------------------------

test("NO PRIMARY SOURCE IS DISQUALIFYING, NOT A SHORTFALL", () => {
  // The entire premise of this catalogue is that its facts are traceable. A
  // page whose every figure is unattributable is not "less ready".
  const r = assessReadiness(complete({ primarySourceCount: 0 }));
  assert.equal(r.verdict, "blocked");
  assert.match(r.blockers.join(" "), /primary source/i);
});

test("a rights problem blocks regardless of everything else", () => {
  const r = assessReadiness(complete({ hasRightsIssue: true }));
  assert.equal(r.verdict, "blocked");
});

test("uncertain identity blocks — publishing would assert an unconfirmed model", () => {
  const r = assessReadiness(complete({ identityUncertain: true }));
  assert.equal(r.verdict, "blocked");
});

test("BLOCKERS SHORT-CIRCUIT AND HIDE THE GAP LIST", () => {
  // Reporting "no primary source" alongside "add two more specifications"
  // invites someone to fix the specs and press publish.
  const r = assessReadiness(complete({ primarySourceCount: 0, specCount: 2, hasExactMedia: false }));
  assert.equal(r.verdict, "blocked");
  assert.deepEqual(r.gaps, [], "gaps must not be offered while a blocker stands");
  assert.ok(r.blockers.length >= 1);
});

// --- media is weighted deliberately ---------------------------------------

test("NO PICTURE OF THE PRODUCT PREVENTS 'READY', HOWEVER COMPLETE THE DATA", () => {
  // This is the specific failure the site is currently judged for.
  const r = assessReadiness(complete({ hasExactMedia: false, hasAnyMedia: false }));
  assert.notEqual(r.verdict, "ready");
  assert.match(r.gaps.join(" "), /No imagery at all/);
});

test("imagery of the WRONG product reads differently from no imagery", () => {
  // They need different work: one is a photo shoot, the other is a correction.
  const wrong = assessReadiness(complete({ hasExactMedia: false, hasAnyMedia: true }));
  const none = assessReadiness(complete({ hasExactMedia: false, hasAnyMedia: false }));
  assert.match(wrong.gaps.join(" "), /does not show this exact product/);
  assert.match(none.gaps.join(" "), /No imagery at all/);
  assert.notDeepEqual(wrong.gaps, none.gaps);
});

// --- shortfalls ------------------------------------------------------------

test("a thin specification table is a gap, not a blocker", () => {
  const r = assessReadiness(complete({ specCount: 3, keySpecCount: 1 }));
  assert.notEqual(r.verdict, "blocked");
  assert.match(r.gaps.join(" "), new RegExp(`about ${MIN_SPECS_FOR_PAGE}`));
});

test("a product with no relationships is called a dead end", () => {
  const r = assessReadiness(complete({ relationshipCount: 0 }));
  assert.match(r.gaps.join(" "), /dead end/);
});

test("many gaps means not_ready; one or two means nearly", () => {
  assert.equal(assessReadiness(complete({ hasSummary: false })).verdict, "nearly");
  const many = assessReadiness(complete({
    specCount: 1, keySpecCount: 0, hasExactMedia: false, hasAnyMedia: false,
    relationshipCount: 0, technologyCount: 0, hasSummary: false,
  }));
  assert.equal(many.verdict, "not_ready");
});

// --- the module refuses to publish ----------------------------------------

test("NOTHING HERE CAN PUBLISH", () => {
  // A score that publishes is a score that will one day publish something
  // embarrassing unattended. The result carries a verdict and reasons, and no
  // field that any caller could mistake for permission.
  const r = assessReadiness(complete());
  const keys = Object.keys(r).sort();
  assert.deepEqual(keys, ["blockers", "gaps", "slug", "verdict"]);
  assert.ok(!("publish" in r) && !("approved" in r) && !("shouldPublish" in r));
});

test("there is no numeric score to sort by", () => {
  // Two READY products are not usefully ordered by a decimal, and inventing one
  // would imply a precision these signals do not have.
  const r = assessReadiness(complete()) as Record<string, unknown>;
  for (const v of Object.values(r)) assert.notEqual(typeof v, "number");
});

// --- aggregation -----------------------------------------------------------

test("summarise counts every verdict exactly once", () => {
  const rows = [
    assessReadiness(complete()),
    assessReadiness(complete({ hasSummary: false })),
    assessReadiness(complete({ primarySourceCount: 0 })),
    assessReadiness(complete({ specCount: 1, keySpecCount: 0, hasExactMedia: false, hasAnyMedia: false, relationshipCount: 0, technologyCount: 0, hasSummary: false })),
  ];
  const s = summarise(rows);
  assert.equal(s.ready + s.nearly + s.not_ready + s.blocked, rows.length);
  assert.equal(s.blocked, 1);
});

test("COMMONEST GAPS GROUPS ACROSS DIFFERING NUMBERS", () => {
  // "Only 6 specifications" and "Only 7 specifications" are one problem. Left
  // ungrouped, every product looks like a unique issue and the backlog cannot
  // be prioritised.
  const rows = [
    assessReadiness(complete({ specCount: 6, keySpecCount: 1 })),
    assessReadiness(complete({ specCount: 7, keySpecCount: 1 })),
    assessReadiness(complete({ specCount: 2, keySpecCount: 1 })),
  ];
  const gaps = commonestGaps(rows);
  const specGap = gaps.find((g) => /specifications/.test(g.gap));
  assert.ok(specGap, gaps.map((g) => g.gap).join(" | "));
  assert.equal(specGap.count, 3, "all three must group into one gap");
});
