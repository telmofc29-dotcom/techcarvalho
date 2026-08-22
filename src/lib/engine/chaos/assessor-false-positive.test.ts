// REGRESSION: a HEALTHY site once halted article creation, product creation and
// media acquisition — permanently. FIXED 2026-08-22.
//
// This file began as a characterisation of the defect: a chaos run that induced
// a completely benign condition and observed the safety layer stop the engine
// anyway. Writing it as executable assertions rather than prose is what made
// the fix verifiable — the moment detector #1 in silent-success.ts started
// reading StageRole, every assertion here inverted, which is exactly what a
// characterisation test is for.
//
// The assertions below now state the CORRECT behaviour. The observed values in
// the comments are the real ones from the failing run, kept so the defect stays
// legible. It is filed here because health.ts states the
// standard itself, in its own words:
//
//     "A breaker that opens permanently on a false signal is not fail-closed. It
//      is broken, and worse than absent, because it trains an operator to ignore
//      it."
//
// THE CONDITION INDUCED
// ---------------------
// Zero orphaned pages. That is the GOAL of engine_internal_links, and the job
// says so in its own comment.
//
// WHAT src/lib/engine/jobs/link-job.ts ACTUALLY WRITES IN THAT CASE
// -----------------------------------------------------------------
// Read from the file (it is server-only and cannot be executed here, so this is
// derived by reading it, and the lines are quoted so the derivation is checkable):
//
//     const orphans = findOrphans(published, linkedIds);
//     counters.examined = published.length;              // line 96 — ALL published pages
//     ...
//     for (const orphan of orphans) { ... log.rpc(...) } // zero iterations
//     ...
//     // Zero orphans is a success and the goal, not an empty result.
//     const jobView = counters.failed === 0 ? "success" : ...
//
// So with 29 published pages and no orphans the row is:
//
//     examined: 29, created: 0, deduped: 0, failed: 0, status: 'success'
//
// WHAT THE SAFETY LAYER DOES WITH THAT ROW
// ----------------------------------------
// `success_no_effect` in BOTH health.ts and silent-success.ts fires on
// (status success|partial) AND examined > 0 AND created+deduped+failed === 0.
// It is severity CRITICAL, it has no minimum sample and no rate, and one
// critical silent-success signal opens the `silent_success` breaker, which halts
// creation, media_acquisition and publication.
//
// WHY IT IS A DEFECT RATHER THAN A DEBATABLE CHOICE
// -------------------------------------------------
// silent-success.ts already models exactly the distinction that would fix it.
// `StageRole` exists, `engine_internal_links` is declared `role: "assessor"`,
// and the doc comment on StageRole says in as many words:
//
//     "`assessor` stages legitimately do nothing when the site is healthy (zero
//      orphans is the goal, not an empty result), so 'created nothing' is never
//      held against them."
//
// Detector #5 (`never_effective`) honours that. Detector #1
// (`success_no_effect`) never reads the role at all. The module's own stated
// rule is enforced in one of the two places it applies.
//
// The same row shape is produced by engine_hero_media (examines products, flags
// weak heroes, finds none) and engine_freshness (examines entities, upserts a
// review only for stale ones, finds none).
//
// THESE TESTS ASSERT THE OBSERVED, BUGGY BEHAVIOUR ON PURPOSE. They are
// characterisation tests: when the role check is added they will fail and point
// straight at this comment, which is the intended way to find out that it landed.

import { test } from "node:test";
import assert from "node:assert/strict";
import { breakerGateFor, capabilitiesStillRunnable, describeHalt, evaluateAsGuardWould } from "./propagation.ts";
import { CHAOS_NOW, HEALTHY_SOURCES, HEALTHY_VALIDATION, healthyHistory, minutesBeforeNow } from "./telemetry.ts";
import { observe } from "./evidence.ts";
import { assessEngineHealth } from "../health.ts";
import { detectSilentSuccess, stageEffectOf, type SilentSuccessRun } from "../silent-success.ts";

const PROOF = "circuit_breaker_test";

/**
 * The engine_job_runs row link-job.ts writes when the site has no orphans.
 * `orphans` is what the job found; everything else follows from its code.
 */
function internalLinksRun(opts: { published: number; orphansReported: number; startedAt: string }): SilentSuccessRun {
  return {
    jobName: "engine_internal_links",
    status: "success",
    startedAt: opts.startedAt,
    finishedAt: opts.startedAt,
    itemsExamined: opts.published, // counters.examined = published.length
    itemsCreated: opts.orphansReported,
    itemsDeduped: 0,
    itemsFailed: 0,
    hasError: false,
    silentNoOps: 0,
    unverifiedWrites: 0,
    blindWrites: 0,
    verifiedWrites: opts.orphansReported,
  };
}

test("the role distinction that would prevent this is already declared in the codebase", () => {
  // Not an inference — read it back out of the production module.
  assert.equal(stageEffectOf("engine_internal_links")?.role, "assessor");
  assert.equal(stageEffectOf("engine_hero_media")?.role, "assessor");
  assert.equal(stageEffectOf("engine_freshness")?.role, "assessor");
  assert.equal(stageEffectOf("engine_discover")?.role, "producer");

  observe(
    PROOF,
    "the fix is already modelled",
    `STAGE_EFFECTS declares engine_internal_links / engine_hero_media / engine_freshness as role="assessor"; ` +
      `detector #5 (never_effective) honours the role, detector #1 (success_no_effect) does not read it.`
  );
});

test("REGRESSION: a site with ZERO orphans raises NO silent-success signal", () => {
  const clean = internalLinksRun({ published: 29, orphansReported: 0, startedAt: minutesBeforeNow(30) });

  const report = detectSilentSuccess([clean], { telemetryAvailable: true });
  const signal = report.critical.find((s) => s.kind === "success_no_effect");
  assert.equal(signal, undefined, "an assessor with nothing to flag is the goal, not a silent success");

  // health.ts carried the identical defect, for the identical reason: the role
  // model lived inside silent-success.ts and health.ts could not import it
  // without a cycle. It now lives in stage-roles.ts and both read it.
  const health = assessEngineHealth([clean], { now: CHAOS_NOW });
  assert.equal(health.critical.some((f) => f.kind === "success_no_effect"), false);

  observe(
    PROOF,
    "FIXED: zero orphans no longer reads as a silent success",
    `row {examined:29, created:0, deduped:0, failed:0, status:'success'} -> ` +
      `silent-success CRITICAL success_no_effect AND health.ts CRITICAL success_no_effect. ` +
      `The signal text asserts "the write matched zero rows and returned no error" — no write was attempted.`
  );
});

test("REGRESSION: a healthy site halts nothing", () => {
  const runs = [
    ...healthyHistory(),
    internalLinksRun({ published: 29, orphansReported: 0, startedAt: minutesBeforeNow(30) }),
  ];

  const view = evaluateAsGuardWould({
    available: true,
    runs,
    sources: HEALTHY_SOURCES,
    validation: HEALTHY_VALIDATION,
    now: CHAOS_NOW,
  });

  const breaker = view.breakers.verdicts.find((v) => v.name === "silent_success");
  assert.equal(breaker?.state, "closed");
  assert.equal(breaker?.observed.criticalSignals, 0);

  const runnable = capabilitiesStillRunnable(view.breakers);
  assert.equal(runnable.includes("creation"), true);
  assert.equal(runnable.includes("media_acquisition"), true);

  for (const job of ["engine_briefs", "engine_draft_assembly", "engine_product_assembly", "engine_media_acquisition"]) {
    assert.equal(breakerGateFor(view.breakers, job).allow, true, `${job} must still run`);
  }

  observe(
    PROOF,
    "FIXED: a healthy site halts nothing",
    `one benign engine_internal_links row on an otherwise perfect 10-day history: ${describeHalt(view.breakers)}. ` +
      `Article creation, product creation and media acquisition all stop, and the stated reason is ` +
      `"at least one stage reported success while having no effect".`
  );
});

test("REGRESSION: five clean nights stay clean", () => {
  // The breaker's action text says "Do NOT clear the signals by re-running the
  // pass". It cannot be cleared by re-running here either, because the trigger
  // is the site being in good order. Five consecutive clean nights:
  const runs = [...healthyHistory()];
  for (let d = 0; d < 5; d++) {
    runs.push(
      internalLinksRun({
        published: 29,
        orphansReported: 0,
        startedAt: new Date(CHAOS_NOW.getTime() - d * 24 * 3_600_000 - 3_600_000).toISOString(),
      })
    );
  }

  const view = evaluateAsGuardWould({
    available: true,
    runs,
    sources: HEALTHY_SOURCES,
    validation: HEALTHY_VALIDATION,
    now: CHAOS_NOW,
  });

  assert.equal(view.breakers.verdicts.find((v) => v.name === "silent_success")?.state, "closed");
  assert.equal(capabilitiesStillRunnable(view.breakers).includes("creation"), true);

  observe(
    PROOF,
    "FIXED: five clean nights stay clean",
    `five consecutive clean nights of engine_internal_links keep silent_success OPEN; creation stays halted. ` +
      `Fixing the site is what causes the halt, and fixing the site again does not lift it.`
  );
});

test("CONTROL: the same job with one orphan to report is clean", () => {
  const runs = [
    ...healthyHistory(),
    internalLinksRun({ published: 29, orphansReported: 1, startedAt: minutesBeforeNow(30) }),
  ];

  const view = evaluateAsGuardWould({
    available: true,
    runs,
    sources: HEALTHY_SOURCES,
    validation: HEALTHY_VALIDATION,
    now: CHAOS_NOW,
  });

  assert.equal(view.breakers.healthy, true);
  assert.equal(view.silentSuccess.clean, true);
  assert.equal(capabilitiesStillRunnable(view.breakers).includes("creation"), true);

  observe(
    PROOF,
    "control: one orphan found",
    `the identical job with created=1 instead of created=0 -> ${describeHalt(view.breakers)}. ` +
      `The engine runs normally precisely when the site is in worse shape.`
  );
});

test("REGRESSION: every assessor stage is exempt, not just internal_links", () => {
  for (const jobName of ["engine_hero_media", "engine_freshness"]) {
    const run: SilentSuccessRun = {
      jobName,
      status: "success",
      startedAt: minutesBeforeNow(30),
      finishedAt: minutesBeforeNow(29),
      itemsExamined: 12,
      itemsCreated: 0,
      itemsDeduped: 0,
      itemsFailed: 0,
      hasError: false,
      silentNoOps: 0,
      unverifiedWrites: 0,
      blindWrites: 0,
      verifiedWrites: 0,
    };
    const report = detectSilentSuccess([run], { telemetryAvailable: true });
    assert.equal(
      report.critical.some((s) => s.kind === "success_no_effect" && s.job === jobName),
      false,
      `${jobName} examining 12 items and finding nothing to flag is its intended outcome`
    );
    assert.equal(stageEffectOf(jobName)?.role, "assessor");

    // And the exemption is not blanket: a DENIED write on the same assessor
    // still surfaces, through the postcondition telemetry rather than the
    // counters. That is what stops this fix hiding a real failure.
    const denied = detectSilentSuccess([{ ...run, silentNoOps: 2 }], { telemetryAvailable: true });
    assert.equal(
      denied.signals.some((s) => s.kind === "status_overstated" && s.job === jobName),
      true,
      `${jobName} with denied writes must still be reported`
    );
  }

  observe(
    PROOF,
    "FIXED: three assessor stages exempt, denial still caught",
    `engine_internal_links, engine_hero_media and engine_freshness all write (examined>0, created 0, ` +
      `deduped 0, failed 0, success) when they find nothing to flag, and all three are declared ` +
      `role="assessor". Any one of them opens the silent_success breaker.`
  );
});
