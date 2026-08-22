// Self-monitoring for the Growth Engine.
//
// Answers the question the audit log cannot answer on its own: "is
// `status: success` telling the truth?"
//
// Every threshold here is derived from the JOB'S OWN RECENT HISTORY, never from
// a number someone picked. A job that normally examines 400 rows and suddenly
// examines 0 is broken; a job that has always examined 0 is idle. The only way
// to tell those apart is to compare a job against itself, so that is what this
// does — and where there is not enough history to compare against, it says so
// (`insufficient_history`) instead of inventing a baseline.
//
// Robust statistics on purpose: median and median-absolute-deviation, not mean
// and standard deviation. One catastrophic run (10,000 created) would drag a
// mean far enough that the NEXT catastrophic run looks normal. The median does
// not move.
//
// Pure and testable — the caller supplies the rows.

import type {
  BreakerInputs,
  DatabaseErrorInput,
  DuplicationInput,
  HealthFindingsInput,
  JobIntervalInput,
  PublicationVolumeInput,
} from "./circuit-breaker.ts";
import { CREATION_JOBS } from "./concurrency.ts";
import { stageEffectOf } from "./stage-roles.ts";

/**
 * How often a job is actually SUPPOSED to run.
 *
 * This used to be the job's own observed median gap between runs, and that is
 * wrong in a way that matters: every engine job runs as a stage of the single
 * `/api/engine/tick` cron, scheduled `30 4 * * *` in vercel.json — once a day.
 * But the observed median is polluted by manual invocations. During
 * development on 2026-08-22 it fell to **1.03h for a job scheduled every 24h**,
 * so the breaker declared a perfectly healthy nightly job overdue after two
 * hours and halted creation, media acquisition and publication.
 *
 * A breaker that opens permanently on a false signal is not fail-closed. It is
 * broken, and worse than absent, because it trains an operator to ignore it.
 *
 * The declared schedule is a known quantity, so use it. Observation is only
 * consulted for a job that runs MORE often than the tick — a genuinely
 * faster-cycling job should not be judged against a daily cadence — and never
 * to shorten the expectation below the schedule.
 */
export const TICK_CADENCE_HOURS = 24;

export function expectedCadenceHours(observedMedianHours: number): number {
  // Trust observation only where it exceeds the declared schedule, which can
  // only mean the job genuinely runs less often than the tick.
  if (observedMedianHours > TICK_CADENCE_HOURS) return observedMedianHours;
  return TICK_CADENCE_HOURS;
}

export type JobRunStatus = "running" | "success" | "partial" | "failed" | "skipped";

/** One engine_job_runs row, in the shape the read RPC returns. */
export type JobRunRecord = {
  jobName: string;
  status: JobRunStatus;
  startedAt: string;
  finishedAt: string | null;
  itemsExamined: number;
  itemsCreated: number;
  itemsDeduped: number;
  itemsFailed: number;
  /** Whether the row carried an error string. The text itself is not exposed. */
  hasError: boolean;
};

export const HEALTH_THRESHOLDS = {
  /** Runs of history needed before any baseline-relative rule may fire. */
  minHistoryRuns: 5,
  /** Robust z-score beyond which a count is called abnormal. */
  robustZ: 3.5,
  /** Multiple of the job's own median gap after which it is called stale. */
  staleIntervalMultiplier: 2.5,
  /** Absolute floor for staleness, so a fast job is not called stale in minutes. */
  staleFloorHours: 2,
  /** Multiple of the job's own median duration after which a 'running' row is stuck. */
  stuckRunMultiplier: 5,
  /** Floor for the stuck rule. */
  stuckFloorMinutes: 30,
  /** Consecutive all-deduped runs that indicate a starved pipeline. */
  dedupeStarvationRuns: 3,
  /** Consecutive failed runs that count as repeated failure. */
  repeatedFailureRuns: 3,
} as const;

export type HealthFindingKind =
  /** Reported success, examined rows, and changed absolutely nothing. */
  | "success_no_effect"
  /** Reported success having examined nothing, when it normally examines plenty. */
  | "zero_processing_anomaly"
  /** Created count far outside the job's own history, in either direction. */
  | "abnormal_volume"
  /** Has not run within its own observed cadence. */
  | "stale_job"
  /** A 'running' row that never finished. */
  | "stuck_run"
  /** Deduplication rate out of line with the job's own history. */
  | "deduplication_anomaly"
  /** Everything deduped and nothing created, for several runs. */
  | "deduplication_starvation"
  /** Several consecutive failed runs. */
  | "repeated_failures"
  /**
   * The stage could not establish that it was ABLE TO SEE its own input.
   *
   * The row shape is: status 'failed', every counter zero. A stage that got as
   * far as examining, creating, deduplicating or failing an item has
   * demonstrated that it could read something; one that failed before touching
   * anything has not, and the two causes that produce this shape are precisely
   * the two this project keeps shipping:
   *
   *   * a queue read that came back empty with no error and no corroborating
   *     evidence that the reader was awake — see queue-read.ts, which is what
   *     turns that case into this row instead of into `status: success`;
   *   * a kill-switch read that failed, so the stage does not know whether it
   *     was allowed to run — see readFlag() in cron.ts.
   *
   * NEEDS NO HISTORY, and that is the entire point. `zero_processing_anomaly`
   * below compares a job against its own baseline and therefore cannot fire for
   * a stage that has been denied since birth — which is exactly how the 2026-08
   * grants incident survived weeks. This one fires on the FIRST such run.
   */
  | "input_unproven"
  /** Not enough history to judge. Reported rather than silently assumed fine. */
  | "insufficient_history";

export type HealthSeverity = "info" | "warning" | "critical";

export type HealthFinding = {
  job: string;
  kind: HealthFindingKind;
  severity: HealthSeverity;
  /** WHY, in words an admin can act on. */
  why: string;
  action: string;
  observed: Record<string, number | string | boolean | null>;
};

export type JobHealth = {
  job: string;
  runs: number;
  lastRunAt: string | null;
  lastSuccessAt: string | null;
  hoursSinceLastSuccess: number | null;
  /** Median hours between consecutive runs, from this job's own history. */
  medianIntervalHours: number | null;
  medianExamined: number | null;
  medianCreated: number | null;
  medianDuplicationRate: number | null;
  consecutiveFailures: number;
};

export type HealthReport = {
  now: string;
  jobs: JobHealth[];
  findings: HealthFinding[];
  critical: HealthFinding[];
  healthy: boolean;
  summary: string;
};

// ---------------------------------------------------------------------------
// Robust statistics
// ---------------------------------------------------------------------------

export function median(values: readonly number[]): number | null {
  if (values.length === 0) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 0 ? (sorted[mid - 1] + sorted[mid]) / 2 : sorted[mid];
}

/** Median absolute deviation — the spread measure that one outlier cannot move. */
export function medianAbsoluteDeviation(values: readonly number[]): number | null {
  const m = median(values);
  if (m === null) return null;
  return median(values.map((v) => Math.abs(v - m)));
}

/**
 * Robust z-score. 0.6745 rescales MAD so the result is comparable to a normal
 * z-score. Returns null when the history is too flat to say anything: a MAD of
 * zero means every historical value was identical, and dividing by it would
 * turn any deviation at all into infinity.
 */
export function robustZScore(value: number, history: readonly number[]): number | null {
  const m = median(history);
  const mad = medianAbsoluteDeviation(history);
  if (m === null || mad === null) return null;
  if (mad === 0) return null;
  return (0.6745 * (value - m)) / mad;
}

function hoursBetween(later: Date, earlier: Date): number {
  return (later.getTime() - earlier.getTime()) / 3_600_000;
}

function duplicationRate(run: JobRunRecord): number | null {
  const total = run.itemsCreated + run.itemsDeduped;
  return total === 0 ? null : run.itemsDeduped / total;
}

// ---------------------------------------------------------------------------
// Assessment
// ---------------------------------------------------------------------------

export function assessEngineHealth(
  runs: readonly JobRunRecord[],
  opts: { now: Date }
): HealthReport {
  const now = opts.now;
  const byJob = new Map<string, JobRunRecord[]>();
  for (const run of runs) {
    const list = byJob.get(run.jobName);
    if (list) list.push(run);
    else byJob.set(run.jobName, [run]);
  }

  const jobs: JobHealth[] = [];
  const findings: HealthFinding[] = [];

  for (const [job, all] of byJob) {
    // Newest first.
    const ordered = [...all].sort(
      (a, b) => new Date(b.startedAt).getTime() - new Date(a.startedAt).getTime()
    );

    // Skipped runs are excluded from every baseline. A flag-disabled run records
    // zeros by definition, and letting those into the history would drag the
    // median to zero and then declare a genuinely broken run "normal".
    const measured = ordered.filter((r) => r.status !== "skipped");
    const latest = measured[0] ?? null;
    const history = measured.slice(1);

    const lastSuccess = measured.find((r) => r.status === "success" || r.status === "partial") ?? null;
    const hoursSinceLastSuccess = lastSuccess ? hoursBetween(now, new Date(lastSuccess.startedAt)) : null;

    const intervals: number[] = [];
    for (let i = 0; i < measured.length - 1; i++) {
      intervals.push(hoursBetween(new Date(measured[i].startedAt), new Date(measured[i + 1].startedAt)));
    }
    const medianIntervalHours = intervals.length >= 2 ? median(intervals) : null;

    const historyExamined = history.map((r) => r.itemsExamined);
    const historyCreated = history.map((r) => r.itemsCreated);
    const historyDuplication = history
      .map(duplicationRate)
      .filter((r): r is number => r !== null);

    let consecutiveFailures = 0;
    for (const r of measured) {
      if (r.status === "failed") consecutiveFailures++;
      else break;
    }

    jobs.push({
      job,
      runs: ordered.length,
      lastRunAt: ordered[0]?.startedAt ?? null,
      lastSuccessAt: lastSuccess?.startedAt ?? null,
      hoursSinceLastSuccess,
      medianIntervalHours,
      medianExamined: median(historyExamined),
      medianCreated: median(historyCreated),
      medianDuplicationRate: median(historyDuplication),
      consecutiveFailures,
    });

    if (!latest) continue;

    // --- 1. Success with no effect at all -----------------------------------
    // Needs no history: a run that examined rows, reported success, and created,
    // deduped and failed nothing did not do the thing it says it did. This is
    // the exact shape of "0 rows deleted, no error".
    //
    // ROLE-AWARE, and it was not — the same defect silent-success.ts carried,
    // for the same reason: the role model lived inside that file and this one
    // could not import it without a cycle. Both files therefore raised a
    // CRITICAL success_no_effect for engine_internal_links whenever the site had
    // ZERO orphans, which is that stage's goal. That opened the silent_success
    // breaker and halted creation, media_acquisition and publication: a healthy
    // site stopped the engine writing articles.
    //
    // An assessor examining rows and flagging none of them is the intended
    // outcome. An assessor whose writes are being DENIED shows the same counters
    // but also carries silent no-ops, which detector #4 in silent-success.ts
    // reads for every job regardless of role — so nothing is lost here.
    const touched = latest.itemsCreated + latest.itemsDeduped + latest.itemsFailed;
    const isAssessor = stageEffectOf(job)?.role === "assessor";
    if (
      !isAssessor &&
      (latest.status === "success" || latest.status === "partial") &&
      latest.itemsExamined > 0 &&
      touched === 0
    ) {
      findings.push({
        job,
        kind: "success_no_effect",
        severity: "critical",
        why:
          `${job} reported '${latest.status}' after examining ${latest.itemsExamined} item(s) while ` +
          `creating, deduplicating and failing NONE of them. Examining rows and affecting nothing is ` +
          `the signature of a write that matched zero rows and returned no error — which is how RLS ` +
          `denies the anon role.`,
        action:
          "Check that the RPC this job writes through exists at the signature the job calls, and " +
          "that anon still has execute on it. A renamed or re-signed function fails exactly like this.",
        observed: {
          examined: latest.itemsExamined,
          created: latest.itemsCreated,
          deduped: latest.itemsDeduped,
          failed: latest.itemsFailed,
          status: latest.status,
        },
      });
    }

    // --- 1b. The stage never established that it could see its input --------
    // NO HISTORY REQUIRED. Every other baseline-relative rule in this file
    // compares a job against itself, which is the right instrument for a job
    // that USED to work — and completely blind to one that never did. A stage
    // whose grant was missing from the day it shipped has a flat history of
    // zeros and looks perfectly normal against it.
    //
    // This rule reads a shape instead of a baseline: a run that ended in
    // 'failed' having examined, created, deduplicated and failed NOTHING did not
    // get far enough to touch any work. Either its input read could not be shown
    // to have been permitted (queue-read.ts records exactly this row for an
    // unproven empty queue) or its kill-switch read failed (readFlag() in
    // cron.ts records exactly this row for `<flag>_flag_unreadable`).
    //
    // Both are the same fact from the engine's point of view: THE STAGE CANNOT
    // SHOW THAT IT WAS ABLE TO LOOK. That is not a quiet night.
    if (
      latest.status === "failed" &&
      latest.itemsExamined === 0 &&
      latest.itemsCreated === 0 &&
      latest.itemsDeduped === 0 &&
      latest.itemsFailed === 0
    ) {
      findings.push({
        job,
        kind: "input_unproven",
        severity: "critical",
        why:
          `${job}'s most recent run ended in 'failed' having examined, created, deduplicated and failed ` +
          `NOTHING. It did not get far enough to touch a single item, so it never demonstrated that it ` +
          `could read its own input queue or its own kill switch. Under RLS a denied read returns zero ` +
          `rows and no error, so "there was nothing to do" and "we were not allowed to look" are the same ` +
          `bytes — this run refused to claim the first without evidence, and that refusal is what is ` +
          `being reported here. It needs no history, which is why a stage denied FROM BIRTH is visible.`,
        action:
          "Read the run's detail payload. If it carries a `stageOutcome` block, the `inputProbe` inside " +
          "names the read, what corroboration was attempted and why it was insufficient. If it carries " +
          "a `<flag>_flag_unreadable` reason, engine_flag_enabled is the thing to call by hand as anon.",
        observed: {
          status: latest.status,
          examined: 0,
          created: 0,
          deduped: 0,
          failed: 0,
          hasError: latest.hasError,
          priorRuns: history.length,
        },
      });
    }

    // --- 2. Insufficient history -------------------------------------------
    if (history.length < HEALTH_THRESHOLDS.minHistoryRuns) {
      findings.push({
        job,
        kind: "insufficient_history",
        severity: "info",
        why:
          `${job} has ${history.length} prior measured run(s), fewer than the ` +
          `${HEALTH_THRESHOLDS.minHistoryRuns} needed to establish a baseline. Volume and ` +
          `deduplication anomalies cannot be judged for it yet, and are reported as unknown rather ` +
          `than as healthy.`,
        action: "None — this resolves itself as the job accumulates runs.",
        observed: { priorRuns: history.length, required: HEALTH_THRESHOLDS.minHistoryRuns },
      });
    }

    // --- 3. Zero processing against a history of processing ------------------
    const medianExamined = median(historyExamined);
    if (
      history.length >= HEALTH_THRESHOLDS.minHistoryRuns &&
      latest.status === "success" &&
      latest.itemsExamined === 0 &&
      medianExamined !== null &&
      medianExamined >= 1
    ) {
      findings.push({
        job,
        kind: "zero_processing_anomaly",
        severity: "critical",
        why:
          `${job} reported success having examined 0 items, but its own median across the last ` +
          `${history.length} runs is ${medianExamined}. "Nothing to do" and "the query that finds ` +
          `work returned nothing because it was denied" produce identical job rows, so this is ` +
          `flagged rather than accepted.`,
        action:
          "Run the job's input RPC by hand as anon. If it returns zero rows, the engine flag is off " +
          "or the RPC's internal flag check is failing — both look like an idle job from here.",
        observed: { examined: 0, medianExamined, historyRuns: history.length },
      });
    }

    // --- 4. Abnormal volume vs the job's own history ------------------------
    if (history.length >= HEALTH_THRESHOLDS.minHistoryRuns) {
      const z = robustZScore(latest.itemsCreated, historyCreated);
      const medianCreated = median(historyCreated);
      if (z !== null && Math.abs(z) >= HEALTH_THRESHOLDS.robustZ) {
        const spike = z > 0;
        findings.push({
          job,
          kind: "abnormal_volume",
          severity: spike ? "critical" : "warning",
          why:
            `${job} created ${latest.itemsCreated} item(s) against its own median of ` +
            `${medianCreated} (robust z-score ${z.toFixed(1)}, threshold ` +
            `${HEALTH_THRESHOLDS.robustZ}). ` +
            (spike
              ? "A sudden spike is how a runaway discovery event turns into a large number of pages."
              : "A sudden collapse usually means the input dried up or a filter started matching everything."),
          action: spike
            ? "Check the newest source output and the dedupe key before letting another pass run."
            : "Check whether an upstream stage stopped producing, or a flag was switched off.",
          observed: {
            created: latest.itemsCreated,
            medianCreated,
            robustZ: Number(z.toFixed(2)),
            historyRuns: history.length,
          },
        });
      }
    }

    // --- 5. Stale job -------------------------------------------------------
    if (medianIntervalHours !== null && medianIntervalHours > 0) {
      const sinceLastRun = hoursBetween(now, new Date(measured[0].startedAt));
      const limit = Math.max(
        medianIntervalHours * HEALTH_THRESHOLDS.staleIntervalMultiplier,
        HEALTH_THRESHOLDS.staleFloorHours
      );
      if (sinceLastRun > limit) {
        findings.push({
          job,
          kind: "stale_job",
          severity: "critical",
          why:
            `${job} last ran ${sinceLastRun.toFixed(1)} hours ago, but its own observed cadence is ` +
            `roughly every ${medianIntervalHours.toFixed(1)} hours. A stage that quietly stopped ` +
            `being invoked leaves no error anywhere — the absence of rows is the only evidence.`,
          action:
            "Check the Vercel cron configuration and the tick route's stage list. A stage removed " +
            "from STAGES, or a cron entry deleted, both produce this.",
          observed: {
            hoursSinceLastRun: Number(sinceLastRun.toFixed(2)),
            medianIntervalHours: Number(medianIntervalHours.toFixed(2)),
            limitHours: Number(limit.toFixed(2)),
          },
        });
      }
    }

    // --- 6. Stuck 'running' row ---------------------------------------------
    if (latest.status === "running" && latest.finishedAt === null) {
      const durations = history
        .filter((r) => r.finishedAt !== null)
        .map((r) => hoursBetween(new Date(r.finishedAt as string), new Date(r.startedAt)) * 60);
      const medianDurationMinutes = median(durations);
      const limitMinutes = Math.max(
        (medianDurationMinutes ?? 0) * HEALTH_THRESHOLDS.stuckRunMultiplier,
        HEALTH_THRESHOLDS.stuckFloorMinutes
      );
      const ageMinutes = hoursBetween(now, new Date(latest.startedAt)) * 60;
      if (ageMinutes > limitMinutes) {
        findings.push({
          job,
          kind: "stuck_run",
          severity: "critical",
          why:
            `${job} has a run marked 'running' that started ${ageMinutes.toFixed(0)} minutes ago and ` +
            `never recorded a finish. Its own median duration is ` +
            `${medianDurationMinutes === null ? "unknown" : `${medianDurationMinutes.toFixed(1)} minutes`}. ` +
            `A run row left open holds the concurrency lease, so the next pass will refuse to start ` +
            `until the lease expires.`,
          action:
            "The function almost certainly timed out or was killed. The lease expires on its own; " +
            "if this recurs, the pass is doing too much work for one invocation.",
          observed: {
            ageMinutes: Number(ageMinutes.toFixed(1)),
            medianDurationMinutes: medianDurationMinutes === null ? null : Number(medianDurationMinutes.toFixed(1)),
            limitMinutes: Number(limitMinutes.toFixed(1)),
          },
        });
      }
    }

    // --- 7. Deduplication anomalies -----------------------------------------
    const latestDuplication = duplicationRate(latest);
    const medianDuplication = median(historyDuplication);
    if (
      historyDuplication.length >= HEALTH_THRESHOLDS.minHistoryRuns &&
      latestDuplication !== null &&
      medianDuplication !== null
    ) {
      const z = robustZScore(latestDuplication, historyDuplication);
      if (z !== null && Math.abs(z) >= HEALTH_THRESHOLDS.robustZ) {
        const collapsed = z < 0;
        findings.push({
          job,
          kind: "deduplication_anomaly",
          severity: "critical",
          why:
            `${job} deduplicated ${(latestDuplication * 100).toFixed(0)}% of its items against its ` +
            `own median of ${(medianDuplication * 100).toFixed(0)}% (robust z-score ${z.toFixed(1)}). ` +
            (collapsed
              ? "A collapse means re-seen items are being written as new records — duplicates accumulate with no error anywhere."
              : "A jump means distinct items are collapsing onto one fingerprint, so genuinely new items are being discarded as repeats."),
          action: collapsed
            ? "Inspect buildDedupeKey() against the newest titles before another pass runs."
            : "Inspect the dedupe keys that absorbed the most sightings; an over-broad key produces this.",
          observed: {
            duplicationRate: Number(latestDuplication.toFixed(3)),
            medianDuplicationRate: Number(medianDuplication.toFixed(3)),
            robustZ: Number(z.toFixed(2)),
          },
        });
      }
    }

    // --- 8. Deduplication starvation ----------------------------------------
    // Several consecutive runs where everything deduped and nothing was created,
    // in a job whose history says it normally creates. Individually each run
    // looks perfectly healthy — that is precisely the problem.
    const recent = measured.slice(0, HEALTH_THRESHOLDS.dedupeStarvationRuns);
    const medianCreatedAll = median(measured.map((r) => r.itemsCreated));
    if (
      recent.length === HEALTH_THRESHOLDS.dedupeStarvationRuns &&
      history.length >= HEALTH_THRESHOLDS.minHistoryRuns &&
      recent.every((r) => r.itemsCreated === 0 && r.itemsDeduped > 0) &&
      medianCreatedAll !== null &&
      medianCreatedAll >= 1
    ) {
      findings.push({
        job,
        kind: "deduplication_starvation",
        severity: "warning",
        why:
          `${job} has created nothing across its last ${recent.length} runs while deduplicating ` +
          `every item, yet its median creation count is ${medianCreatedAll}. Each of those runs ` +
          `reported success and looks healthy on its own; the pattern only shows across runs.`,
        action:
          "Either the sources genuinely stopped publishing anything new, or the dedupe key has " +
          "become too broad and is absorbing new items. Compare a few recent source items against " +
          "the discoveries they matched.",
        observed: {
          runsChecked: recent.length,
          createdAcrossRuns: 0,
          dedupedAcrossRuns: recent.reduce((a, r) => a + r.itemsDeduped, 0),
          medianCreated: medianCreatedAll,
        },
      });
    }

    // --- 9. Repeated failures ----------------------------------------------
    if (consecutiveFailures >= HEALTH_THRESHOLDS.repeatedFailureRuns) {
      findings.push({
        job,
        kind: "repeated_failures",
        severity: "critical",
        why: `${job} has failed ${consecutiveFailures} times in a row.`,
        action: "Read the error on the most recent engine_job_runs row for this job.",
        observed: { consecutiveFailures },
      });
    }
  }

  const critical = findings.filter((f) => f.severity === "critical");
  const warnings = findings.filter((f) => f.severity === "warning");

  const summary =
    critical.length === 0 && warnings.length === 0
      ? `No health problems across ${jobs.length} job(s).`
      : `${critical.length} critical and ${warnings.length} warning finding(s) across ${jobs.length} job(s): ` +
        `${[...critical, ...warnings].map((f) => `${f.job}/${f.kind}`).join(", ")}.`;

  return {
    now: now.toISOString(),
    jobs,
    findings,
    critical,
    healthy: critical.length === 0,
    summary,
  };
}

// ---------------------------------------------------------------------------
// Feeding the circuit breakers
// ---------------------------------------------------------------------------

/**
 * Derive the breaker inputs that can be computed from job history alone.
 *
 * Source health and validation-rejection rates are NOT derivable from
 * engine_job_runs — they need their own aggregate RPCs — so they are
 * deliberately absent here rather than approximated. The breakers treat a
 * missing input according to their own fail-closed table.
 */
/**
 * Health findings that are allowed to OPEN A BREAKER, and the ones that are not.
 *
 * Until now no HealthFinding of any severity reached any breaker. health.ts
 * could raise a CRITICAL `zero_processing_anomaly` — the read-side denial
 * signature, the exact thing this engine exists to catch — and the engine would
 * carry on creating, because `gateFor()` consults the breakers, the lease and
 * the budget ledger and nothing else. A detector whose output gates nothing is a
 * detector that documents an incident rather than preventing one.
 *
 * The list is a SUBSET, deliberately, and the criterion for membership is: does
 * this finding mean THE ENGINE'S REPORT OF ITSELF IS UNRELIABLE?
 *
 *   * `success_no_effect`         — a run said success and touched nothing.
 *   * `zero_processing_anomaly`   — a run said success having examined nothing,
 *                                   against its own history of examining plenty.
 *   * `input_unproven`            — a run could not show it was able to look.
 *
 * DELIBERATELY EXCLUDED: `stale_job`, `stuck_run`, `repeated_failures`,
 * `abnormal_volume`, `deduplication_anomaly`. Not because they are unimportant —
 * each already has its own breaker (`job_interval`, `database_errors`,
 * `publication_volume`, `duplication_rate`) built for it — but because they are
 * evidence that a stage IS NOT RUNNING, and halting a capability is itself a way
 * of stopping stages from running. Folding them in creates a breaker that, once
 * open, guarantees its own input: halted stages record no rows, missing rows
 * become staleness, staleness re-opens the breaker. health.ts's own standard
 * applies — "a breaker that opens permanently on a false signal is not
 * fail-closed, it is broken".
 *
 * The three that ARE included have the same property the `silent_success`
 * breaker already accepts for the identical `success_no_effect` shape: they
 * latch until the cause is fixed and the evidence rolls out of the window. That
 * is the intended cost of refusing to create records on top of an engine whose
 * own telemetry has been shown to be wrong.
 */
export const HALTING_HEALTH_FINDING_KINDS: readonly HealthFindingKind[] = [
  "success_no_effect",
  "zero_processing_anomaly",
  "input_unproven",
];

/** The breaker input derived from a health report. */
export function healthFindingsBreakerInput(report: HealthReport): HealthFindingsInput {
  const halting = report.findings.filter(
    (f) => f.severity === "critical" && HALTING_HEALTH_FINDING_KINDS.includes(f.kind)
  );
  return {
    jobsAssessed: report.jobs.length,
    criticalFindings: report.critical.length,
    haltingFindings: halting.length,
    haltingKinds: [...new Set(halting.map((f) => f.kind))],
    haltingJobs: [...new Set(halting.map((f) => f.job))],
  };
}

export function breakerInputsFromRuns(
  runs: readonly JobRunRecord[],
  opts: { now: Date; creationJobs?: readonly string[] }
): Pick<BreakerInputs, "publication" | "database" | "duplication" | "jobs" | "healthFindings"> {
  const now = opts.now;
  const creationJobs = opts.creationJobs ?? CREATION_JOBS;
  const measured = runs.filter((r) => r.status !== "skipped");

  // --- Publication volume: creation jobs only, bucketed by UTC day ----------
  const creationRuns = measured.filter((r) => creationJobs.includes(r.jobName));
  const byDay = new Map<string, number>();
  for (const run of creationRuns) {
    const day = run.startedAt.slice(0, 10);
    byDay.set(day, (byDay.get(day) ?? 0) + run.itemsCreated);
  }
  const today = now.toISOString().slice(0, 10);
  const createdLast24h = creationRuns
    .filter((r) => hoursBetween(now, new Date(r.startedAt)) <= 24)
    .reduce((a, r) => a + r.itemsCreated, 0);
  const priorDays = [...byDay.entries()].filter(([day]) => day !== today).map(([, n]) => n);

  const publication: PublicationVolumeInput = {
    createdLast24h,
    // Needs several complete days before a median means anything.
    dailyMedian: priorDays.length >= 3 ? median(priorDays) : null,
  };

  // --- Database errors -----------------------------------------------------
  const errored = measured.filter((r) => r.hasError || r.status === "failed").length;
  const ordered = [...measured].sort(
    (a, b) => new Date(b.startedAt).getTime() - new Date(a.startedAt).getTime()
  );
  let consecutiveFailedRuns = 0;
  for (const r of ordered) {
    if (r.status === "failed") consecutiveFailedRuns++;
    else break;
  }
  const database: DatabaseErrorInput = {
    operations: measured.length,
    errors: errored,
    consecutiveFailedRuns,
  };

  // --- Duplication ---------------------------------------------------------
  const recentWindow = measured.filter((r) => hoursBetween(now, new Date(r.startedAt)) <= 24);
  const recentCreated = recentWindow.reduce((a, r) => a + r.itemsCreated, 0);
  const recentDeduped = recentWindow.reduce((a, r) => a + r.itemsDeduped, 0);
  const olderRates = measured
    .filter((r) => hoursBetween(now, new Date(r.startedAt)) > 24)
    .map(duplicationRate)
    .filter((r): r is number => r !== null);
  const duplication: DuplicationInput = {
    created: recentCreated,
    deduped: recentDeduped,
    baselineDuplicationRate: olderRates.length >= HEALTH_THRESHOLDS.minHistoryRuns ? median(olderRates) : null,
  };


  // --- Job intervals -------------------------------------------------------
  const report = assessEngineHealth(runs, { now });
  const jobs: JobIntervalInput[] = report.jobs
    .filter((j) => j.medianIntervalHours !== null && j.medianIntervalHours > 0)
    .map((j) => ({
      jobName: j.job,
      hoursSinceLastSuccess: j.hoursSinceLastSuccess,
      expectedIntervalHours: expectedCadenceHours(j.medianIntervalHours as number),
    }));

  // --- Health findings -----------------------------------------------------
  // The report is already computed above for the job-interval inputs; this is
  // the same reading, routed to the breaker that was missing rather than to a
  // detail payload nobody queries.
  return { publication, database, duplication, jobs, healthFindings: healthFindingsBreakerInput(report) };
}
