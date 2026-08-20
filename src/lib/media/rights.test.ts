import { test } from "node:test";
import assert from "node:assert/strict";
import { evaluatePublishEligibility } from "./rights.ts";

test("restricted always blocks, even if owned", () => {
  const result = evaluatePublishEligibility({ rights_status: "restricted", owned: true });
  assert.equal(result.allowed, false);
});

test("verified is sufficient on its own", () => {
  assert.equal(evaluatePublishEligibility({ rights_status: "verified" }).allowed, true);
});

test("owned is sufficient even with unknown rights_status", () => {
  assert.equal(evaluatePublishEligibility({ rights_status: "unknown", owned: true }).allowed, true);
});

test("staff_photograph source is sufficient even with unknown rights_status", () => {
  assert.equal(
    evaluatePublishEligibility({ rights_status: "unknown", source_type: "staff_photograph" }).allowed,
    true
  );
});

test("manufacturer source alone (not owned, not verified) is blocked", () => {
  assert.equal(evaluatePublishEligibility({ rights_status: "unknown", source_type: "manufacturer" }).allowed, false);
});

test("stock_licensed source alone is blocked", () => {
  assert.equal(
    evaluatePublishEligibility({ rights_status: "pending_verification", source_type: "stock_licensed" }).allowed,
    false
  );
});

test("missing rights_status defaults to unknown (blocked without owned/verified/staff)", () => {
  assert.equal(evaluatePublishEligibility({}).allowed, false);
});

test("pending_verification without owned/verified/staff is blocked", () => {
  assert.equal(evaluatePublishEligibility({ rights_status: "pending_verification" }).allowed, false);
});
