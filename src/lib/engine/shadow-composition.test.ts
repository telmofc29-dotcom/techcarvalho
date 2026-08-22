import { test } from "node:test";
import assert from "node:assert/strict";
import {
  assessComposition,
  classifyDimensions,
  shadowCandidateIdentity,
  familyBucket,
  SHADOW_DIMENSIONS,
  MIN_DECISIONS_PER_DIMENSION,
  MAX_CREDIT_PER_FAMILY,
  MAX_EARLY_TERMINATION_SHARE,
  type CompositionEntry,
  type DimensionSignals,
} from "./shadow-composition.ts";

const signals = (over: Partial<DimensionSignals> = {}): DimensionSignals => ({
  title: "Something happened",
  summary: null,
  discoveryType: "technology_news",
  categorySlug: "computing",
  claimStatus: "confirmed_primary",
  suggestedAngle: null,
  freshnessSensitivity: "time_sensitive",
  evidenceCount: 3,
  distinctPublishers: 3,
  derivativeSources: 0,
  conflictCount: 0,
  entityDecision: "new_entity",
  mediaStageRan: true,
  mediaCandidateCount: 0,
  mediaClearedCount: 0,
  requiresHeroMedia: false,
  isProductRecord: false,
  ...over,
});

const entry = (over: Partial<CompositionEntry> = {}): CompositionEntry => ({
  identity: "discovery:x",
  title: "Some story",
  publisher: "Example",
  dimensions: ["news_sensitive"],
  day: "2026-08-22",
  complete: true,
  terminalStage: "final_decision",
  reachedGate: true,
  ...over,
});

// ---------------------------------------------------------------------------
// Identity
// ---------------------------------------------------------------------------

test("candidate identity is stable across runs — it encodes what the candidate IS", () => {
  const a = shadowCandidateIdentity({ kind: "discovery", key: "VESA-DP21-Update" });
  const b = shadowCandidateIdentity({ kind: "discovery", key: "  vesa-dp21-update  " });
  assert.equal(a, b, "case and surrounding whitespace must not create a second identity");
});

test("candidate identity carries no version or timestamp", () => {
  const id = shadowCandidateIdentity({ kind: "discovery", key: "abc" });
  assert.equal(id, "discovery:abc");
  assert.ok(!/\d{4}-\d{2}-\d{2}/.test(id), "a date in the identity would reset deduplication daily");
});

// ---------------------------------------------------------------------------
// Dimension classification
// ---------------------------------------------------------------------------

test("evergreen and news-sensitive are mutually exclusive", () => {
  const news = classifyDimensions(signals({ freshnessSensitivity: "breaking" }));
  const green = classifyDimensions(signals({ freshnessSensitivity: "evergreen" }));
  assert.ok(news.includes("news_sensitive") && !news.includes("evergreen"));
  assert.ok(green.includes("evergreen") && !green.includes("news_sensitive"));
});

test("structural dimensions come from stages that actually ran, not from keywords", () => {
  assert.ok(classifyDimensions(signals({ entityDecision: "ambiguous" })).includes("difficult_entity_resolution"));
  assert.ok(!classifyDimensions(signals({ entityDecision: "new_entity" })).includes("difficult_entity_resolution"));
  assert.ok(classifyDimensions(signals({ conflictCount: 2 })).includes("source_disagreement"));
  assert.ok(classifyDimensions(signals({ evidenceCount: 1, distinctPublishers: 1 })).includes("sparse_source"));
});

test("media_impossible requires a hero to be needed — an article that needs no image is not the hard case", () => {
  const noHeroNeeded = classifyDimensions(signals({ mediaCandidateCount: 0, mediaClearedCount: 0, requiresHeroMedia: false }));
  assert.ok(!noHeroNeeded.includes("media_impossible"), "no requirement means neither media dimension applies");
  assert.ok(!noHeroNeeded.includes("media_rich"));

  const impossible = classifyDimensions(signals({ mediaCandidateCount: 4, mediaClearedCount: 0, requiresHeroMedia: true }));
  assert.ok(impossible.includes("media_impossible"));

  const rich = classifyDimensions(signals({ mediaCandidateCount: 4, mediaClearedCount: 2, requiresHeroMedia: true }));
  assert.ok(rich.includes("media_rich") && !rich.includes("media_impossible"));
});

test("neither media dimension is credited when the media stage never ran", () => {
  const earlyReject = classifyDimensions(
    signals({ mediaStageRan: false, mediaCandidateCount: 0, mediaClearedCount: 0, requiresHeroMedia: true })
  );
  assert.ok(
    !earlyReject.includes("media_impossible") && !earlyReject.includes("media_rich"),
    "a question never asked is not a hard case answered"
  );
});

test("classification is deterministic and ordered", () => {
  const s = signals({ title: "Best GPU vs CPU price guide: how to fix a crash", conflictCount: 1 });
  const a = classifyDimensions(s);
  const b = classifyDimensions(s);
  assert.deepEqual(a, b);
  const order = SHADOW_DIMENSIONS.filter((d) => a.includes(d));
  assert.deepEqual(a, order, "output must follow SHADOW_DIMENSIONS order so two runs are byte-identical");
});

test("a candidate exercising nothing on the list still classifies, as an empty array", () => {
  const result = classifyDimensions(
    signals({
      title: "Untitled",
      discoveryType: "new_topic",
      freshnessSensitivity: null,
      evidenceCount: 5,
      distinctPublishers: 5,
      claimStatus: "confirmed_primary",
    })
  );
  assert.ok(Array.isArray(result));
});

// ---------------------------------------------------------------------------
// Anti-inflation: the whole point of the module
// ---------------------------------------------------------------------------

test("re-running over the same candidates accumulates no credit", () => {
  const once = assessComposition([entry({ identity: "discovery:a" })]);
  const tenTimes = assessComposition(
    Array.from({ length: 10 }, () => entry({ identity: "discovery:a" }))
  );
  assert.equal(once.creditedDecisions, 1);
  assert.equal(tenTimes.creditedDecisions, 1, "ten passes over one candidate is one decision");
  assert.equal(tenTimes.duplicateIdentitiesRefused, 9);
});

test("a crashed candidate is never credited", () => {
  const report = assessComposition([
    entry({ identity: "discovery:a", complete: false, terminalStage: "evidence" }),
    entry({ identity: "discovery:b" }),
  ]);
  assert.equal(report.creditedDecisions, 1);
  assert.equal(report.incompleteRefused, 1);
  assert.equal(report.totalRecords, 2, "the failure is still recorded — it is counted separately, not discarded");
});

test("near-duplicate stories from one publisher are capped", () => {
  const entries = Array.from({ length: 12 }, (_, i) =>
    entry({
      identity: `discovery:vesa-${i}`,
      title: "VESA updates DisplayPort specification for gaming",
      publisher: "VESA",
    })
  );
  const report = assessComposition(entries);
  assert.equal(report.creditedDecisions, MAX_CREDIT_PER_FAMILY);
  assert.equal(report.familyCapRefused, 12 - MAX_CREDIT_PER_FAMILY);
  assert.equal(report.distinctFamilies, 1);
});

test("genuinely different stories from one publisher are NOT capped together", () => {
  const report = assessComposition([
    entry({ identity: "d:1", title: "VESA updates DisplayPort specification", publisher: "VESA" }),
    entry({ identity: "d:2", title: "Firefox ships a built-in VPN for everyone", publisher: "VESA" }),
    entry({ identity: "d:3", title: "Court rules on antitrust remedy in browser case", publisher: "VESA" }),
  ]);
  assert.equal(report.creditedDecisions, 3, "collapsing unrelated stories would under-count honest work");
  assert.equal(report.distinctFamilies, 3);
});

test("the same story from two publishers is two decisions", () => {
  const report = assessComposition([
    entry({ identity: "d:1", title: "VESA updates DisplayPort specification", publisher: "VESA" }),
    entry({ identity: "d:2", title: "VESA updates DisplayPort specification", publisher: "AnandTech" }),
  ]);
  assert.equal(report.creditedDecisions, 2);
});

test("family clustering is publisher-scoped", () => {
  assert.equal(familyBucket("  VESA  "), "vesa");
  assert.equal(familyBucket(null), "unknown");
  assert.equal(familyBucket(""), "unknown");
});

// ---------------------------------------------------------------------------
// Coverage floors and shape
// ---------------------------------------------------------------------------

test("a large single-dimension set is NOT adequate", () => {
  const entries = Array.from({ length: 600 }, (_, i) =>
    entry({
      identity: `discovery:${i}`,
      title: `Story number ${i} about a thing that happened somewhere`,
      publisher: `Publisher ${i}`,
      dimensions: ["news_sensitive"],
    })
  );
  const report = assessComposition(entries);
  assert.ok(report.creditedDecisions >= 500, "the raw count clears 500");
  assert.equal(report.adequate, false, "but 600 near-identical decisions are not evidence");
  assert.equal(report.gaps.length, SHADOW_DIMENSIONS.length - 1);
  assert.ok(report.blockers.some((b) => b.criterion.includes("evergreen")));
});

test("every dimension needs its own floor", () => {
  const entries: CompositionEntry[] = [];
  let n = 0;
  for (const dimension of SHADOW_DIMENSIONS) {
    // One short of the floor everywhere.
    for (let i = 0; i < MIN_DECISIONS_PER_DIMENSION - 1; i++) {
      entries.push(
        entry({
          identity: `discovery:${n}`,
          title: `Distinct story ${n} concerning subject ${n}`,
          publisher: `Publisher ${n}`,
          dimensions: [dimension],
          day: `2026-0${(n % 9) + 1}-1${n % 10}`,
        })
      );
      n++;
    }
  }
  const report = assessComposition(entries);
  assert.equal(report.gaps.length, SHADOW_DIMENSIONS.length, "one short is still short, in every dimension");
});

test("a set dominated by cheap early terminations is not adequate", () => {
  const entries: CompositionEntry[] = [];
  let n = 0;
  for (const dimension of SHADOW_DIMENSIONS) {
    for (let i = 0; i < MIN_DECISIONS_PER_DIMENSION + 5; i++) {
      entries.push(
        entry({
          identity: `discovery:${n}`,
          title: `Distinct story ${n} concerning subject ${n}`,
          publisher: `Publisher ${n}`,
          dimensions: [dimension],
          day: `2026-0${(n % 9) + 1}-1${n % 10}`,
          // Almost everything dies at relevance.
          reachedGate: i % 10 === 0,
          terminalStage: i % 10 === 0 ? "final_decision" : "relevance",
        })
      );
      n++;
    }
  }
  const report = assessComposition(entries);
  assert.equal(report.gaps.length, 0, "coverage floors are met");
  assert.ok(report.earlyTerminationShare > MAX_EARLY_TERMINATION_SHARE);
  assert.equal(report.adequate, false, "the expensive stages were barely exercised");
  assert.ok(report.blockers.some((b) => b.criterion.includes("before the publication gate")));
});

test("an empty set is never adequate", () => {
  const report = assessComposition([]);
  assert.equal(report.creditedDecisions, 0);
  assert.equal(report.adequate, false);
  assert.ok(report.blockers.length > 0);
});

test("nothing in the module can raise a count", () => {
  const entries = Array.from({ length: 40 }, (_, i) =>
    entry({ identity: `discovery:${i}`, title: `Story ${i} about subject ${i}`, publisher: `P${i}` })
  );
  const report = assessComposition(entries);
  assert.ok(
    report.creditedDecisions <= entries.length,
    "credited can never exceed the records actually recorded"
  );
});

test("the summary names the gaps rather than hiding behind a total", () => {
  const report = assessComposition([entry()]);
  assert.match(report.summary, /NOT adequate/);
  assert.match(report.summary, /evergreen/);
});
