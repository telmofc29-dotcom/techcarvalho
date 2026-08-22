import { test } from "node:test";
import assert from "node:assert/strict";
import {
  evaluateReadiness, resolveEffectiveMode, modeMayPublish, READINESS,
  type ReadinessEvidence,
} from "./modes.ts";

/** Evidence satisfying every criterion. Tests spoil one at a time. */
const ready = (): ReadinessEvidence => ({
  shadowDecisions: 500,
  distinctDays: 30,
  fabricatedClaimEscapes: 0,
  unlicensedMediaEscapes: 0,
  bypassedHardBlockers: 0,
  duplicateLeakageRate: 0,
  humanDisagreementRate: 0.05,
  passedProofs: [...READINESS.requiredProofs],
});

const nothing = (): ReadinessEvidence => ({
  shadowDecisions: 0, distinctDays: 0, fabricatedClaimEscapes: 0,
  unlicensedMediaEscapes: 0, bypassedHardBlockers: 0,
  duplicateLeakageRate: 0, humanDisagreementRate: 0, passedProofs: [],
});

test("AUTONOMOUS is locked by default, with no evidence", () => {
  const r = evaluateReadiness(nothing());
  assert.equal(r.autonomousUnlocked, false);
  assert.equal(r.highestJustifiedMode, "SHADOW");
  assert.ok(r.blockers.length > 0);
});

test("SHADOW publishes nothing; CANARY and AUTONOMOUS may", () => {
  assert.equal(modeMayPublish("OFF"), false);
  assert.equal(modeMayPublish("SHADOW"), false);
  assert.equal(modeMayPublish("CANARY"), true);
  assert.equal(modeMayPublish("AUTONOMOUS"), true);
});

test("full evidence unlocks AUTONOMOUS", () => {
  const r = evaluateReadiness(ready());
  assert.equal(r.autonomousUnlocked, true, JSON.stringify(r.blockers));
  assert.equal(r.highestJustifiedMode, "AUTONOMOUS");
});

test("ANY single escape re-locks it — these have no acceptable rate", () => {
  for (const key of ["fabricatedClaimEscapes", "unlicensedMediaEscapes", "bypassedHardBlockers"] as const) {
    const e = ready();
    e[key] = 1;
    const r = evaluateReadiness(e);
    assert.equal(r.autonomousUnlocked, false, `${key}=1 must lock`);
    assert.ok(r.blockers.some((b) => b.required === "0"), key);
  }
});

test("every missing proof is its own blocker", () => {
  for (const proof of READINESS.requiredProofs) {
    const e = ready();
    e.passedProofs = READINESS.requiredProofs.filter((p) => p !== proof);
    const r = evaluateReadiness(e);
    assert.equal(r.autonomousUnlocked, false, `missing ${proof} must lock`);
    assert.ok(r.blockers.some((b) => b.criterion.includes(proof)), proof);
  }
});

test("sample size and elapsed days are BOTH required", () => {
  const crammed = ready();
  crammed.distinctDays = 7;
  assert.equal(evaluateReadiness(crammed).autonomousUnlocked, false,
    "500 decisions crammed into a week is not 30 days of observation");

  const sparse = ready();
  sparse.shadowDecisions = 40;
  assert.equal(evaluateReadiness(sparse).autonomousUnlocked, false);
});

test("a high human-disagreement rate locks it even with zero errors", () => {
  const e = ready();
  e.humanDisagreementRate = 0.4;
  assert.equal(evaluateReadiness(e).autonomousUnlocked, false,
    "the engine can be error-free and still not share the publication's judgement");
});

test("blockers state what was required AND what was actual", () => {
  for (const b of evaluateReadiness(nothing()).blockers) {
    assert.ok(b.criterion.length > 3, JSON.stringify(b));
    assert.ok(b.required.length > 0, JSON.stringify(b));
    assert.ok(b.actual.length > 0, JSON.stringify(b));
  }
});

// ---------------------------------------------------------------------------
// Clamping — asking for a mode does not grant it
// ---------------------------------------------------------------------------

test("requesting AUTONOMOUS without evidence yields SHADOW, not AUTONOMOUS", () => {
  const eff = resolveEffectiveMode("AUTONOMOUS", evaluateReadiness(nothing()));
  assert.equal(eff.mode, "SHADOW");
  assert.equal(eff.clamped, true);
  assert.ok(eff.reason.includes("not justified"));
});

test("requesting CANARY without evidence also clamps down", () => {
  const eff = resolveEffectiveMode("CANARY", evaluateReadiness(nothing()));
  assert.equal(eff.mode, "SHADOW");
  assert.equal(eff.clamped, true);
});

test("CANARY unlocks on partial evidence, but only with zero escapes and key proofs", () => {
  const e = nothing();
  e.shadowDecisions = 100;
  e.passedProofs = ["rollback_test", "circuit_breaker_test"];
  const r = evaluateReadiness(e);
  assert.equal(r.highestJustifiedMode, "CANARY");
  assert.equal(r.autonomousUnlocked, false, "CANARY is not AUTONOMOUS");

  e.unlicensedMediaEscapes = 1;
  assert.equal(evaluateReadiness(e).highestJustifiedMode, "SHADOW", "one escape drops it back");
});

test("OFF is always honoured and never clamped upward", () => {
  const eff = resolveEffectiveMode("OFF", evaluateReadiness(ready()));
  assert.equal(eff.mode, "OFF");
  assert.equal(eff.clamped, false);
});

test("no input can unlock AUTONOMOUS while an escape exists", () => {
  // Assert the BEHAVIOUR, not the source text. (A source scan was tried first
  // and produced a false positive on `bypassedHardBlockers` — the field that
  // COUNTS bypasses, which is the opposite of a bypass path.)
  for (const key of ["fabricatedClaimEscapes", "unlicensedMediaEscapes", "bypassedHardBlockers"] as const) {
    for (const magnitude of [1, 5, 1000]) {
      const e = ready();
      e[key] = magnitude;
      e.shadowDecisions = 1_000_000;
      e.distinctDays = 3650;
      e.humanDisagreementRate = 0;
      e.duplicateLeakageRate = 0;
      const r = evaluateReadiness(e);
      assert.equal(r.autonomousUnlocked, false, `${key}=${magnitude} with perfect everything else must stay locked`);
      assert.notEqual(resolveEffectiveMode("AUTONOMOUS", r).mode, "AUTONOMOUS", `${key}=${magnitude}`);
    }
  }
  // The API takes evidence only — no options bag to smuggle a flag through.
  assert.equal(evaluateReadiness.length, 1);
});

test("the required sample size is defensible, not convenient", () => {
  // Guards against someone quietly lowering the bar to unlock sooner.
  assert.ok(READINESS.minShadowDecisions >= 500);
  assert.ok(READINESS.minDistinctDays >= 30);
  assert.equal(READINESS.maxFabricatedClaimEscapes, 0);
  assert.equal(READINESS.maxUnlicensedMediaEscapes, 0);
  assert.equal(READINESS.maxBypassedHardBlockers, 0);
  assert.ok(READINESS.requiredProofs.length >= 7);
});
