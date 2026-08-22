import { test } from "node:test";
import assert from "node:assert/strict";
import { STAGE_JOB_NAMES } from "./stages.ts";
import { ENGINE_JOBS, capabilityOf } from "./concurrency.ts";

// The regression these tests exist for
// ------------------------------------
// The shadow stage recorded under "engine_shadow", the tick mapped it to
// "engine_shadow_evaluation", and ENGINE_JOBS contained neither. capabilityOf()
// returned null, so guard.ts skipped BOTH the circuit-breaker check and the
// concurrency-lease check for that stage — it ran even when a breaker had
// halted every capability. Nothing failed; nothing looked wrong.
//
// gateFor() now refuses any job it cannot map, which turns that silent bypass
// into a loud refusal. That fix has a sharp edge: a stage whose job name is not
// registered will now be REFUSED in production. These tests are what stops that
// edge cutting — a missing registration fails here first.

test("every tick stage maps to a job registered in ENGINE_JOBS", () => {
  const unmapped: string[] = [];
  for (const [stage, job] of Object.entries(STAGE_JOB_NAMES)) {
    if (!capabilityOf(job)) unmapped.push(`${stage} -> ${job}`);
  }
  assert.deepEqual(
    unmapped,
    [],
    "gateFor() refuses jobs it cannot map, so an unregistered stage would be halted in production. " +
      "Add it to ENGINE_JOBS in src/lib/engine/concurrency.ts."
  );
});

test("every stage's job name is distinct — two stages cannot share one audit row", () => {
  const jobs = Object.values(STAGE_JOB_NAMES);
  assert.equal(new Set(jobs).size, jobs.length, `duplicate job names: ${jobs.join(", ")}`);
});

test("the shadow stage specifically is gated, and as classification", () => {
  // Pinned by name because this is the one that was actually broken, and
  // because the capability choice is a judgement worth defending in a test:
  // filing shadow evaluation under `creation` would make measurement consume
  // the daily creation budget and starve the real creation stages.
  assert.equal(STAGE_JOB_NAMES.shadow_evaluation, "engine_shadow");
  assert.equal(capabilityOf("engine_shadow"), "classification");
  assert.equal(capabilityOf("engine_shadow_evaluation"), null, "the old, wrong name maps to nothing");
});

test("no registered job claims the publication capability", () => {
  // Nothing in this engine publishes, and the capability exists so a breaker can
  // name it. If a job ever appears here, that is a structural change to the
  // publication boundary and must not arrive quietly.
  const publishers = ENGINE_JOBS.filter((j) => j.capability === "publication").map((j) => j.job);
  assert.deepEqual(publishers, [], `a job now claims the publication capability: ${publishers.join(", ")}`);
});
