// SILENT_SUCCESS — a named, machine-detectable failure class.
//
// WHAT IT IS
// ----------
// An operation that reports success while not doing the thing it exists to do.
// Not a crash, not an error, not an exception. A green row in engine_job_runs
// with nothing behind it.
//
// This project has shipped it twice, in two different disguises:
//
//   1. A DELETE against analytics_events returned "0 rows deleted" with NO
//      error. RLS denies by returning zero rows, so the statement ran, matched
//      nothing, and reported success.
//   2. `engine_upsert_update_proposal` answered 'rejected_invalid' to every
//      `stale_content` call because its guard list omitted that reason. The
//      freshness job discarded the return value. `engine_job_runs` recorded
//      `status: success`. The freshness -> editor bridge never worked once, and
//      nothing noticed for as long as it existed.
//
// Note that the database was not the problem in the second case. The function
// answered honestly; nobody was listening. That is why this class is defined by
// the CALLER's claim rather than by any particular database behaviour: a job is
// not successful merely because it did not throw.
//
// WHY A MODULE AND NOT A FIX
// --------------------------
// Both incidents were fixed by hand. Fixing them by hand is what guarantees a
// third one, because the mechanism that let them hide is still there: `status:
// success` is written by the same code whose success is in question. So this
// module makes the class detectable by the MACHINE. It can:
//
//   * fail a job            — statusFromPostconditions(), wired per job
//   * reduce readiness      — hardenReadiness()
//   * raise an alert        — silentSuccessFindings() -> HealthFinding
//   * trip a circuit breaker— silentSuccessBreakerInput() -> the
//                             `silent_success` breaker in circuit-breaker.ts
//   * block graduation      — hardenReadiness() + the breaker halting
//                             'creation' and 'publication'
//
// TWO DETECTION HORIZONS, DELIBERATELY BOTH
// -----------------------------------------
// WITHIN a run, postconditions.ts catches a mutation that reported success and
// changed nothing. That is the sharp instrument, and it only works where a job
// author wired it.
//
// ACROSS runs, this module catches the shapes that no single run can reveal —
// a stage that has never once had an effect, a producer whose consumer never
// sees anything, a run where every item was rejected but the run said success.
// Incident #2 was invisible within any single run and obvious across thirty.
// The cross-run detector needs NO cooperation from the job, which is what makes
// it the backstop for code nobody has instrumented yet.
//
// PURE. The caller supplies the rows; every rule here is unit-testable from
// plain numbers, with no database and no clock beyond the `now` it is handed.

import type { EngineCapability } from "./circuit-breaker.ts";
import type { JobRunRecord } from "./health.ts";
import type { HealthFinding } from "./health.ts";
import type { PostconditionSummary } from "./postconditions.ts";
import { STAGE_EFFECTS, stageEffectOf } from "./stage-roles.ts";

// ---------------------------------------------------------------------------
// The taxonomy
// ---------------------------------------------------------------------------

export type SilentSuccessKind =
  /** Reported success, examined rows, affected none of them. Incident #1 shape. */
  | "success_no_effect"
  /** Every item in the run was rejected, yet the run did not report failure. */
  | "total_rejection_reported_success"
  /** A declared producer has NEVER created anything across its whole history
   *  while reporting success throughout. Incident #2 shape. */
  | "never_effective"
  /** A producer created work whose declared consumer then examined nothing. */
  | "downstream_starved"
  /** The run recorded verified silent no-ops but still claimed success. */
  | "status_overstated"
  /** Every write this job makes is structurally unobservable, so it can never
   *  demonstrate that it did anything at all. */
  | "unprovable_by_construction"
  /** Silent-success telemetry itself is missing, so the class cannot be
   *  detected. Reported rather than assumed clean. */
  | "detection_unavailable";

export type SilentSuccessSeverity = "warning" | "critical";

// ---------------------------------------------------------------------------
// THE FOUR TELEMETRY STATES — separately representable, separately reported
// ---------------------------------------------------------------------------

/**
 * What the detector's window actually contained.
 *
 * THE DEFECT THIS EXISTS TO MAKE IMPOSSIBLE. An assessor stage finding nothing
 * to flag — its GOAL — raised a CRITICAL signal that opened the silent_success
 * breaker and halted creation, media_acquisition and publication. The engine
 * stopped writing articles precisely BECAUSE the site had no orphans, and
 * started again only when the site got worse. The fix made the detectors
 * role-aware, which stopped that particular collapse; this type stops the whole
 * FAMILY of them, by giving each of the four possible readings its own name and
 * forbidding any of them from being computed as another.
 *
 * The four are mutually exclusive and jointly exhaustive:
 *
 *   ZERO_MEASURED_RUNS  There were no runs in the window to examine. Nothing was
 *                       measured, so nothing is known. NOT health — an engine
 *                       that has not run is not an engine that is fine. It is
 *                       also not an incident: there is no evidence of anything.
 *
 *   MEASURED_CLEAN      Runs were examined and every one of them came back
 *                       genuinely clean. THIS, AND ONLY THIS, IS HEALTH. It is
 *                       the one state reachable only by having looked.
 *
 *   TELEMETRY_UNAVAILABLE  The detector could not read what it needs. NOT clean.
 *                       The absence of evidence looks identical to good news for
 *                       this failure class, which is exactly why it gets its own
 *                       state rather than defaulting into MEASURED_CLEAN. Still
 *                       fails closed: it opens the breaker and blocks graduation.
 *
 *   INCIDENTS_DETECTED  At least one genuine critical signal.
 *
 * ZERO_MEASURED_RUNS and TELEMETRY_UNAVAILABLE are both UNKNOWN — see
 * `telemetryStateIsKnown`. Neither reads as healthy and neither reads as an
 * incident, because "we did not look" and "we looked and it was bad" are
 * different facts and collapsing them in either direction is a lie.
 */
export type TelemetryState =
  | "zero_measured_runs"
  | "measured_clean"
  | "telemetry_unavailable"
  | "incidents_detected";

export const TELEMETRY_STATES: readonly TelemetryState[] = [
  "zero_measured_runs",
  "measured_clean",
  "telemetry_unavailable",
  "incidents_detected",
];

export const TELEMETRY_STATE_HEADLINES: Record<TelemetryState, string> = {
  zero_measured_runs: "NOTHING WAS MEASURED — no runs in the window",
  measured_clean: "measured and clean — runs were examined and are genuinely healthy",
  telemetry_unavailable: "TELEMETRY UNAVAILABLE — the detector could not read what it needs",
  incidents_detected: "INCIDENTS DETECTED — at least one stage's report of itself is unreliable",
};

export const TELEMETRY_STATE_MEANINGS: Record<TelemetryState, string> = {
  zero_measured_runs:
    "The window contained no measured runs at all — either the engine has never run, or every run in it " +
    "was 'skipped' and therefore excluded from every baseline. NOT a clean bill of health: no detector " +
    "in this file examined anything, so a stage could be entirely broken and produce exactly this. Also " +
    "NOT an incident, because there is no evidence of one. It is UNKNOWN, and it is reported as unknown.",
  measured_clean:
    "Runs were examined and every rule in this file was applied to them, and none fired. This is the " +
    "ONLY state that means health, and it is reachable only by having looked. An assessor that examined " +
    "rows and deliberately flagged none of them lands here, which is correct: zero orphans is the goal, " +
    "not an empty result.",
  telemetry_unavailable:
    "The detector could not read the job-run telemetry, so SILENT_SUCCESS could not be looked for at " +
    "all. NOT clean. This class's entire signature is that its absence of evidence looks identical to " +
    "good news, so an engine that cannot show its stages are having an effect is treated as one that is " +
    "not. Fails closed: opens the breaker and blocks graduation.",
  incidents_detected:
    "At least one critical signal fired: a stage reported success while having no effect, rejected " +
    "everything and called it success, has never once produced what it exists to produce, or starved " +
    "its declared consumer. The engine's own report of what it did cannot be believed.",
};

/** THE ONLY state that means healthy. Zero measured runs is not health. */
export function telemetryStateIsHealthy(state: TelemetryState): boolean {
  return state === "measured_clean";
}

/** Whether anything at all was established. False for both UNKNOWN states. */
export function telemetryStateIsKnown(state: TelemetryState): boolean {
  return state === "measured_clean" || state === "incidents_detected";
}

/** Whether the state constitutes evidence of a problem, as opposed to absence of evidence. */
export function telemetryStateIsIncident(state: TelemetryState): boolean {
  return state === "incidents_detected";
}

/**
 * Whether the state must block autonomous graduation.
 *
 * Everything except MEASURED_CLEAN. Graduation is a claim that the engine has
 * been SHOWN to be safe, and three of the four states are the absence of that
 * showing rather than the presence of it. TELEMETRY_UNAVAILABLE blocking is the
 * fail-closed rule and must never erode; ZERO_MEASURED_RUNS blocking is the same
 * rule applied to the case where the reads worked and there was nothing in them.
 */
export function telemetryStateBlocksGraduation(state: TelemetryState): boolean {
  return state !== "measured_clean";
}

/**
 * Whether the state may open the silent-success breaker.
 *
 * MEASURED_CLEAN must never trip it — that is requirement (b), and violating it
 * is what halted creation on a healthy site. ZERO_MEASURED_RUNS must not trip it
 * either, for a different reason: a brand-new engine has no runs, and a breaker
 * that opens on an empty history would make the engine unable to ever start,
 * which is not fail-closed but merely stuck. It is reported as UNKNOWN instead —
 * `basis: "no_data"` on the verdict, which is structurally distinct from
 * `basis: "measured"` and is the field an operator reads to tell the two apart.
 */
export function telemetryStateOpensBreaker(state: TelemetryState): boolean {
  return state === "telemetry_unavailable" || state === "incidents_detected";
}

export type SilentSuccessSignal = {
  kind: SilentSuccessKind;
  severity: SilentSuccessSeverity;
  /** The job, or "producer -> consumer" for a pipeline-link signal. */
  job: string;
  /** WHY, in words an admin can act on. */
  why: string;
  /** What to actually do about it. */
  action: string;
  observed: Record<string, number | string | boolean | null>;
};

// ---------------------------------------------------------------------------
// What each stage is FOR — declared, so "had no effect" is checkable
// ---------------------------------------------------------------------------

/**
 * A stage's declared effect.
 *
 * `producer` stages exist to make rows. A producer that has never made one is
 * broken, however calm its job rows look. `assessor` stages legitimately do
 * nothing when the site is healthy (zero orphans is the goal, not an empty
 * result), so "created nothing" is never held against them.
 *
 * This is a claim about intent that only a human can make, which is exactly why
 * it is written down here rather than inferred. Inferring it from history would
 * mean a stage that has been broken since birth teaches the detector that doing
 * nothing is normal for it — the precise way incident #2 stayed hidden.
 */
// Moved to ./stage-roles.ts so health.ts can share the same definition — the
// two files implement the same detector and had drifted apart on exactly this.
// Re-exported so existing importers keep working.
export { STAGE_EFFECTS, stageEffectOf, type StageRole, type StageEffect } from "./stage-roles.ts";


export const SILENT_SUCCESS_THRESHOLDS = {
  /** Runs a producer must have accumulated before "never effective" can fire.
   *  Below this it is simply young. */
  minRunsForNeverEffective: 8,
  /** Runs a producer must have made rows in, for its consumer's idleness to
   *  count as starvation rather than as a quiet window. */
  minProducerRunsForStarvation: 3,
  /** Rows a producer must have created in the window before starvation fires. */
  minProducedForStarvation: 5,
} as const;

// ---------------------------------------------------------------------------
// Per-run telemetry, including the columns that do not exist yet
// ---------------------------------------------------------------------------

/**
 * A job run enriched with postcondition counts.
 *
 * `silentNoOps` / `unverifiedWrites` / `blindWrites` are `null` when the
 * telemetry does not carry them — which is the case in production TODAY,
 * because `engine_recent_job_runs` returns a fixed column list that predates
 * this module. `null` means UNMEASURED and is never read as zero. The draft in
 * supabase/migrations/20260822_silent_success_telemetry.sql, applied 2026-08-22, added them.
 *
 * The detectors below are written so the ones that need only the old columns
 * still work without it. Losing the sharp instrument must not mean losing all
 * detection — that would make applying the migration a prerequisite for safety
 * rather than an improvement to it.
 */
export type SilentSuccessRun = JobRunRecord & {
  silentNoOps?: number | null;
  unverifiedWrites?: number | null;
  blindWrites?: number | null;
  verifiedWrites?: number | null;
};

export type SilentSuccessReport = {
  signals: SilentSuccessSignal[];
  critical: SilentSuccessSignal[];
  /** Jobs with at least one signal. */
  affectedJobs: string[];
  /** Whether the sharp per-run counters were available at all. */
  postconditionTelemetry: "present" | "absent";
  /**
   * Which of the four telemetry states this window is in. THE authoritative
   * field — `clean` below is deliberately narrower and must not be read as
   * health.
   */
  telemetryState: TelemetryState;
  /**
   * True iff `telemetryState` is MEASURED_CLEAN.
   *
   * Separate from `clean` on purpose, and the difference is the whole of task 1:
   * `clean` means "no critical signal fired", which is ALSO true when nothing
   * was measured and when the reads failed. `healthy` means "runs were examined
   * and they were genuinely fine". Only the second is a claim about the engine.
   */
  healthy: boolean;
  /** False for both UNKNOWN states — nothing was established either way. */
  known: boolean;
  /** Runs that entered the analysis: everything not 'skipped'. */
  measuredRuns: number;
  /** Runs excluded from every rule here because they were 'skipped'. */
  skippedRuns: number;
  /**
   * Jobs for which EVERY run in the window was skipped.
   *
   * A job in this list contributed no evidence at all, and every readiness
   * number computed over the window is computed over nothing for it. Named so an
   * intentional skip cannot quietly make the telemetry look better than it is.
   */
  jobsWithOnlySkippedRuns: string[];
  /**
   * No CRITICAL signal fired.
   *
   * NOT the same as healthy. Left with its original meaning because the breaker
   * and existing callers key on it, but read `healthy`/`telemetryState` to ask
   * "is the engine fine?".
   */
  clean: boolean;
  summary: string;
};

// ---------------------------------------------------------------------------
// The detector
// ---------------------------------------------------------------------------

function sum(values: readonly number[]): number {
  return values.reduce((a, b) => a + b, 0);
}

/**
 * Detect SILENT_SUCCESS across a window of job runs.
 *
 * Deliberately takes the same rows health.ts takes. This is a second reading of
 * one dataset, not a second dataset — a detector with its own private feed is a
 * detector that can be starved without anyone noticing.
 */
export function detectSilentSuccess(
  runs: readonly SilentSuccessRun[],
  opts: { telemetryAvailable: boolean }
): SilentSuccessReport {
  const signals: SilentSuccessSignal[] = [];

  if (!opts.telemetryAvailable) {
    signals.push({
      kind: "detection_unavailable",
      severity: "critical",
      job: "(all)",
      why:
        "Job-run telemetry could not be read, so SILENT_SUCCESS cannot be detected at all. The " +
        "engine cannot show that its stages are having an effect, and an engine that cannot show " +
        "that is treated as one that is not — the whole point of this class is that its absence of " +
        "evidence looks identical to good news.",
      action:
        "Restore engine_recent_job_runs (check the anon grant and that the function still exists at " +
        "its signature) before trusting any 'success' the engine reports.",
      observed: { telemetryAvailable: false },
    });
    return finish(signals, "absent", {
      state: "telemetry_unavailable",
      measuredRuns: 0,
      skippedRuns: runs.filter((r) => r.status === "skipped").length,
      jobsWithOnlySkippedRuns: [],
    });
  }

  const measured = runs.filter((r) => r.status !== "skipped");
  const skipped = runs.filter((r) => r.status === "skipped");
  const anyCounters = measured.some((r) => r.silentNoOps !== null && r.silentNoOps !== undefined);
  const telemetry: "present" | "absent" = anyCounters ? "present" : "absent";

  // --- Jobs that contributed NOTHING because every run of theirs was skipped --
  // A skipped run is excluded from every rule in this file and from every
  // baseline in health.ts, which is correct — a flag-disabled run records zeros
  // by definition and letting those into a median would teach the detector that
  // doing nothing is normal. But the exclusion has a cost that was never
  // reported: a job whose every run in the window was skipped is INVISIBLE, not
  // clean, and readiness computed over the window is computed over nothing for
  // it. Named here so an intentional skip cannot make the telemetry look
  // healthier than it is.
  const measuredJobs = new Set(measured.map((r) => r.jobName));
  const jobsWithOnlySkippedRuns = [
    ...new Set(skipped.map((r) => r.jobName).filter((j) => !measuredJobs.has(j))),
  ].sort();

  if (jobsWithOnlySkippedRuns.length > 0) {
    signals.push({
      kind: "detection_unavailable",
      severity: "warning",
      job: jobsWithOnlySkippedRuns.join(", "),
      why:
        `${jobsWithOnlySkippedRuns.length} job(s) have NO measured run in this window — every run of ` +
        `theirs was 'skipped', and skipped runs are excluded from every rule in this file and every ` +
        `baseline in health.ts. Nothing has been checked about them. That is not the same as their ` +
        `having been checked and found fine, and it must not be counted as evidence toward readiness.`,
      action:
        "Confirm the skip was intentional by reading the reason on those rows. A reason ending " +
        "'_flag_unreadable' is NOT an intentional skip — it is a failed kill-switch read, and those " +
        "record 'failed' now precisely so they stop landing here.",
      observed: {
        jobs: jobsWithOnlySkippedRuns.join(", "),
        skippedRuns: skipped.length,
        measuredRuns: measured.length,
      },
    });
  }

  if (!anyCounters && measured.length > 0) {
    signals.push({
      kind: "detection_unavailable",
      severity: "warning",
      job: "(all)",
      why:
        "No run carries postcondition counters, so within-run silent no-ops cannot be seen — only " +
        "the coarser cross-run shapes below. A mutation that was rejected and counted as a " +
        "duplicate is invisible at this resolution.",
      action:
        "Applied: supabase/migrations/20260822_silent_success_telemetry.sql, which adds " +
        "silent_no_ops / unverified_writes / blind_writes to engine_job_runs and exposes them " +
        "through engine_recent_job_runs.",
      observed: { runsChecked: measured.length },
    });
  }

  const byJob = new Map<string, SilentSuccessRun[]>();
  for (const r of measured) {
    const list = byJob.get(r.jobName);
    if (list) list.push(r);
    else byJob.set(r.jobName, [r]);
  }

  for (const [job, all] of byJob) {
    const ordered = [...all].sort(
      (a, b) => new Date(b.startedAt).getTime() - new Date(a.startedAt).getTime()
    );
    const latest = ordered[0];
    const effect = stageEffectOf(job);

    // --- 1. Reported success, examined rows, affected none of them ----------
    // Needs no history and no new columns. Incident #1's exact shape.
    //
    // ROLE-AWARE, and it was not. This detector fired on ANY pass with
    // examined > 0 and nothing touched, which is the normal, desired outcome
    // for an ASSESSOR. engine_internal_links sets examined = every published
    // article, then finds zero orphans and reports success — its own comment
    // says "Zero orphans is a success and the goal, not an empty result."
    //
    // That row is examined:29 created:0 deduped:0 failed:0 status:success, which
    // fired this signal at CRITICAL with no rate and no minimum sample, opened
    // the silent_success breaker, and halted creation, media_acquisition and
    // publication. Observed: 4 of 15 jobs refused, including engine_briefs and
    // engine_draft_assembly. The engine therefore stopped writing articles
    // precisely BECAUSE the site had no orphans — and started again only when
    // the site got worse. health.ts's own standard applies: "A breaker that
    // opens permanently on a false signal is not fail-closed. It is broken."
    //
    // StageRole already existed for exactly this, engine_internal_links /
    // engine_hero_media / engine_freshness are all already declared assessors,
    // and detector #5 below already honours the role. This one simply never
    // read it.
    //
    // WHAT IS NOT LOST. An assessor whose writes are all being DENIED shows the
    // same counters, so this is not a free change — the evidence that separates
    // the two is the postcondition telemetry, not the counters. A denied write
    // produces silent_no_ops > 0, which detector #4 (status_overstated) catches
    // for every job regardless of role, and where that telemetry is missing
    // entirely the detection_unavailable signal fires instead of silence. The
    // assessor case is therefore still covered, by the evidence that can
    // actually tell the two apart.
    const touched = latest.itemsCreated + latest.itemsDeduped + latest.itemsFailed;
    const isAssessor = effect?.role === "assessor";
    if (
      !isAssessor &&
      (latest.status === "success" || latest.status === "partial") &&
      latest.itemsExamined > 0 &&
      touched === 0
    ) {
      signals.push({
        kind: "success_no_effect",
        severity: "critical",
        job,
        why:
          `${job} reported '${latest.status}' after examining ${latest.itemsExamined} item(s) and ` +
          `creating, deduplicating and failing NONE of them. A pass cannot look at work and then ` +
          `have had no relationship to it; the write matched zero rows and returned no error.`,
        action:
          "Call the RPC this job writes through, by hand, as anon. A renamed function, a changed " +
          "signature or a revoked grant all produce exactly this and none of them raise.",
        observed: {
          examined: latest.itemsExamined,
          created: latest.itemsCreated,
          deduped: latest.itemsDeduped,
          failed: latest.itemsFailed,
          status: latest.status,
        },
      });
    }

    // --- 2. Everything rejected, run still not marked failed ----------------
    if (
      latest.status === "success" &&
      latest.itemsExamined > 0 &&
      latest.itemsFailed >= latest.itemsExamined &&
      latest.itemsCreated === 0
    ) {
      signals.push({
        kind: "total_rejection_reported_success",
        severity: "critical",
        job,
        why:
          `${job} recorded ${latest.itemsFailed} failure(s) across ${latest.itemsExamined} examined ` +
          `item(s), created nothing, and still reported 'success'. A pass in which every single ` +
          `unit of work was refused is a failed pass, whatever the status column says.`,
        action:
          "Read the run's detail payload. Total rejection is nearly always one systematic cause — a " +
          "guard list that no longer matches a CHECK constraint, or an input field that changed shape.",
        observed: {
          examined: latest.itemsExamined,
          failed: latest.itemsFailed,
          created: latest.itemsCreated,
          status: latest.status,
        },
      });
    }

    // --- 3. Counters say silent no-ops; status says success -----------------
    const noOps = latest.silentNoOps ?? null;
    if (noOps !== null && noOps > 0 && latest.status === "success") {
      signals.push({
        kind: "status_overstated",
        severity: "critical",
        job,
        why:
          `${job} recorded ${noOps} verified silent no-op(s) — mutations that returned no error and ` +
          `demonstrably changed nothing — and still reported 'success'. The postcondition log and ` +
          `the status column disagree, and the postcondition log is the one that looked.`,
        action:
          "The job is computing its own status instead of deriving it from its postcondition " +
          "summary. Route it through statusFromPostconditions()/worstStatus() in postconditions.ts.",
        observed: { silentNoOps: noOps, status: latest.status },
      });
    }

    // --- 4. Every write unobservable -----------------------------------------
    const blind = latest.blindWrites ?? null;
    const verified = latest.verifiedWrites ?? null;
    if (blind !== null && verified !== null && blind > 0 && verified === 0) {
      signals.push({
        kind: "unprovable_by_construction",
        severity: "warning",
        job,
        why:
          `Every one of ${job}'s ${blind} write(s) goes through an RPC that returns void, so the ` +
          `job cannot demonstrate that it did anything. It would report exactly these numbers ` +
          `whether its writes landed or were denied.`,
        action:
          "Change the RPC to return a status string or a row id. This is the only fix — no amount " +
          "of caller-side checking can observe an unobservable write.",
        observed: { blindWrites: blind, verifiedWrites: 0 },
      });
    }

    // --- 5. A declared producer that has never produced ----------------------
    // The cross-run backstop. Incident #2 lived here: every individual run was
    // unremarkable, and only the total across all of them was zero.
    if (effect?.role === "producer" && ordered.length >= SILENT_SUCCESS_THRESHOLDS.minRunsForNeverEffective) {
      const created = sum(ordered.map((r) => r.itemsCreated));
      const examined = sum(ordered.map((r) => r.itemsExamined));
      const everFailed = ordered.some((r) => r.status === "failed");
      // A job that writes only through void RPCs cannot report a creation even
      // when it makes one, so its zero here is already explained — and reported
      // — by `unprovable_by_construction` above. Raising a second, critical
      // signal for the same fact would train people to ignore both.
      const explainedByBlindness = ordered.some((r) => (r.blindWrites ?? 0) > 0);
      if (created === 0 && examined > 0 && !everFailed && !explainedByBlindness) {
        signals.push({
          kind: "never_effective",
          severity: "critical",
          job,
          why:
            `${job} exists to create ${effect.produces}. Across ${ordered.length} runs it has ` +
            `examined ${examined} item(s), created ZERO, and never once reported failure. A stage ` +
            `that has never had its intended effect is not idle — it has never worked, and every ` +
            `run of it has reported success.`,
          action:
            "Call the job's write RPC by hand with a realistic payload and read the string it " +
            "returns. A guard list inside the function that rejects every call produces precisely " +
            "this: an honest 'rejected_invalid' that nobody was listening to.",
          observed: {
            runs: ordered.length,
            examinedTotal: examined,
            createdTotal: 0,
            produces: effect.produces,
          },
        });
      }
    }
  }

  // --- 6. Producer produced, declared consumer saw nothing ------------------
  for (const effect of STAGE_EFFECTS) {
    const producerRuns = byJob.get(effect.job);
    if (!producerRuns || effect.feeds.length === 0) continue;
    const produced = sum(producerRuns.map((r) => r.itemsCreated));
    const productiveRuns = producerRuns.filter((r) => r.itemsCreated > 0).length;
    if (
      produced < SILENT_SUCCESS_THRESHOLDS.minProducedForStarvation ||
      productiveRuns < SILENT_SUCCESS_THRESHOLDS.minProducerRunsForStarvation
    ) {
      continue;
    }

    for (const consumerName of effect.feeds) {
      const consumerRuns = byJob.get(consumerName);
      if (!consumerRuns || consumerRuns.length === 0) continue;
      const consumerExamined = sum(consumerRuns.map((r) => r.itemsExamined));
      if (consumerExamined > 0) continue;

      // A consumer whose input only arrives after a HUMAN acts is not starved
      // when its queue is empty — it is waiting, which is the design.
      // engine_draft_assembly consumes only human-APPROVED briefs, so a full
      // brief queue with no approvals fired a CRITICAL signal, opened the
      // silent_success breaker and halted creation: the engine stopped writing
      // articles because the editor had not been through the inbox, and
      // stopped hardest exactly when that inbox was fullest.
      //
      // This is the same defect as the assessor false positive, in a third
      // costume — detector #6 judges a stage by what its CONSUMER examined and
      // read no role at all. Nothing is lost: a consumer whose queue read was
      // genuinely DENIED is caught by input_unproven, which is positive
      // evidence about the read rather than an inference from an empty queue,
      // and which fires on the first run with no history at all.
      if (stageEffectOf(consumerName)?.consumptionRequiresHumanAction) continue;

      signals.push({
        kind: "downstream_starved",
        severity: "critical",
        job: `${effect.job} -> ${consumerName}`,
        why:
          `${effect.job} created ${produced} ${effect.produces}(s) across ${productiveRuns} run(s), ` +
          `but ${consumerName} — which consumes them — has examined NOTHING across ` +
          `${consumerRuns.length} run(s) in the same window. Both stages report success. Work is ` +
          `entering the pipeline and not arriving at the next stage, which is what a broken join, ` +
          `an unstamped state column or a filter that no longer matches looks like from the outside.`,
        action:
          `Run ${consumerName}'s input RPC by hand and compare what it returns against the rows ` +
          `${effect.job} actually wrote. The mismatch is almost always a status/state value the ` +
          `producer never sets.`,
        observed: {
          producer: effect.job,
          consumer: consumerName,
          produced,
          producerProductiveRuns: productiveRuns,
          consumerRuns: consumerRuns.length,
          consumerExamined: 0,
        },
      });
    }
  }

  return finish(signals, telemetry, {
    state: null,
    measuredRuns: measured.length,
    skippedRuns: skipped.length,
    jobsWithOnlySkippedRuns,
  });
}

function finish(
  signals: SilentSuccessSignal[],
  telemetry: "present" | "absent",
  window: {
    /** Forced only for the total-blindness path; otherwise derived below. */
    state: TelemetryState | null;
    measuredRuns: number;
    skippedRuns: number;
    jobsWithOnlySkippedRuns: string[];
  }
): SilentSuccessReport {
  const critical = signals.filter((s) => s.severity === "critical");
  const affectedJobs = [...new Set(signals.map((s) => s.job))];

  // THE STATE MACHINE, written as one total expression so no branch can fall
  // through into "healthy" by accident. Order matters and is argued:
  //
  //   1. TELEMETRY_UNAVAILABLE first — it explains everything else, and a
  //      detector that could not read must not report on what it did not see.
  //   2. INCIDENTS_DETECTED next — evidence of a problem outranks absence of
  //      evidence.
  //   3. ZERO_MEASURED_RUNS — nothing was examined, so nothing is known.
  //   4. MEASURED_CLEAN — the only remaining case, and the only one that can be
  //      reached by having actually looked at runs and found them fine.
  const state: TelemetryState =
    window.state !== null
      ? window.state
      : critical.length > 0
        ? "incidents_detected"
        : window.measuredRuns === 0
          ? "zero_measured_runs"
          : "measured_clean";

  const warnings = signals.length - critical.length;
  const signalText =
    signals.length === 0
      ? "no signals"
      : `${critical.length} critical and ${warnings} warning signal(s): ` +
        signals.map((s) => `${s.job}/${s.kind}`).join(", ");

  return {
    signals,
    critical,
    affectedJobs,
    postconditionTelemetry: telemetry,
    telemetryState: state,
    healthy: telemetryStateIsHealthy(state),
    known: telemetryStateIsKnown(state),
    measuredRuns: window.measuredRuns,
    skippedRuns: window.skippedRuns,
    jobsWithOnlySkippedRuns: window.jobsWithOnlySkippedRuns,
    clean: critical.length === 0,
    // The summary NAMES the state. Two different states producing the same
    // sentence is the collapse this whole change exists to prevent, and it is
    // asserted in the tests rather than left as an intention.
    summary:
      `SILENT_SUCCESS [${state}] ${TELEMETRY_STATE_HEADLINES[state]} — ` +
      `${window.measuredRuns} measured run(s), ${window.skippedRuns} skipped, ${signalText}.`,
  };
}

// ---------------------------------------------------------------------------
// 1. Fail a job — from a single pass's postcondition summary
// ---------------------------------------------------------------------------

/**
 * Whether a single pass's postconditions constitute a SILENT_SUCCESS.
 *
 * Kept separate from `statusFromPostconditions` because the two questions
 * differ: that one asks "what status should this run record?", this one asks
 * "did this run exhibit the failure class?". A run can legitimately be
 * 'partial' without any silent success in it.
 */
export function isSilentSuccess(summary: PostconditionSummary): boolean {
  return summary.silentNoOps > 0 || summary.unverifiable > 0;
}

/** The block a job should put in its engine_job_runs detail payload. */
export function postconditionDetail(summary: PostconditionSummary): Record<string, unknown> {
  return {
    verified: summary.verified,
    silentNoOps: summary.silentNoOps,
    unverifiable: summary.unverifiable,
    errored: summary.errored,
    blindWrites: summary.blind,
    blindOperations: summary.blindOperations,
    silentSuccess: isSilentSuccess(summary),
    // The details, not just the count. A count tells an admin something is
    // wrong; these tell them which row and which RPC.
    silentNoOpDetails: summary.silentNoOpDetails,
    summary: summary.summary,
  };
}

/**
 * The four counts a run reports into engine_job_runs' own columns.
 *
 * Separate from postconditionDetail() on purpose. The detail payload is jsonb
 * that nothing queries; these become real columns that the breaker, health.ts
 * and the readiness scorecard read. A job that ran NO checked mutations reports
 * zeros — that is a measured zero, and it is a different fact from the NULLs a
 * run written before instrumentation carries.
 */
export function writeCountsFrom(summary: PostconditionSummary): {
  verified: number;
  silentNoOps: number;
  unverified: number;
  blind: number;
} {
  return {
    verified: summary.verified,
    silentNoOps: summary.silentNoOps,
    unverified: summary.unverifiable,
    blind: summary.blind,
  };
}

// ---------------------------------------------------------------------------
// 2. Trip a circuit breaker
// ---------------------------------------------------------------------------

export type SilentSuccessInput = {
  /** Runs the detector actually looked at. */
  runsObserved: number;
  /** Total signals. */
  signals: number;
  /** Signals severe enough to halt on. */
  criticalSignals: number;
  /** Distinct jobs implicated. */
  jobsAffected: number;
  /** Whether the sharp per-run counters were available. */
  postconditionTelemetry: "present" | "absent";
  /** Which of the four states the window is in. */
  telemetryState: TelemetryState;
  /** Runs that actually entered the analysis. */
  measuredRuns: number;
  /** Runs excluded as 'skipped'. */
  skippedRuns: number;
};

export function silentSuccessBreakerInput(report: SilentSuccessReport, runsObserved: number): SilentSuccessInput {
  return {
    runsObserved,
    signals: report.signals.length,
    criticalSignals: report.critical.length,
    jobsAffected: report.affectedJobs.length,
    postconditionTelemetry: report.postconditionTelemetry,
    telemetryState: report.telemetryState,
    measuredRuns: report.measuredRuns,
    skippedRuns: report.skippedRuns,
  };
}

/** Capabilities the silent-success breaker suspends when it opens. */
export const SILENT_SUCCESS_HALTS: readonly EngineCapability[] = [
  // Creating more records while an unknown number of writes are no-ops
  // multiplies the mess, and half-created entities are the expensive kind to
  // unpick. Measurement continues — it is how the problem gets diagnosed.
  "creation",
  "media_acquisition",
  "publication",
];

// ---------------------------------------------------------------------------
// 3. Raise an alert — as health findings, in the existing shape
// ---------------------------------------------------------------------------

/**
 * Render the signals as HealthFindings so they appear wherever health findings
 * already appear, rather than requiring a second dashboard nobody opens.
 */
export function silentSuccessFindings(report: SilentSuccessReport): HealthFinding[] {
  return report.signals.map((s) => ({
    job: s.job,
    // health.ts owns its own kind union; SILENT_SUCCESS signals surface under
    // the kind health.ts already has for this shape, with the precise kind kept
    // in `observed` so nothing is lost in translation.
    kind: "success_no_effect" as const,
    severity: s.severity === "critical" ? ("critical" as const) : ("warning" as const),
    why: `[SILENT_SUCCESS/${s.kind}] ${s.why}`,
    action: s.action,
    observed: { ...s.observed, silentSuccessKind: s.kind },
  }));
}

// ---------------------------------------------------------------------------
// 4. Block autonomous graduation
// ---------------------------------------------------------------------------

/**
 * A readiness blocker, structurally identical to modes.ts's own so the two
 * compose without this module importing that one (modes.ts is owned by the
 * readiness/proofs work and is under active edit; depending on its shape rather
 * than its identity keeps these two changes from colliding).
 */
export type SilentSuccessBlocker = { criterion: string; required: string; actual: string };

/**
 * Graduation criteria for this failure class.
 *
 * Zero, and not "a low rate". A duplicate article can be merged; a silent
 * success means the engine's own report of what it did is unreliable, and every
 * other readiness number is computed FROM that report. One silent success
 * invalidates the evidence base, not just the item it happened to.
 */
export const SILENT_SUCCESS_READINESS = {
  maxCriticalSignals: 0,
  maxSilentNoOps: 0,
  /** Unobservable writes make a claim of readiness unfalsifiable. */
  maxBlindWriteOperations: 0,
  /** Detection must itself be demonstrably working. */
  requirePostconditionTelemetry: true,
  /**
   * Graduation requires the MEASURED_CLEAN state specifically.
   *
   * Not "no critical signals" — that is satisfied by ZERO_MEASURED_RUNS and by
   * TELEMETRY_UNAVAILABLE too, and neither of those is evidence of safety. An
   * engine graduates on having been shown to be safe, and two of the four states
   * are the absence of that showing.
   */
  requireMeasuredCleanTelemetry: true,
  /**
   * Jobs whose every run in the window was skipped contribute no evidence, and a
   * readiness number computed over them is computed over nothing.
   */
  maxJobsWithOnlySkippedRuns: 0,
} as const;

export type SilentSuccessEvidence = {
  report: SilentSuccessReport;
  /** Silent no-ops observed across the readiness window. */
  silentNoOpsObserved: number;
  /** Distinct RPCs still written to blind. */
  blindWriteOperations: readonly string[];
};

export function silentSuccessGraduationBlockers(evidence: SilentSuccessEvidence): SilentSuccessBlocker[] {
  const blockers: SilentSuccessBlocker[] = [];
  const { report } = evidence;

  if (report.critical.length > SILENT_SUCCESS_READINESS.maxCriticalSignals) {
    blockers.push({
      criterion: "SILENT_SUCCESS critical signals",
      required: "0",
      actual: `${report.critical.length} (${report.critical.map((s) => `${s.job}/${s.kind}`).join(", ")})`,
    });
  }
  if (evidence.silentNoOpsObserved > SILENT_SUCCESS_READINESS.maxSilentNoOps) {
    blockers.push({
      criterion: "Verified silent no-ops",
      required: "0",
      actual: String(evidence.silentNoOpsObserved),
    });
  }
  if (evidence.blindWriteOperations.length > SILENT_SUCCESS_READINESS.maxBlindWriteOperations) {
    blockers.push({
      criterion: "Write paths whose effect cannot be observed",
      required: "0",
      actual: `${evidence.blindWriteOperations.length}: ${evidence.blindWriteOperations.join(", ")}`,
    });
  }
  if (SILENT_SUCCESS_READINESS.requirePostconditionTelemetry && report.postconditionTelemetry !== "present") {
    blockers.push({
      criterion: "Postcondition telemetry",
      required: "present",
      actual: "absent — silent no-ops cannot be counted, so a count of zero would be an assumption",
    });
  }

  // --- The four-state gate ---------------------------------------------------
  // The three non-healthy states each get their OWN blocker text, because
  // "readiness was refused" is useless to an operator who cannot tell whether
  // the engine is broken, was never looked at, or could not be read.
  if (
    SILENT_SUCCESS_READINESS.requireMeasuredCleanTelemetry &&
    telemetryStateBlocksGraduation(report.telemetryState)
  ) {
    blockers.push({
      criterion: "SILENT_SUCCESS telemetry state",
      required: "measured_clean — runs examined and found genuinely clean",
      actual:
        `${report.telemetryState} — ${TELEMETRY_STATE_HEADLINES[report.telemetryState]}. ` +
        `${TELEMETRY_STATE_MEANINGS[report.telemetryState]} ` +
        `(measured ${report.measuredRuns}, skipped ${report.skippedRuns})`,
    });
  }

  // --- Jobs that were only ever skipped --------------------------------------
  // An intentional skip is legitimate operation and is NOT an incident. What it
  // must not do is make readiness look better than the evidence supports: a job
  // that never ran in the window has been checked by nothing, and counting its
  // silence as a pass is the same substitution — absence of evidence for
  // evidence of absence — that this whole module exists to refuse.
  if (report.jobsWithOnlySkippedRuns.length > SILENT_SUCCESS_READINESS.maxJobsWithOnlySkippedRuns) {
    blockers.push({
      criterion: "Jobs with no measured run in the readiness window",
      required: "0 — every job must have contributed at least one measured run",
      actual:
        `${report.jobsWithOnlySkippedRuns.length}: ${report.jobsWithOnlySkippedRuns.join(", ")}. ` +
        `Every run of these was 'skipped' and therefore excluded from every detector and every ` +
        `baseline. Nothing about them has been checked; that is not the same as their having been ` +
        `checked and found fine.`,
    });
  }

  return blockers;
}

/**
 * Harden an existing readiness verdict against this failure class.
 *
 * Takes the readiness report structurally rather than by importing modes.ts, so
 * it can wrap whatever that module currently produces. It can only ever LOWER a
 * verdict: there is no path through this function that unlocks anything.
 */
export function hardenReadiness<
  R extends { autonomousUnlocked: boolean; highestJustifiedMode: string; blockers: SilentSuccessBlocker[] }
>(report: R, evidence: SilentSuccessEvidence): R {
  const extra = silentSuccessGraduationBlockers(evidence);
  if (extra.length === 0) return report;
  return {
    ...report,
    autonomousUnlocked: false,
    // Never promote. If the wrapped report already said SHADOW, it stays SHADOW.
    highestJustifiedMode: report.highestJustifiedMode === "OFF" ? "OFF" : "SHADOW",
    blockers: [...report.blockers, ...extra],
  };
}
