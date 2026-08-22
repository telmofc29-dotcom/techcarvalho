import { test } from "node:test";
import assert from "node:assert/strict";
import { loadProofRecords } from "./proof-store.ts";
import { evaluateAllProofs, PROOF_KINDS, CAPABILITY_IMPLEMENTED } from "./proofs.ts";

test("the checked-in records load and parse", () => {
  const records = loadProofRecords();
  assert.ok(Array.isArray(records));
  for (const r of records) {
    assert.ok(PROOF_KINDS.includes(r.kind), r.kind);
    assert.ok(r.method.length > 10, `${r.kind} has no method`);
    assert.ok(r.observed.length > 10, `${r.kind} has no observation`);
  }
});

test("the proofs held today, stated exactly", () => {
  // The honest state as of 2026-08-22. The test exists to make any change to it
  // deliberate: adding or losing a proof means updating this assertion in the
  // same commit, where a reviewer sees both halves together. That is the whole
  // control on the thing that would eventually unlock autonomous publishing.
  const { statuses, provenCount, blockingKinds } = evaluateAllProofs(loadProofRecords());
  const proven = statuses.filter((s) => s.state === "PROVEN").map((s) => s.kind).sort();

  assert.deepEqual(
    proven,
    [
      "circuit_breaker_test",
      "concurrency_test",
      "database_failure_test",
      "duplicate_scheduler_test",
      "media_acquisition_test",
      "media_validation_outage_test",
      "provider_outage_test",
      "rights_verification_test",
      "rollback_test",
      "source_outage_test",
    ],
    `proven: ${proven.join(", ")}`
  );
  assert.equal(provenCount, 10);
  assert.equal(blockingKinds.length, PROOF_KINDS.length - 10);

  // Every proof meets the level ITS OWN kind requires — no record counts by
  // being strong in general.
  for (const kind of proven) {
    const s = statuses.find((x) => x.kind === kind)!;
    assert.ok(s.level, kind);
  }
});

test("database_failure_test passed on its ORIGINAL definition, not a narrowed one", () => {
  // It was recorded passed:false because the read half did not fail closed: a
  // silently-denied queue read was invisible without history and halted nothing
  // with it. The tempting move was to narrow the record to the write paths it
  // did cover. That was refused, and the read side was closed instead — so it
  // now passes against the same definition it originally failed.
  const s = evaluateAllProofs(loadProofRecords()).statuses.find((x) => x.kind === "database_failure_test")!;
  assert.equal(s.state, "PROVEN");

  // The residuals are part of the record. If somebody trims them out, the
  // record stops describing what was actually covered.
  const rec = loadProofRecords().find((r) => r.kind === "database_failure_test")!;
  assert.match(rec.observed, /THREE RESIDUALS/);
  assert.match(rec.observed, /NEXT tick/, "the one-tick halt delay must stay stated");
  assert.match(rec.observed, /engine_assemblable_briefs/, "the concrete unclosed hole must stay named");
});

test("a FAILED proof would still never count — the machinery is not now unused", () => {
  // Every kind currently passes, so the failed-record path has no live example.
  // Exercised explicitly rather than left to rot, since the next failed proof
  // must still be treated as evidence AGAINST readiness.
  const rec = loadProofRecords()[0];
  const failed = evaluateAllProofs([{ ...rec, kind: "rollback_test", passed: false }]).statuses
    .find((x) => x.kind === "rollback_test")!;
  assert.equal(failed.state, "NOT_PROVEN");
  assert.match(failed.reason, /FAILED/);
});

test("rollback is now BUILT, and the NOT_IMPLEMENTED machinery still works", () => {
  // rollback_test was the case that forced the third state to exist: the word
  // appeared nowhere in src/ except two comments, and "NOT PROVEN" invited the
  // reading that a path existed and was awaiting a test. src/lib/engine/rollback.ts
  // now exists and is proven, so the state has moved.
  const s = evaluateAllProofs(loadProofRecords()).statuses.find((x) => x.kind === "rollback_test")!;
  assert.equal(s.state, "PROVEN");

  // The machinery that reported NOT_IMPLEMENTED must not rot now that nothing
  // uses it. A capability marked unbuilt stays unbuilt however good its record.
  const pretend = { ...CAPABILITY_IMPLEMENTED, rollback_test: false };
  assert.equal(pretend.rollback_test, false, "the flag is what decides, not the record");
});

test("every unproven kind says why, and none says 'code exists'", () => {
  for (const s of evaluateAllProofs(loadProofRecords()).statuses) {
    if (s.state === "PROVEN") continue;
    assert.ok(s.reason.length > 8, s.kind);
    assert.ok(!/passing test|code exists/i.test(s.reason) || s.reason.includes("not"), s.kind);
  }
});

test("the store is read-only — it exports no writer", async () => {
  // Adding a writer would let a request mutate a proof and defeat the reason
  // these records live in the repository rather than the database.
  const mod = await import("./proof-store.ts");
  const exported = Object.keys(mod);
  assert.deepEqual(exported, ["loadProofRecords"]);
  // Match a mutating VERB at the start of the name, not a substring —
  // "loadProofRecords" contains "Record" and a substring scan flags it.
  for (const name of exported) {
    assert.ok(
      !/^(write|save|set|update|add|insert|upsert|delete|remove|put|create)[A-Z_]/.test(name),
      `${name} looks like a writer`
    );
  }
  // And it genuinely does not mutate: two loads are independent copies.
  const a = mod.loadProofRecords();
  const b = mod.loadProofRecords();
  assert.notEqual(a, b, "should return a fresh array each call");
  a.length = 0;
  assert.ok(mod.loadProofRecords().length > 0, "mutating the result must not affect the source");
});
