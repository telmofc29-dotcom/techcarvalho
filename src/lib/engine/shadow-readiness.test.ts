import { test } from "node:test";
import assert from "node:assert/strict";
import { assessShadowReadiness, type LedgerRow, type ShadowReadinessInput } from "./shadow-readiness.ts";
import { SHADOW_DIMENSIONS, MIN_DECISIONS_PER_DIMENSION } from "./shadow-composition.ts";
import { READINESS } from "./modes.ts";
import type { ProofRecord } from "./proofs.ts";

const noEscapes = () => ({
  wouldPublish: 0,
  fabricatedClaimEscapes: 0,
  unlicensedMediaEscapes: 0,
  bypassedHardBlockers: 0,
  duplicateLeakage: 0,
  humanReviewed: 100,
  humanDisagreed: 2,
});

const proofs = (): ProofRecord[] =>
  READINESS.requiredProofs.map((kind) => ({
    kind,
    level: kind === "concurrency_test" || kind === "duplicate_scheduler_test" ? "production_proven" : "chaos_proven",
    observedAt: new Date().toISOString(),
    commit: "abc1234",
    method: `Deliberately induced the ${kind} failure condition against a real subsystem.`,
    observed: "The system halted and published nothing, as required.",
    passed: true,
  }));

/** A ledger that satisfies every coverage floor with genuinely distinct rows. */
function fullLedger(): LedgerRow[] {
  const rows: LedgerRow[] = [];
  let n = 0;
  for (const dimension of SHADOW_DIMENSIONS) {
    for (let i = 0; i < MIN_DECISIONS_PER_DIMENSION + 25; i++) {
      rows.push({
        candidateIdentity: `discovery:c-${n}`,
        title: `Distinct subject ${n} examined in detail`,
        publisher: `Publisher ${n}`,
        decidedOn: `2026-0${(n % 9) + 1}-${String((n % 28) + 1).padStart(2, "0")}`,
        recordKind: "decision",
        outcome: "WOULD_REJECT",
        terminalStage: "final_decision",
        reachedGate: true,
        dimensions: [dimension],
      });
      n++;
    }
  }
  return rows;
}

const input = (over: Partial<ShadowReadinessInput> = {}): ShadowReadinessInput => ({
  ledger: fullLedger(),
  escapes: noEscapes(),
  proofRecords: proofs(),
  ledgerAvailable: true,
  ...over,
});

test("an empty ledger is 0/500 and stays in SHADOW", () => {
  const report = assessShadowReadiness(input({ ledger: [], escapes: { ...noEscapes(), humanReviewed: 0, humanDisagreed: 0 } }));
  assert.equal(report.evidence.shadowDecisions, 0);
  assert.equal(report.autonomousUnlocked, false);
  assert.equal(report.highestJustifiedMode, "SHADOW");
});

test("an unreadable ledger is the most pessimistic report, not a clean slate", () => {
  const report = assessShadowReadiness(
    input({ ledgerAvailable: false, ledgerUnavailableReason: "engine_shadow_ledger does not exist" })
  );
  assert.equal(report.autonomousUnlocked, false);
  assert.equal(report.evidence.shadowDecisions, 0, "an unreadable ledger must not report the rows it happens to hold");
  assert.ok(report.blockers.some((b) => b.criterion === "Shadow ledger readable"));
  assert.match(report.summary, /READINESS UNKNOWN/);
});

test("the number handed to modes.ts is the CREDITED count, not the row count", () => {
  const rows = fullLedger();
  const withDuplicates = [...rows, ...rows, ...rows];
  const report = assessShadowReadiness(input({ ledger: withDuplicates }));
  assert.equal(
    report.evidence.shadowDecisions,
    report.composition.creditedDecisions,
    "modes.ts must never see a number inflated by re-runs"
  );
  assert.ok(report.evidence.shadowDecisions < withDuplicates.length);
  assert.equal(report.refusedCredit.duplicates, rows.length * 2);
});

test("crashed candidates never reach the count", () => {
  const rows = fullLedger();
  const withCrashes: LedgerRow[] = [
    ...rows,
    ...Array.from({ length: 200 }, (_, i) => ({
      candidateIdentity: `discovery:crash-${i}`,
      title: `Crashed candidate ${i}`,
      publisher: `Publisher crash ${i}`,
      decidedOn: "2026-08-22",
      recordKind: "failure" as const,
      outcome: null,
      terminalStage: "evidence",
      reachedGate: false,
      dimensions: [],
    })),
  ];
  const clean = assessShadowReadiness(input({ ledger: rows }));
  const withFailures = assessShadowReadiness(input({ ledger: withCrashes }));
  assert.equal(withFailures.evidence.shadowDecisions, clean.evidence.shadowDecisions, "200 crashes add nothing");
  assert.equal(withFailures.refusedCredit.incomplete, 200);
});

test("composition is conjunctive: a clean escape record cannot outvote a missing dimension", () => {
  const rows = fullLedger().filter((r) => !r.dimensions.includes("regulatory_legal"));
  const report = assessShadowReadiness(input({ ledger: rows }));
  assert.equal(report.autonomousUnlocked, false);
  assert.ok(report.composition.gaps.includes("regulatory_legal"));
  assert.ok(report.blockers.some((b) => b.criterion.includes("regulatory_legal")));
});

test("an unmeasured human-disagreement rate is reported as maximal, not as zero", () => {
  const report = assessShadowReadiness(
    input({ escapes: { ...noEscapes(), humanReviewed: 0, humanDisagreed: 0 } })
  );
  assert.equal(report.evidence.humanDisagreementRate, 1, "no observations is not a passing score");
  assert.equal(report.autonomousUnlocked, false);
  assert.ok(report.blockers.some((b) => b.criterion === "Human disagreement rate"));
});

test("an unrun proof blocks, and no proof is inferred from silence", () => {
  const report = assessShadowReadiness(input({ proofRecords: [] }));
  assert.equal(report.autonomousUnlocked, false);
  assert.ok(report.blockers.some((b) => b.criterion.startsWith("Proof:")));
});

test("a single escape blocks, however large the set", () => {
  const report = assessShadowReadiness(
    input({ escapes: { ...noEscapes(), wouldPublish: 10, unlicensedMediaEscapes: 1 } })
  );
  assert.equal(report.autonomousUnlocked, false);
  assert.ok(report.blockers.some((b) => b.criterion === "Unlicensed-media escapes"));
});

test("with a genuinely adequate ledger and every proof, autonomy unlocks", () => {
  const report = assessShadowReadiness(input());
  assert.ok(
    report.evidence.shadowDecisions >= READINESS.minShadowDecisions,
    `only ${report.evidence.shadowDecisions} credited`
  );
  assert.equal(report.composition.adequate, true, report.composition.summary);
  assert.equal(report.modes.autonomousUnlocked, true, JSON.stringify(report.modes.blockers));
  assert.equal(report.autonomousUnlocked, true);
  assert.equal(report.highestJustifiedMode, "AUTONOMOUS");
});

test("this module can only ever remove justification, never add it", () => {
  const report = assessShadowReadiness(input());
  const spoiled = assessShadowReadiness(input({ ledger: fullLedger().slice(0, 10) }));
  assert.equal(report.autonomousUnlocked, true);
  assert.equal(spoiled.autonomousUnlocked, false);
  // The combined verdict is never stronger than modes.ts's own.
  for (const r of [report, spoiled]) {
    assert.ok(
      !r.autonomousUnlocked || r.modes.autonomousUnlocked,
      "the combined verdict must never unlock what modes.ts refused"
    );
  }
});
