// CHAOS: does an open breaker actually STOP anything?
//
// THE QUESTION THIS FILE EXISTS TO ANSWER
// ---------------------------------------
// A breaker object reporting `state: "open"` is a value, not a halt. The engine
// only stops doing something if the open breaker reaches the place where a stage
// is about to run and turns it away. Between those two facts sits a chain that
// has to be shown to hold, because a safety layer with no consumer is
// indistinguishable from no safety layer — the tick route's own comment says
// exactly that, and it says it because for a while that was literally the case
// here: every breaker existed, nothing called them, and an open breaker halted
// nothing at all.
//
// THE REAL CHAIN, AND HOW MUCH OF IT THIS FILE EXECUTES
// -----------------------------------------------------
// In production the chain is five links:
//
//   (1) evaluateBreakers(inputs)                        circuit-breaker.ts  ✅ executed here
//   (2) report.halted = ALL_CAPABILITIES.filter(...)    circuit-breaker.ts  ✅ executed here
//   (3) capabilityOf(jobName)                           concurrency.ts      ✅ executed here
//   (4) haltReason(report, capability)                  circuit-breaker.ts  ✅ executed here
//   (5) guard.gateFor(jobName) -> tick's `if (!gate.allow) continue`
//                                                       guard.ts + route.ts  ❌ NOT executed
//
// Link 5 is three lines of guard.ts and one `if` in the tick route, and both
// files are unreachable from `node --test`: guard.ts begins `import
// "server-only"` and the route imports `next/server`. So this module composes
// links 3 and 4 in the same order and with the same arguments guard.ts uses,
// and the composition is quoted below verbatim so a reader can check it by eye
// rather than by trust.
//
// From src/lib/engine/guard.ts, buildGuard().gateFor(), unmodified:
//
//     function gateFor(jobName: string): StageGate {
//       const capability = capabilityOf(jobName);
//       if (!capability) {
//         return { allow: false, why: `'${jobName}' is not in ENGINE_JOBS, ...` };
//       }
//       const breakerWhy = haltReason(breakers, capability);
//       if (breakerWhy) {
//         return { allow: false, why: `Circuit breaker halted '${capability}'. ${breakerWhy}` };
//       }
//       ...
//
// A proof built on this module therefore covers "an open breaker names the
// capability, and every job carrying that capability resolves to a refusal with
// a reason". It does NOT cover "the tick route honours the refusal", which
// remains readable-but-unexecuted. Say so in the proof record.
//
// NOT server-only.

import {
  ALL_CAPABILITIES,
  evaluateBreakers,
  haltReason,
  isHalted,
  type BreakerReport,
  type EngineCapability,
  type SourceFailureInput,
  type ValidationRejectionInput,
} from "../circuit-breaker.ts";
import { ENGINE_JOBS, capabilityOf } from "../concurrency.ts";
import { assessEngineHealth, breakerInputsFromRuns, type HealthReport } from "../health.ts";
import {
  detectSilentSuccess,
  silentSuccessBreakerInput,
  type SilentSuccessReport,
  type SilentSuccessRun,
} from "../silent-success.ts";
import { probeCoreValidators } from "../validators.ts";

export type GuardView = {
  breakers: BreakerReport;
  health: HealthReport;
  silentSuccess: SilentSuccessReport;
};

/**
 * Links 1 and 2, assembled exactly as `buildGuard()` assembles them.
 *
 * From src/lib/engine/guard.ts, unmodified:
 *
 *     const health = assessEngineHealth(telemetry.runs, { now });
 *     const fromRuns = telemetry.available ? breakerInputsFromRuns(telemetry.runs, { now }) : {};
 *     const silentSuccess = detectSilentSuccess(telemetry.runs, { telemetryAvailable: telemetry.available });
 *     const breakers = evaluateBreakers({
 *       ...fromRuns,
 *       sources: telemetry.sources,
 *       validation: telemetry.validation,
 *       validators: probeCoreValidators(),
 *       silentSuccess: silentSuccessBreakerInput(silentSuccess, telemetry.runs.length),
 *     });
 *
 * Every function named there is imported here from its real module and called
 * with the same arguments in the same order, including the real
 * `probeCoreValidators()` rather than a stubbed roster. Only the surrounding
 * `EngineGuard` object — which adds no rule of its own; guard.ts's own header
 * says "Nothing here has a rule of its own, deliberately" — is absent.
 */
export function evaluateAsGuardWould(telemetry: {
  available: boolean;
  runs: SilentSuccessRun[];
  sources?: SourceFailureInput;
  validation?: ValidationRejectionInput;
  now: Date;
}): GuardView {
  const { now } = telemetry;
  const health = assessEngineHealth(telemetry.runs, { now });
  const fromRuns = telemetry.available ? breakerInputsFromRuns(telemetry.runs, { now }) : {};
  const silentSuccess = detectSilentSuccess(telemetry.runs, { telemetryAvailable: telemetry.available });
  const breakers = evaluateBreakers({
    ...fromRuns,
    sources: telemetry.sources,
    validation: telemetry.validation,
    validators: probeCoreValidators(),
    silentSuccess: silentSuccessBreakerInput(silentSuccess, telemetry.runs.length),
  });
  return { breakers, health, silentSuccess };
}

export type CapabilityGate = {
  job: string;
  capability: EngineCapability | null;
  allow: boolean;
  why: string;
};

/**
 * Links 3 and 4 of the chain, composed exactly as guard.ts composes them.
 *
 * Deliberately covers ONLY the breaker branch. guard.gateFor also consults the
 * concurrency lease and the budget ledger, and folding those in here would make
 * a refusal ambiguous about which mechanism produced it — the opposite of what a
 * proof needs.
 */
export function breakerGateFor(report: BreakerReport, jobName: string): CapabilityGate {
  const capability = capabilityOf(jobName);

  // Mirrors guard.ts's unmappable-job refusal. Kept in step deliberately: a job
  // nobody registered has no capability, therefore no breaker can ever halt it,
  // therefore allowing it would be allowing a stage to run with the entire
  // safety layer open. Refusing is the only reading of "I do not know what this
  // is allowed to do" that is not "anything".
  if (!capability) {
    return {
      job: jobName,
      capability: null,
      allow: false,
      why:
        `'${jobName}' is not in ENGINE_JOBS, so no capability, breaker or concurrency rule applies ` +
        `to it. Refused rather than allowed.`,
    };
  }

  const breakerWhy = haltReason(report, capability);
  if (breakerWhy) {
    return {
      job: jobName,
      capability,
      allow: false,
      why: `Circuit breaker halted '${capability}'. ${breakerWhy}`,
    };
  }
  return { job: jobName, capability, allow: true, why: "No open breaker names this capability." };
}

/**
 * The capability list the engine is left able to act on.
 *
 * Derived from the real `ALL_CAPABILITIES` and the real `isHalted`, so a
 * capability appears here only if no open verdict claims it. The assertion a
 * chaos proof wants is about ABSENCE from this list, not presence in
 * `report.halted` — an empty `halts` array on an open breaker would satisfy the
 * second and fail the first.
 */
export function capabilitiesStillRunnable(report: BreakerReport): EngineCapability[] {
  return ALL_CAPABILITIES.filter((c) => !isHalted(report, c));
}

/** Every audited engine job, gated. The job list is production data, not a fixture. */
export function gateEveryJob(report: BreakerReport): CapabilityGate[] {
  return ENGINE_JOBS.map((j) => breakerGateFor(report, j.job));
}

/** How many registered stages actually carry a capability. */
export function jobsCarrying(capability: EngineCapability): string[] {
  return ENGINE_JOBS.filter((j) => j.capability === capability).map((j) => j.job);
}

export type Enforceability = "enforceable" | "not_applicable";

/**
 * Whether halting a capability can turn any stage away AT ALL.
 *
 * Made explicit because it is otherwise a vacuous truth waiting to be mistaken
 * for evidence: "every job carrying `publication` was refused" is trivially
 * satisfied when no job carries `publication`, which is the case today —
 * ENGINE_JOBS has zero entries for it. Halting publication is therefore
 * currently a statement about a capability nothing implements, and a proof must
 * report that as NOT APPLICABLE rather than counting it as a halt that worked.
 */
export function enforceabilityOf(capability: EngineCapability): {
  capability: EngineCapability;
  jobs: string[];
  status: Enforceability;
  why: string;
} {
  const jobs = jobsCarrying(capability);
  return {
    capability,
    jobs,
    status: jobs.length > 0 ? "enforceable" : "not_applicable",
    why:
      jobs.length > 0
        ? `${jobs.length} registered stage(s) carry '${capability}': ${jobs.join(", ")}. Halting it turns them away.`
        : `NO registered stage carries '${capability}'. Halting it refuses nothing, because nothing ` +
          `implements it yet — an assertion that "every job carrying it was refused" is vacuously ` +
          `true and is not evidence that the halt works.`,
  };
}

/** The jobs an open breaker actually turns away. */
export function jobsHalted(report: BreakerReport): CapabilityGate[] {
  return gateEveryJob(report).filter((g) => !g.allow);
}

/** The jobs still permitted to run. */
export function jobsRunnable(report: BreakerReport): CapabilityGate[] {
  return gateEveryJob(report).filter((g) => g.allow);
}

/**
 * A one-line, quotable summary of what a breaker report actually did to the
 * engine. Used by the tests to emit REAL observed values into the proof record
 * rather than a restatement of the assertion.
 */
export function describeHalt(report: BreakerReport): string {
  const halted = jobsHalted(report);
  return (
    `open=[${report.open.map((v) => v.name).join(",") || "none"}] ` +
    `halted=[${report.halted.join(",") || "none"}] ` +
    `stillRunnable=[${capabilitiesStillRunnable(report).join(",") || "none"}] ` +
    `jobsRefused=${halted.length}/${ENGINE_JOBS.length}` +
    (halted.length > 0 ? ` (${halted.map((g) => g.job).join(",")})` : "")
  );
}
