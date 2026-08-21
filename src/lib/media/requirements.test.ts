import { test } from "node:test";
import assert from "node:assert/strict";
import { evaluateMediaReadiness } from "./requirements.ts";

test("no hero asset at all is never ready", () => {
  assert.equal(evaluateMediaReadiness({ heroAsset: null }).ready, false);
});

test("hero asset with unverified rights is not ready, even if a requirement exists and is approved", () => {
  const result = evaluateMediaReadiness({
    heroAsset: { rights_status: "unknown" },
    requirement: { sourcing_status: "approved" },
  });
  assert.equal(result.ready, false);
});

test("hero asset owned and verified, no requirement row at all, is ready", () => {
  assert.equal(
    evaluateMediaReadiness({ heroAsset: { rights_status: "verified" }, requirement: null }).ready,
    true
  );
});

test("hero asset eligible but requirement still 'sourcing' blocks readiness", () => {
  const result = evaluateMediaReadiness({
    heroAsset: { owned: true },
    requirement: { sourcing_status: "sourcing" },
  });
  assert.equal(result.ready, false);
});

test("hero asset eligible and requirement 'approved' is ready", () => {
  const result = evaluateMediaReadiness({
    heroAsset: { owned: true },
    requirement: { sourcing_status: "approved" },
  });
  assert.equal(result.ready, true);
});

test("restricted hero asset blocks readiness regardless of requirement status", () => {
  const result = evaluateMediaReadiness({
    heroAsset: { rights_status: "restricted", owned: true },
    requirement: { sourcing_status: "approved" },
  });
  assert.equal(result.ready, false);
});
