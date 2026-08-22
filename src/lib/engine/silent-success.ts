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
export type StageRole = "producer" | "assessor";

export type StageEffect = {
  job: string;
  role: StageRole;
  /** Stages that consume what this one produces, by job name. */
  feeds: readonly string[];
  /** What a row created by this stage IS, for the message text. */
  produces: string;
};

export const STAGE_EFFECTS: readonly StageEffect[] = [
  { job: "engine_discover", role: "producer", feeds: ["engine_relevance"], produces: "a candidate discovery" },
  { job: "engine_relevance", role: "producer", feeds: ["engine_briefs", "engine_update_proposals", "engine_product_assembly"], produces: "a relevance verdict" },
  { job: "engine_update_proposals", role: "assessor", feeds: [], produces: "an update proposal against an existing page" },
  { job: "engine_product_assembly", role: "assessor", feeds: [], produces: "an unpublished product shell" },
  { job: "engine_briefs", role: "producer", feeds: ["engine_draft_assembly"], produces: "a research brief" },
  // Assembly consumes only HUMAN-APPROVED briefs, so it is legitimately idle
  // whenever nobody has approved one. Judging it as a producer would flag the
  // editor's inbox as an engine fault.
  { job: "engine_draft_assembly", role: "assessor", feeds: [], produces: "a draft article" },
  { job: "engine_search_intelligence", role: "producer", feeds: ["engine_opportunities", "engine_trends"], produces: "an aggregated search row" },
  { job: "engine_opportunities", role: "producer", feeds: [], produces: "an opportunity score" },
  { job: "engine_trends", role: "producer", feeds: [], produces: "a trend measurement" },
  { job: "engine_media_acquisition", role: "assessor", feeds: [], produces: "a media candidate" },
  { job: "engine_freshness", role: "assessor", feeds: [], produces: "a freshness review" },
  { job: "engine_internal_links", role: "assessor", feeds: [], produces: "an orphan report" },
  { job: "engine_hero_media", role: "assessor", feeds: [], produces: "a weak-hero requirement" },
];

export function stageEffectOf(job: string): StageEffect | null {
  return STAGE_EFFECTS.find((s) => s.job === job) ?? null;
}

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
 * supabase/migrations_pending/20260822_silent_success_telemetry.sql adds them.
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
    return finish(signals, "absent");
  }

  const measured = runs.filter((r) => r.status !== "skipped");
  const anyCounters = measured.some((r) => r.silentNoOps !== null && r.silentNoOps !== undefined);
  const telemetry: "present" | "absent" = anyCounters ? "present" : "absent";

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
        "Apply supabase/migrations_pending/20260822_silent_success_telemetry.sql, which adds " +
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
    const touched = latest.itemsCreated + latest.itemsDeduped + latest.itemsFailed;
    if ((latest.status === "success" || latest.status === "partial") && latest.itemsExamined > 0 && touched === 0) {
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

  return finish(signals, telemetry);
}

function finish(signals: SilentSuccessSignal[], telemetry: "present" | "absent"): SilentSuccessReport {
  const critical = signals.filter((s) => s.severity === "critical");
  const affectedJobs = [...new Set(signals.map((s) => s.job))];
  return {
    signals,
    critical,
    affectedJobs,
    postconditionTelemetry: telemetry,
    clean: critical.length === 0,
    summary:
      signals.length === 0
        ? "No SILENT_SUCCESS signals."
        : `${critical.length} critical and ${signals.length - critical.length} warning SILENT_SUCCESS ` +
          `signal(s): ${signals.map((s) => `${s.job}/${s.kind}`).join(", ")}.`,
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
};

export function silentSuccessBreakerInput(report: SilentSuccessReport, runsObserved: number): SilentSuccessInput {
  return {
    runsObserved,
    signals: report.signals.length,
    criticalSignals: report.critical.length,
    jobsAffected: report.affectedJobs.length,
    postconditionTelemetry: report.postconditionTelemetry,
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
