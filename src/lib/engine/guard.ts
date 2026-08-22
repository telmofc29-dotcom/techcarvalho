import "server-only";
import type { createClient } from "@/lib/supabase/server";
import {
  evaluateBreakers,
  haltReason,
  type BreakerReport,
  type EngineCapability,
  type SourceFailureInput,
  type ValidationRejectionInput,
} from "@/lib/engine/circuit-breaker";
import {
  assessEngineHealth,
  breakerInputsFromRuns,
  type HealthReport,
  type JobRunRecord,
} from "@/lib/engine/health";
import {
  budgetGateForJob,
  describeBudgets,
  ledgerFromJobRuns,
  type BudgetLedger,
} from "@/lib/engine/budgets";
import {
  capabilityOf,
  decideLease,
  TICK_LEASE_SECONDS,
  type LeaseDecision,
  type LeaseOutcome,
} from "@/lib/engine/concurrency";
import { probeCoreValidators } from "@/lib/engine/validators";
import { logQueryError } from "@/lib/log/query-error";
import {
  detectSilentSuccess,
  silentSuccessBreakerInput,
  silentSuccessFindings,
  type SilentSuccessReport,
  type SilentSuccessRun,
} from "@/lib/engine/silent-success";

// The I/O half of the engine safety layer. Everything that DECIDES lives in the
// pure modules (circuit-breaker, health, budgets, concurrency, validators) and
// is unit-tested there; this file only fetches telemetry and hands it over.
// Nothing here has a rule of its own, deliberately — a rule that lives in a
// server-only module is a rule that cannot be tested.

type Client = Awaited<ReturnType<typeof createClient>>;

/**
 * Every read below goes through a SECURITY DEFINER RPC because engine tables
 * are admin-only under RLS and the scheduled path runs as `anon`. A direct
 * select would return zero rows with no error, which would make a completely
 * blind guard look like a perfectly healthy one — the exact failure this whole
 * layer exists to prevent. So an unavailable RPC is reported as UNAVAILABLE and
 * never as "no findings".
 */
export type Telemetry = {
  available: boolean;
  runs: SilentSuccessRun[];
  sources: SourceFailureInput | undefined;
  validation: ValidationRejectionInput | undefined;
  unavailableReasons: string[];
};

/**
 * The columns `engine_recent_job_runs` returns.
 *
 * The four postcondition columns are OPTIONAL because they do not exist in
 * production yet — the draft that adds them is in
 * supabase/migrations_pending/20260822_silent_success_telemetry.sql. They are
 * read as `undefined` rather than defaulted to 0, because 0 would assert "no
 * silent no-ops occurred" on the strength of a column that was never selected.
 */
type RawJobRun = {
  job_name: string;
  status: string;
  started_at: string;
  finished_at: string | null;
  items_examined: number;
  items_created: number;
  items_deduped: number;
  items_failed: number;
  has_error: boolean;
  silent_no_ops?: number | null;
  unverified_writes?: number | null;
  blind_writes?: number | null;
  verified_writes?: number | null;
};

function messageOf(error: unknown): string {
  if (error && typeof error === "object" && "message" in error) {
    return String((error as { message: unknown }).message);
  }
  return String(error);
}

export async function loadTelemetry(supabase: Client, hours = 336): Promise<Telemetry> {
  const unavailableReasons: string[] = [];

  const [runsResult, sourceResult, validationResult] = await Promise.all([
    supabase.rpc("engine_recent_job_runs", { p_hours: hours, p_limit: 800 }),
    supabase.rpc("engine_source_health"),
    supabase.rpc("engine_validation_stats", { p_hours: 24 }),
  ]);

  let runs: SilentSuccessRun[] = [];
  let available = true;
  if (runsResult.error) {
    available = false;
    unavailableReasons.push(`engine_recent_job_runs: ${messageOf(runsResult.error)}`);
  } else if (runsResult.data === null) {
    // No error and no rows is the anon/RLS signature, not an empty history —
    // engine_recent_job_runs returns a table, so supabase-js gives [] when it
    // genuinely has nothing. A null here means the call did not do what it says.
    available = false;
    unavailableReasons.push(
      "engine_recent_job_runs returned null rather than a row set, which is what a denied or " +
        "missing SECURITY DEFINER function looks like — not an empty job history."
    );
  } else {
    runs = ((runsResult.data ?? []) as RawJobRun[]).map((r) => ({
      jobName: r.job_name,
      status: r.status as JobRunRecord["status"],
      startedAt: r.started_at,
      finishedAt: r.finished_at,
      itemsExamined: r.items_examined,
      itemsCreated: r.items_created,
      itemsDeduped: r.items_deduped,
      itemsFailed: r.items_failed,
      hasError: r.has_error,
      silentNoOps: r.silent_no_ops ?? null,
      unverifiedWrites: r.unverified_writes ?? null,
      blindWrites: r.blind_writes ?? null,
      verifiedWrites: r.verified_writes ?? null,
    }));
  }

  let sources: SourceFailureInput | undefined;
  if (sourceResult.error) {
    unavailableReasons.push(`engine_source_health: ${messageOf(sourceResult.error)}`);
  } else {
    const row = ((sourceResult.data ?? []) as {
      checked: number;
      failed: number;
      max_consecutive_failures: number;
    }[])[0];
    if (row) {
      sources = {
        checked: row.checked,
        failed: row.failed,
        maxConsecutiveFailures: row.max_consecutive_failures,
      };
    }
  }

  let validation: ValidationRejectionInput | undefined;
  if (validationResult.error) {
    unavailableReasons.push(`engine_validation_stats: ${messageOf(validationResult.error)}`);
  } else {
    const row = ((validationResult.data ?? []) as {
      evaluated: number;
      rejected: number;
      baseline_evaluated: number;
      baseline_rejected: number;
    }[])[0];
    if (row) {
      validation = {
        evaluated: row.evaluated,
        rejected: row.rejected,
        // Null rather than 0 when there is no baseline period — a fabricated
        // zero baseline would make any rejection at all look like a spike.
        baselineRejectionRate:
          row.baseline_evaluated > 0 ? row.baseline_rejected / row.baseline_evaluated : null,
      };
    }
  }

  return { available, runs, sources, validation, unavailableReasons };
}

// ---------------------------------------------------------------------------
// Run lease
// ---------------------------------------------------------------------------

export type LeaseResult = {
  outcome: LeaseOutcome;
  runId: string | null;
  decision: LeaseDecision;
  error: string | null;
};

/**
 * Claim the run lease for this window. The RPC uses the partial unique index on
 * (job_name, idempotency_key) that has existed since Phase 3 and was never
 * populated by anything — engine_record_job_run has always passed a null key,
 * so the index has protected exactly nothing until now.
 */
export async function beginRun(
  supabase: Client,
  jobName: string,
  idempotencyKey: string,
  leaseSeconds = TICK_LEASE_SECONDS
): Promise<LeaseResult> {
  const { data, error } = await supabase.rpc("engine_begin_run", {
    p_job_name: jobName,
    p_idempotency_key: idempotencyKey,
    p_lease_seconds: leaseSeconds,
  });

  if (error) {
    return { outcome: "unavailable", runId: null, decision: decideLease("unavailable"), error: messageOf(error) };
  }
  const value = typeof data === "string" ? data : "";
  if (value === "already_running") {
    return { outcome: "already_running", runId: null, decision: decideLease("already_running"), error: null };
  }
  if (value.startsWith("acquired:")) {
    return { outcome: "acquired", runId: value.slice("acquired:".length), decision: decideLease("acquired"), error: null };
  }
  if (value.startsWith("took_over:")) {
    return {
      outcome: "took_over_expired",
      runId: value.slice("took_over:".length),
      decision: decideLease("took_over_expired"),
      error: null,
    };
  }
  // An unrecognised answer is treated as no lease at all rather than as a pass.
  return {
    outcome: "unavailable",
    runId: null,
    decision: decideLease("unavailable"),
    error: `engine_begin_run returned an unrecognised value: ${JSON.stringify(data)}`,
  };
}

export async function completeRun(
  supabase: Client,
  runId: string,
  status: "success" | "partial" | "failed" | "skipped",
  counters: { examined: number; created: number; deduped: number; failed: number },
  detail: Record<string, unknown>,
  error?: string
): Promise<void> {
  try {
    const { data, error: writeError } = await supabase.rpc("engine_complete_run", {
      p_run_id: runId,
      p_status: status,
      p_items_examined: counters.examined,
      p_items_created: counters.created,
      p_items_deduped: counters.deduped,
      p_items_failed: counters.failed,
      p_detail: detail,
      p_error: error ?? null,
    });
    // Not fatal — the lease expires on its own if this never lands — but not
    // silent either. A completion that does not land leaves the run row stuck
    // in 'running', which health.ts then reports as a stuck_run: a real symptom
    // with a misleading cause. Naming it here saves that diagnosis.
    logQueryError(`engine_complete_run(${runId}) — run row left open`, writeError);
    if (!writeError && data !== "ok" && data !== null) {
      logQueryError(`engine_complete_run(${runId}) returned '${String(data)}' rather than completing the run`, {
        message: `unexpected status: ${String(data)}`,
      });
    }
  } catch (e) {
    logQueryError(`engine_complete_run(${runId}) threw; run row left open`, {
      message: e instanceof Error ? e.message : String(e),
    });
  }
}

// ---------------------------------------------------------------------------
// The guard
// ---------------------------------------------------------------------------

export type StageGate = { allow: boolean; why: string };

export type EngineGuard = {
  telemetry: Telemetry;
  breakers: BreakerReport;
  health: HealthReport;
  silentSuccess: SilentSuccessReport;
  ledger: BudgetLedger;
  lease: LeaseResult;
  gateFor(jobName: string): StageGate;
  detail(): Record<string, unknown>;
};

export function buildGuard(args: {
  telemetry: Telemetry;
  lease: LeaseResult;
  now: Date;
}): EngineGuard {
  const { telemetry, lease, now } = args;

  const health = assessEngineHealth(telemetry.runs, { now });
  const fromRuns = telemetry.available ? breakerInputsFromRuns(telemetry.runs, { now }) : {};

  // Run the SILENT_SUCCESS detector over the same rows health.ts just read. One
  // dataset, two readings — a detector with its own private feed is one that
  // can be starved without anyone noticing.
  const silentSuccess = detectSilentSuccess(telemetry.runs, {
    telemetryAvailable: telemetry.available,
  });

  const breakers = evaluateBreakers({
    ...fromRuns,
    sources: telemetry.sources,
    validation: telemetry.validation,
    validators: probeCoreValidators(),
    silentSuccess: silentSuccessBreakerInput(silentSuccess, telemetry.runs.length),
  });

  const ledger = ledgerFromJobRuns(telemetry.runs, { now });
  const leaseHalts = new Set<EngineCapability>(lease.decision.halts);

  function gateFor(jobName: string): StageGate {
    const capability = capabilityOf(jobName);

    if (capability) {
      const breakerWhy = haltReason(breakers, capability);
      if (breakerWhy) {
        return { allow: false, why: `Circuit breaker halted '${capability}'. ${breakerWhy}` };
      }
      if (leaseHalts.has(capability)) {
        return { allow: false, why: `Concurrency control halted '${capability}'. ${lease.decision.why}` };
      }
    }

    const budget = budgetGateForJob(jobName, ledger);
    if (!budget.allow) return { allow: false, why: budget.why };

    return { allow: true, why: budget.why };
  }

  function detail(): Record<string, unknown> {
    return {
      telemetryAvailable: telemetry.available,
      telemetryGaps: telemetry.unavailableReasons,
      lease: { outcome: lease.outcome, why: lease.decision.why, error: lease.error },
      breakers: {
        healthy: breakers.healthy,
        summary: breakers.summary,
        halted: breakers.halted,
        open: breakers.open.map((v) => ({ name: v.name, why: v.why, action: v.action, observed: v.observed })),
      },
      health: {
        healthy: health.healthy,
        summary: health.summary,
        // SILENT_SUCCESS signals are folded into the health findings list on
        // purpose. A separate list is a second place to look, and the whole
        // failure class survives on nobody looking.
        findings: [...health.findings, ...silentSuccessFindings(silentSuccess)].map((f) => ({
          job: f.job,
          kind: f.kind,
          severity: f.severity,
          why: f.why,
          action: f.action,
        })),
      },
      silentSuccess: {
        clean: silentSuccess.clean,
        summary: silentSuccess.summary,
        postconditionTelemetry: silentSuccess.postconditionTelemetry,
        signals: silentSuccess.signals.map((s) => ({
          kind: s.kind,
          severity: s.severity,
          job: s.job,
          why: s.why,
          action: s.action,
          observed: s.observed,
        })),
      },
      budgets: describeBudgets(ledger),
    };
  }

  return { telemetry, breakers, health, silentSuccess, ledger, lease, gateFor, detail };
}
