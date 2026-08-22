import { test } from "node:test";
import assert from "node:assert/strict";
import {
  detectSilentSuccess,
  hardenReadiness,
  silentSuccessBreakerInput,
  silentSuccessGraduationBlockers,
  TELEMETRY_STATES,
  TELEMETRY_STATE_HEADLINES,
  TELEMETRY_STATE_MEANINGS,
  telemetryStateBlocksGraduation,
  telemetryStateIsHealthy,
  telemetryStateIsIncident,
  telemetryStateIsKnown,
  telemetryStateOpensBreaker,
  type SilentSuccessReport,
  type SilentSuccessRun,
  type TelemetryState,
} from "./silent-success.ts";
import { evaluateBreakers, isHalted } from "./circuit-breaker.ts";

// THE FOUR TELEMETRY STATES.
//
// The defect that prompted this: an assessor stage finding nothing to flag — its
// GOAL — raised a CRITICAL signal, opened the silent_success breaker and halted
// creation, media_acquisition and publication. The engine stopped writing
// articles because the site was healthy. That specific collapse was fixed by
// making the detectors role-aware; these tests are about the FAMILY of
// collapses, and they assert that the four possible readings are separately
// representable, separately reported, and never equal to one another.
//
//   (a) ZERO MEASURED RUNS                 no runs in the window at all
//   (b) MEASURED RUNS WITH ZERO INCIDENTS  examined and genuinely clean = HEALTH
//   (c) TELEMETRY UNAVAILABLE              could not read. NOT clean.
//   (d) GENUINE DETECTED INCIDENTS

const T0 = new Date("2026-08-22T00:00:00Z").getTime();

/**
 * Every OTHER breaker satisfied, so an assertion about halting is an assertion
 * about the silent-success breaker and not about the three that fail closed on
 * absent input.
 */
const HEALTHY_BASE = {
  publication: { createdLast24h: 2, dailyMedian: 1 },
  validators: [
    { validator: "media_rights", available: true },
    { validator: "postconditions", available: true },
    { validator: "fail_closed_rule", available: true },
  ],
};

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
    silentNoOps: p.silentNoOps ?? 0,
    unverifiedWrites: p.unverifiedWrites ?? 0,
    blindWrites: p.blindWrites ?? 0,
    verifiedWrites: p.verifiedWrites ?? 0,
  };
}

// The four fixtures, each producing exactly one state.
function reportFor(state: TelemetryState): SilentSuccessReport {
  switch (state) {
    case "zero_measured_runs":
      // Rows exist, and every single one is 'skipped' — so nothing entered the
      // analysis. This is the S2 shape: one denied engine_flag_enabled used to
      // make every stage record a skip, and the detector then reported clean.
      return detectSilentSuccess(
        Array.from({ length: 6 }, (_, i) =>
          run({ jobName: "engine_discover", hoursAgo: i * 24, status: "skipped" })
        ),
        { telemetryAvailable: true }
      );
    case "measured_clean":
      // A producer that produced, examined against its own consumer. Nothing
      // fires. THIS is health.
      return detectSilentSuccess(
        Array.from({ length: 6 }, (_, i) => [
          run({ jobName: "engine_discover", hoursAgo: i * 24, itemsExamined: 22, itemsCreated: 3 }),
          run({ jobName: "engine_relevance", hoursAgo: i * 24, itemsExamined: 9, itemsCreated: 4 }),
        ]).flat(),
        { telemetryAvailable: true }
      );
    case "telemetry_unavailable":
      return detectSilentSuccess([], { telemetryAvailable: false });
    case "incidents_detected":
      return detectSilentSuccess(
        [run({ jobName: "engine_discover", hoursAgo: 1, itemsExamined: 40 })],
        { telemetryAvailable: true }
      );
  }
}

// ---------------------------------------------------------------------------
// Each state is produced, and is the state it claims to be
// ---------------------------------------------------------------------------

test("(a) ZERO MEASURED RUNS is its own state — not healthy, and not an incident", () => {
  const r = reportFor("zero_measured_runs");
  assert.equal(r.telemetryState, "zero_measured_runs");
  assert.equal(r.measuredRuns, 0);
  assert.equal(r.skippedRuns, 6);

  // NOT healthy. This is the assertion the old code could not satisfy: it
  // returned `clean: true` and nothing else, so a window containing nothing was
  // indistinguishable from one that had been examined and found fine.
  assert.equal(r.healthy, false, "nothing was measured, so nothing is known to be healthy");
  // NOT an incident either. There is no evidence of a problem — only an absence
  // of evidence, and the two must not be collapsed in either direction.
  assert.equal(telemetryStateIsIncident(r.telemetryState), false);
  assert.equal(r.critical.length, 0);
  // UNKNOWN.
  assert.equal(r.known, false);
});

test("(b) MEASURED RUNS WITH ZERO INCIDENTS is the ONLY state that reads as health", () => {
  const r = reportFor("measured_clean");
  assert.equal(r.telemetryState, "measured_clean");
  assert.equal(r.healthy, true);
  assert.equal(r.known, true);
  assert.equal(r.critical.length, 0);
  assert.ok(r.measuredRuns > 0, "health requires having actually looked at runs");

  // And it is the only one. Asserted over the whole enum rather than by
  // inspection, so a fifth state added later cannot quietly become healthy too.
  for (const state of TELEMETRY_STATES) {
    assert.equal(
      telemetryStateIsHealthy(state),
      state === "measured_clean",
      `${state} must not read as healthy`
    );
  }
});

test("(b) an assessor examining rows and flagging NONE of them is state (b) — the original defect", () => {
  // engine_internal_links sets examined = every published article, finds zero
  // orphans, and reports success. That row opened the silent_success breaker and
  // halted creation on a healthy site. It must land in MEASURED_CLEAN.
  const r = detectSilentSuccess(
    [run({ jobName: "engine_internal_links", hoursAgo: 1, itemsExamined: 29 })],
    { telemetryAvailable: true }
  );
  assert.equal(r.telemetryState, "measured_clean");
  assert.equal(r.healthy, true);

  const breakers = evaluateBreakers({ ...HEALTHY_BASE, silentSuccess: silentSuccessBreakerInput(r, 1) });
  assert.equal(isHalted(breakers, "creation"), false, "a healthy site must not stop the engine");
  assert.equal(isHalted(breakers, "media_acquisition"), false);
  assert.equal(isHalted(breakers, "publication"), false);
});

test("(c) TELEMETRY UNAVAILABLE is not clean, is not an incident, and still fails closed", () => {
  const r = reportFor("telemetry_unavailable");
  assert.equal(r.telemetryState, "telemetry_unavailable");
  assert.equal(r.healthy, false, "the detector could not read; that is never clean");
  assert.equal(r.known, false, "it is UNKNOWN, not a finding about the engine");
  assert.equal(telemetryStateIsIncident(r.telemetryState), false);

  // FAIL-CLOSED IS NOT WEAKENED. Calling it 'unknown' rather than 'incident' is
  // a statement about what it MEANS, not a reduction in what it DOES.
  assert.equal(telemetryStateBlocksGraduation("telemetry_unavailable"), true);
  assert.equal(telemetryStateOpensBreaker("telemetry_unavailable"), true);
  const breakers = evaluateBreakers({ silentSuccess: silentSuccessBreakerInput(r, 0) });
  assert.equal(isHalted(breakers, "creation"), true);
  assert.equal(isHalted(breakers, "media_acquisition"), true);
  assert.equal(isHalted(breakers, "publication"), true);
});

test("(d) GENUINE DETECTED INCIDENTS is the only state that reads as an incident", () => {
  const r = reportFor("incidents_detected");
  assert.equal(r.telemetryState, "incidents_detected");
  assert.equal(r.healthy, false);
  assert.equal(r.known, true, "we looked, and we found something — that IS knowledge");
  assert.ok(r.critical.length > 0);

  for (const state of TELEMETRY_STATES) {
    assert.equal(telemetryStateIsIncident(state), state === "incidents_detected");
  }

  const breakers = evaluateBreakers({ silentSuccess: silentSuccessBreakerInput(r, 1) });
  assert.equal(isHalted(breakers, "creation"), true);
});

// ---------------------------------------------------------------------------
// NO TWO STATES PRODUCE IDENTICAL OUTPUT
// ---------------------------------------------------------------------------

test("no two of the four states produce identical output, at any layer", () => {
  const layers: Record<string, (s: TelemetryState) => string> = {
    // 1. The state name itself.
    state: (s) => s,
    // 2. The human-readable headline and meaning.
    headline: (s) => TELEMETRY_STATE_HEADLINES[s],
    meaning: (s) => TELEMETRY_STATE_MEANINGS[s],
    // 3. The report's own summary sentence — the string that reaches an operator.
    summary: (s) => reportFor(s).summary,
    // 4. The predicate tuple — what any consumer actually branches on. Two
    //    states sharing all of these would be functionally one state with two
    //    names, however differently they are documented.
    //
    //    The FOURTH element is load-bearing and was missing on the first
    //    attempt: healthy/known/incident alone renders `false/false/false` for
    //    BOTH unknown states, because "we did not look" and "we could not look"
    //    genuinely are alike on those three axes. What separates them is what
    //    they DO — (c) fails closed and opens the breaker, (a) does not, because
    //    an engine with no history must still be able to start. Leaving the
    //    fourth axis out would have let the two collapse everywhere a consumer
    //    branches, which is exactly the failure being tested for.
    predicates: (s) =>
      `${telemetryStateIsHealthy(s)}/${telemetryStateIsKnown(s)}/` +
      `${telemetryStateIsIncident(s)}/${telemetryStateOpensBreaker(s)}`,
    // 5. The breaker verdict, rendered from the fields a consumer decides on.
    //
    //    `state` alone is not enough: closed-because-clean and
    //    closed-because-nothing-was-measured are both `closed`, and `basis` is
    //    what separates them — that distinction did not exist before.
    //
    //    `basis` alone is not enough either: (c) and (d) both open on `measured`,
    //    for a reason that is argued rather than accidental — see the branch in
    //    circuit-breaker.ts and circuit-breaker-chaos.test.ts. What separates
    //    those two is `observed.telemetryState`, which is part of the verdict
    //    ("the numbers the decision was made from, retained for the audit log")
    //    and is the field an operator triages on.
    breakerVerdict: (s) => {
      const r = reportFor(s);
      const v = evaluateBreakers({
        silentSuccess: silentSuccessBreakerInput(r, r.measuredRuns + r.skippedRuns),
      }).verdicts.find((x) => x.name === "silent_success");
      return `${v?.state}/${v?.basis}/${v?.halts.join(",") || "none"}/${v?.observed.telemetryState}`;
    },
    // 6. The verdict's WHY. Two states that open the same breaker with the same
    //    sentence are one alert with two causes, and an operator cannot act on
    //    that: (c) is fixed with a grant, (d) with a job.
    breakerWhy: (s) => {
      const r = reportFor(s);
      const v = evaluateBreakers({
        silentSuccess: silentSuccessBreakerInput(r, r.measuredRuns + r.skippedRuns),
      }).verdicts.find((x) => x.name === "silent_success");
      return v?.why ?? "";
    },
  };

  for (const [layerName, render] of Object.entries(layers)) {
    const seen = new Map<string, TelemetryState>();
    for (const s of TELEMETRY_STATES) {
      const value = render(s);
      const clash = seen.get(value);
      assert.equal(
        clash,
        undefined,
        `LAYER '${layerName}': states '${clash}' and '${s}' render identically as ${JSON.stringify(value)}. ` +
          `Two states that produce the same output are one state with two names, which is the collapse ` +
          `this whole taxonomy exists to prevent.`
      );
      seen.set(value, s);
    }
    assert.equal(seen.size, 4, `layer '${layerName}' must distinguish all four states`);
  }
});

test("the two UNKNOWN states are distinguishable from each other, not merged into 'not healthy'", () => {
  // The easy wrong fix is one boolean: healthy / not healthy. That would make
  // "the engine has not run" and "we cannot read the engine's history" the same
  // alert, with the same action, and only one of them is fixed by restoring a
  // grant.
  const a = reportFor("zero_measured_runs");
  const c = reportFor("telemetry_unavailable");

  assert.equal(a.healthy, false);
  assert.equal(c.healthy, false);
  assert.equal(a.known, false);
  assert.equal(c.known, false);
  // ...and yet:
  assert.notEqual(a.telemetryState, c.telemetryState);
  assert.notEqual(a.summary, c.summary);
  assert.notEqual(a.clean, c.clean, "(c) raises a critical signal; (a) has no evidence to raise one from");
  assert.equal(telemetryStateOpensBreaker("zero_measured_runs"), false);
  assert.equal(telemetryStateOpensBreaker("telemetry_unavailable"), true);
});

// ---------------------------------------------------------------------------
// (b) must not trip a breaker; (a) and (c) must still block graduation
// ---------------------------------------------------------------------------

test("state (b) trips NOTHING — a clean measured window never halts a capability", () => {
  const r = reportFor("measured_clean");
  const breakers = evaluateBreakers({
    silentSuccess: silentSuccessBreakerInput(r, r.measuredRuns),
    // Everything else supplied so the assertion is about this breaker only.
    publication: { createdLast24h: 2, dailyMedian: 1 },
    validators: [
      { validator: "media_rights", available: true },
      { validator: "postconditions", available: true },
      { validator: "fail_closed_rule", available: true },
    ],
  });
  const v = breakers.verdicts.find((x) => x.name === "silent_success");
  assert.equal(v?.state, "closed");
  assert.equal(v?.basis, "measured");
  assert.deepEqual(v?.halts, []);
});

test("state (a) does NOT open the breaker — a new engine must be able to start", () => {
  // A breaker that opens on an empty history is not fail-closed; it is stuck,
  // and the engine could never record the first run that would clear it. The
  // honest report is `basis: "no_data"` on a CLOSED verdict, and the refusal
  // happens at the graduation gate instead — which is where an unproven claim
  // actually has to be refused.
  const r = reportFor("zero_measured_runs");
  const v = evaluateBreakers({
    silentSuccess: silentSuccessBreakerInput(r, 6),
  }).verdicts.find((x) => x.name === "silent_success");

  assert.equal(v?.state, "closed");
  assert.equal(v?.basis, "no_data", "closed on NO DATA is a different fact from closed on measurement");
  assert.match(v?.why ?? "", /NOT a clean bill of health/);
  assert.equal(v?.observed.telemetryState, "zero_measured_runs");
  assert.equal(v?.observed.measuredRuns, 0);
});

test("graduation is blocked by (a), (c) and (d), and permitted only by (b)", () => {
  for (const state of TELEMETRY_STATES) {
    const r = reportFor(state);
    const blockers = silentSuccessGraduationBlockers({
      report: r,
      silentNoOpsObserved: 0,
      blindWriteOperations: [],
    });
    const stateBlocker = blockers.find((b) => b.criterion === "SILENT_SUCCESS telemetry state");
    if (state === "measured_clean") {
      assert.equal(stateBlocker, undefined, "a measured clean window must not be blocked by this rule");
    } else {
      assert.ok(stateBlocker, `${state} must block graduation`);
      assert.match(stateBlocker.actual, new RegExp(state));
    }
    assert.equal(telemetryStateBlocksGraduation(state), state !== "measured_clean");
  }
});

test("hardenReadiness can only ever LOWER a verdict, in every state", () => {
  for (const state of TELEMETRY_STATES) {
    const r = reportFor(state);
    const before = { autonomousUnlocked: true, highestJustifiedMode: "AUTONOMOUS", blockers: [] };
    const after = hardenReadiness(before, {
      report: r,
      silentNoOpsObserved: 0,
      blindWriteOperations: [],
    });
    if (state === "measured_clean") {
      // (b) alone still leaves postcondition telemetry to satisfy; the fixture
      // supplies it, so nothing is added.
      assert.equal(after.autonomousUnlocked, true, "a genuinely clean window is not penalised");
    } else {
      assert.equal(after.autonomousUnlocked, false, `${state} must block autonomy`);
      assert.notEqual(after.highestJustifiedMode, "AUTONOMOUS");
    }
  }
});
