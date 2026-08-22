// CHAOS PROOF: database_failure_test
//
// REQUIRED LEVEL: chaos_proven (proofs.ts REQUIRED_LEVEL).
//
// WHAT IS INDUCED
// ---------------
// A stage wired exactly the way src/lib/engine/jobs/discovery.ts is wired is run
// against a fake database that fails in five specific ways, each returning the
// literal bytes supabase-js returns for it. The two the proof turns on:
//
//   (A) THE LOUD FORM   — an explicit error (42501 permission denied,
//                         PGRST202 function-not-in-schema-cache, connection lost).
//   (B) THE SILENT FORM — no error at all. RLS denies by matching zero rows, so
//                         the call returns `{ data: [], error: null }` or
//                         `{ data: null, error: null }` and every `if (error)`
//                         check in the codebase passes. This is the form that
//                         has actually shipped in this repo three times and it is
//                         the centrepiece.
//
// WHAT IS OBSERVED
// ----------------
// Whether the system FAILS CLOSED: whether the induced failure ends up as
// anything other than `status: success`, whether it is named as a denial rather
// than as an empty result, and whether it eventually removes capabilities from
// the list the engine is allowed to act on.
//
// LAYER COVERED / NOT COVERED — read src/lib/engine/chaos/stage-under-fault.ts.
// The fourteen real job files cannot be imported (`import "server-only"`), so the
// twenty lines of glue each one writes by hand are replicated here. Everything
// the glue CALLS is the real module. A glue bug in a specific job file is
// therefore NOT covered by this proof.

import { test } from "node:test";
import assert from "node:assert/strict";
import { createChaosClient } from "./fault-injection.ts";
import { jobRunFrom, miswiredJobRun, runCarrierStage } from "./stage-under-fault.ts";
import { breakerGateFor, capabilitiesStillRunnable, describeHalt, evaluateAsGuardWould, jobsHalted } from "./propagation.ts";
import { CHAOS_NOW, HEALTHY_SOURCES, HEALTHY_VALIDATION, healthyHistory, minutesBeforeNow } from "./telemetry.ts";
import { observe } from "./evidence.ts";
import { ALL_CAPABILITIES } from "../circuit-breaker.ts";
import { ENGINE_JOBS } from "../concurrency.ts";
import { isEngineFault } from "../stage-outcome.ts";

const PROOF = "database_failure_test";

const QUEUE = "engine_due_work";
const WRITE = "engine_upsert_discovery";
const VOID_RPC = "engine_record_source_check";

const WORK = [
  { id: "11111111-1111-4111-8111-111111111111", subject: "Acme: RX-7 sensor module" },
  { id: "22222222-2222-4222-8222-222222222222", subject: "Acme: RX-7 firmware 2.1" },
  { id: "33333333-3333-4333-8333-333333333333", subject: "Beta Ltd: KX drive recall" },
];

function client() {
  return createChaosClient({ [QUEUE]: WORK, [WRITE]: "created", [VOID_RPC]: null });
}

function stage(c: ReturnType<typeof client>) {
  return runCarrierStage({
    client: c,
    stage: "discovery",
    queueRpc: QUEUE,
    writeRpc: WRITE,
    voidRpc: VOID_RPC,
    emptinessProof: "zero_rows_only",
    deniableUnderRls: true,
  });
}

// ---------------------------------------------------------------------------
// 0. THE CONTROL — the same stage, nothing broken
// ---------------------------------------------------------------------------

test("CONTROL: with the database healthy the carrier stage genuinely succeeds", async () => {
  const c = client();
  const r = await stage(c);

  assert.equal(r.status, "success");
  assert.equal(r.counters.created, 3);
  assert.equal(r.counters.failed, 0);
  assert.equal(r.postconditions.verified, 3);
  assert.equal(r.verdict.outcome, "WORK_SUCCEEDED");
  assert.equal(r.incident, null);

  observe(
    PROOF,
    "control (no fault induced)",
    `status=${r.status} examined=${r.counters.examined} created=${r.counters.created} failed=${r.counters.failed} ` +
      `verified=${r.postconditions.verified} verdict=${r.verdict.outcome} incident=none`
  );
});

// ---------------------------------------------------------------------------
// A. THE LOUD FORM — an explicit error
// ---------------------------------------------------------------------------

test("INDUCED: 42501 permission denied on every write — the run fails, and is named a denial", async () => {
  const c = client();
  c.breakRpc(WRITE, { kind: "permission_denied", operation: WRITE });
  const r = await stage(c);

  // Fail closed: not success, not partial, and every item counted as failed.
  assert.equal(r.status, "failed");
  assert.equal(r.counters.created, 0);
  assert.equal(r.counters.failed, 3);
  assert.equal(r.postconditions.errored, 3);
  assert.equal(r.verdict.outcome, "PERMISSION_FAILURE");
  assert.equal(r.incident?.severity, "critical");
  assert.equal(isEngineFault(r.verdict.outcome), true);

  observe(
    PROOF,
    "A1: explicit error, code 42501, on every write",
    `status=${r.status} created=0 failed=${r.counters.failed} errored=${r.postconditions.errored} ` +
      `verdict=${r.verdict.outcome} severity=${r.incident?.severity} ` +
      `firstError="${r.postconditions.errorDetails[0]?.slice(0, 120)}"`
  );
});

test("INDUCED: PGRST202 (a revoked grant makes the function invisible) reads as a denial, not as a code bug", async () => {
  const c = client();
  c.breakRpc(WRITE, { kind: "function_missing", operation: WRITE });
  const r = await stage(c);

  assert.equal(r.status, "failed");
  assert.equal(r.verdict.outcome, "PERMISSION_FAILURE");
  assert.equal(r.incident?.severity, "critical");

  observe(
    PROOF,
    "A2: PGRST202 function-not-in-schema-cache",
    `status=${r.status} failed=${r.counters.failed} verdict=${r.verdict.outcome} — filed as PERMISSION, not "unknown"`
  );
});

test("INDUCED: the queue read itself errors — the pass ends failed, never empty", async () => {
  const c = client();
  c.breakRpc(QUEUE, { kind: "permission_denied", operation: QUEUE });
  const r = await stage(c);

  assert.equal(r.status, "failed");
  assert.notEqual(r.queueErrored, null);
  assert.equal(r.verdict.outcome, "PERMISSION_FAILURE");
  // The crucial negative: a failed queue read must never be reported as a queue
  // that had nothing in it.
  assert.notEqual(r.verdict.outcome, "NOTHING_TO_DO");

  observe(
    PROOF,
    "A3: input queue RPC errors",
    `status=${r.status} examined=0 verdict=${r.verdict.outcome} queueError="${r.queueErrored}"`
  );
});

test("INDUCED: the connection dies mid-write — a thrown call becomes a recorded failure, not an abort", async () => {
  const c = client();
  c.breakRpc(WRITE, { kind: "connection_lost" });
  const r = await stage(c);

  // mutateAndVerify catches the throw so the pass records what happened rather
  // than dying and leaving no row at all.
  assert.equal(r.status, "failed");
  assert.equal(r.counters.failed, 3);
  assert.equal(r.postconditions.errored, 3);
  assert.match(r.postconditions.errorDetails[0], /fetch failed/);

  observe(
    PROOF,
    "A4: connection lost (thrown, not returned)",
    `status=${r.status} errored=${r.postconditions.errored} — the pass survived and recorded it: ` +
      `"${r.postconditions.errorDetails[0]?.slice(0, 110)}"`
  );
});

// ---------------------------------------------------------------------------
// B. THE SILENT FORM — no error whatsoever. THE CENTREPIECE.
// ---------------------------------------------------------------------------

test("INDUCED (CENTREPIECE): a write denied by RLS — zero rows, NO ERROR — does not report success", async () => {
  const c = client();
  // This is the byte-for-byte shape of an RLS denial on a statement that
  // returns rows: the statement ran, matched nothing, raised nothing.
  c.breakRpc(WRITE, { kind: "rls_silent_zero_rows" });
  const r = await stage(c);

  // Every `if (error)` in the codebase passes here. The postcondition layer is
  // the only thing standing between this and a green run.
  assert.equal(r.jobView, "failed", "the stage's own view, computed from counters");
  assert.equal(r.status, "failed");
  assert.equal(r.counters.created, 0);
  assert.equal(r.counters.failed, 3);
  assert.equal(r.postconditions.errored, 0, "there was no error — that is the whole problem");
  assert.equal(r.postconditions.unverifiable, 3);
  assert.equal(r.verdict.ambiguous, true);
  assert.equal(r.verdict.ambiguity, "mutation_unverifiable");
  assert.equal(r.incident?.severity, "critical");

  observe(
    PROOF,
    "B1: RLS silent denial on writes — data:[] error:null",
    `errored=0 (NO error was returned) unverifiable=${r.postconditions.unverifiable} ` +
      `counters.failed=${r.counters.failed} status=${r.status} verdict=${r.verdict.outcome}/${r.verdict.ambiguity} ` +
      `severity=${r.incident?.severity}`
  );
});

test("INDUCED (CENTREPIECE): a `returns void` write denied silently — data:null, error:null", async () => {
  const c = client();
  c.breakRpc(WRITE, { kind: "rls_silent_void" });
  const r = await stage(c);

  assert.equal(r.status, "failed");
  assert.equal(r.postconditions.errored, 0);
  assert.equal(r.postconditions.unverifiable, 3);
  assert.equal(r.counters.created, 0);
  // "I could not tell" is counted as a failure, never as a pass.
  assert.equal(r.counters.failed, 3);

  observe(
    PROOF,
    "B2: RLS silent denial, scalar form — data:null error:null",
    `errored=0 unverifiable=${r.postconditions.unverifiable} status=${r.status} — ` +
      `"could not confirm" is tallied as failed, not as deduped`
  );
});

test("INDUCED (CENTREPIECE): the incident-#2 shape — an honest 'rejected_invalid' nobody enumerated", async () => {
  const c = client();
  // The function ran fine and answered honestly. The caller named 'created' and
  // 'deduped' and nothing else, so this is a failure BY CONSTRUCTION rather than
  // by anyone remembering to handle it.
  c.breakRpc(WRITE, { kind: "rls_silent_rejected", status: "rejected_invalid" });
  const r = await stage(c);

  assert.equal(r.postconditions.errored, 0);
  assert.equal(r.postconditions.silentNoOps, 3);
  assert.equal(r.counters.deduped, 0, "a rejection must NOT be filed as a benign duplicate");
  assert.equal(r.counters.failed, 3);
  assert.equal(r.status, "failed");
  // With rlsDeniable declared and zero rows affected, stage-outcome.ts names the
  // most actionable cause rather than a generic no-op.
  assert.equal(r.verdict.outcome, "PERMISSION_FAILURE");
  assert.equal(r.incident?.severity, "critical");

  observe(
    PROOF,
    "B3: 'rejected_invalid' returned to a caller that enumerated only created|deduped",
    `silentNoOps=${r.postconditions.silentNoOps} deduped=${r.counters.deduped} failed=${r.counters.failed} ` +
      `status=${r.status} verdict=${r.verdict.outcome} — detail: "${r.postconditions.silentNoOpDetails[0]?.slice(0, 130)}"`
  );
});

test("INDUCED (CENTREPIECE): the QUEUE read denied silently — the one case that still reports success", async () => {
  const c = client();
  // Zero rows, no error, on the read that supplies work. Byte-identical to a
  // queue that is genuinely empty.
  c.breakRpc(QUEUE, { kind: "rls_silent_zero_rows" });

  const denied = await runCarrierStage({
    client: c,
    stage: "discovery",
    queueRpc: QUEUE,
    writeRpc: WRITE,
    emptinessProof: "zero_rows_only", // all the stage can honestly claim
    deniableUnderRls: true,
  });

  // ⚠️ THE LIVE GAP, OBSERVED RATHER THAN ASSERTED AWAY.
  // The status column CANNOT tell these apart: examined 0, nothing failed, no
  // error anywhere, therefore `success`. This is what discovery.ts writes today
  // when engine_due_sources is denied.
  assert.equal(denied.status, "success");
  assert.equal(denied.counters.examined, 0);

  // The ONLY module in the codebase that separates them is stage-outcome.ts,
  // via the emptiness proof — and it correctly refuses to call this benign.
  assert.equal(denied.verdict.outcome, "UNCLASSIFIED");
  assert.equal(denied.verdict.ambiguity, "emptiness_unproven");
  assert.equal(denied.incident?.severity, "critical");

  // THE CONTROL for the same bytes: a reader that can prove it was awake.
  const genuinelyEmpty = await runCarrierStage({
    client: c,
    stage: "discovery",
    queueRpc: QUEUE,
    writeRpc: WRITE,
    emptinessProof: "reader_alive",
    deniableUnderRls: true,
  });
  assert.equal(genuinelyEmpty.status, "success");
  assert.equal(genuinelyEmpty.verdict.outcome, "NOTHING_TO_DO");
  assert.equal(genuinelyEmpty.incident, null);

  observe(
    PROOF,
    "B4: input queue denied silently (zero rows, no error)",
    `engine_job_runs would record status=${denied.status} examined=0 — INDISTINGUISHABLE from an empty queue. ` +
      `classifyStageOutcome separates them: proof=zero_rows_only -> ${denied.verdict.outcome}/${denied.verdict.ambiguity} ` +
      `(critical), proof=reader_alive -> ${genuinelyEmpty.verdict.outcome} (no incident). ` +
      `classifyStageOutcome has ZERO production callers, so the engine does not currently make this distinction.`
  );
});

// ---------------------------------------------------------------------------
// C. DOES IT PROPAGATE? — the induced failure must remove capabilities
// ---------------------------------------------------------------------------

test("PROPAGATION: three induced database failures halt EVERY capability", async () => {
  const history = healthyHistory();

  // Control first: with only the healthy history, nothing is halted.
  const before = evaluateAsGuardWould({
    available: true,
    runs: history,
    sources: HEALTHY_SOURCES,
    validation: HEALTHY_VALIDATION,
    now: CHAOS_NOW,
  });
  assert.equal(before.breakers.healthy, true);
  assert.deepEqual(capabilitiesStillRunnable(before.breakers), [...ALL_CAPABILITIES]);

  // Now induce the outage and let the stage record what really happened.
  const failedRuns = [];
  for (let i = 0; i < 3; i++) {
    const c = client();
    c.breakAll({ kind: "permission_denied", operation: WRITE });
    const r = await stage(c);
    assert.equal(r.status, "failed");
    failedRuns.push(
      jobRunFrom({
        jobName: "engine_discover",
        startedAt: minutesBeforeNow(30 - i * 10),
        result: r,
        hasError: true,
      })
    );
  }

  const after = evaluateAsGuardWould({
    available: true,
    runs: [...history, ...failedRuns],
    sources: HEALTHY_SOURCES,
    validation: HEALTHY_VALIDATION,
    now: CHAOS_NOW,
  });

  const dbBreaker = after.breakers.verdicts.find((v) => v.name === "database_errors");
  assert.equal(dbBreaker?.state, "open");
  assert.equal(dbBreaker?.basis, "measured");
  assert.equal(dbBreaker?.observed.consecutiveFailedRuns, 3);

  // The whole point: the capability list the engine may act on is now EMPTY.
  assert.deepEqual(capabilitiesStillRunnable(after.breakers), []);
  assert.deepEqual([...after.breakers.halted].sort(), [...ALL_CAPABILITIES].sort());

  // And every audited job is turned away with a reason, not silently. The count
  // comes from ENGINE_JOBS rather than a literal so a newly registered stage
  // widens the assertion instead of breaking it.
  const refused = jobsHalted(after.breakers);
  assert.equal(refused.length, ENGINE_JOBS.length);
  assert.ok(ENGINE_JOBS.length >= 14, "sanity: the job registry is populated");
  for (const g of refused) {
    assert.equal(g.allow, false);
    assert.match(g.why, /Circuit breaker halted/);
    assert.ok(g.why.length > 80, "a refusal must carry an actionable reason");
  }

  observe(
    PROOF,
    "C: propagation of an induced database outage",
    `BEFORE: ${describeHalt(before.breakers)}. ` +
      `AFTER 3 induced 42501 runs: ${describeHalt(after.breakers)}. ` +
      `database_errors.observed=${JSON.stringify(dbBreaker?.observed)}`
  );
});

test("PROPAGATION: a SILENT failure a miswired job reported as success still halts creation", async () => {
  // The silent form only reaches the breaker if something notices. Induce the
  // full failure: the write is denied silently AND the job reports success
  // anyway — the glue bug six real job files once had.
  const c = client();
  c.breakRpc(WRITE, { kind: "rls_silent_rejected", status: "rejected_invalid" });
  const r = await stage(c);
  assert.equal(r.status, "failed", "correctly wired, the carrier already fails");
  assert.equal(r.writeCounts.silentNoOps, 3);

  const lying = miswiredJobRun(
    jobRunFrom({ jobName: "engine_discover", startedAt: minutesBeforeNow(20), result: r })
  );
  assert.equal(lying.status, "success", "the induced miswiring: green row, three silent no-ops behind it");

  const view = evaluateAsGuardWould({
    available: true,
    runs: [...healthyHistory(), lying],
    sources: HEALTHY_SOURCES,
    validation: HEALTHY_VALIDATION,
    now: CHAOS_NOW,
  });

  const overstated = view.silentSuccess.critical.find((s) => s.kind === "status_overstated");
  assert.ok(overstated, "the postcondition counters and the status column disagree, and it is caught");

  const breaker = view.breakers.verdicts.find((v) => v.name === "silent_success");
  assert.equal(breaker?.state, "open");

  const runnable = capabilitiesStillRunnable(view.breakers);
  assert.equal(runnable.includes("creation"), false);
  assert.equal(runnable.includes("media_acquisition"), false);
  assert.equal(runnable.includes("publication"), false);
  // Scoped, not a blanket: measuring is how the problem gets diagnosed.
  assert.equal(runnable.includes("classification"), true);
  assert.equal(runnable.includes("maintenance"), true);

  assert.equal(breakerGateFor(view.breakers, "engine_briefs").allow, false);
  assert.equal(breakerGateFor(view.breakers, "engine_relevance").allow, true);

  observe(
    PROOF,
    "C2: a green job row with silent no-ops behind it",
    `run recorded status=success silentNoOps=${lying.silentNoOps}; detector raised ` +
      `${view.silentSuccess.critical.length} critical signal(s) incl. status_overstated; ${describeHalt(view.breakers)}`
  );
});

// ---------------------------------------------------------------------------
// C3. HOW FAR THE READ-SIDE SILENT DENIAL GETS — measured, not assumed
// ---------------------------------------------------------------------------
//
// B4 established that a silently-denied QUEUE read still writes
// `status: success, examined: 0`. The question that decides whether this proof
// passes is what happens NEXT: does anything downstream catch it, and does
// anything halt? Both cases are measured rather than argued.

test("⚠️ FINDING: a silently-denied queue on a job with HISTORY is detected but halts nothing", () => {
  const c = client();
  c.breakRpc(QUEUE, { kind: "rls_silent_zero_rows" });

  // Ten nights where engine_discover examined 22 items, then one where its
  // queue is denied. The only visible difference is a zero.
  const denied = {
    jobName: "engine_discover",
    status: "success" as const,
    startedAt: minutesBeforeNow(30),
    finishedAt: minutesBeforeNow(29),
    itemsExamined: 0,
    itemsCreated: 0,
    itemsDeduped: 0,
    itemsFailed: 0,
    hasError: false,
    silentNoOps: 0,
    unverifiedWrites: 0,
    blindWrites: 0,
    verifiedWrites: 0,
  };

  const view = evaluateAsGuardWould({
    available: true,
    runs: [...healthyHistory(), denied],
    sources: HEALTHY_SOURCES,
    validation: HEALTHY_VALIDATION,
    now: CHAOS_NOW,
  });

  // GOOD: health.ts catches it, at CRITICAL severity, by comparing the job
  // against its own history.
  const anomaly = view.health.critical.find(
    (f) => f.kind === "zero_processing_anomaly" && f.job === "engine_discover"
  );
  assert.ok(anomaly, "assessEngineHealth names the job whose input dried up");
  assert.equal(anomaly.observed.medianExamined, 22);

  // ⚠️ BAD: the silent-success detector does NOT see it — both of its relevant
  // rules require examined > 0, and the denial is precisely why it is 0.
  assert.equal(view.silentSuccess.clean, true);

  // ⚠️ WORSE: NOTHING IS HALTED. A critical health finding is placed in
  // guard.detail() and never consulted by gateFor(), which reads only the
  // breakers, the lease and the budget ledger. The engine carries on creating.
  assert.equal(view.breakers.healthy, true);
  assert.deepEqual(capabilitiesStillRunnable(view.breakers), [...ALL_CAPABILITIES]);
  assert.equal(breakerGateFor(view.breakers, "engine_briefs").allow, true);

  observe(
    PROOF,
    "⚠️ FINDING: a critical health finding halts nothing",
    `queue denied silently on a job with 10 nights of history: health.ts raised CRITICAL ` +
      `zero_processing_anomaly (${JSON.stringify(anomaly.observed)}), silentSuccess.clean=${view.silentSuccess.clean}, ` +
      `breakers.healthy=${view.breakers.healthy}, ${describeHalt(view.breakers)}. ` +
      `No HealthFinding of any severity maps to a breaker, so health.ts cannot halt anything.`
  );
});

test("⚠️ FINDING: a silently-denied queue on a job with NO history is not detected at all", () => {
  // The worse case: the grant was never there. The job has always examined
  // zero, so there is no baseline for it to look wrong against — the exact way
  // the 2026-08 grants incident survived for weeks.
  const runs = healthyHistory()
    .filter((r) => r.jobName !== "engine_discover")
    .concat(
      Array.from({ length: 6 }, (_, d) => ({
        jobName: "engine_discover",
        status: "success" as const,
        startedAt: new Date(CHAOS_NOW.getTime() - d * 24 * 3_600_000 - 3_600_000).toISOString(),
        finishedAt: new Date(CHAOS_NOW.getTime() - d * 24 * 3_600_000 - 3_500_000).toISOString(),
        itemsExamined: 0,
        itemsCreated: 0,
        itemsDeduped: 0,
        itemsFailed: 0,
        hasError: false,
        silentNoOps: 0,
        unverifiedWrites: 0,
        blindWrites: 0,
        verifiedWrites: 0,
      }))
    );

  const view = evaluateAsGuardWould({
    available: true,
    runs,
    sources: HEALTHY_SOURCES,
    validation: HEALTHY_VALIDATION,
    now: CHAOS_NOW,
  });

  const discoverFindings = view.health.critical.filter((f) => f.job === "engine_discover");
  assert.deepEqual(discoverFindings, [], "nothing critical is said about a stage that has NEVER worked");
  assert.equal(view.silentSuccess.clean, true);
  assert.equal(view.breakers.healthy, true);
  assert.equal(breakerGateFor(view.breakers, "engine_discover").allow, true);

  observe(
    PROOF,
    "⚠️ FINDING: no history, no detection",
    `six nights of engine_discover with a permanently denied queue: 0 critical health findings for it, ` +
      `silentSuccess.clean=true, breakers.healthy=true, engine_discover still allowed to run. ` +
      `never_effective cannot fire (it requires examined > 0) and zero_processing_anomaly cannot fire ` +
      `(it requires a median examined >= 1). A stage denied from birth is invisible.`
  );
});

test("RECOVERY: healing the database closes the breaker again — the halt tracked the fault", async () => {
  const c = client();
  c.breakAll({ kind: "permission_denied", operation: WRITE });
  const broken = await stage(c);
  assert.equal(broken.status, "failed");

  c.heal();
  const healed = await stage(c);
  assert.equal(healed.status, "success");
  assert.equal(healed.counters.created, 3);

  const view = evaluateAsGuardWould({
    available: true,
    runs: [
      ...healthyHistory(),
      jobRunFrom({ jobName: "engine_discover", startedAt: minutesBeforeNow(40), result: broken, hasError: true }),
      jobRunFrom({ jobName: "engine_discover", startedAt: minutesBeforeNow(10), result: healed }),
    ],
    sources: HEALTHY_SOURCES,
    validation: HEALTHY_VALIDATION,
    now: CHAOS_NOW,
  });

  assert.equal(view.breakers.healthy, true);
  assert.deepEqual(capabilitiesStillRunnable(view.breakers), [...ALL_CAPABILITIES]);

  observe(
    PROOF,
    "D: recovery",
    `one induced failure followed by one healthy run: ${describeHalt(view.breakers)} — ` +
      `the halt is attributable to the fault rather than to the fixture`
  );
});
