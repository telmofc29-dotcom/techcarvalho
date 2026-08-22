import { test } from "node:test";
import assert from "node:assert/strict";
import {
  detectSilentSuccess,
  hardenReadiness,
  silentSuccessBreakerInput,
  silentSuccessGraduationBlockers,
  type SilentSuccessRun,
} from "./silent-success.ts";
import { assessEngineHealth, breakerInputsFromRuns, type JobRunRecord } from "./health.ts";
import { evaluateBreakers, isHalted } from "./circuit-breaker.ts";
import { STAGE_JOB_NAMES } from "./stages.ts";
import { probeCoreValidators } from "./validators.ts";

// KILL-SWITCH TELEMETRY, END TO END.
//
// THE BUG (audit S2). `isFlagEnabled` was `if (error) return false`. Failing
// closed is right. What followed was not: every stage recorded 'skipped' with
// reason "<flag>_disabled" — a reason that is simply untrue, because the flag was
// never read — and silent-success.ts FILTERS 'skipped' rows out of its analysis
// entirely. With every run skipped, `measured.length === 0`, so even the
// `detection_unavailable` guard could not fire, and the detector reported
// `clean: true`. One denied RPC therefore switched the whole engine off, labelled
// it a deliberate configuration choice, and produced a clean bill of health.
//
// `readFlag()` in cron.ts now returns `{ enabled, readable, reason }` and every
// job records 'failed' with "<flag>_flag_unreadable" instead. cron.ts and the
// jobs both begin `import "server-only"`, which throws outside Next.js, so this
// file tests the two ends that ARE reachable: the exact ROW every job now writes
// on that path, and everything downstream of it.
//
// The row shape is quoted from src/lib/engine/jobs/discovery.ts and is identical
// in all fourteen stages:
//
//     const status = discoveryFlag.readable ? "skipped" : "failed";
//     await recordJobRun(supabase, JOB, status, counters,
//                        { reason: discoveryFlag.reason }, discoveryFlag.error);
//
// `counters` is `newCounters()` — every counter zero — because this is the first
// thing the stage does.

const NOW = new Date("2026-08-22T05:30:00.000Z");

/** The row a stage writes when its flag read FAILED. `readFlag` -> readable:false. */
function flagUnreadableRow(jobName: string, hoursAgo: number): SilentSuccessRun {
  const startedAt = new Date(NOW.getTime() - hoursAgo * 3_600_000).toISOString();
  return {
    jobName,
    status: "failed",
    startedAt,
    finishedAt: startedAt,
    itemsExamined: 0,
    itemsCreated: 0,
    itemsDeduped: 0,
    itemsFailed: 0,
    // readFlag returns `error: error.message`, which the job passes to
    // recordJobRun, so engine_job_runs.error is non-null.
    hasError: true,
    silentNoOps: null,
    unverifiedWrites: null,
    blindWrites: null,
    verifiedWrites: null,
  };
}

/** The row a stage writes when its flag read SUCCEEDED and said off. */
function flagOffRow(jobName: string, hoursAgo: number): SilentSuccessRun {
  const startedAt = new Date(NOW.getTime() - hoursAgo * 3_600_000).toISOString();
  return {
    jobName,
    status: "skipped",
    startedAt,
    finishedAt: startedAt,
    itemsExamined: 0,
    itemsCreated: 0,
    itemsDeduped: 0,
    itemsFailed: 0,
    hasError: false,
    silentNoOps: null,
    unverifiedWrites: null,
    blindWrites: null,
    verifiedWrites: null,
  };
}

function healthyRun(jobName: string, hoursAgo: number): SilentSuccessRun {
  const startedAt = new Date(NOW.getTime() - hoursAgo * 3_600_000).toISOString();
  return {
    jobName,
    status: "success",
    startedAt,
    finishedAt: startedAt,
    itemsExamined: 22,
    itemsCreated: 3,
    itemsDeduped: 0,
    itemsFailed: 0,
    hasError: false,
    silentNoOps: 0,
    unverifiedWrites: 0,
    blindWrites: 0,
    verifiedWrites: 3,
  };
}

function guardWould(runs: readonly SilentSuccessRun[]) {
  const health = assessEngineHealth(runs as readonly JobRunRecord[], { now: NOW });
  const fromRuns = breakerInputsFromRuns(runs as readonly JobRunRecord[], { now: NOW });
  const silentSuccess = detectSilentSuccess(runs, { telemetryAvailable: true });
  const breakers = evaluateBreakers({
    ...fromRuns,
    validators: probeCoreValidators(),
    silentSuccess: silentSuccessBreakerInput(silentSuccess, runs.length),
  });
  return { health, breakers, silentSuccess };
}

const EVERY_STAGE = Object.values(STAGE_JOB_NAMES);

// ---------------------------------------------------------------------------
// (ii) A FLAG-UNREADABLE RUN IS VISIBLE TO THE DETECTORS
// ---------------------------------------------------------------------------

test("S2 REPRODUCED AND CLOSED: every stage unreadable is no longer a clean report", () => {
  // The literal S2 scenario: one denied engine_flag_enabled, fourteen stages,
  // one tick. Under the old code these were fourteen 'skipped' rows, the
  // detector filtered all fourteen out, `measured.length === 0` stopped the
  // detection_unavailable guard from firing too, and the answer was
  // `clean: true, "No SILENT_SUCCESS signals."`
  const runs = EVERY_STAGE.map((job, i) => flagUnreadableRow(job, 0.5 + i * 0.001));
  assert.ok(runs.length >= 14, "the whole stage list, not a sample");

  const view = guardWould(runs);

  // 1. The rows are MEASURED. They are 'failed', not 'skipped', so nothing
  //    filters them out of anything.
  assert.equal(view.silentSuccess.measuredRuns, runs.length);
  assert.equal(view.silentSuccess.skippedRuns, 0);
  assert.equal(view.silentSuccess.telemetryState, "measured_clean");

  // 2. health.ts names EVERY stage, with no history required.
  const unproven = view.health.critical.filter((f) => f.kind === "input_unproven");
  assert.equal(unproven.length, runs.length, "every stage that could not read its switch is named");
  for (const f of unproven) assert.equal(f.observed.hasError, true);

  // 3. It halts. This is the link that did not exist: a critical health finding
  //    reaching a breaker.
  assert.equal(isHalted(view.breakers, "creation"), true);
  assert.equal(isHalted(view.breakers, "media_acquisition"), true);
  assert.equal(isHalted(view.breakers, "publication"), true);
  const hf = view.breakers.open.find((v) => v.name === "health_findings");
  assert.ok(hf);
  assert.equal(hf.observed.haltingKinds, "input_unproven");
});

test("ONE unreadable flag on ONE stage is enough — no threshold to hide under", () => {
  const view = guardWould([
    ...Array.from({ length: 10 }, (_, d) => healthyRun("engine_discover", (d + 1) * 24)),
    flagUnreadableRow("engine_briefs", 0.5),
  ]);
  const f = view.health.critical.find((x) => x.kind === "input_unproven" && x.job === "engine_briefs");
  assert.ok(f, "a single stage that could not read its kill switch is a critical finding");
  assert.equal(isHalted(view.breakers, "creation"), true);
});

test("a flag-unreadable run is a MEASURED run, so it enters every baseline it should", () => {
  // The mirror of the S2 bug: 'skipped' rows are excluded from every baseline in
  // health.ts and every rule in silent-success.ts, deliberately and correctly. A
  // failed flag read must not inherit that exemption.
  const runs = [
    ...Array.from({ length: 6 }, (_, d) => healthyRun("engine_discover", (d + 1) * 24)),
    flagUnreadableRow("engine_discover", 0.5),
  ];
  const report = detectSilentSuccess(runs, { telemetryAvailable: true });
  assert.equal(report.measuredRuns, 7);
  assert.equal(report.skippedRuns, 0);
  assert.deepEqual(report.jobsWithOnlySkippedRuns, []);

  const health = assessEngineHealth(runs as readonly JobRunRecord[], { now: NOW });
  const job = health.jobs.find((j) => j.job === "engine_discover");
  // The latest run is the failed one, so the six healthy runs are its history.
  assert.equal(job?.medianExamined, 22, "the baseline is unaffected; the failed run is judged against it");
  assert.ok(health.critical.some((f) => f.kind === "input_unproven"));
});

// ---------------------------------------------------------------------------
// (i) AN INTENTIONAL SKIP CANNOT MAKE READINESS LOOK HEALTHIER THAN IT IS
// ---------------------------------------------------------------------------

test("an intentional skip does NOT halt anything — flags off is legitimate operation", () => {
  // The other half. If a deliberate skip halted the engine, operators could not
  // switch a capability off, and the alarm would be one they learn to ignore.
  const runs = EVERY_STAGE.map((job, i) => flagOffRow(job, 0.5 + i * 0.001));
  const view = guardWould(runs);
  assert.equal(view.health.critical.length, 0, "a deliberate skip is not a critical finding");
  const hf = view.breakers.verdicts.find((v) => v.name === "health_findings");
  assert.equal(hf?.state, "closed");
});

test("...but a window of nothing BUT skips is reported as UNKNOWN, never as health", () => {
  // This is the readiness half of S2. Every run skipped means every detector saw
  // nothing. The old report said `clean: true` and stopped there, which is the
  // same substitution — absence of evidence for evidence of absence — that the
  // whole module exists to refuse.
  const runs = EVERY_STAGE.map((job, i) => flagOffRow(job, 0.5 + i * 0.001));
  const report = detectSilentSuccess(runs, { telemetryAvailable: true });

  assert.equal(report.telemetryState, "zero_measured_runs");
  assert.equal(report.healthy, false, "a window of pure skips is not a healthy window");
  assert.equal(report.known, false);
  assert.equal(report.measuredRuns, 0);
  assert.equal(report.skippedRuns, runs.length);
  assert.match(report.summary, /NOTHING WAS MEASURED/);

  // And it is named per job, not just in aggregate.
  assert.deepEqual([...report.jobsWithOnlySkippedRuns].sort(), [...EVERY_STAGE].sort());
});

test("readiness is BLOCKED by a skipped window, with both reasons stated separately", () => {
  const runs = EVERY_STAGE.map((job, i) => flagOffRow(job, 0.5 + i * 0.001));
  const report = detectSilentSuccess(runs, { telemetryAvailable: true });
  const blockers = silentSuccessGraduationBlockers({
    report,
    silentNoOpsObserved: 0,
    blindWriteOperations: [],
  });

  const stateBlocker = blockers.find((b) => b.criterion === "SILENT_SUCCESS telemetry state");
  assert.ok(stateBlocker, "the window state must block");
  assert.match(stateBlocker.actual, /zero_measured_runs/);

  const jobsBlocker = blockers.find((b) =>
    b.criterion === "Jobs with no measured run in the readiness window"
  );
  assert.ok(jobsBlocker, "the jobs that contributed nothing must be named");
  assert.match(jobsBlocker.actual, /engine_discover/);

  const hardened = hardenReadiness(
    { autonomousUnlocked: true, highestJustifiedMode: "AUTONOMOUS", blockers: [] },
    { report, silentNoOpsObserved: 0, blindWriteOperations: [] }
  );
  assert.equal(hardened.autonomousUnlocked, false);
  assert.equal(hardened.highestJustifiedMode, "SHADOW");
});

test("a job skipped for the WHOLE window is named even when other jobs are healthy", () => {
  // The subtle version, and the realistic one: research is switched off for a
  // fortnight while discovery keeps running. Readiness computed over that window
  // has zero evidence about three creation stages and full evidence about the
  // rest, and the aggregate would look fine.
  const runs = [
    ...Array.from({ length: 10 }, (_, d) => healthyRun("engine_discover", (d + 1) * 24)),
    ...Array.from({ length: 10 }, (_, d) => flagOffRow("engine_draft_assembly", (d + 1) * 24 + 0.1)),
    ...Array.from({ length: 10 }, (_, d) => flagOffRow("engine_briefs", (d + 1) * 24 + 0.2)),
  ];
  const report = detectSilentSuccess(runs, { telemetryAvailable: true });

  // The window as a whole IS measured — engine_discover ran.
  assert.equal(report.telemetryState, "measured_clean");
  assert.ok(report.measuredRuns > 0);
  // ...and yet two jobs contributed nothing, and readiness says so.
  assert.deepEqual([...report.jobsWithOnlySkippedRuns].sort(), [
    "engine_briefs",
    "engine_draft_assembly",
  ]);
  const blockers = silentSuccessGraduationBlockers({
    report,
    silentNoOpsObserved: 0,
    blindWriteOperations: [],
  });
  const jobsBlocker = blockers.find((b) =>
    b.criterion === "Jobs with no measured run in the readiness window"
  );
  assert.ok(jobsBlocker, "an all-skipped job must block readiness even in an otherwise measured window");
  assert.match(jobsBlocker.actual, /engine_briefs/);
  assert.match(jobsBlocker.actual, /engine_draft_assembly/);

  // It is a WARNING, not a critical signal: a deliberate skip is not an
  // incident, and treating it as one would make the alarm meaningless. What it
  // must not do is count as evidence toward graduation, and it does not.
  const signal = report.signals.find((s) => s.job.includes("engine_briefs"));
  assert.equal(signal?.severity, "warning");
  assert.equal(report.clean, true);
  assert.equal(isHalted(guardWould(runs).breakers, "creation"), false);
});

// ---------------------------------------------------------------------------
// The two rows must never be confusable
// ---------------------------------------------------------------------------

test("'flag off' and 'flag unreadable' produce different rows, findings and verdicts", () => {
  const off = flagOffRow("engine_discover", 0.5);
  const unreadable = flagUnreadableRow("engine_discover", 0.5);

  // The row.
  assert.notEqual(off.status, unreadable.status);
  assert.notEqual(off.hasError, unreadable.hasError);

  // The finding.
  const offView = guardWould([off]);
  const unreadableView = guardWould([unreadable]);
  assert.equal(offView.health.critical.length, 0);
  assert.equal(unreadableView.health.critical.filter((f) => f.kind === "input_unproven").length, 1);

  // The verdict.
  assert.equal(isHalted(offView.breakers, "creation"), false);
  assert.equal(isHalted(unreadableView.breakers, "creation"), true);

  // And the detector's own state.
  assert.equal(detectSilentSuccess([off], { telemetryAvailable: true }).telemetryState, "zero_measured_runs");
  assert.equal(
    detectSilentSuccess([unreadable], { telemetryAvailable: true }).telemetryState,
    "measured_clean"
  );
});
