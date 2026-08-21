import { test } from "node:test";
import assert from "node:assert/strict";
import { computeConfidence, isPublishableAsFact } from "./confidence.ts";

test("no evidence yields zero confidence, never a default guess", () => {
  const r = computeConfidence([]);
  assert.equal(r.confidence, 0);
  assert.equal(r.effectiveClaimStatus, "unverified");
});

test("twenty secondary repetitions cannot reach primary-grade confidence", () => {
  const many = Array.from({ length: 20 }, () => ({
    claim_status: "reported_secondary" as const,
    trust_level: "secondary" as const,
    originates_from_url: null,
  }));
  const r = computeConfidence(many);
  // Ceiling for reported_secondary is 0.75 — volume must not exceed it.
  assert.ok(r.confidence <= 0.75, `expected <= 0.75, got ${r.confidence}`);
  assert.equal(isPublishableAsFact(r), false);
});

test("a rumour stays low confidence no matter how many outlets repeat it", () => {
  const many = Array.from({ length: 15 }, () => ({
    claim_status: "rumour" as const,
    trust_level: "secondary" as const,
    originates_from_url: null,
  }));
  const r = computeConfidence(many);
  assert.ok(r.confidence <= 0.3, `expected <= 0.3, got ${r.confidence}`);
  assert.equal(isPublishableAsFact(r), false);
});

test("circular reporting is excluded from corroboration", () => {
  const circular = [
    { claim_status: "leak" as const, trust_level: "secondary" as const, originates_from_url: null },
    // Nine outlets all repeating the same original leak.
    ...Array.from({ length: 9 }, () => ({
      claim_status: "leak" as const,
      trust_level: "secondary" as const,
      originates_from_url: "https://original-leak.example/post",
    })),
  ];
  const r = computeConfidence(circular);
  assert.equal(r.independentSources, 1);
  assert.equal(r.derivativeSources, 9);
  // One independent source means no corroboration bonus at all.
  assert.ok(r.explanation.includes("No independent corroboration"));
});

test("a single primary source outranks many secondary ones", () => {
  const primary = computeConfidence([
    { claim_status: "confirmed_primary", trust_level: "primary", originates_from_url: null },
  ]);
  const secondaries = computeConfidence(
    Array.from({ length: 10 }, () => ({
      claim_status: "reported_secondary" as const,
      trust_level: "secondary" as const,
      originates_from_url: null,
    }))
  );
  assert.ok(
    primary.confidence > secondaries.confidence,
    `primary ${primary.confidence} should beat ${secondaries.confidence}`
  );
  assert.equal(isPublishableAsFact(primary), true);
});

test("independent corroboration raises confidence, but only within the ceiling", () => {
  const one = computeConfidence([
    { claim_status: "reported_secondary", trust_level: "secondary", originates_from_url: null },
  ]);
  const three = computeConfidence([
    { claim_status: "reported_secondary", trust_level: "secondary", originates_from_url: null },
    { claim_status: "reported_secondary", trust_level: "secondary", originates_from_url: null },
    { claim_status: "reported_secondary", trust_level: "secondary", originates_from_url: null },
  ]);
  assert.ok(three.confidence > one.confidence);
  assert.ok(three.confidence <= 0.75);
});

test("isPublishableAsFact requires a genuine primary confirmation", () => {
  const leaked = computeConfidence([
    { claim_status: "leak", trust_level: "primary", originates_from_url: null },
  ]);
  assert.equal(isPublishableAsFact(leaked), false);
});
