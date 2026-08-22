import { test } from "node:test";
import assert from "node:assert/strict";
import {
  evaluateProof, evaluateAllProofs, REQUIRED_LEVEL, PROOF_KINDS, PROOF_TTL_DAYS,
  type ProofRecord,
} from "./proofs.ts";

const NOW = new Date("2026-08-22T12:00:00Z");
const daysAgo = (n: number) => new Date(NOW.getTime() - n * 86_400_000).toISOString();

const rec = (o: Partial<ProofRecord>): ProofRecord => ({
  kind: "rollback_test",
  level: "chaos_proven",
  observedAt: daysAgo(1),
  commit: "abc1234",
  method: "Induced the failure and observed the response.",
  observed: "The system halted and published nothing.",
  passed: true,
  ...o,
});

test("nothing is proven by default", () => {
  const { provenCount, blockingKinds } = evaluateAllProofs([], NOW);
  assert.equal(provenCount, 0);
  assert.equal(blockingKinds.length, PROOF_KINDS.length);
});

test("a passing unit test NEVER proves a failure-mode capability", () => {
  // The whole point. Every chaos-level proof must reject unit_tested evidence.
  for (const kind of PROOF_KINDS) {
    if (REQUIRED_LEVEL[kind] === "unit_tested" || REQUIRED_LEVEL[kind] === "code_exists") continue;
    const s = evaluateProof(kind, [rec({ kind, level: "unit_tested" })], NOW);
    assert.equal(s.state, "NOT_PROVEN", `${kind} accepted a unit test as proof`);
    assert.ok(s.reason.includes(REQUIRED_LEVEL[kind]), kind);
  }
});

test("code merely existing is never evidence", () => {
  for (const kind of PROOF_KINDS) {
    const s = evaluateProof(kind, [rec({ kind, level: "code_exists" })], NOW);
    assert.equal(s.state, "NOT_PROVEN", kind);
  }
});

test("a chaos-proven record satisfies a chaos requirement", () => {
  const s = evaluateProof("rollback_test", [rec({ kind: "rollback_test", level: "chaos_proven" })], NOW);
  assert.equal(s.state, "PROVEN");
  assert.ok(s.reason.includes("halted"), "the reason should carry what was OBSERVED");
});

test("concurrency and duplicate-scheduler need PRODUCTION evidence", () => {
  for (const kind of ["concurrency_test", "duplicate_scheduler_test"] as const) {
    assert.equal(REQUIRED_LEVEL[kind], "production_proven");
    // Chaos in a safe environment is not enough — the lock lives in the DB.
    assert.equal(evaluateProof(kind, [rec({ kind, level: "chaos_proven" })], NOW).state, "NOT_PROVEN");
    assert.equal(evaluateProof(kind, [rec({ kind, level: "production_proven" })], NOW).state, "PROVEN");
  }
});

test("a FAILED run counts against readiness, never toward it", () => {
  const s = evaluateProof("rollback_test", [rec({ passed: false })], NOW);
  assert.equal(s.state, "NOT_PROVEN");
  assert.ok(s.reason.includes("FAILED"));
  assert.ok(s.reason.includes("evidence against"));
});

test("an assertion without a recorded observation is not a proof", () => {
  for (const patch of [{ method: "" }, { observed: "" }, { method: "ok", observed: "ok" }]) {
    const s = evaluateProof("rollback_test", [rec(patch)], NOW);
    assert.equal(s.state, "NOT_PROVEN", JSON.stringify(patch));
    assert.ok(s.reason.includes("not a proof") || s.reason.includes("no method"));
  }
});

test("proofs expire — old evidence is about code that no longer exists", () => {
  assert.equal(evaluateProof("rollback_test", [rec({ observedAt: daysAgo(PROOF_TTL_DAYS - 1) })], NOW).state, "PROVEN");
  const stale = evaluateProof("rollback_test", [rec({ observedAt: daysAgo(PROOF_TTL_DAYS + 1) })], NOW);
  assert.equal(stale.state, "NOT_PROVEN");
  assert.ok(stale.reason.includes("changes daily"));
});

test("the strongest recent evidence wins, and weak records cannot dilute it", () => {
  const s = evaluateProof("rollback_test", [
    rec({ level: "unit_tested", observedAt: daysAgo(0) }),
    rec({ level: "chaos_proven", observedAt: daysAgo(2) }),
    rec({ level: "code_exists", observedAt: daysAgo(0) }),
  ], NOW);
  assert.equal(s.state, "PROVEN");
  assert.equal(s.level, "chaos_proven");
});

test("one proven kind does not imply any other", () => {
  const { provenCount, blockingKinds, statuses } = evaluateAllProofs(
    [rec({ kind: "concurrency_test", level: "production_proven" })], NOW
  );
  assert.equal(provenCount, 1);
  assert.equal(blockingKinds.length, PROOF_KINDS.length - 1);
  assert.equal(statuses.find((s) => s.kind === "concurrency_test")!.state, "PROVEN");
  assert.equal(statuses.find((s) => s.kind === "rollback_test")!.state, "NOT_PROVEN");
});

test("every failure-mode proof demands the failure be induced, not simulated in a unit test", () => {
  // Guards against someone quietly lowering a requirement to unlock sooner.
  for (const kind of [
    "rollback_test", "circuit_breaker_test", "source_outage_test",
    "database_failure_test", "media_validation_outage_test", "provider_outage_test",
  ] as const) {
    assert.equal(REQUIRED_LEVEL[kind], "chaos_proven", kind);
  }
});

test("every NOT_PROVEN status explains itself in actionable terms", () => {
  for (const s of evaluateAllProofs([], NOW).statuses) {
    assert.ok(s.reason.length > 8, s.kind);
  }
});
