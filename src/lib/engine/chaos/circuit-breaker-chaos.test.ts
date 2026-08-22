// CHAOS PROOF: circuit_breaker_test
//
// REQUIRED LEVEL: chaos_proven (proofs.ts REQUIRED_LEVEL).
//
// THE CLAIM THAT HAS TO BE PROVED
// -------------------------------
// Not "a breaker reports state: open". That is a value in an object. The claim
// is that a real, induced failure removes a capability from the set the engine
// is allowed to act on, and that every stage carrying that capability is then
// turned away with a reason.
//
// HOW FAR THE CHAIN IS EXECUTED HERE — see src/lib/engine/chaos/propagation.ts,
// which sets this out link by link and quotes the guard.ts source it stands in
// for. Summary: links 1-4 (evaluateBreakers -> report.halted -> capabilityOf ->
// haltReason) run here as the real production functions. Link 5 — guard.ts's
// three-line `gateFor` wrapper and the tick route's `if (!gate.allow) continue`
// — cannot be executed from `node --test` because both files are server-only /
// Next.js-only. That gap is real and must be carried into the proof record.
//
// TWO GRADES OF TRIP, LABELLED
// ----------------------------
// [INDUCED] a fault was created, a stage really ran into it, and the breaker
//           input was COMPUTED by production code from what actually happened.
// [FED]     the breaker input was supplied directly, because the RPC that
//           produces it (engine_validation_stats, engine_source_health) is only
//           reachable through server-only code. These prove the halt propagates
//           given the reading; they do not prove the reading gets taken.

import { test } from "node:test";
import assert from "node:assert/strict";
import { createChaosClient } from "./fault-injection.ts";
import { jobRunFrom, runCarrierStage } from "./stage-under-fault.ts";
import {
  breakerGateFor,
  capabilitiesStillRunnable,
  describeHalt,
  enforceabilityOf,
  evaluateAsGuardWould,
  gateEveryJob,
  jobsCarrying,
  jobsHalted,
} from "./propagation.ts";
import { CHAOS_NOW, HEALTHY_SOURCES, HEALTHY_VALIDATION, healthyHistory, minutesBeforeNow } from "./telemetry.ts";
import { observe } from "./evidence.ts";
import {
  ALL_CAPABILITIES,
  evaluateBreakers,
  isHalted,
  type BreakerInputs,
  type BreakerName,
  type EngineCapability,
} from "../circuit-breaker.ts";
import { ENGINE_JOBS } from "../concurrency.ts";

const PROOF = "circuit_breaker_test";

const QUEUE = "engine_due_work";
const WRITE = "engine_create_brief";

function workItems(n: number) {
  return Array.from({ length: n }, (_, i) => ({
    id: `${String(i).padStart(8, "0")}-0000-4000-8000-000000000000`,
    subject: `candidate ${i}`,
  }));
}

// ---------------------------------------------------------------------------
// 0. CONTROL
// ---------------------------------------------------------------------------

test("CONTROL: a healthy engine halts nothing and every stage is allowed to run", () => {
  const view = evaluateAsGuardWould({
    available: true,
    runs: healthyHistory(),
    sources: HEALTHY_SOURCES,
    validation: HEALTHY_VALIDATION,
    now: CHAOS_NOW,
  });

  assert.equal(view.breakers.healthy, true);
  assert.equal(view.breakers.open.length, 0);
  assert.deepEqual(capabilitiesStillRunnable(view.breakers), [...ALL_CAPABILITIES]);
  assert.equal(gateEveryJob(view.breakers).every((g) => g.allow), true);

  observe(PROOF, "control", describeHalt(view.breakers));
});

// ---------------------------------------------------------------------------
// 1. [INDUCED] A RUNAWAY CREATION EVENT
// ---------------------------------------------------------------------------

test("[INDUCED] a source republishing its archive mints 60 records — creation and publication halt", async () => {
  // The fault: the upstream queue suddenly offers sixty items instead of three
  // and every write succeeds. Nothing errors. Nothing is denied. This is the
  // scenario the ceiling exists for and it produces a perfectly green run.
  const c = createChaosClient({ [QUEUE]: workItems(60), [WRITE]: "created" });
  const runaway = await runCarrierStage({
    client: c,
    stage: "briefs",
    queueRpc: QUEUE,
    writeRpc: WRITE,
    emptinessProof: "reader_alive",
  });

  assert.equal(runaway.status, "success", "the runaway pass itself looks entirely healthy");
  assert.equal(runaway.counters.created, 60);

  const view = evaluateAsGuardWould({
    available: true,
    runs: [
      ...healthyHistory(),
      jobRunFrom({ jobName: "engine_briefs", startedAt: minutesBeforeNow(15), result: runaway }),
    ],
    sources: HEALTHY_SOURCES,
    validation: HEALTHY_VALIDATION,
    now: CHAOS_NOW,
  });

  const breaker = view.breakers.verdicts.find((v) => v.name === "publication_volume");
  assert.equal(breaker?.state, "open");
  assert.equal(breaker?.basis, "measured");
  // The count was DERIVED by breakerInputsFromRuns from the run the stage really
  // wrote, not handed to the breaker.
  assert.equal(breaker?.observed.createdLast24h, 61);
  assert.equal(breaker?.observed.hardCeiling, 25);

  const runnable = capabilitiesStillRunnable(view.breakers);
  assert.equal(runnable.includes("creation"), false);
  assert.equal(runnable.includes("publication"), false);
  assert.equal(runnable.includes("discovery"), true, "the halt is scoped, not a blanket");
  assert.equal(runnable.includes("classification"), true);

  assert.equal(breakerGateFor(view.breakers, "engine_briefs").allow, false);
  assert.equal(breakerGateFor(view.breakers, "engine_draft_assembly").allow, false);
  assert.equal(breakerGateFor(view.breakers, "engine_product_assembly").allow, false);
  assert.equal(breakerGateFor(view.breakers, "engine_discover").allow, true);

  observe(
    PROOF,
    "[INDUCED] runaway volume: a green 60-record pass",
    `pass status=${runaway.status} created=${runaway.counters.created}; breakerInputsFromRuns derived ` +
      `createdLast24h=${breaker?.observed.createdLast24h} vs ceiling ${breaker?.observed.hardCeiling}; ` +
      `${describeHalt(view.breakers)}`
  );
});

// ---------------------------------------------------------------------------
// 2. [INDUCED] A STAGE SILENTLY STOPS BEING INVOKED
// ---------------------------------------------------------------------------

test("[INDUCED] a stage stops running entirely — job_interval opens on its absence", () => {
  // The fault is an ABSENCE: a stage removed from STAGES, or a cron entry
  // deleted. There is no error to find anywhere; the only evidence is rows that
  // stopped appearing. Induced by dropping the last three nights of one job.
  const cutoff = new Date(CHAOS_NOW.getTime() - 3 * 24 * 3_600_000).getTime();
  const runs = healthyHistory().filter(
    (r) => !(r.jobName === "engine_relevance" && new Date(r.startedAt).getTime() > cutoff)
  );

  const view = evaluateAsGuardWould({
    available: true,
    runs,
    sources: HEALTHY_SOURCES,
    validation: HEALTHY_VALIDATION,
    now: CHAOS_NOW,
  });

  const breaker = view.breakers.verdicts.find((v) => v.name === "job_interval");
  assert.equal(breaker?.state, "open");
  assert.match(String(breaker?.observed.overdueNames), /engine_relevance/);

  // health.ts saw it too, independently.
  const stale = view.health.critical.find((f) => f.kind === "stale_job" && f.job === "engine_relevance");
  assert.ok(stale, "assessEngineHealth also names the stage that stopped");

  const runnable = capabilitiesStillRunnable(view.breakers);
  assert.equal(runnable.includes("creation"), false);
  assert.equal(runnable.includes("publication"), false);

  observe(
    PROOF,
    "[INDUCED] a stage stopped being invoked (rows simply stop)",
    `job_interval.observed=${JSON.stringify(breaker?.observed)}; health finding "${stale?.kind}" on ` +
      `${stale?.job} (${JSON.stringify(stale?.observed)}); ${describeHalt(view.breakers)}`
  );
});

// ---------------------------------------------------------------------------
// 3. [INDUCED] TELEMETRY ITSELF GOES DARK
// ---------------------------------------------------------------------------

test("[INDUCED] the guard cannot read its own telemetry — it halts rather than assuming health", () => {
  // The exact 2026-08 incident, applied to the safety layer: the read RPC is
  // gone, so the guard has NOTHING. The fail-closed table in circuit-breaker.ts
  // is the whole subject of this test.
  const view = evaluateAsGuardWould({
    available: false,
    runs: [],
    sources: undefined,
    validation: undefined,
    now: CHAOS_NOW,
  });

  const openNames = view.breakers.open.map((v) => v.name).sort();
  assert.deepEqual(openNames, ["publication_volume", "silent_success"]);

  // publication_volume opens on the ABSENCE of a reading and says so.
  const volume = view.breakers.verdicts.find((v) => v.name === "publication_volume");
  assert.equal(volume?.state, "open");
  assert.equal(volume?.basis, "no_data", "an open-on-absence verdict must say it rests on absence");

  // silent_success opens on a MEASURED signal rather than on absence, because
  // the detector itself reported that it could not look. That is the stronger
  // of the two answers: "we established that detection is unavailable" beats
  // "no telemetry arrived".
  const silent = view.breakers.verdicts.find((v) => v.name === "silent_success");
  assert.equal(silent?.state, "open");
  assert.equal(silent?.basis, "measured");
  assert.equal(silent?.observed.criticalSignals, 1);

  // Benign absences stay closed, so the halt is a decision and not a panic.
  assert.equal(view.breakers.verdicts.find((v) => v.name === "source_failures")?.state, "closed");
  assert.equal(view.breakers.verdicts.find((v) => v.name === "database_errors")?.state, "closed");

  const runnable = capabilitiesStillRunnable(view.breakers);
  assert.equal(runnable.includes("creation"), false);
  assert.equal(runnable.includes("media_acquisition"), false);
  assert.equal(runnable.includes("publication"), false);
  assert.equal(runnable.includes("classification"), true);

  // And the detector says out loud that it could not look.
  const blind = view.silentSuccess.critical.find((s) => s.kind === "detection_unavailable");
  assert.ok(blind);

  observe(
    PROOF,
    "[INDUCED] total telemetry loss",
    `open=[${openNames.join(",")}] all basis=no_data; silent-success raised detection_unavailable; ` +
      `${describeHalt(view.breakers)}`
  );
});

// ---------------------------------------------------------------------------
// 4. THE HALT MATRIX — every breaker, tripped, checked all the way to the job
// ---------------------------------------------------------------------------

type TripCase = {
  breaker: BreakerName;
  grade: "INDUCED" | "FED";
  inputs: BreakerInputs;
  expectHalts: readonly EngineCapability[];
};

/**
 * Each breaker tripped in ISOLATION, so the halt observed is attributable to it
 * alone rather than to a neighbour.
 *
 * That requires a healthy baseline for the three breakers in FAIL_CLOSED —
 * publication_volume, validator_unavailable and silent_success — because those
 * open on the ABSENCE of a reading. Leaving them out of a row about
 * `source_failures` would open three extra breakers and make the row prove
 * nothing about source failures at all. (Which is itself a real, correct
 * property of this design, and is what the telemetry-loss test above exercises
 * on purpose.)
 */
const HEALTHY_BASE: BreakerInputs = {
  validators: [
    { validator: "media_rights", available: true },
    { validator: "postconditions", available: true },
    { validator: "fail_closed_rule", available: true },
  ],
  publication: { createdLast24h: 2, dailyMedian: 1 },
  silentSuccess: {
    runsObserved: 40,
    signals: 0,
    criticalSignals: 0,
    jobsAffected: 0,
    postconditionTelemetry: "present",
  },
};

const TRIPS: TripCase[] = [
  {
    breaker: "publication_volume",
    grade: "INDUCED",
    inputs: { ...HEALTHY_BASE, publication: { createdLast24h: 61, dailyMedian: 1 } },
    expectHalts: ["creation", "publication"],
  },
  {
    breaker: "source_failures",
    grade: "INDUCED",
    inputs: { ...HEALTHY_BASE, sources: { checked: 6, failed: 6, maxConsecutiveFailures: 5 } },
    expectHalts: ["discovery"],
  },
  {
    breaker: "validator_unavailable",
    grade: "INDUCED",
    // The roster arrives empty — the validator probe module could not be reached
    // at all. decideValidation() treats that as a stop, never as a pass.
    inputs: { ...HEALTHY_BASE, validators: [] },
    expectHalts: ["creation", "media_acquisition", "publication"],
  },
  {
    breaker: "validation_rejection_spike",
    grade: "FED",
    inputs: { ...HEALTHY_BASE, validation: { evaluated: 20, rejected: 20, baselineRejectionRate: 0.1 } },
    expectHalts: ["creation", "discovery"],
  },
  {
    breaker: "database_errors",
    grade: "INDUCED",
    inputs: { ...HEALTHY_BASE, database: { operations: 40, errors: 0, consecutiveFailedRuns: 3 } },
    expectHalts: ALL_CAPABILITIES,
  },
  {
    breaker: "duplication_rate",
    grade: "FED",
    inputs: { ...HEALTHY_BASE, duplication: { created: 1, deduped: 19, baselineDuplicationRate: 0.3 } },
    expectHalts: ["creation", "discovery"],
  },
  {
    breaker: "job_interval",
    grade: "INDUCED",
    inputs: {
      ...HEALTHY_BASE,
      jobs: [{ jobName: "engine_relevance", hoursSinceLastSuccess: 73, expectedIntervalHours: 24 }],
    },
    expectHalts: ["creation", "publication"],
  },
  {
    breaker: "silent_success",
    grade: "INDUCED",
    inputs: {
      ...HEALTHY_BASE,
      silentSuccess: {
        runsObserved: 40,
        signals: 1,
        criticalSignals: 1,
        jobsAffected: 1,
        postconditionTelemetry: "present",
      },
    },
    expectHalts: ["creation", "media_acquisition", "publication"],
  },
];

for (const trip of TRIPS) {
  test(`[${trip.grade}] tripping ${trip.breaker} removes ${trip.expectHalts.join("+")} from what the engine may run`, () => {
    const report = evaluateBreakers(trip.inputs);

    const verdict = report.verdicts.find((v) => v.name === trip.breaker);
    assert.equal(verdict?.state, "open", `${trip.breaker} did not trip on its own trigger`);

    // The named capabilities are gone from what the engine may act on.
    const runnable = capabilitiesStillRunnable(report);
    for (const cap of trip.expectHalts) {
      assert.equal(isHalted(report, cap), true, `${cap} should be halted by ${trip.breaker}`);
      assert.equal(runnable.includes(cap), false, `${cap} must not appear in the runnable list`);
    }

    // And every job that carries one is refused, by name, with a reason.
    //
    // THE VACUOUS CASE IS MADE EXPLICIT. "every job carrying X was refused" is
    // trivially true when no job carries X, and ENGINE_JOBS today registers ZERO
    // stages for `publication`. Counting that as a working halt would be exactly
    // the kind of unfalsifiable evidence this whole proof system exists to
    // reject, so the enforceable and not-applicable capabilities are separated
    // and only the enforceable ones are allowed to satisfy the assertion.
    const enforceable = trip.expectHalts.map(enforceabilityOf).filter((e) => e.status === "enforceable");
    const notApplicable = trip.expectHalts.map(enforceabilityOf).filter((e) => e.status === "not_applicable");
    assert.ok(
      enforceable.length > 0,
      `${trip.breaker} halts only capabilities no stage implements — the halt cannot refuse anything`
    );

    const refusedJobs = jobsHalted(report).map((g) => g.job);
    for (const e of enforceable) {
      for (const job of e.jobs) {
        assert.equal(refusedJobs.includes(job), true, `${job} should have been refused`);
        const gate = breakerGateFor(report, job);
        assert.equal(gate.allow, false);
        assert.match(gate.why, new RegExp(trip.breaker));
      }
    }
    for (const e of notApplicable) {
      assert.equal(e.jobs.length, 0);
      observe(PROOF, `[${trip.grade}] ${trip.breaker}: capability '${e.capability}' NOT APPLICABLE`, e.why);
    }

    // Nothing else is halted: a breaker that halts more than it declares is as
    // wrong as one that halts less.
    const unexpected = ALL_CAPABILITIES.filter(
      (c) => isHalted(report, c) && !trip.expectHalts.includes(c)
    );
    assert.deepEqual(unexpected, [], `${trip.breaker} halted capabilities it does not declare`);

    observe(
      PROOF,
      `[${trip.grade}] ${trip.breaker}`,
      `open; observed=${JSON.stringify(verdict?.observed)}; halted=[${report.halted.join(",")}]; ` +
        `jobs refused=${refusedJobs.length}/${ENGINE_JOBS.length}`
    );
  });
}

// ---------------------------------------------------------------------------
// 5. THE ESCAPE HATCH — a stage nobody registered
// ---------------------------------------------------------------------------

test("[INDUCED] an unregistered stage is REFUSED, not waved past every open breaker", () => {
  // Induce the condition directly: ask the gate about a job name that is not in
  // ENGINE_JOBS, while every breaker is open. This is the shape the shadow stage
  // was in — shadow-job.ts recorded under one name and the tick route gated
  // under another, so capabilityOf() answered null for both and the stage
  // skipped the breaker and lease checks entirely.
  const allOpen = evaluateBreakers({
    ...HEALTHY_BASE,
    database: { operations: 40, errors: 0, consecutiveFailedRuns: 3 },
  });
  assert.deepEqual([...allOpen.halted].sort(), [...ALL_CAPABILITIES].sort());

  const ghost = breakerGateFor(allOpen, "engine_shadow_evaluation");
  assert.equal(ghost.capability, null, "the old tick-route name maps to no capability");
  assert.equal(ghost.allow, false, "an unmappable job must not run while every capability is halted");
  assert.match(ghost.why, /not in ENGINE_JOBS/);

  // And the name it was actually recording under is now registered and gated.
  const real = breakerGateFor(allOpen, "engine_shadow");
  assert.equal(real.capability, "classification");
  assert.equal(real.allow, false);
  assert.match(real.why, /Circuit breaker halted 'classification'/);

  observe(
    PROOF,
    "[INDUCED] unregistered stage while all six capabilities are halted",
    `capabilityOf("engine_shadow_evaluation")=null -> refused ("${ghost.why.slice(0, 90)}..."); ` +
      `capabilityOf("engine_shadow")=classification -> refused by the breaker. ` +
      `Before this was fixed, the first of those two names RAN.`
  );
});

test("⚠️ FINDING: halting 'publication' currently refuses nothing — no stage carries it", () => {
  const e = enforceabilityOf("publication");
  assert.equal(e.status, "not_applicable");
  assert.deepEqual(jobsCarrying("publication"), []);

  // Four of the eight breakers name `publication` among their halts.
  const namingPublication = TRIPS.filter((t) => t.expectHalts.includes("publication")).map((t) => t.breaker);
  assert.ok(namingPublication.length >= 3);

  // Every other capability IS backed by at least one stage.
  for (const cap of ALL_CAPABILITIES) {
    if (cap === "publication") continue;
    assert.equal(enforceabilityOf(cap).status, "enforceable", `${cap} has no registered stage`);
  }

  observe(
    PROOF,
    "⚠️ FINDING: the 'publication' halt is unfalsifiable today",
    `ENGINE_JOBS registers ${ENGINE_JOBS.length} stages across ${ALL_CAPABILITIES.length} capabilities; ` +
      `'publication' has ZERO. Breakers naming it: ${namingPublication.join(", ")}. ` +
      `"publication halted" is true and stops nothing, so it must not be counted as evidence that a halt works.`
  );
});

test("every breaker that can open declares at least one capability to halt", () => {
  // A breaker with an empty `halts` list would satisfy `state: open` and stop
  // nothing whatsoever — the precise failure this proof exists to rule out.
  for (const trip of TRIPS) {
    const report = evaluateBreakers(trip.inputs);
    const verdict = report.verdicts.find((v) => v.name === trip.breaker);
    assert.equal(verdict?.state, "open");
    assert.ok(verdict.halts.length > 0, `${trip.breaker} opens but halts nothing`);
    assert.ok(verdict.why.length > 40, `${trip.breaker} opens without an explanation`);
    assert.ok(verdict.action.length > 10, `${trip.breaker} opens without an action`);
  }
  assert.equal(TRIPS.length, 8, "all eight breakers are covered by the matrix");
});
