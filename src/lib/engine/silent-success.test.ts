import { test } from "node:test";
import assert from "node:assert/strict";
import {
  detectSilentSuccess,
  hardenReadiness,
  isSilentSuccess,
  postconditionDetail,
  silentSuccessBreakerInput,
  silentSuccessFindings,
  silentSuccessGraduationBlockers,
  STAGE_EFFECTS,
  stageEffectOf,
  type SilentSuccessRun,
} from "./silent-success.ts";
import { evaluateBreakers, isHalted } from "./circuit-breaker.ts";
import { summarisePostconditions } from "./postconditions.ts";

const T0 = new Date("2026-08-22T00:00:00Z").getTime();

function run(p: Partial<SilentSuccessRun> & { jobName: string; hoursAgo: number }): SilentSuccessRun {
  const startedAt = new Date(T0 - p.hoursAgo * 3_600_000).toISOString();
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
    silentNoOps: p.silentNoOps ?? null,
    unverifiedWrites: p.unverifiedWrites ?? null,
    blindWrites: p.blindWrites ?? null,
    stageOutcome: p.stageOutcome ?? null,
    outcomeAmbiguity: p.outcomeAmbiguity ?? null,
    verifiedWrites: p.verifiedWrites ?? null,
  };
}

const ok = { telemetryAvailable: true };

// ---------------------------------------------------------------------------
// Detection unavailable fails closed
// ---------------------------------------------------------------------------

test("no telemetry is a CRITICAL signal, never a clean bill of health", () => {
  const r = detectSilentSuccess([], { telemetryAvailable: false });
  assert.equal(r.clean, false);
  assert.equal(r.critical[0].kind, "detection_unavailable");
});

test("an empty but readable history is clean — nothing has happened yet", () => {
  const r = detectSilentSuccess([], ok);
  assert.equal(r.clean, true);
  assert.equal(r.signals.length, 0);
});

// ---------------------------------------------------------------------------
// The two real incidents
// ---------------------------------------------------------------------------

test("INCIDENT 1: examined rows, touched none, reported success", () => {
  // engine_discover, not engine_freshness. Freshness is a declared ASSESSOR,
  // for which "examined 40, flagged none" is the desired outcome rather than a
  // silent success — this test previously used it, and so encoded the false
  // positive that halted creation on a healthy site.
  const r = detectSilentSuccess([run({ jobName: "engine_discover", hoursAgo: 1, itemsExamined: 40 })], ok);
  const s = r.signals.find((x) => x.kind === "success_no_effect");
  assert.ok(s, "must be detected with no history and no new columns");
  assert.equal(s.severity, "critical");
  assert.equal(r.clean, false);
});

test("INCIDENT 2: a producer that has NEVER produced, across its whole history", () => {
  // Each run individually looks fine: it examined things, nothing errored.
  // Only the total across all of them is zero — which is why this needs the
  // cross-run horizon and why the bug survived every single-run inspection.
  const runs = Array.from({ length: 10 }, (_, i) =>
    run({ jobName: "engine_briefs", hoursAgo: i * 24, itemsExamined: 12, itemsDeduped: 12 })
  );
  const r = detectSilentSuccess(runs, ok);
  const s = r.signals.find((x) => x.kind === "never_effective");
  assert.ok(s);
  assert.equal(s.severity, "critical");
});

test("a YOUNG producer is not accused of never working", () => {
  const runs = Array.from({ length: 3 }, (_, i) =>
    run({ jobName: "engine_briefs", hoursAgo: i * 24, itemsExamined: 12, itemsDeduped: 12 })
  );
  assert.equal(
    detectSilentSuccess(runs, ok).signals.some((s) => s.kind === "never_effective"), false
  );
});

test("an ASSESSOR that creates nothing is doing its job, not failing", () => {
  // Zero orphans is the goal. Judging engine_internal_links as a producer
  // would report a healthy site as an engine fault.
  const runs = Array.from({ length: 12 }, (_, i) =>
    run({ jobName: "engine_internal_links", hoursAgo: i * 24, itemsExamined: 81 })
  );
  assert.equal(
    detectSilentSuccess(runs, ok).signals.some((s) => s.kind === "never_effective"), false
  );
});

test("a producer that has FAILED is not 'never effective' — that failure was visible", () => {
  const runs = Array.from({ length: 10 }, (_, i) =>
    run({
      jobName: "engine_briefs", hoursAgo: i * 24, itemsExamined: 12,
      itemsDeduped: 12, status: i === 0 ? "failed" : "success",
    })
  );
  assert.equal(
    detectSilentSuccess(runs, ok).signals.some((s) => s.kind === "never_effective"), false,
    "the point of the class is silence; a job that reported failure is not silent"
  );
});

// ---------------------------------------------------------------------------
// The other shapes
// ---------------------------------------------------------------------------

test("everything rejected but the run still says success", () => {
  const r = detectSilentSuccess(
    [run({ jobName: "engine_relevance", hoursAgo: 1, itemsExamined: 30, itemsFailed: 30 })], ok
  );
  const s = r.signals.find((x) => x.kind === "total_rejection_reported_success");
  assert.ok(s);
  assert.equal(s.severity, "critical");
});

test("counters reporting silent no-ops contradict a 'success' status", () => {
  const r = detectSilentSuccess(
    [run({ jobName: "engine_trends", hoursAgo: 1, itemsExamined: 5, itemsCreated: 5, silentNoOps: 3 })], ok
  );
  assert.ok(r.signals.some((s) => s.kind === "status_overstated"));
});

test("a job whose every write is blind is reported as unprovable, at warning level", () => {
  const r = detectSilentSuccess(
    [run({ jobName: "engine_opportunities", hoursAgo: 1, itemsExamined: 9, blindWrites: 9, verifiedWrites: 0 })], ok
  );
  const s = r.signals.find((x) => x.kind === "unprovable_by_construction");
  assert.ok(s);
  assert.equal(s.severity, "warning", "it is a to-do list, not an outage");
});

test("blindness explains a zero creation count instead of double-reporting it", () => {
  const runs = Array.from({ length: 10 }, (_, i) =>
    run({
      jobName: "engine_opportunities", hoursAgo: i * 24, itemsExamined: 9,
      blindWrites: 9, verifiedWrites: 0,
    })
  );
  const r = detectSilentSuccess(runs, ok);
  assert.equal(r.signals.some((s) => s.kind === "never_effective"), false);
  assert.equal(r.signals.some((s) => s.kind === "unprovable_by_construction"), true);
});

test("a producer producing into a consumer that examines nothing is starvation", () => {
  const runs = [
    ...Array.from({ length: 4 }, (_, i) =>
      run({ jobName: "engine_discover", hoursAgo: i * 24, itemsExamined: 20, itemsCreated: 6 })
    ),
    ...Array.from({ length: 4 }, (_, i) =>
      run({ jobName: "engine_relevance", hoursAgo: i * 24, itemsExamined: 0 })
    ),
  ];
  const r = detectSilentSuccess(runs, ok);
  const s = r.signals.find((x) => x.kind === "downstream_starved");
  assert.ok(s, "both stages report success; the gap between them is the only evidence");
  assert.equal(s.severity, "critical");
});

test("a consumer that IS seeing work is not starved", () => {
  const runs = [
    ...Array.from({ length: 4 }, (_, i) =>
      run({ jobName: "engine_discover", hoursAgo: i * 24, itemsExamined: 20, itemsCreated: 6 })
    ),
    ...Array.from({ length: 4 }, (_, i) =>
      run({ jobName: "engine_relevance", hoursAgo: i * 24, itemsExamined: 6, itemsCreated: 6 })
    ),
  ];
  assert.equal(
    detectSilentSuccess(runs, ok).signals.some((s) => s.kind === "downstream_starved"), false
  );
});

test("a barely-productive producer does not accuse its consumer", () => {
  const runs = [
    run({ jobName: "engine_discover", hoursAgo: 1, itemsExamined: 20, itemsCreated: 1 }),
    run({ jobName: "engine_relevance", hoursAgo: 1, itemsExamined: 0 }),
  ];
  assert.equal(
    detectSilentSuccess(runs, ok).signals.some((s) => s.kind === "downstream_starved"), false
  );
});

test("missing postcondition counters are reported rather than assumed zero", () => {
  const r = detectSilentSuccess([run({ jobName: "engine_trends", hoursAgo: 1, itemsExamined: 5, itemsCreated: 5 })], ok);
  const s = r.signals.find((x) => x.kind === "detection_unavailable");
  assert.ok(s);
  assert.equal(s.severity, "warning");
  assert.equal(r.postconditionTelemetry, "absent");
  assert.equal(r.clean, true, "blunt detection is not the same as an outage");
});

test("skipped runs never contribute to any signal", () => {
  const runs = Array.from({ length: 12 }, (_, i) =>
    run({ jobName: "engine_briefs", hoursAgo: i * 24, status: "skipped", itemsExamined: 0 })
  );
  assert.equal(detectSilentSuccess(runs, ok).critical.length, 0);
});

// ---------------------------------------------------------------------------
// 1. It fails a job
// ---------------------------------------------------------------------------

test("isSilentSuccess flags a pass whose writes did nothing", () => {
  const bad = summarisePostconditions([
    { operation: "a", status: "silent_no_op", ok: false, expectation: "", detail: "", data: null, error: null },
  ]);
  assert.equal(isSilentSuccess(bad), true);

  const good = summarisePostconditions([
    { operation: "a", status: "verified", ok: true, expectation: "", detail: "", data: null, error: null },
  ]);
  assert.equal(isSilentSuccess(good), false);
});

test("the detail block carries what to act on, not just a boolean", () => {
  const d = postconditionDetail(
    summarisePostconditions([
      { operation: "engine_upsert_freshness", status: "silent_no_op", ok: false, expectation: "", detail: "row X untouched", data: null, error: null },
    ])
  );
  assert.equal(d.silentSuccess, true);
  assert.deepEqual(d.silentNoOpDetails, ["row X untouched"]);
});

// ---------------------------------------------------------------------------
// 2. It trips a circuit breaker
// ---------------------------------------------------------------------------

test("one critical signal opens the breaker and halts creation", () => {
  const report = detectSilentSuccess(
    [run({ jobName: "engine_discover", hoursAgo: 1, itemsExamined: 40 })], ok
  );
  const breakers = evaluateBreakers({ silentSuccess: silentSuccessBreakerInput(report, 1) });
  const v = breakers.verdicts.find((x) => x.name === "silent_success");
  assert.equal(v?.state, "open");
  assert.equal(isHalted(breakers, "creation"), true);
  assert.equal(isHalted(breakers, "publication"), true);
});

test("no threshold to hide under: ONE instance trips it", () => {
  // A PRODUCER, deliberately. engine_freshness is a declared assessor, for
  // which examining one item and flagging none of it is the intended outcome.
  const report = detectSilentSuccess(
    [run({ jobName: "engine_discover", hoursAgo: 1, itemsExamined: 1 })], ok
  );
  const input = silentSuccessBreakerInput(report, 1);
  assert.equal(input.criticalSignals, 1);
  const v = evaluateBreakers({ silentSuccess: input }).verdicts.find((x) => x.name === "silent_success");
  assert.equal(v?.state, "open");
});

test("the breaker fails CLOSED when the detector did not run at all", () => {
  const breakers = evaluateBreakers({});
  const v = breakers.verdicts.find((x) => x.name === "silent_success");
  assert.equal(v?.state, "open");
  assert.equal(v?.basis, "no_data");
});

test("measurement and maintenance keep running so the problem can be diagnosed", () => {
  const report = detectSilentSuccess(
    [run({ jobName: "engine_discover", hoursAgo: 1, itemsExamined: 40 })], ok
  );
  const breakers = evaluateBreakers({ silentSuccess: silentSuccessBreakerInput(report, 1) });
  const v = breakers.verdicts.find((x) => x.name === "silent_success");
  assert.equal(v?.halts.includes("classification"), false);
  assert.equal(v?.halts.includes("maintenance"), false);
});

test("a clean detector run leaves the breaker closed", () => {
  const report = detectSilentSuccess(
    [run({ jobName: "engine_trends", hoursAgo: 1, itemsExamined: 5, itemsCreated: 5, silentNoOps: 0, verifiedWrites: 5, blindWrites: 0 })],
    ok
  );
  const breakers = evaluateBreakers({ silentSuccess: silentSuccessBreakerInput(report, 1) });
  assert.equal(breakers.verdicts.find((x) => x.name === "silent_success")?.state, "closed");
});

// ---------------------------------------------------------------------------
// 3. It raises an alert
// ---------------------------------------------------------------------------

test("signals render as health findings so they appear where people already look", () => {
  const report = detectSilentSuccess(
    [run({ jobName: "engine_discover", hoursAgo: 1, itemsExamined: 40 })], ok
  );
  const findings = silentSuccessFindings(report);
  assert.equal(findings.length, report.signals.length);
  for (const f of findings) assert.match(f.why, /SILENT_SUCCESS/);

  const noEffect = findings.find((f) => f.observed.silentSuccessKind === "success_no_effect");
  assert.ok(noEffect);
  assert.equal(noEffect.severity, "critical");
  assert.equal(noEffect.job, "engine_discover");
});

// ---------------------------------------------------------------------------
// 4. It blocks autonomous graduation
// ---------------------------------------------------------------------------

const cleanEvidence = {
  report: detectSilentSuccess(
    [run({ jobName: "engine_trends", hoursAgo: 1, itemsExamined: 5, itemsCreated: 5, silentNoOps: 0, verifiedWrites: 5, blindWrites: 0 })],
    ok
  ),
  silentNoOpsObserved: 0,
  blindWriteOperations: [] as string[],
};

test("clean evidence adds no blockers", () => {
  assert.deepEqual(silentSuccessGraduationBlockers(cleanEvidence), []);
});

test("one critical signal blocks graduation", () => {
  const blockers = silentSuccessGraduationBlockers({
    ...cleanEvidence,
    report: detectSilentSuccess([run({ jobName: "engine_discover", hoursAgo: 1, itemsExamined: 40 })], ok),
  });
  assert.ok(blockers.some((b) => b.criterion.includes("critical signals")));
});

test("an unobservable write path blocks graduation — readiness must be falsifiable", () => {
  const blockers = silentSuccessGraduationBlockers({
    ...cleanEvidence,
    blindWriteOperations: ["engine_upsert_opportunity"],
  });
  assert.ok(blockers.some((b) => b.criterion.includes("cannot be observed")));
});

test("absent detection telemetry blocks graduation rather than reading as zero", () => {
  const blockers = silentSuccessGraduationBlockers({
    report: detectSilentSuccess([run({ jobName: "engine_trends", hoursAgo: 1, itemsExamined: 5, itemsCreated: 5 })], ok),
    silentNoOpsObserved: 0,
    blindWriteOperations: [],
  });
  assert.ok(blockers.some((b) => b.criterion === "Postcondition telemetry"));
});

test("hardenReadiness can only ever LOWER a verdict", () => {
  const unlocked = { autonomousUnlocked: true, highestJustifiedMode: "AUTONOMOUS", blockers: [] };
  const hardened = hardenReadiness(unlocked, {
    ...cleanEvidence,
    blindWriteOperations: ["engine_upsert_opportunity"],
  });
  assert.equal(hardened.autonomousUnlocked, false);
  assert.equal(hardened.highestJustifiedMode, "SHADOW");
  assert.equal(hardened.blockers.length, 1);
});

test("hardenReadiness never promotes a locked verdict", () => {
  const locked = { autonomousUnlocked: false, highestJustifiedMode: "SHADOW", blockers: [{ criterion: "x", required: "y", actual: "z" }] };
  assert.deepEqual(hardenReadiness(locked, cleanEvidence), locked);
});

test("hardenReadiness leaves OFF alone", () => {
  const off = { autonomousUnlocked: false, highestJustifiedMode: "OFF", blockers: [] };
  const hardened = hardenReadiness(off, { ...cleanEvidence, silentNoOpsObserved: 1 });
  assert.equal(hardened.highestJustifiedMode, "OFF");
});

// ---------------------------------------------------------------------------
// The stage model itself
// ---------------------------------------------------------------------------

test("every stage's declared consumer is itself a declared stage", () => {
  const known = new Set(STAGE_EFFECTS.map((s) => s.job));
  for (const s of STAGE_EFFECTS) {
    for (const f of s.feeds) {
      assert.ok(known.has(f), `${s.job} feeds unknown stage ${f}`);
    }
  }
});

test("no stage feeds itself", () => {
  for (const s of STAGE_EFFECTS) assert.equal(s.feeds.includes(s.job), false);
});

test("every stage says what it produces, so a signal can name it", () => {
  for (const s of STAGE_EFFECTS) assert.ok(s.produces.length > 3, `${s.job} has no produces text`);
});

test("stageEffectOf returns null rather than guessing for an unknown job", () => {
  assert.equal(stageEffectOf("engine_not_a_job"), null);
});

test("every signal carries an action, not just a diagnosis", () => {
  const runs = [
    run({ jobName: "engine_discover", hoursAgo: 1, itemsExamined: 40 }),
    run({ jobName: "engine_relevance", hoursAgo: 1, itemsExamined: 30, itemsFailed: 30 }),
  ];
  for (const s of detectSilentSuccess(runs, ok).signals) {
    assert.ok(s.action.length > 10, `${s.kind} has no action`);
    assert.ok(s.why.length > 30, `${s.kind} has no explanation`);
  }
});

// ---------------------------------------------------------------------------
// The assessor false positive: a HEALTHY site halted article creation
// ---------------------------------------------------------------------------

test("an assessor that finds nothing to flag is the GOAL, not a silent success", () => {
  // The live bug. engine_internal_links sets examined = every published
  // article, finds zero orphans, and reports success. That row is
  // examined:29 created:0 deduped:0 failed:0 status:success — which fired
  // success_no_effect at CRITICAL, opened the silent_success breaker, and
  // halted creation, media_acquisition and publication. The engine stopped
  // writing articles precisely because the site had no orphans.
  const report = detectSilentSuccess(
    [run({ jobName: "engine_internal_links", hoursAgo: 1, status: "success", itemsExamined: 29 })],
    ok
  );
  assert.equal(
    report.signals.filter((s) => s.kind === "success_no_effect").length,
    0,
    "an assessor examining 29 articles and flagging none of them is the desired outcome"
  );
  assert.equal(report.critical.length, 0, JSON.stringify(report.signals));
});

test("a PRODUCER with the same counters is still the incident, unchanged", () => {
  // The fix must not blind the detector to what it was built for.
  const report = detectSilentSuccess(
    [run({ jobName: "engine_discover", hoursAgo: 1, status: "success", itemsExamined: 29 })],
    ok
  );
  assert.ok(
    report.signals.some((s) => s.kind === "success_no_effect" && s.severity === "critical"),
    "a producer that looked at 29 items and touched none of them is incident #1"
  );
});

test("an assessor whose writes are DENIED is still caught, by the telemetry", () => {
  // What the role exemption does not cost. A denied write produces silent
  // no-ops, and status_overstated reads those for every job regardless of role
  // — the evidence that actually separates "nothing to flag" from "could not
  // write what I flagged".
  const report = detectSilentSuccess(
    [
      run({
        jobName: "engine_internal_links",
        hoursAgo: 1,
        status: "success",
        itemsExamined: 29,
        silentNoOps: 3,
      }),
    ],
    ok
  );
  assert.ok(
    report.signals.some((s) => s.kind === "status_overstated"),
    "silent no-ops must still surface on an assessor"
  );
});

test("a consumer waiting on a HUMAN is not starved — the editor's inbox is not an engine fault", () => {
  // The third costume of the same defect. engine_briefs produces briefs;
  // engine_draft_assembly consumes only the ones a human has APPROVED. Five
  // briefs across three productive runs with no approvals fired a CRITICAL
  // downstream_starved, opened the silent_success breaker and halted creation.
  //
  // The engine stopped writing articles because the editor had not been through
  // the inbox — and stopped hardest exactly when that inbox was fullest.
  const runs = [
    run({ jobName: "engine_briefs", hoursAgo: 1, itemsExamined: 9, itemsCreated: 3 }),
    run({ jobName: "engine_briefs", hoursAgo: 25, itemsExamined: 9, itemsCreated: 2 }),
    run({ jobName: "engine_briefs", hoursAgo: 49, itemsExamined: 9, itemsCreated: 2 }),
    run({ jobName: "engine_draft_assembly", hoursAgo: 1, itemsExamined: 0 }),
    run({ jobName: "engine_draft_assembly", hoursAgo: 25, itemsExamined: 0 }),
  ];
  const report = detectSilentSuccess(runs, ok);
  assert.equal(
    report.signals.some((s) => s.kind === "downstream_starved"),
    false,
    `waiting on an approval is not starvation: ${JSON.stringify(report.signals.map((s) => s.kind))}`
  );
});

test("a consumer that does NOT wait on a human is still reported as starved", () => {
  // The fix must not blind the detector to real starvation. engine_relevance
  // consumes what engine_discover writes with no human in between, so a full
  // producer and an idle consumer there IS the pipeline being broken.
  const runs = [
    run({ jobName: "engine_discover", hoursAgo: 1, itemsExamined: 9, itemsCreated: 3 }),
    run({ jobName: "engine_discover", hoursAgo: 25, itemsExamined: 9, itemsCreated: 2 }),
    run({ jobName: "engine_discover", hoursAgo: 49, itemsExamined: 9, itemsCreated: 2 }),
    run({ jobName: "engine_relevance", hoursAgo: 1, itemsExamined: 0 }),
    run({ jobName: "engine_relevance", hoursAgo: 25, itemsExamined: 0 }),
  ];
  const report = detectSilentSuccess(runs, ok);
  assert.ok(
    report.signals.some((s) => s.kind === "downstream_starved"),
    "a machine-to-machine handoff that stopped moving is still an incident"
  );
});

// ---------------------------------------------------------------------------
// stage_outcome: written by every job, and CONSUMED here
// ---------------------------------------------------------------------------

test("a stage that classified its own pass UNCLASSIFIED raises a critical signal", () => {
  // UNCLASSIFIED is not a kind of outcome — it is the classifier declining to
  // invent one, which stage-outcome.ts defines as always an incident. Most
  // often it means the stage could not prove its input queue was genuinely
  // empty rather than unreadable.
  const report = detectSilentSuccess(
    [
      run({
        jobName: "engine_briefs",
        hoursAgo: 1,
        status: "failed",
        stageOutcome: "UNCLASSIFIED",
        outcomeAmbiguity: "emptiness_unproven",
      }),
    ],
    ok
  );
  const signal = report.signals.find((s) => s.kind === "stage_unclassified");
  assert.ok(signal, JSON.stringify(report.signals.map((s) => s.kind)));
  assert.equal(signal.severity, "critical");
  assert.match(signal.why, /emptiness_unproven/);
  assert.equal(report.clean, false);
});

test("a stage that classified itself NOTHING_TO_DO raises nothing", () => {
  // The earned-empty case. A corroborated empty queue is health, and the whole
  // point of the classification is that this row differs from the one above.
  const report = detectSilentSuccess(
    [run({ jobName: "engine_briefs", hoursAgo: 1, status: "success", stageOutcome: "NOTHING_TO_DO" })],
    ok
  );
  assert.equal(
    report.signals.some((s) => s.kind === "stage_unclassified"),
    false
  );
});

test("a run with NO stage_outcome is not treated as classified", () => {
  // null means UNMEASURED — the run predates the column, or the stage does not
  // classify itself. It must raise neither an incident nor an all-clear.
  const report = detectSilentSuccess(
    [run({ jobName: "engine_briefs", hoursAgo: 1, status: "success", stageOutcome: null })],
    ok
  );
  assert.equal(
    report.signals.some((s) => s.kind === "stage_unclassified"),
    false,
    "unmeasured is not an incident"
  );
});
