import { test } from "node:test";
import assert from "node:assert/strict";
import {
  decideShadowOutcome,
  tallyShadowRun,
  SHADOW_STAGES,
  SHADOW_MAY_PUBLISH,
  type ShadowStage,
  type ShadowStageRecord,
  type ShadowStageStatus,
} from "./shadow-decision.ts";
import type { GateVerdict } from "./publication-gate.ts";
import type { ReviewResult } from "./reviewer.ts";

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

const stages = (over: Partial<Record<ShadowStage, ShadowStageStatus>> = {}): ShadowStageRecord[] =>
  SHADOW_STAGES.map((stage) => ({
    stage,
    status: over[stage] ?? "passed",
    summary: `${stage} ran`,
    detail: [],
  }));

const cleanGate = (): GateVerdict => ({
  publishable: true,
  blockers: [],
  dimensions: [{ dimension: "factual_accuracy", score: 1, rationale: "all claims traced" }],
  unavailableChecks: [],
  summary: "Cleared.",
});

const blockedGate = (): GateVerdict => ({
  publishable: false,
  blockers: [{ code: "missing_hero_media", message: "No hero image." }],
  dimensions: [],
  unavailableChecks: [],
  summary: "BLOCKED.",
});

const unavailableGate = (): GateVerdict => ({
  publishable: false,
  blockers: [{ code: "check_unavailable", message: "The media validation check could not be run.", evidence: "media validation" }],
  dimensions: [],
  unavailableChecks: ["media validation"],
  summary: "BLOCKED by 1 hard blocker(s): check_unavailable.",
});

const review = (over: Partial<ReviewResult> = {}): ReviewResult =>
  ({
    findings: [],
    blockers: [],
    severityCounts: { blocker: 0, serious: 0, caution: 0, note: 0 },
    verdict: "no_objection",
    coverage: {
      claims: [], claimCount: 2, supportedCount: 2, coverageRatio: 1,
      unsupportedClaims: [], highRiskUnsupported: [], fabricatedValueCount: 0, explanation: "ok",
    },
    confidence: {
      confidence: 90, effectiveClaimStatus: "confirmed_primary",
      independentSources: 3, derivativeSources: 0, explanation: "ok",
    },
    reconciliations: [],
    sourceClassifications: [],
    sevenDay: {
      horizonDays: 7, wouldPublishUnattended: true, unattendedRiskScore: 0,
      expiringClaims: [], irreversibleRisks: [], compoundingRisks: [], explanation: "fine",
    },
    generatorClaim: null,
    disagreesWithGenerator: false,
    explanation: "NO OBJECTION",
    ...over,
  }) as ReviewResult;

// ---------------------------------------------------------------------------
// A crash is not a decision — the load-bearing rule
// ---------------------------------------------------------------------------

test("a stage that threw produces a FAILURE with no outcome", () => {
  const d = decideShadowOutcome({
    stages: stages({ evidence: "error" }),
    earlyReasons: [],
  });
  assert.equal(d.kind, "failure");
  assert.equal(d.outcome, null, "a crash must never be laundered into HUMAN_REVIEW_REQUIRED");
  assert.equal(d.failedStage, "evidence");
  assert.match(d.explanation, /NO DECISION/);
});

test("a crash outranks a gate verdict — the gate ran on partial data", () => {
  const d = decideShadowOutcome({
    stages: stages({ media_rights: "error" }),
    gate: cleanGate(),
    review: review(),
    earlyReasons: [],
  });
  assert.equal(d.kind, "failure");
  assert.equal(d.outcome, null);
});

test("ending without reaching the gate and without any stage stopping is a failure, not a pass", () => {
  const d = decideShadowOutcome({
    stages: stages({ publication_gate: "not_reached", final_decision: "not_reached" }),
    earlyReasons: [],
  });
  assert.equal(d.kind, "failure");
  assert.equal(d.outcome, null);
  assert.match(d.failureError ?? "", /orchestration defect/);
});

// ---------------------------------------------------------------------------
// Legitimate early fail-closed states
// ---------------------------------------------------------------------------

test("a fail-closed stage is a real decision: WOULD_REJECT", () => {
  const d = decideShadowOutcome({
    stages: stages({ relevance: "fail_closed" }),
    earlyReasons: [{ code: "not_relevant", stage: "relevance", severity: "blocker", message: "off topic", detail: [] }],
  });
  assert.equal(d.kind, "decision");
  assert.equal(d.outcome, "WOULD_REJECT");
  assert.equal(d.terminalStage, "relevance");
  assert.equal(d.reachedGate, false, "so composition can see this was a cheap decision");
});

test("a needs_human stage is a real decision: HUMAN_REVIEW_REQUIRED", () => {
  const d = decideShadowOutcome({
    stages: stages({ relevance: "needs_human" }),
    earlyReasons: [],
  });
  assert.equal(d.kind, "decision");
  assert.equal(d.outcome, "HUMAN_REVIEW_REQUIRED");
  assert.equal(d.reachedGate, false);
});

// ---------------------------------------------------------------------------
// Precedence
// ---------------------------------------------------------------------------

test("a disqualifying gate blocker outranks a clean reviewer", () => {
  const d = decideShadowOutcome({ stages: stages(), gate: blockedGate(), review: review(), earlyReasons: [] });
  assert.equal(d.outcome, "WOULD_REJECT");
});

test("a reviewer REJECT outranks a clean gate", () => {
  const d = decideShadowOutcome({
    stages: stages(),
    gate: cleanGate(),
    review: review({
      verdict: "reject",
      severityCounts: { blocker: 1, serious: 0, caution: 0, note: 0 },
      blockers: [{ code: "fabricated_rating", severity: "blocker", category: "reader_harm", message: "invented score", detail: [] }],
      findings: [{ code: "fabricated_rating", severity: "blocker", category: "reader_harm", message: "invented score", detail: [] }],
    }),
    earlyReasons: [],
  });
  assert.equal(d.outcome, "WOULD_REJECT", "two independent checks, either can disqualify");
});

test("a check that could not run is HUMAN_REVIEW_REQUIRED, not WOULD_REJECT", () => {
  const d = decideShadowOutcome({ stages: stages(), gate: unavailableGate(), review: review(), earlyReasons: [] });
  assert.equal(d.outcome, "HUMAN_REVIEW_REQUIRED");
  assert.match(d.explanation, /not a check that passed/);
});

test("an outage does not inflate the rejection rate, but still publishes nothing", () => {
  const d = decideShadowOutcome({ stages: stages(), gate: unavailableGate(), review: review(), earlyReasons: [] });
  assert.notEqual(d.outcome, "WOULD_PUBLISH");
  assert.notEqual(d.outcome, "WOULD_REJECT");
});

test("a reviewer HOLD produces HUMAN_REVIEW_REQUIRED even with a clean gate", () => {
  const d = decideShadowOutcome({
    stages: stages(),
    gate: cleanGate(),
    review: review({ verdict: "hold_for_human", severityCounts: { blocker: 0, serious: 1, caution: 0, note: 0 } }),
    earlyReasons: [],
  });
  assert.equal(d.outcome, "HUMAN_REVIEW_REQUIRED");
});

test("failing the seven-day question blocks WOULD_PUBLISH", () => {
  const d = decideShadowOutcome({
    stages: stages(),
    gate: cleanGate(),
    review: review({
      sevenDay: {
        horizonDays: 7, wouldPublishUnattended: false, unattendedRiskScore: 40,
        expiringClaims: [], irreversibleRisks: [], compoundingRisks: [],
        explanation: "price claim expires in 3 days",
      },
    }),
    earlyReasons: [],
  });
  assert.equal(d.outcome, "HUMAN_REVIEW_REQUIRED");
});

test("a clean gate with NO adversarial review is not WOULD_PUBLISH", () => {
  const d = decideShadowOutcome({ stages: stages(), gate: cleanGate(), earlyReasons: [] });
  assert.equal(d.outcome, "HUMAN_REVIEW_REQUIRED");
  assert.match(d.explanation, /single clean check is not corroboration/);
});

test("WOULD_PUBLISH requires every check to have run and passed", () => {
  const d = decideShadowOutcome({ stages: stages(), gate: cleanGate(), review: review(), earlyReasons: [] });
  assert.equal(d.outcome, "WOULD_PUBLISH");
  assert.equal(d.reachedGate, true);
  assert.equal(d.terminalStage, "final_decision");
  assert.match(d.explanation, /Nothing was published/);
});

// ---------------------------------------------------------------------------
// Invariants
// ---------------------------------------------------------------------------

test("every candidate yields exactly one record, and never both an outcome and a failure", () => {
  const cases = [
    decideShadowOutcome({ stages: stages({ evidence: "error" }), earlyReasons: [] }),
    decideShadowOutcome({ stages: stages({ relevance: "fail_closed" }), earlyReasons: [] }),
    decideShadowOutcome({ stages: stages(), gate: cleanGate(), review: review(), earlyReasons: [] }),
    decideShadowOutcome({ stages: stages(), gate: blockedGate(), review: review(), earlyReasons: [] }),
  ];
  for (const d of cases) {
    assert.equal(d.kind === "failure", d.outcome === null, "kind and outcome must agree, always");
    assert.ok(d.explanation.length > 0, "a decision with no stated reason is not a decision");
  }
});

test("reasons from the gate and the reviewer are both carried into the record", () => {
  const d = decideShadowOutcome({
    stages: stages(),
    gate: blockedGate(),
    review: review({
      findings: [{ code: "single_source", severity: "caution", category: "independence", message: "one source", detail: [] }],
      severityCounts: { blocker: 0, serious: 0, caution: 1, note: 0 },
      verdict: "revise",
    }),
    earlyReasons: [{ code: "no_demand_signal", stage: "opportunity", severity: "caution", message: "unknown demand", detail: [] }],
  });
  const codes = d.reasons.map((r) => r.code);
  assert.ok(codes.includes("missing_hero_media"));
  assert.ok(codes.includes("single_source"));
  assert.ok(codes.includes("no_demand_signal"));
});

test("SHADOW may not publish", () => {
  assert.equal(SHADOW_MAY_PUBLISH, false);
});

// ---------------------------------------------------------------------------
// Tally
// ---------------------------------------------------------------------------

test("the tally keeps decisions and failures apart", () => {
  const tally = tallyShadowRun([
    decideShadowOutcome({ stages: stages(), gate: cleanGate(), review: review(), earlyReasons: [] }),
    decideShadowOutcome({ stages: stages(), gate: blockedGate(), review: review(), earlyReasons: [] }),
    decideShadowOutcome({ stages: stages({ relevance: "fail_closed" }), earlyReasons: [] }),
    decideShadowOutcome({ stages: stages({ brief: "error" }), earlyReasons: [] }),
  ]);
  assert.equal(tally.candidates, 4);
  assert.equal(tally.decisions, 3);
  assert.equal(tally.failures, 1);
  assert.equal(tally.decisions + tally.failures, tally.candidates, "no candidate is counted twice or lost");
  assert.equal(tally.outcomes.WOULD_PUBLISH, 1);
  assert.equal(tally.outcomes.WOULD_REJECT, 2);
  assert.equal(tally.reachedGate, 2);
});
