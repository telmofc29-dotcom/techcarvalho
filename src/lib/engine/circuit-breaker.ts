// Circuit breakers for the Growth Engine.
//
// PURE AND TESTABLE ON PURPOSE. Nothing here performs I/O; the caller gathers
// telemetry (src/lib/engine/guard.ts) and passes it in, so every trip decision
// can be reproduced in a unit test from plain numbers.
//
// WHY THIS EXISTS
// ---------------
// The engine runs unattended. The failure mode this project has actually hit is
// not a crash — it is a job that reports `status: success` while doing nothing,
// because the scheduled path runs as `anon` and RLS denies by returning ZERO
// ROWS rather than an error. A DELETE against analytics_events reported "0 rows
// deleted" with no error at all. `engine_trends.is_active` was write-once for
// weeks and nothing noticed. So the breakers below are not about exceptions;
// they are about measurements that look wrong, including "suspiciously calm".
//
// THE NON-NEGOTIABLE RULE
// -----------------------
// A broken subsystem must never cause validation to be SKIPPED. If the thing
// that checks evidence or media rights cannot answer, the engine STOPS. It does
// not proceed unvalidated, and it does not treat "validator unreachable" as
// "validator said yes". `decideValidation()` below encodes this as a two-valued
// decision — there is deliberately no "skip" member in its return type, so a
// future edit that wanted to add one would have to change the type first.

/**
 * What an open breaker is allowed to halt. Deliberately coarser than the job
 * list: capabilities are stable, job names are not.
 */
export type EngineCapability =
  /** Polling sources and recording candidate discoveries. */
  | "discovery"
  /** Scoring/classifying things that already exist (relevance, trends, opportunity). */
  | "classification"
  /** Minting durable artefacts: briefs, drafts, products. */
  | "creation"
  /** Proposing or recording media candidates. */
  | "media_acquisition"
  /** Recommendations against existing records: freshness, links, hero audit. */
  | "maintenance"
  /** Making anything publicly visible. Still off at the settings level too. */
  | "publication";

export const ALL_CAPABILITIES: readonly EngineCapability[] = [
  "discovery",
  "classification",
  "creation",
  "media_acquisition",
  "maintenance",
  "publication",
];

export type BreakerName =
  | "publication_volume"
  | "source_failures"
  | "validator_unavailable"
  | "validation_rejection_spike"
  | "database_errors"
  | "duplication_rate"
  | "job_interval"
  /** Stages reporting success while having no effect. See silent-success.ts. */
  | "silent_success"
  /**
   * Health findings that mean the engine's own report of itself is unreliable.
   * See HALTING_HEALTH_FINDING_KINDS in health.ts for what is in and what is
   * deliberately out. Until this existed, no HealthFinding of any severity
   * reached any breaker at all.
   */
  | "health_findings";

export type BreakerVerdict = {
  name: BreakerName;
  state: "closed" | "open";
  /**
   * Whether the verdict rests on real measurements or on their absence.
   * `no_data` is never quietly treated as healthy — see FAIL_CLOSED below.
   */
  basis: "measured" | "no_data";
  /** WHY, in words an admin can act on. Always populated, open or closed. */
  why: string;
  /** What a human should actually do about it. */
  action: string;
  /** Capabilities suspended while this breaker is open. */
  halts: readonly EngineCapability[];
  /** The numbers the decision was made from, retained for the audit log. */
  observed: Record<string, number | string | boolean | null>;
};

export type BreakerReport = {
  verdicts: BreakerVerdict[];
  open: BreakerVerdict[];
  halted: EngineCapability[];
  healthy: boolean;
  summary: string;
};

/**
 * Which breakers open when their input is MISSING.
 *
 * This is the fail-closed table, and the reasoning differs per breaker rather
 * than being a blanket rule:
 *
 *  - `validator_unavailable`: absence of a validator report is exactly the
 *    condition it exists to catch. Open.
 *  - `publication_volume`: if we cannot measure how much we have created, we
 *    must not create more — that is the runaway scenario. Open.
 *  - `source_failures`: no source telemetry means no source was polled, which
 *    creates nothing. Absence here is genuinely benign. Closed.
 *  - `validation_rejection_spike`, `database_errors`, `duplication_rate`,
 *    `job_interval`: these measure the character of work that happened. If no
 *    work happened there is nothing to characterise, and the "nothing happened"
 *    case is caught by health.ts instead. Closed.
 *  - `silent_success`: absence of a silent-success report means the detector
 *    did not run, and a failure class whose entire signature is "looks fine"
 *    cannot be assumed absent because nobody looked. Open.
 *  - `health_findings`: Closed, and this one needs its reasoning stated because
 *    "closed on absence" reads like a hole. Health findings are derived from
 *    `engine_recent_job_runs` — the SAME rows the `silent_success` breaker
 *    already fails CLOSED on, halting the IDENTICAL capability set. So the
 *    absence this breaker would have to cover is already covered, by a breaker
 *    that stops exactly the same things. Opening a second one on the same
 *    absence buys no additional safety and costs a second thing to diagnose.
 *    That equivalence is asserted in the tests rather than trusted here.
 */
const FAIL_CLOSED: Record<BreakerName, boolean> = {
  publication_volume: true,
  source_failures: false,
  validator_unavailable: true,
  validation_rejection_spike: false,
  database_errors: false,
  duplication_rate: false,
  job_interval: false,
  silent_success: true,
  health_findings: false,
};

export const BREAKER_THRESHOLDS = {
  /** Created-per-day above this many times the job's own median trips. */
  publicationVolumeMultiplier: 3,
  /** Absolute daily ceiling, independent of history. A brand-new engine has no
   *  median to be a multiple of, and "we have never done this before" must not
   *  read as "any volume is normal". */
  publicationHardCeiling: 25,
  /** Below this, volume is too small for a multiple to mean anything. */
  publicationMinAbsolute: 5,
  /** Fraction of polled sources failing that trips. */
  sourceFailureRatio: 0.5,
  /** Consecutive failures against a single source that trips. */
  sourceConsecutiveFailures: 5,
  /** Rejection rate that trips regardless of history. */
  rejectionRateAbsolute: 0.9,
  /** Rejection rate above this multiple of the measured baseline trips. */
  rejectionRateMultiplier: 2,
  /** Floor for the relative rule, so 1% -> 3% is not called a spike. */
  rejectionRateFloor: 0.5,
  /** Fraction of database operations erroring that trips. */
  databaseErrorRatio: 0.25,
  /** Consecutive whole runs ending in failure that trips. */
  databaseConsecutiveErrorRuns: 3,
  /** Duplication rate above this multiple of baseline trips (dedupe storm). */
  duplicationHighMultiplier: 1.5,
  /** Absolute floor for the dedupe-storm rule. */
  duplicationHighFloor: 0.9,
  /** Duplication rate below this fraction of baseline trips (dedupe BROKEN —
   *  the dangerous direction, because it means duplicates are being created). */
  duplicationCollapseFraction: 0.25,
  /** Overdue = this many times the job's expected interval. */
  jobOverdueMultiplier: 2,
  /** Minimum sample before any ratio rule is allowed to fire. */
  minSampleForRatio: 10,
} as const;

// ---------------------------------------------------------------------------
// Validation availability — the rule that must never erode
// ---------------------------------------------------------------------------

export type ValidatorStatus = {
  /** e.g. "evidence", "media_rights", "provenance". */
  validator: string;
  available: boolean;
  /** Why it is unavailable, when it is. */
  detail?: string;
};

/**
 * The decision type has exactly two members. There is no "skip", and adding one
 * would require editing this union — which is the point. A validator that
 * cannot answer is not a validator that said yes.
 */
export type ValidationDecision =
  | { decision: "validate"; validators: string[] }
  | { decision: "stop"; unavailable: string[]; why: string };

/**
 * Decide whether validated work may proceed.
 *
 * Returns `stop` when ANY declared validator is unavailable, and also when NO
 * validator declared itself at all — an empty roster cannot prove that anything
 * was validated, and "nobody checked" must not be indistinguishable from
 * "everybody passed".
 */
export function decideValidation(validators: ValidatorStatus[] | null | undefined): ValidationDecision {
  if (!validators || validators.length === 0) {
    return {
      decision: "stop",
      unavailable: [],
      why:
        "No validator reported its availability, so there is no evidence that evidence/media " +
        "validation ran at all. An unreported validator is treated as unavailable, never as a pass.",
    };
  }

  const unavailable = validators.filter((v) => !v.available);
  if (unavailable.length > 0) {
    const named = unavailable
      .map((v) => (v.detail ? `${v.validator} (${v.detail})` : v.validator))
      .join(", ");
    return {
      decision: "stop",
      unavailable: unavailable.map((v) => v.validator),
      why:
        `Validation cannot be performed because ${unavailable.length} validator(s) are ` +
        `unavailable: ${named}. The engine stops rather than proceeding unvalidated — an ` +
        `unavailable validator is not permission to skip the check.`,
    };
  }

  return { decision: "validate", validators: validators.map((v) => v.validator) };
}

// ---------------------------------------------------------------------------
// Breaker inputs
// ---------------------------------------------------------------------------

export type PublicationVolumeInput = {
  /** Records created in the last 24h that become (or become candidates for) pages. */
  createdLast24h: number;
  /** The engine's OWN median daily creation count, or null with too little history. */
  dailyMedian: number | null;
  /** Optional override of the absolute ceiling. */
  hardCeiling?: number;
};

export type SourceFailureInput = {
  checked: number;
  failed: number;
  /** Worst consecutive_failures value across the registry. */
  maxConsecutiveFailures: number;
};

export type ValidationRejectionInput = {
  evaluated: number;
  rejected: number;
  /** The engine's own historical rejection rate (0..1), or null. */
  baselineRejectionRate: number | null;
};

export type DatabaseErrorInput = {
  operations: number;
  errors: number;
  /** Consecutive whole job runs that ended in `failed`. */
  consecutiveFailedRuns: number;
};

export type DuplicationInput = {
  created: number;
  deduped: number;
  /** The engine's own historical deduped/(created+deduped), or null. */
  baselineDuplicationRate: number | null;
};

export type JobIntervalInput = {
  jobName: string;
  /** Null means it has never recorded a successful run. */
  hoursSinceLastSuccess: number | null;
  /** Derived from the job's own observed cadence, not a hardcoded schedule. */
  expectedIntervalHours: number;
};

/**
 * Silent-success telemetry, produced by detectSilentSuccess() in
 * silent-success.ts. Structural rather than an import so this module stays the
 * leaf it is — silent-success.ts imports EngineCapability from here.
 */
export type SilentSuccessBreakerInput = {
  runsObserved: number;
  signals: number;
  criticalSignals: number;
  jobsAffected: number;
  postconditionTelemetry: "present" | "absent";
  /**
   * Which of the four telemetry states the window is in. See TelemetryState in
   * silent-success.ts.
   *
   * OPTIONAL, so a caller that predates the four-state model still typechecks —
   * and when it is absent the breaker behaves exactly as it did before rather
   * than inventing a state. `runsObserved` alone cannot substitute for it: that
   * counts rows handed to the detector, including 'skipped' ones the detector
   * then discarded, so `runsObserved: 40, measuredRuns: 0` is a real and
   * important combination.
   */
  telemetryState?: "zero_measured_runs" | "measured_clean" | "telemetry_unavailable" | "incidents_detected";
  measuredRuns?: number;
  skippedRuns?: number;
};

/**
 * Health telemetry, produced by healthFindingsBreakerInput() in health.ts.
 *
 * Structural rather than an import for the same reason SilentSuccessBreakerInput
 * is: health.ts imports its breaker input types FROM here, so this module has to
 * stay the leaf.
 */
export type HealthFindingsInput = {
  jobsAssessed: number;
  /** Every critical finding, including the ones that deliberately do not halt. */
  criticalFindings: number;
  /** Critical findings whose kind is in HALTING_HEALTH_FINDING_KINDS. */
  haltingFindings: number;
  haltingKinds: readonly string[];
  haltingJobs: readonly string[];
};

export type BreakerInputs = {
  publication?: PublicationVolumeInput;
  sources?: SourceFailureInput;
  validators?: ValidatorStatus[];
  validation?: ValidationRejectionInput;
  database?: DatabaseErrorInput;
  duplication?: DuplicationInput;
  jobs?: JobIntervalInput[];
  silentSuccess?: SilentSuccessBreakerInput;
  healthFindings?: HealthFindingsInput;
};

// ---------------------------------------------------------------------------
// Individual breakers
// ---------------------------------------------------------------------------

function noData(name: BreakerName, what: string, halts: readonly EngineCapability[]): BreakerVerdict {
  const failClosed = FAIL_CLOSED[name];
  return {
    name,
    state: failClosed ? "open" : "closed",
    basis: "no_data",
    why: failClosed
      ? `No ${what} telemetry was available, and this breaker fails CLOSED: the engine cannot ` +
        `show that it is operating within limits, so it is treated as out of limits.`
      : `No ${what} telemetry in this window. Nothing to measure, and absence here does not ` +
        `indicate a problem.`,
    action: failClosed
      ? `Restore ${what} telemetry (usually: apply the pending engine-safety migration so the ` +
        `read RPC exists) before the halted capabilities resume.`
      : "None.",
    halts: failClosed ? halts : [],
    observed: {},
  };
}

function publicationVolumeBreaker(input: PublicationVolumeInput | undefined): BreakerVerdict {
  const halts: readonly EngineCapability[] = ["creation", "publication"];
  if (!input) return noData("publication_volume", "publication volume", halts);

  const ceiling = input.hardCeiling ?? BREAKER_THRESHOLDS.publicationHardCeiling;
  const observed = {
    createdLast24h: input.createdLast24h,
    dailyMedian: input.dailyMedian,
    hardCeiling: ceiling,
  };

  if (input.createdLast24h > ceiling) {
    return {
      name: "publication_volume",
      state: "open",
      basis: "measured",
      why:
        `${input.createdLast24h} records were created in the last 24 hours, above the absolute ` +
        `ceiling of ${ceiling}. A single runaway discovery event creating hundreds of pages is ` +
        `precisely what this ceiling exists to stop, so creation is suspended even if the ` +
        `volume turns out to be legitimate.`,
      action:
        "Inspect the most recent engine_job_runs rows and the newest engine_discoveries. If the " +
        "volume is genuine, raise the ceiling deliberately in BREAKER_THRESHOLDS rather than " +
        "letting it be exceeded silently.",
      halts,
      observed,
    };
  }

  const median = input.dailyMedian;
  if (
    median !== null &&
    median >= 1 &&
    input.createdLast24h >= BREAKER_THRESHOLDS.publicationMinAbsolute &&
    input.createdLast24h > median * BREAKER_THRESHOLDS.publicationVolumeMultiplier
  ) {
    return {
      name: "publication_volume",
      state: "open",
      basis: "measured",
      why:
        `${input.createdLast24h} records were created in the last 24 hours against this engine's ` +
        `own median of ${median} per day — more than ${BREAKER_THRESHOLDS.publicationVolumeMultiplier}x ` +
        `normal for it. The comparison is to its own history, not to a number someone guessed.`,
      action:
        "Check whether a source started republishing its whole archive, or whether the dedupe key " +
        "stopped matching. Both produce this shape.",
      halts,
      observed,
    };
  }

  return {
    name: "publication_volume",
    state: "closed",
    basis: "measured",
    why:
      `${input.createdLast24h} records created in the last 24 hours, within both the ceiling of ` +
      `${ceiling} and ${median === null ? "no established median yet" : `${BREAKER_THRESHOLDS.publicationVolumeMultiplier}x the median of ${median}`}.`,
    action: "None.",
    halts: [],
    observed,
  };
}

function sourceFailureBreaker(input: SourceFailureInput | undefined): BreakerVerdict {
  const halts: readonly EngineCapability[] = ["discovery"];
  if (!input) return noData("source_failures", "source health", halts);

  const ratio = input.checked > 0 ? input.failed / input.checked : 0;
  const observed = {
    checked: input.checked,
    failed: input.failed,
    failureRatio: Number(ratio.toFixed(3)),
    maxConsecutiveFailures: input.maxConsecutiveFailures,
  };

  if (input.maxConsecutiveFailures >= BREAKER_THRESHOLDS.sourceConsecutiveFailures) {
    return {
      name: "source_failures",
      state: "open",
      basis: "measured",
      why:
        `At least one source has now failed ${input.maxConsecutiveFailures} times in a row ` +
        `(threshold ${BREAKER_THRESHOLDS.sourceConsecutiveFailures}). A source that fails this ` +
        `persistently has usually moved, changed format, or started blocking us — continuing to ` +
        `poll it burns budget and produces nothing.`,
      action:
        "Open the engine sources registry, find the row with the highest consecutive_failures and " +
        "read its last_error. Fix the URL or deactivate the source.",
      halts,
      observed,
    };
  }

  if (input.checked >= BREAKER_THRESHOLDS.minSampleForRatio && ratio >= BREAKER_THRESHOLDS.sourceFailureRatio) {
    return {
      name: "source_failures",
      state: "open",
      basis: "measured",
      why:
        `${input.failed} of ${input.checked} polled sources failed (${(ratio * 100).toFixed(0)}%, ` +
        `threshold ${(BREAKER_THRESHOLDS.sourceFailureRatio * 100).toFixed(0)}%). Failure at this ` +
        `scale is usually ours, not theirs — outbound network, DNS, or a bad user agent.`,
      action:
        "Check whether the deployment can reach the open internet at all before touching individual sources.",
      halts,
      observed,
    };
  }

  return {
    name: "source_failures",
    state: "closed",
    basis: "measured",
    why: `${input.failed} of ${input.checked} polled sources failed; worst consecutive failure streak is ${input.maxConsecutiveFailures}.`,
    action: "None.",
    halts: [],
    observed,
  };
}

function validatorBreaker(validators: ValidatorStatus[] | undefined): BreakerVerdict {
  const halts: readonly EngineCapability[] = ["creation", "media_acquisition", "publication"];
  const decision = decideValidation(validators);

  if (decision.decision === "stop") {
    return {
      name: "validator_unavailable",
      state: "open",
      basis: validators && validators.length > 0 ? "measured" : "no_data",
      why: decision.why,
      action:
        "Restore the named validator(s). Do NOT work around this by disabling the check — the " +
        "engine is designed to stop rather than create records nobody validated.",
      halts,
      observed: {
        declared: validators?.length ?? 0,
        unavailable: decision.unavailable.length,
        unavailableNames: decision.unavailable.join(", ") || null,
      },
    };
  }

  return {
    name: "validator_unavailable",
    state: "closed",
    basis: "measured",
    why: `All ${decision.validators.length} declared validator(s) are available: ${decision.validators.join(", ")}.`,
    action: "None.",
    halts: [],
    observed: { declared: decision.validators.length, unavailable: 0, unavailableNames: null },
  };
}

function rejectionSpikeBreaker(input: ValidationRejectionInput | undefined): BreakerVerdict {
  const halts: readonly EngineCapability[] = ["creation", "discovery"];
  if (!input) return noData("validation_rejection_spike", "validation outcome", halts);

  const rate = input.evaluated > 0 ? input.rejected / input.evaluated : 0;
  const observed = {
    evaluated: input.evaluated,
    rejected: input.rejected,
    rejectionRate: Number(rate.toFixed(3)),
    baselineRejectionRate: input.baselineRejectionRate,
  };

  if (input.evaluated < BREAKER_THRESHOLDS.minSampleForRatio) {
    return {
      name: "validation_rejection_spike",
      state: "closed",
      basis: "measured",
      why:
        `Only ${input.evaluated} item(s) were validated, below the minimum sample of ` +
        `${BREAKER_THRESHOLDS.minSampleForRatio} needed for a rejection rate to mean anything.`,
      action: "None.",
      halts: [],
      observed,
    };
  }

  if (rate >= BREAKER_THRESHOLDS.rejectionRateAbsolute) {
    return {
      name: "validation_rejection_spike",
      state: "open",
      basis: "measured",
      why:
        `${input.rejected} of ${input.evaluated} validations were rejected ` +
        `(${(rate * 100).toFixed(0)}%). Near-total rejection almost always means the INPUT broke — ` +
        `a source now serving something else, or a classifier fed the wrong field — not that the ` +
        `world suddenly became untrustworthy.`,
      action:
        "Read a handful of the rejected items. If they are malformed rather than genuinely bad, " +
        "the source or the parser is the problem.",
      halts,
      observed,
    };
  }

  const baseline = input.baselineRejectionRate;
  if (
    baseline !== null &&
    baseline > 0 &&
    rate >= BREAKER_THRESHOLDS.rejectionRateFloor &&
    rate > baseline * BREAKER_THRESHOLDS.rejectionRateMultiplier
  ) {
    return {
      name: "validation_rejection_spike",
      state: "open",
      basis: "measured",
      why:
        `The rejection rate is ${(rate * 100).toFixed(0)}%, more than ` +
        `${BREAKER_THRESHOLDS.rejectionRateMultiplier}x this engine's own baseline of ` +
        `${(baseline * 100).toFixed(0)}%. Measured against its own history, not a guessed number.`,
      action: "Compare the newest rejected items against ones from before the change in rate.",
      halts,
      observed,
    };
  }

  return {
    name: "validation_rejection_spike",
    state: "closed",
    basis: "measured",
    why: `Rejection rate ${(rate * 100).toFixed(0)}% over ${input.evaluated} validations, within normal range.`,
    action: "None.",
    halts: [],
    observed,
  };
}

function databaseErrorBreaker(input: DatabaseErrorInput | undefined): BreakerVerdict {
  // A database that is erroring undermines every other measurement, so this one
  // halts everything rather than a subset.
  const halts: readonly EngineCapability[] = ALL_CAPABILITIES;
  if (!input) return noData("database_errors", "database operation", halts);

  const ratio = input.operations > 0 ? input.errors / input.operations : 0;
  const observed = {
    operations: input.operations,
    errors: input.errors,
    errorRatio: Number(ratio.toFixed(3)),
    consecutiveFailedRuns: input.consecutiveFailedRuns,
  };

  if (input.consecutiveFailedRuns >= BREAKER_THRESHOLDS.databaseConsecutiveErrorRuns) {
    return {
      name: "database_errors",
      state: "open",
      basis: "measured",
      why:
        `${input.consecutiveFailedRuns} consecutive job runs ended in failure (threshold ` +
        `${BREAKER_THRESHOLDS.databaseConsecutiveErrorRuns}). Repeated database failure means no ` +
        `measurement the engine reports can currently be trusted, so every capability is suspended.`,
      action:
        "Read the `error` column on the most recent engine_job_runs rows. A missing function name " +
        "there means a migration in supabase/migrations_pending/ has not been applied.",
      halts,
      observed,
    };
  }

  if (input.operations >= BREAKER_THRESHOLDS.minSampleForRatio && ratio >= BREAKER_THRESHOLDS.databaseErrorRatio) {
    return {
      name: "database_errors",
      state: "open",
      basis: "measured",
      why:
        `${input.errors} of ${input.operations} database operations errored ` +
        `(${(ratio * 100).toFixed(0)}%, threshold ${(BREAKER_THRESHOLDS.databaseErrorRatio * 100).toFixed(0)}%).`,
      action: "Check for a missing RPC, a changed signature, or a revoked grant.",
      halts,
      observed,
    };
  }

  return {
    name: "database_errors",
    state: "closed",
    basis: "measured",
    why: `${input.errors} of ${input.operations} database operations errored; ${input.consecutiveFailedRuns} consecutive failed run(s).`,
    action: "None.",
    halts: [],
    observed,
  };
}

function duplicationBreaker(input: DuplicationInput | undefined): BreakerVerdict {
  const halts: readonly EngineCapability[] = ["creation", "discovery"];
  if (!input) return noData("duplication_rate", "deduplication", halts);

  const total = input.created + input.deduped;
  const rate = total > 0 ? input.deduped / total : 0;
  const baseline = input.baselineDuplicationRate;
  const observed = {
    created: input.created,
    deduped: input.deduped,
    duplicationRate: Number(rate.toFixed(3)),
    baselineDuplicationRate: baseline,
  };

  if (total < BREAKER_THRESHOLDS.minSampleForRatio) {
    return {
      name: "duplication_rate",
      state: "closed",
      basis: "measured",
      why: `Only ${total} item(s) processed, below the minimum sample of ${BREAKER_THRESHOLDS.minSampleForRatio} for a duplication rate to mean anything.`,
      action: "None.",
      halts: [],
      observed,
    };
  }

  // Direction 1 — dedupe COLLAPSED. The dangerous one: the fingerprint stopped
  // matching, so re-seen items are being written as new records. This is how a
  // catalogue fills with near-duplicates without anything reporting an error.
  if (
    baseline !== null &&
    baseline >= 0.2 &&
    rate < baseline * BREAKER_THRESHOLDS.duplicationCollapseFraction
  ) {
    return {
      name: "duplication_rate",
      state: "open",
      basis: "measured",
      why:
        `Deduplication collapsed: only ${(rate * 100).toFixed(0)}% of items deduped against this ` +
        `engine's own baseline of ${(baseline * 100).toFixed(0)}%. Re-seen items are being written ` +
        `as NEW records, which is how a catalogue quietly fills with near-duplicates while every ` +
        `job still reports success.`,
      action:
        "Check buildDedupeKey() and whether source titles changed shape. Do not clear the backlog " +
        "before the key is fixed, or the duplicates will simply be recreated.",
      halts,
      observed,
    };
  }

  // Direction 2 — dedupe STORM. Everything collapses onto a handful of keys, so
  // genuinely new items are being discarded as repeats.
  if (
    rate >= BREAKER_THRESHOLDS.duplicationHighFloor &&
    baseline !== null &&
    baseline > 0 &&
    rate > baseline * BREAKER_THRESHOLDS.duplicationHighMultiplier
  ) {
    return {
      name: "duplication_rate",
      state: "open",
      basis: "measured",
      why:
        `${(rate * 100).toFixed(0)}% of items deduped against a baseline of ` +
        `${(baseline * 100).toFixed(0)}%. An unusually high rate means distinct items are ` +
        `collapsing onto the same fingerprint, so genuinely new discoveries are being discarded ` +
        `as repeats — invisible loss, not visible failure.`,
      action:
        "Inspect a few dedupe keys that absorbed many sightings. An over-broad key (e.g. one that " +
        "drops the model number) produces this.",
      halts,
      observed,
    };
  }

  return {
    name: "duplication_rate",
    state: "closed",
    basis: "measured",
    why:
      `${(rate * 100).toFixed(0)}% duplication over ${total} item(s)` +
      (baseline === null ? ", with no established baseline to compare against yet." : `, against a baseline of ${(baseline * 100).toFixed(0)}%.`),
    action: "None.",
    halts: [],
    observed,
  };
}

function jobIntervalBreaker(jobs: JobIntervalInput[] | undefined): BreakerVerdict {
  const halts: readonly EngineCapability[] = ["creation", "publication"];
  if (!jobs || jobs.length === 0) return noData("job_interval", "job cadence", halts);

  const overdue = jobs.filter((j) => {
    const limit = j.expectedIntervalHours * BREAKER_THRESHOLDS.jobOverdueMultiplier;
    if (j.hoursSinceLastSuccess === null) return true;
    return j.hoursSinceLastSuccess > limit;
  });

  const observed = {
    jobsTracked: jobs.length,
    overdue: overdue.length,
    overdueNames: overdue.map((j) => j.jobName).join(", ") || null,
  };

  if (overdue.length > 0) {
    const detail = overdue
      .map((j) =>
        j.hoursSinceLastSuccess === null
          ? `${j.jobName} (has never recorded a successful run)`
          : `${j.jobName} (${j.hoursSinceLastSuccess.toFixed(1)}h since last success, expected every ${j.expectedIntervalHours}h)`
      )
      .join("; ");
    return {
      name: "job_interval",
      state: "open",
      basis: "measured",
      why:
        `${overdue.length} job(s) have not completed successfully within ` +
        `${BREAKER_THRESHOLDS.jobOverdueMultiplier}x their expected interval: ${detail}. A stage ` +
        `that silently stopped running looks identical to a stage with nothing to do, which is why ` +
        `this is measured rather than assumed.`,
      action:
        "Check the tick route's response and the engine_job_runs rows for those job names. A stage " +
        "throwing every pass, or a flag switched off, both produce this.",
      halts,
      observed,
    };
  }

  return {
    name: "job_interval",
    state: "closed",
    basis: "measured",
    why: `All ${jobs.length} tracked job(s) completed successfully within their expected interval.`,
    action: "None.",
    halts: [],
    observed,
  };
}

/**
 * The SILENT_SUCCESS breaker.
 *
 * Trips on ANY critical signal, with no ratio and no minimum sample. Every
 * other breaker here waits for a sample because it is measuring a rate against
 * a baseline; this one is measuring whether the engine's own report of what it
 * did can be believed. There is no acceptable rate of "reported success while
 * doing nothing", because every other measurement in this file is computed from
 * exactly those reports. One confirmed instance makes the rest of the telemetry
 * evidence of nothing.
 *
 * It halts CREATION but not classification or maintenance: continuing to
 * measure is how the problem gets diagnosed, and re-running an idempotent
 * assessor changes nothing. Creating more entities on top of an unknown number
 * of phantom writes is the move that turns a detectable bug into a cleanup job.
 */
function silentSuccessBreaker(input: SilentSuccessBreakerInput | undefined): BreakerVerdict {
  const halts: readonly EngineCapability[] = ["creation", "media_acquisition", "publication"];
  if (!input) return noData("silent_success", "silent-success detection", halts);

  const observed = {
    runsObserved: input.runsObserved,
    signals: input.signals,
    criticalSignals: input.criticalSignals,
    jobsAffected: input.jobsAffected,
    postconditionTelemetry: input.postconditionTelemetry,
    telemetryState: input.telemetryState ?? null,
    measuredRuns: input.measuredRuns ?? null,
    skippedRuns: input.skippedRuns ?? null,
  };

  // ZERO MEASURED RUNS — state (a). Distinct from every other verdict this
  // function can return, and distinct in the field that matters: `basis` is
  // "no_data", not "measured". A closed breaker on measured evidence and a
  // closed breaker on no evidence at all are different facts, and this file
  // already has the vocabulary to say so — it just was never said here, so a
  // window containing nothing produced the identical verdict to a window that
  // was examined and found clean.
  //
  // It does NOT open. A brand-new engine has no runs, and a breaker that opens
  // on an empty history would leave the engine permanently unable to start,
  // which is not fail-closed but stuck. The honest report is "nothing is known",
  // and the graduation gate — which is where an unproven claim actually has to
  // be refused — blocks on it. See telemetryStateBlocksGraduation().
  if (input.telemetryState === "zero_measured_runs") {
    return {
      name: "silent_success",
      state: "closed",
      basis: "no_data",
      why:
        `NOTHING WAS MEASURED. ${input.runsObserved} run row(s) were handed to the detector and ` +
        `${input.measuredRuns ?? 0} of them entered the analysis` +
        (input.skippedRuns ? ` (${input.skippedRuns} were 'skipped' and are excluded from every rule)` : "") +
        `. This is NOT a clean bill of health and must not be read as one: no rule ran, so a completely ` +
        `broken stage would produce exactly this verdict. The breaker stays closed because an engine ` +
        `with no history must still be able to start, but the state is UNKNOWN, not healthy, and ` +
        `autonomous graduation is blocked on it.`,
      action:
        "Check that the tick is actually running and that its stages are recording rows. If every run " +
        "is 'skipped', read the reason on those rows — a reason ending '_flag_unreadable' is a failed " +
        "kill-switch read wearing a skip's clothes.",
      halts: [],
      observed,
    };
  }

  // TELEMETRY UNAVAILABLE — state (c). Its own branch, above the generic
  // critical-signals branch it used to fall into.
  //
  // WHY IT NEEDED SEPARATING. `detection_unavailable` is itself a critical
  // signal, so (c) and (d) produced the identical verdict — same state, same
  // basis, same halts, same sentence about "N critical signals". An operator
  // triaging an open silent_success breaker could not tell "we could not read
  // the telemetry" from "we read it and found a stage lying about its work", and
  // those have completely different fixes: one is a grant, the other is a job.
  //
  // `basis` STAYS "measured", deliberately, and not for want of noticing. The
  // reasoning is asserted in circuit-breaker-chaos.test.ts and it is sound: the
  // detector RAN and positively reported its own blindness, which is a stronger
  // answer than publication_volume's `no_data`, where nothing arrived at all.
  // The two are genuinely different kinds of absence and the field already
  // distinguishes them correctly. What separates (c) from (d) is
  // `observed.telemetryState` and the text below.
  //
  // NOTHING IS WEAKENED: same `state: "open"`, same `halts`.
  if (input.telemetryState === "telemetry_unavailable") {
    return {
      name: "silent_success",
      state: "open",
      basis: "measured",
      why:
        `TELEMETRY UNAVAILABLE. The SILENT_SUCCESS detector could not read the job-run history, so the ` +
        `class could not be looked for at all. This is NOT a clean report and it is NOT a finding about ` +
        `any particular stage — it is the absence of the evidence every other breaker here is computed ` +
        `from. A failure class whose entire signature is "looks fine" cannot be assumed absent because ` +
        `nobody was able to look, so the engine is treated as out of limits until it can show otherwise.`,
      action:
        "Restore engine_recent_job_runs: check that the function exists at the signature guard.ts calls " +
        "(p_hours, p_limit) and that anon still has execute on it. A revoked grant reports as " +
        "'not found in schema cache' rather than as a permission error.",
      halts,
      observed,
    };
  }

  if (input.criticalSignals > 0) {
    return {
      name: "silent_success",
      state: "open",
      basis: "measured",
      why:
        `${input.criticalSignals} critical SILENT_SUCCESS signal(s) across ${input.jobsAffected} ` +
        `job(s): at least one stage reported success while having no effect. Unlike every other ` +
        `breaker here there is no threshold to be under — the readings the other breakers rely on ` +
        `come from the same status column that just proved unreliable, so creation stops on the ` +
        `first instance rather than on a rate.`,
      action:
        "Read the silentSuccess block in the tick's engine_job_runs detail. It names the job, the " +
        "shape, and what to run by hand. Do NOT clear the signals by re-running the pass — a " +
        "silent success reproduces silently.",
      halts,
      observed,
    };
  }

  // Detection working but blunt. Not a halt: the coarse cross-run detectors
  // still ran, and halting on "we could be looking harder" would make applying
  // a migration a precondition for the engine functioning at all.
  if (input.postconditionTelemetry === "absent") {
    return {
      name: "silent_success",
      state: "closed",
      basis: "measured",
      why:
        `No critical signals across ${input.runsObserved} run(s), but per-run postcondition ` +
        `counters are absent, so only the cross-run shapes could be checked. A mutation rejected ` +
        `and miscounted as a duplicate would not be visible at this resolution.`,
      action:
        "Applied: supabase/migrations/20260822_silent_success_telemetry.sql to raise the " +
        "resolution of this check.",
      halts: [],
      observed,
    };
  }

  return {
    name: "silent_success",
    state: "closed",
    basis: "measured",
    why:
      `MEASURED AND CLEAN. ${input.measuredRuns ?? input.runsObserved} run(s) were examined against every ` +
      `rule in silent-success.ts and none fired, with per-run postcondition counters present. This is the ` +
      `one verdict here that means health, and it is reachable only by having looked.`,
    action: "None.",
    halts: [],
    observed,
  };
}

/**
 * The HEALTH FINDINGS breaker.
 *
 * THE HOLE IT CLOSES. health.ts has always been able to raise a CRITICAL
 * `zero_processing_anomaly` — "this job reported success having examined 0 items
 * against its own median of 22", which is the literal signature of a silently
 * denied read — and the engine carried on creating, because `gateFor()` reads
 * the breakers, the lease and the budget ledger, and health findings reached
 * none of them. They were rendered into a jsonb detail payload and that was all.
 * A detector whose output gates nothing documents an incident; it does not
 * prevent one.
 *
 * WHY IT TRIPS ON ONE. Same argument as `silent_success`: the halting kinds are
 * not measurements of a rate, they are findings that the engine's own report of
 * what it did cannot be believed. Every other breaker in this file computes its
 * verdict FROM those reports. One confirmed instance makes the rest of the
 * telemetry evidence of nothing, so there is no threshold to be under.
 *
 * WHY THIS SET OF HALTS. Identical to `silent_success`: creation,
 * media_acquisition and publication. Measurement, classification and maintenance
 * continue, because continuing to measure is how the problem gets diagnosed and
 * re-running an idempotent assessor changes nothing.
 */
function healthFindingsBreaker(input: HealthFindingsInput | undefined): BreakerVerdict {
  const halts: readonly EngineCapability[] = ["creation", "media_acquisition", "publication"];
  if (!input) return noData("health_findings", "engine health", halts);

  const observed = {
    jobsAssessed: input.jobsAssessed,
    criticalFindings: input.criticalFindings,
    haltingFindings: input.haltingFindings,
    haltingKinds: input.haltingKinds.join(", ") || null,
    haltingJobs: input.haltingJobs.join(", ") || null,
  };

  if (input.haltingFindings > 0) {
    return {
      name: "health_findings",
      state: "open",
      basis: "measured",
      why:
        `${input.haltingFindings} critical health finding(s) of a halting kind ` +
        `(${input.haltingKinds.join(", ")}) across ${input.haltingJobs.length} job(s): ` +
        `${input.haltingJobs.join(", ")}. Each of those kinds means a stage's own report of what it did ` +
        `is unreliable — it claimed success while touching nothing, examined nothing against a history ` +
        `of examining plenty, or could not show it was able to read its input at all. Every other ` +
        `breaker here computes its verdict from those same reports, so creation stops on the first ` +
        `instance rather than on a rate.`,
      action:
        "Open the health findings in the tick's guard detail and find the named job(s). The finding " +
        "carries the exact read to run by hand as anon. Do NOT clear it by re-running the pass — a " +
        "denied read reproduces silently.",
      halts,
      observed,
    };
  }

  return {
    name: "health_findings",
    state: "closed",
    basis: "measured",
    why:
      `No halting health findings across ${input.jobsAssessed} job(s)` +
      (input.criticalFindings > 0
        ? `. ${input.criticalFindings} critical finding(s) were raised, but none of a kind this breaker ` +
          `acts on — those kinds have their own breakers (job_interval, database_errors, ` +
          `publication_volume, duplication_rate) and are deliberately not doubled up here.`
        : "."),
    action: "None.",
    halts: [],
    observed,
  };
}

// ---------------------------------------------------------------------------
// Report
// ---------------------------------------------------------------------------

export function evaluateBreakers(inputs: BreakerInputs): BreakerReport {
  const verdicts: BreakerVerdict[] = [
    publicationVolumeBreaker(inputs.publication),
    sourceFailureBreaker(inputs.sources),
    validatorBreaker(inputs.validators),
    rejectionSpikeBreaker(inputs.validation),
    databaseErrorBreaker(inputs.database),
    duplicationBreaker(inputs.duplication),
    jobIntervalBreaker(inputs.jobs),
    silentSuccessBreaker(inputs.silentSuccess),
    healthFindingsBreaker(inputs.healthFindings),
  ];

  const open = verdicts.filter((v) => v.state === "open");
  const halted = ALL_CAPABILITIES.filter((c) => open.some((v) => v.halts.includes(c)));

  const summary =
    open.length === 0
      ? "All circuit breakers closed."
      : `${open.length} circuit breaker(s) open (${open.map((v) => v.name).join(", ")}); ` +
        `halted capabilities: ${halted.join(", ")}.`;

  return { verdicts, open, halted, healthy: open.length === 0, summary };
}

/** Whether a capability is suspended by any open breaker. */
export function isHalted(report: BreakerReport, capability: EngineCapability): boolean {
  return report.halted.includes(capability);
}

/** The reason a capability is halted, for the audit log and the HTTP response. */
export function haltReason(report: BreakerReport, capability: EngineCapability): string | null {
  const culprits = report.open.filter((v) => v.halts.includes(capability));
  if (culprits.length === 0) return null;
  return culprits.map((v) => `[${v.name}] ${v.why} ACTION: ${v.action}`).join(" | ");
}
