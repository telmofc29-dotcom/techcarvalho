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
  escapesAvailable: true,
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

test("a genuinely adequate ledger satisfies EVERY criterion except the unbuilt one", () => {
  // This asserted that a full ledger plus every proof unlocks AUTONOMOUS. It
  // cannot any more, and the reason is a finding rather than a regression:
  // rollback_test is required at chaos_proven, and no rollback, undo, revert or
  // compensating mechanism exists anywhere in src/. proofs.ts now answers
  // NOT_IMPLEMENTED for it, which never counts as proven and always blocks.
  //
  // The valuable half of the original assertion is kept: the ledger and
  // composition machinery genuinely do reach the bar, so nothing here is
  // failing for an accidental reason.
  const report = assessShadowReadiness(input());
  assert.ok(
    report.evidence.shadowDecisions >= READINESS.minShadowDecisions,
    `only ${report.evidence.shadowDecisions} credited`
  );
  assert.equal(report.composition.adequate, true, report.composition.summary);
  assert.equal(report.autonomousUnlocked, false);
  assert.deepEqual(
    report.blockers.map((b) => b.criterion),
    ["Proof: rollback_test"],
    "the ONLY thing standing between full evidence and AUTONOMOUS is an unbuilt capability"
  );
});

test("this module can only ever remove justification, never add it", () => {
  const report = assessShadowReadiness(input());
  const spoiled = assessShadowReadiness(input({ ledger: fullLedger().slice(0, 10) }));
  // Both are locked today (see the rollback note above), so the invariant is
  // checked against modes.ts's own verdict rather than against a hardcoded
  // expectation — which is what the property actually says.
  assert.ok(spoiled.blockers.length >= report.blockers.length, "a worse ledger cannot have fewer blockers");
  // The combined verdict is never stronger than modes.ts's own.
  for (const r of [report, spoiled]) {
    assert.ok(
      !r.autonomousUnlocked || r.modes.autonomousUnlocked,
      "the combined verdict must never unlock what modes.ts refused"
    );
  }
});

test("an UNREADABLE escape record blocks — it must never read as a spotless one", () => {
  // The bug this pins: scripts/run-shadow-evaluation.ts called
  // engine_shadow_escapes and discarded `.error`. Seven `?? 0` defaults then
  // reported zero fabricated-claim escapes, zero unlicensed-media escapes and
  // zero bypassed hard blockers — the three ZERO-TOLERANCE criteria — as though
  // they had been measured.
  //
  // Every other unknown in this module fails closed. This one failed OPEN, in
  // the direction of unlocking autonomy, which is the only direction where the
  // mistake is expensive.
  const report = assessShadowReadiness(
    input({ escapesAvailable: false, escapesUnavailableReason: "permission denied for function" })
  );
  assert.equal(report.autonomousUnlocked, false);
  assert.notEqual(report.highestJustifiedMode, "AUTONOMOUS");
  assert.notEqual(report.highestJustifiedMode, "CANARY");
  const blocker = report.blockers.find((b) => b.criterion === "Escape counts readable");
  assert.ok(blocker, `expected an escape-readability blocker: ${JSON.stringify(report.blockers)}`);
  assert.match(blocker!.actual, /NOT measurements/);
  assert.match(report.summary, /READINESS UNKNOWN/);
});

test("an unreadable escape record blocks even when the ledger is perfect", () => {
  // Otherwise a full, adequate ledger could carry the verdict past a
  // measurement that never happened.
  const perfect = assessShadowReadiness(input());
  const blind = assessShadowReadiness(input({ escapesAvailable: false }));
  assert.ok(
    blind.blockers.length > perfect.blockers.length,
    "losing the escape measurement must ADD a blocker, never leave the verdict unchanged"
  );
});
