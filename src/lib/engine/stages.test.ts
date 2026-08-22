import { test } from "node:test";
import assert from "node:assert/strict";
import { STAGE_JOB_NAMES, ENGINE_STAGE_NAMES } from "./stages.ts";
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

// ---------------------------------------------------------------------------
// The invariant, stated once: no stage capable of work escapes the controls
// ---------------------------------------------------------------------------

test("the stage list and the job map are the same set — neither can drift", () => {
  // STAGE_JOB_NAMES is typed Record<EngineStageName, string>, so a MISSING
  // stage fails to compile. This asserts the other direction: no orphan entry
  // in the map that no stage actually uses, which would be a job name nothing
  // records under and a gate nothing consults.
  assert.deepEqual(
    Object.keys(STAGE_JOB_NAMES).sort(),
    [...ENGINE_STAGE_NAMES].sort(),
    "the stage names and the mapped names must be exactly the same set"
  );
});

test("EVERY stage passes through EVERY required safety control", () => {
  // The invariant the shadow bypass violated. Stated as a list rather than
  // prose, so a new control has to be added here to be considered required —
  // and a stage that cannot satisfy one shows up by name.
  //
  // The controls a stage must be subject to, in the order guard.gateFor()
  // applies them:
  //   1. capability mapping     — without it, 2 and 3 are skipped entirely
  //   2. circuit breakers       — keyed by capability
  //   3. the concurrency lease  — halts are keyed by capability
  //   4. the creation budget    — keyed by job name
  const unprotected: string[] = [];
  for (const stage of ENGINE_STAGE_NAMES) {
    const job = STAGE_JOB_NAMES[stage];
    const capability = capabilityOf(job);
    if (!capability) unprotected.push(`${stage} -> ${job}: no capability, so breakers and lease do not apply`);
  }
  assert.deepEqual(unprotected, [], "every stage must be reachable by every control");
});

test("SHADOW runs the same safety machinery as an eventual autonomous pass", () => {
  // The point of SHADOW is that it is the real pipeline with the final mutation
  // removed. If it were gated more loosely than the stages it stands in for,
  // its evidence would be evidence about a DIFFERENT system — and that evidence
  // is what would eventually be used to argue for turning autonomy on.
  //
  // engine_shadow is `classification`, the same capability as engine_relevance,
  // engine_trends and engine_opportunities. So every breaker that halts those
  // halts shadow too, by construction rather than by a separate rule.
  const shadowJob = STAGE_JOB_NAMES.shadow_evaluation;
  const shadowCapability = capabilityOf(shadowJob);
  assert.equal(shadowCapability, "classification");

  const peers = ENGINE_JOBS.filter((j) => j.capability === shadowCapability).map((j) => j.job);
  assert.ok(peers.includes(shadowJob), "shadow is gated alongside the other classification stages");
  assert.ok(peers.length > 1, "and it is not alone in its capability, so it cannot be special-cased");

  // The ONE difference, asserted rather than assumed: shadow does not carry the
  // publication capability, and neither does anything else — nothing in this
  // engine publishes.
  assert.notEqual(shadowCapability, "publication");
});

test("a stage cannot be registered under a capability that publishes", () => {
  // Belt and braces on the boundary: if a future stage claimed `publication`,
  // it would be gated (good) but it would also mean something in the engine
  // publishes (not good). This is the assertion that notices.
  for (const stage of ENGINE_STAGE_NAMES) {
    assert.notEqual(
      capabilityOf(STAGE_JOB_NAMES[stage]),
      "publication",
      `${stage} claims the publication capability`
    );
  }
});
