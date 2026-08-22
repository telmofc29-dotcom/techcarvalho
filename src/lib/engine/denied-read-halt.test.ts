import { test } from "node:test";
import assert from "node:assert/strict";
import { concludeQueueRead, controlRead, filteredQueue, NO_LIVENESS, rpcQueue } from "./queue-read.ts";
import {
  assessEngineHealth,
  breakerInputsFromRuns,
  healthFindingsBreakerInput,
  HALTING_HEALTH_FINDING_KINDS,
  type JobRunRecord,
} from "./health.ts";
import { ALL_CAPABILITIES, evaluateBreakers, haltReason, isHalted } from "./circuit-breaker.ts";
import { capabilityOf, ENGINE_JOBS } from "./concurrency.ts";
import { detectSilentSuccess, silentSuccessBreakerInput } from "./silent-success.ts";
import { probeCoreValidators } from "./validators.ts";

// THE READ-SIDE BLOCKER, END TO END.
//
// data/engine/proof-records.ts records database_failure_test as passed:false for
// one reason: the WRITE side fails closed completely, and the READ side does
// not. A silently-denied input QUEUE READ wrote `status: success, examined: 0`,
// byte-identical to a genuinely empty queue. With history, health.ts raised a
// CRITICAL zero_processing_anomaly and NOTHING halted, because no HealthFinding
// of any severity mapped to any breaker. With no history at all it was
// completely invisible — which is exactly how the 2026-08 grants incident
// survived weeks.
//
// This file executes the whole chain on the real modules:
//
//   concludeQueueRead()            queue-read.ts     — the row the job records
//     -> assessEngineHealth()      health.ts         — the finding
//     -> breakerInputsFromRuns()   health.ts         — the bridge that was missing
//     -> evaluateBreakers()        circuit-breaker.ts— the verdict
//     -> capabilityOf/haltReason   concurrency.ts    — the refusal
//
// The last link — guard.gateFor() and the tick route's `if (!gate.allow)` — is
// unreachable from node --test because both files begin `import "server-only"`.
// The composition below is the same one guard.ts performs, in the same order,
// and is quoted in src/lib/engine/chaos/propagation.ts for the same reason.

const NOW = new Date("2026-08-22T05:30:00.000Z");

function jobRun(p: Partial<JobRunRecord> & { jobName: string; hoursAgo: number }): JobRunRecord {
  const startedAt = new Date(NOW.getTime() - p.hoursAgo * 3_600_000).toISOString();
  return {
    jobName: p.jobName,
    status: p.status ?? "success",
    startedAt,
    finishedAt: startedAt,
    itemsExamined: p.itemsExamined ?? 0,
    itemsCreated: p.itemsCreated ?? 0,
    itemsDeduped: p.itemsDeduped ?? 0,
    itemsFailed: p.itemsFailed ?? 0,
    hasError: p.hasError ?? false,
  };
}

/**
 * The engine_job_runs row a job writes after `concludeQueueRead` has spoken.
 *
 * Mirrors the call every wired job now makes, e.g. link-job.ts:
 *
 *     const outcome = await concludeEmptyQueue(supabase, {...});
 *     await recordJobRun(supabase, JOB, outcome.status, counters, outcome.detail,
 *                        outcome.error ?? undefined);
 *
 * `counters` is untouched on this path, so every counter is zero — which is what
 * makes the row's SHAPE the signal.
 */
function rowFromEmptyQueue(args: {
  jobName: string;
  hoursAgo: number;
  source: string;
  rowsReturned: number;
  liveness?: ReturnType<typeof controlRead> | typeof NO_LIVENESS;
}): JobRunRecord {
  const outcome = concludeQueueRead({
    stage: args.jobName,
    facts: rpcQueue({
      source: args.source,
      errored: false,
      rowsReturned: args.rowsReturned,
      eligible: 0,
      liveness: args.liveness ?? NO_LIVENESS,
    }),
  });
  return jobRun({
    jobName: args.jobName,
    hoursAgo: args.hoursAgo,
    status: outcome.status,
    hasError: outcome.error !== null,
  });
}

/** guard.ts's composition, minus the `server-only` wrapper. */
function guardWould(runs: readonly JobRunRecord[]) {
  const health = assessEngineHealth(runs, { now: NOW });
  const fromRuns = breakerInputsFromRuns(runs, { now: NOW });
  const silentSuccess = detectSilentSuccess(runs, { telemetryAvailable: true });
  const breakers = evaluateBreakers({
    ...fromRuns,
    validators: probeCoreValidators(),
    silentSuccess: silentSuccessBreakerInput(silentSuccess, runs.length),
  });
  return { health, breakers, silentSuccess };
}

/** guard.gateFor's breaker branch, verbatim in structure. */
function gateFor(breakers: ReturnType<typeof guardWould>["breakers"], jobName: string) {
  const capability = capabilityOf(jobName);
  if (!capability) return { allow: false, why: "not in ENGINE_JOBS" };
  const why = haltReason(breakers, capability);
  return why ? { allow: false, why } : { allow: true, why: "no open breaker names this capability" };
}

/** Ten nights of a healthy nightly tick, so the control is not the fixture. */
function healthyHistory(): JobRunRecord[] {
  const stages = [
    { jobName: "engine_discover", examined: 22, created: 3 },
    { jobName: "engine_relevance", examined: 9, created: 4 },
    { jobName: "engine_briefs", examined: 4, created: 1 },
  ];
  return Array.from({ length: 10 }, (_, d) =>
    stages.map((s) =>
      jobRun({
        jobName: s.jobName,
        hoursAgo: (d + 1) * 24,
        itemsExamined: s.examined,
        itemsCreated: s.created,
      })
    )
  ).flat();
}

// ---------------------------------------------------------------------------
// 1. The control
// ---------------------------------------------------------------------------

test("CONTROL: ten nights of healthy ticks leave every capability runnable", () => {
  const view = guardWould(healthyHistory());
  assert.equal(view.breakers.healthy, true, view.breakers.summary);
  for (const c of ALL_CAPABILITIES) assert.equal(isHalted(view.breakers, c), false);
});

// ---------------------------------------------------------------------------
// 2. DENIED FROM BIRTH — the case that used to be completely invisible
// ---------------------------------------------------------------------------

test("A STAGE DENIED FROM BIRTH is detected on its FIRST run and halts creation", () => {
  // No history whatsoever. The proof record's exact wording for why this failed:
  // "never_effective requires examined>0 and zero_processing_anomaly requires
  // medianExamined>=1, so a stage denied FROM BIRTH is completely invisible."
  //
  // Both of those are still true. What changed is upstream of them: the job no
  // longer writes `status: success` for a read it cannot show it was permitted
  // to make, so the row itself is different and needs no baseline to read.
  const denied = rowFromEmptyQueue({
    jobName: "engine_draft_assembly",
    hoursAgo: 1,
    source: "engine_assemblable_briefs",
    rowsReturned: 0,
  });
  assert.equal(denied.status, "failed", "the row a denied read produces is no longer a success");

  const view = guardWould([denied]);

  const finding = view.health.critical.find((f) => f.kind === "input_unproven");
  assert.ok(finding, "input_unproven needs no history and must fire on the first run");
  assert.equal(finding.job, "engine_draft_assembly");
  assert.equal(finding.observed.priorRuns, 0, "explicitly: ZERO prior runs");

  const hf = view.breakers.open.find((v) => v.name === "health_findings");
  assert.ok(hf, "the finding must reach a breaker");
  assert.equal(hf.observed.haltingKinds, "input_unproven");

  assert.equal(isHalted(view.breakers, "creation"), true);
  assert.equal(isHalted(view.breakers, "media_acquisition"), true);
  assert.equal(isHalted(view.breakers, "publication"), true);
  assert.equal(gateFor(view.breakers, "engine_briefs").allow, false);
  assert.equal(gateFor(view.breakers, "engine_product_assembly").allow, false);

  // Measurement deliberately continues. Halting everything would remove the
  // means of diagnosing the fault, and re-running an idempotent assessor changes
  // nothing.
  assert.equal(isHalted(view.breakers, "classification"), false);
  assert.equal(isHalted(view.breakers, "maintenance"), false);
  assert.equal(gateFor(view.breakers, "engine_relevance").allow, true);
});

test("...and the SAME stage on a genuinely empty queue, corroborated, halts NOTHING", () => {
  // The other half, and the half that makes the first one meaningful. Without
  // this the "fix" would just be a breaker that is always open, which is not
  // fail-closed but broken — and it would halt creation every night that no
  // editor had approved a brief, which is most nights.
  const empty = rowFromEmptyQueue({
    jobName: "engine_draft_assembly",
    hoursAgo: 1,
    source: "engine_assemblable_briefs",
    rowsReturned: 0,
    liveness: controlRead("engine_reference_data", 40),
  });
  assert.equal(empty.status, "success", "a corroborated empty queue is a success, and is earned");

  // engine_briefs is excluded from the history here on purpose, and the reason
  // is a SEPARATE pre-existing defect worth naming: silent-success.ts detector
  // #6 (`downstream_starved`) does not consult the CONSUMER's declared role.
  // STAGE_EFFECTS declares engine_draft_assembly an assessor precisely because
  // it "consumes only HUMAN-APPROVED briefs, so it is legitimately idle whenever
  // nobody has approved one. Judging it as a producer would flag the editor's
  // inbox as an engine fault." Detector #5 honours that; detector #6 does not,
  // so ten nights of briefs with an empty approval queue still fires a CRITICAL
  // starvation signal and halts creation. Not fixed here — it is a different
  // defect in a file another workstream owns — but it is why this fixture is
  // shaped this way rather than being a convenience.
  const history = healthyHistory().filter((r) => r.jobName !== "engine_briefs");
  const view = guardWould([...history, empty]);
  assert.equal(view.breakers.healthy, true, view.breakers.summary);
  assert.equal(gateFor(view.breakers, "engine_product_assembly").allow, true);
});

test("the two rows are DIFFERENT rows — that is the whole point", () => {
  const denied = rowFromEmptyQueue({
    jobName: "engine_draft_assembly", hoursAgo: 1,
    source: "engine_assemblable_briefs", rowsReturned: 0,
  });
  const empty = rowFromEmptyQueue({
    jobName: "engine_draft_assembly", hoursAgo: 1,
    source: "engine_assemblable_briefs", rowsReturned: 0,
    liveness: controlRead("engine_reference_data", 40),
  });
  // Before this change both of these were `status: success, examined: 0,
  // created: 0, deduped: 0, failed: 0, has_error: false`. Identical bytes.
  assert.notDeepEqual(denied, empty);
  assert.notEqual(denied.status, empty.status);
  assert.notEqual(denied.hasError, empty.hasError);
});

// ---------------------------------------------------------------------------
// 3. WITH HISTORY — the case that was detected and halted nothing
// ---------------------------------------------------------------------------

test("a critical zero_processing_anomaly now reaches a breaker instead of a jsonb blob", () => {
  // The proof record: "health.ts raises a CRITICAL zero_processing_anomaly
  // (medianExamined:22) but breakers.healthy stays TRUE and every job is still
  // allowed — no HealthFinding of any severity maps to any breaker."
  //
  // This fixture keeps the OLD job behaviour on purpose (status success, zero
  // examined) so it measures the breaker bridge and not the job change.
  const view = guardWould([
    ...healthyHistory(),
    jobRun({ jobName: "engine_discover", hoursAgo: 0.5, status: "success", itemsExamined: 0 }),
  ]);

  const anomaly = view.health.critical.find((f) => f.kind === "zero_processing_anomaly");
  assert.ok(anomaly);
  assert.equal(anomaly.observed.medianExamined, 22);

  assert.equal(view.breakers.healthy, false);
  assert.equal(isHalted(view.breakers, "creation"), true);
  assert.equal(gateFor(view.breakers, "engine_briefs").allow, false);
  assert.match(gateFor(view.breakers, "engine_briefs").why, /health_findings/);
});

// ---------------------------------------------------------------------------
// 4. THE HALTING SET IS A SUBSET, AND THAT IS DELIBERATE
// ---------------------------------------------------------------------------

test("stale/stuck/repeated-failure findings do NOT open this breaker — they would latch it forever", () => {
  // A breaker that halts stages, keyed on findings that mean stages are not
  // running, guarantees its own input: halted stages record no rows, missing
  // rows become staleness, staleness re-opens the breaker. health.ts's own
  // standard: "a breaker that opens permanently on a false signal is not
  // fail-closed. It is broken."
  //
  // Each of these already has its own breaker built for it.
  const stale = healthyHistory().filter((r) => r.jobName !== "engine_discover");
  const view = guardWould(stale.concat([
    // Three consecutive failures WITH work attempted — repeated_failures fires,
    // input_unproven does not, because items were examined.
    jobRun({ jobName: "engine_trends", hoursAgo: 24, status: "failed", itemsExamined: 5, itemsFailed: 5, hasError: true }),
    jobRun({ jobName: "engine_trends", hoursAgo: 48, status: "failed", itemsExamined: 5, itemsFailed: 5, hasError: true }),
    jobRun({ jobName: "engine_trends", hoursAgo: 72, status: "failed", itemsExamined: 5, itemsFailed: 5, hasError: true }),
  ]));

  assert.ok(view.health.critical.some((f) => f.kind === "repeated_failures"));
  const hf = view.breakers.verdicts.find((v) => v.name === "health_findings");
  assert.equal(hf?.state, "closed", "repeated_failures must not open THIS breaker");
  assert.equal(hf.observed.haltingFindings, 0);
  // ...and it explains that other critical findings existed and were routed
  // elsewhere, rather than silently reporting nothing.
  assert.ok((hf.observed.criticalFindings as number) > 0);
  assert.match(hf.why, /have their own breakers/);
});

test("the halting set is exactly three kinds, and each names a stage lying about itself", () => {
  assert.deepEqual([...HALTING_HEALTH_FINDING_KINDS].sort(), [
    "input_unproven",
    "success_no_effect",
    "zero_processing_anomaly",
  ]);
});

// ---------------------------------------------------------------------------
// 5. The breaker's own absence behaviour
// ---------------------------------------------------------------------------

test("absent health telemetry closes health_findings — because silent_success already fails closed on it", () => {
  // FAIL_CLOSED.health_findings is false, and this is the justification, asserted
  // rather than trusted: the absence this breaker would have to cover is already
  // covered by one that halts the IDENTICAL capability set.
  const report = evaluateBreakers({});
  const hf = report.verdicts.find((v) => v.name === "health_findings");
  const ss = report.verdicts.find((v) => v.name === "silent_success");

  assert.equal(hf?.state, "closed");
  assert.equal(hf.basis, "no_data");
  assert.equal(ss?.state, "open", "the same absence must already be halting something");
  assert.deepEqual([...hf.halts], []);
  // The set health_findings WOULD have halted, halted by silent_success anyway.
  for (const c of ["creation", "media_acquisition", "publication"] as const) {
    assert.equal(isHalted(report, c), true, `${c} must still be halted with no telemetry at all`);
  }
});

test("healthFindingsBreakerInput reports zero halting findings for a clean report", () => {
  const input = healthFindingsBreakerInput(assessEngineHealth(healthyHistory(), { now: NOW }));
  assert.equal(input.haltingFindings, 0);
  assert.deepEqual([...input.haltingKinds], []);
  assert.ok(input.jobsAssessed > 0, "a clean verdict must rest on jobs actually assessed");
});

// ---------------------------------------------------------------------------
// 6. Every wired stage resolves to a capability, so a halt can reach it
// ---------------------------------------------------------------------------

test("every stage that now builds an InputProbe is registered, so a halt can actually refuse it", () => {
  // A verdict that names a capability nothing carries is a halt that stops
  // nothing — the vacuous-truth trap circuit-breaker-chaos.test.ts already names
  // for `publication`. These are the stages wired in this change.
  const wired = [
    "engine_discover",
    "engine_relevance",
    "engine_update_proposals",
    "engine_product_assembly",
    "engine_briefs",
    "engine_draft_assembly",
    "engine_opportunities",
    "engine_media_acquisition",
    "engine_freshness",
    "engine_internal_links",
    "engine_hero_media",
    "engine_shadow",
  ];
  for (const job of wired) {
    assert.ok(capabilityOf(job), `${job} must be in ENGINE_JOBS or no breaker can ever refuse it`);
  }
  assert.ok(ENGINE_JOBS.length >= wired.length);
});

// ---------------------------------------------------------------------------
// 7. Same-read filtering, through the whole chain
// ---------------------------------------------------------------------------

test("link-job's shape: entities returned rows, none published -> success, no halt", () => {
  const outcome = concludeQueueRead({
    stage: "engine_internal_links",
    reason: "no_published_content",
    facts: filteredQueue({ source: "engine_existing_entities", errored: false, rowsReturned: 81, eligible: 0 }),
  });
  assert.equal(outcome.status, "success");
  const view = guardWould([
    ...healthyHistory(),
    jobRun({ jobName: "engine_internal_links", hoursAgo: 0.5, status: outcome.status }),
  ]);
  assert.equal(view.breakers.healthy, true, view.breakers.summary);
});

test("link-job's shape when the entities read is denied: zero rows out, halted", () => {
  const outcome = concludeQueueRead({
    stage: "engine_internal_links",
    reason: "no_published_content",
    facts: filteredQueue({ source: "engine_existing_entities", errored: false, rowsReturned: 0, eligible: 0 }),
  });
  assert.equal(outcome.status, "failed");
  const view = guardWould([
    ...healthyHistory(),
    jobRun({ jobName: "engine_internal_links", hoursAgo: 0.5, status: outcome.status, hasError: true }),
  ]);
  assert.equal(isHalted(view.breakers, "creation"), true);
});
