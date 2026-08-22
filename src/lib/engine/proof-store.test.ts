import { test } from "node:test";
import assert from "node:assert/strict";
import { loadProofRecords } from "./proof-store.ts";
import { evaluateAllProofs, PROOF_KINDS } from "./proofs.ts";

test("the checked-in records load and parse", () => {
  const records = loadProofRecords();
  assert.ok(Array.isArray(records));
  for (const r of records) {
    assert.ok(PROOF_KINDS.includes(r.kind), r.kind);
    assert.ok(r.method.length > 10, `${r.kind} has no method`);
    assert.ok(r.observed.length > 10, `${r.kind} has no observation`);
  }
});

test("exactly two proofs are held, and both are PRODUCTION evidence", () => {
  // The honest state as of 2026-08-22. The test exists to make any change to it
  // deliberate: adding a proof means updating this assertion in the same commit,
  // where a reviewer sees both halves together. That is the whole control.
  //
  // Both were obtained against the production database, which is what their kinds
  // require — a lease is only real where the lock actually lives.
  const { statuses, provenCount, blockingKinds } = evaluateAllProofs(loadProofRecords());
  const proven = statuses.filter((s) => s.state === "PROVEN").map((s) => s.kind).sort();
  assert.deepEqual(proven, ["concurrency_test", "duplicate_scheduler_test"], `proven: ${proven.join(", ")}`);
  assert.equal(provenCount, 2);
  assert.equal(blockingKinds.length, PROOF_KINDS.length - 2);

  for (const kind of proven) {
    assert.equal(statuses.find((s) => s.kind === kind)!.level, "production_proven", kind);
  }
});

test("rollback is reported as UNBUILT, not merely untested", () => {
  // The distinction matters on the dashboard: "NOT PROVEN" invites the reading
  // that a rollback path exists and is awaiting a test. It does not exist.
  const s = evaluateAllProofs(loadProofRecords()).statuses.find((x) => x.kind === "rollback_test")!;
  assert.equal(s.state, "NOT_IMPLEMENTED");
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
