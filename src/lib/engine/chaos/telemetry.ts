// CHAOS: the healthy world the fault is induced into.
//
// A chaos proof needs a CONTROL. "The breaker is open" means nothing on its own
// — it could have been open before anybody touched the system, which is the
// state a fail-closed design starts in. The observation that counts is the
// TRANSITION: everything closed and every capability runnable, then a fault, then
// the specific breaker open and the specific capabilities gone.
//
// So this module builds a realistic, boringly healthy engine history — ten days
// of nightly ticks across four stages, in the exact shape
// `engine_recent_job_runs` returns and `breakerInputsFromRuns` consumes — and
// the tests assert it is genuinely healthy before breaking anything. If it were
// not, every later assertion would be measuring the fixture instead of the fault.
//
// The numbers are chosen to sit clear of every threshold in circuit-breaker.ts
// and health.ts rather than to game them: a producer that produces, a consumer
// that consumes, a nightly cadence, no errors. Anything closer to a limit would
// make the control fragile and the proof worthless.
//
// NOT server-only.

import type { SourceFailureInput, ValidationRejectionInput } from "../circuit-breaker.ts";
import type { SilentSuccessRun } from "../silent-success.ts";

/** The instant every scenario is evaluated at. Fixed so nothing depends on today. */
export const CHAOS_NOW = new Date("2026-08-22T05:30:00.000Z");

/** Nightly tick time, matching vercel.json's `30 4 * * *`. */
const TICK_HOUR_UTC = 4;

type StageShape = {
  jobName: string;
  examined: number;
  created: number;
  deduped: number;
};

/**
 * Four stages that between them satisfy every cross-run detector in
 * silent-success.ts: a producer that has produced, its declared consumer
 * actually consuming, and an assessor legitimately creating nothing.
 */
const HEALTHY_STAGES: readonly StageShape[] = [
  { jobName: "engine_discover", examined: 22, created: 3, deduped: 0 },
  // engine_discover feeds engine_relevance; relevance must have examined
  // something or `downstream_starved` fires on a perfectly healthy fixture.
  { jobName: "engine_relevance", examined: 9, created: 4, deduped: 0 },
  // engine_relevance feeds engine_briefs.
  { jobName: "engine_briefs", examined: 4, created: 1, deduped: 0 },
  // An assessor. It has to be given something to create here, even though
  // STAGE_EFFECTS declares creating nothing to be its healthy state — because
  // `success_no_effect` in health.ts and silent-success.ts does NOT consult
  // StageRole, and an assessor row of (examined>0, created 0, deduped 0,
  // failed 0) is read as a critical silent success. That is a real defect, it is
  // demonstrated deliberately in assessor-false-positive.test.ts, and the
  // control fixture has to route around it or every scenario below would be
  // measuring the defect instead of the fault it induced.
  { jobName: "engine_freshness", examined: 6, created: 1, deduped: 0 },
];

/**
 * `days` nights of successful ticks ending one hour before CHAOS_NOW.
 *
 * `telemetryColumns` models whether the pending silent-success migration has
 * been applied. Both worlds matter: with the columns absent the sharp per-run
 * detector is blind and only the cross-run shapes can fire, and a proof should
 * be able to say which world it was obtained in.
 */
export function healthyHistory(opts?: { days?: number; telemetryColumns?: boolean }): SilentSuccessRun[] {
  const days = opts?.days ?? 10;
  const withColumns = opts?.telemetryColumns ?? true;
  const runs: SilentSuccessRun[] = [];

  for (let d = days - 1; d >= 0; d--) {
    const started = new Date(CHAOS_NOW);
    started.setUTCDate(started.getUTCDate() - d);
    started.setUTCHours(TICK_HOUR_UTC, 30, 0, 0);
    const finished = new Date(started.getTime() + 90_000);

    for (const stage of HEALTHY_STAGES) {
      runs.push({
        jobName: stage.jobName,
        status: "success",
        startedAt: started.toISOString(),
        finishedAt: finished.toISOString(),
        itemsExamined: stage.examined,
        itemsCreated: stage.created,
        itemsDeduped: stage.deduped,
        itemsFailed: 0,
        hasError: false,
        silentNoOps: withColumns ? 0 : null,
        unverifiedWrites: withColumns ? 0 : null,
        blindWrites: withColumns ? 0 : null,
        verifiedWrites: withColumns ? stage.created + stage.deduped : null,
      });
    }
  }

  return runs;
}

/** An hour offset from CHAOS_NOW, for placing an induced run in the timeline. */
export function minutesBeforeNow(minutes: number): string {
  return new Date(CHAOS_NOW.getTime() - minutes * 60_000).toISOString();
}

/** A source registry with nothing wrong with it. */
export const HEALTHY_SOURCES: SourceFailureInput = {
  checked: 6,
  failed: 0,
  maxConsecutiveFailures: 0,
};

/** Validation outcomes with nothing wrong with them. */
export const HEALTHY_VALIDATION: ValidationRejectionInput = {
  evaluated: 20,
  rejected: 2,
  baselineRejectionRate: 0.1,
};
