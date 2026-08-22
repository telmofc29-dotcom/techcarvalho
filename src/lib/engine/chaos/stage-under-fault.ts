// CHAOS: the carrier stage.
//
// WHAT THIS IS, PRECISELY — read this before believing anything it proves
// ----------------------------------------------------------------------
// The fourteen real engine stages live in src/lib/engine/jobs/*.ts and every one
// of them begins `import "server-only"`, a module that THROWS the moment it is
// imported outside a Next.js server render. They therefore cannot be loaded by
// `node --test` at all, and nothing here modifies them to make them loadable —
// stripping the guard would mean proving something about a file that does not
// exist in production.
//
// So this module is a CARRIER: the smallest stage that wires itself the way the
// real stages wire themselves, used to carry an induced database fault into the
// real shared modules and let the real consequence be observed.
//
// It is a faithful carrier, not a convenient one. Compare, line for line, with
// `runDiscovery` in src/lib/engine/jobs/discovery.ts:
//
//   1. read the input queue with a bare `supabase.rpc(...)`      <- same
//   2. `const log = createPostconditionLog(counters)`            <- same
//   3. one `log.rpc({ accepted, benign })` per item              <- same
//   4. `log.pendingRpc({ migration, accepted })` for the void RPC<- same
//   5. `const post = log.summarise()`                            <- same
//   6. `worstStatus(jobView, statusFromPostconditions(post))`    <- same
//   7. `writeCountsFrom(post)` / `postconditionDetail(post)`     <- same
//
// Every one of those seven is the REAL production function, imported from the
// real module. What is replicated here is only the glue between them — the
// twenty lines each job file writes by hand — and the `jobView` rule, copied
// from discovery.ts verbatim.
//
// WHAT THAT MEANS FOR THE PROOF
// -----------------------------
// A fault induced through this carrier proves the behaviour of the shared
// verification layer: postconditions.ts, silent-success.ts, stage-outcome.ts,
// health.ts and circuit-breaker.ts. It does NOT prove that all fourteen job
// files call that layer correctly. Six of them once folded 'rejected_invalid'
// into `deduped` by hand, which is exactly a glue bug, and glue is the one part
// this carrier supplies itself. That limitation is stated again in the test
// files and must be carried into any proof record.
//
// NOT server-only.

import {
  createPostconditionLog,
  statusFromPostconditions,
  worstStatus,
  type PostconditionSummary,
} from "../postconditions.ts";
import { postconditionDetail, writeCountsFrom, type SilentSuccessRun } from "../silent-success.ts";
import {
  classifyStageOutcome,
  countersOf,
  incidentFor,
  type EmptinessProof,
  type MutationEvidence,
  type StageIncident,
  type StageVerdict,
} from "../stage-outcome.ts";
import type { ChaosClient } from "./fault-injection.ts";

export type CarrierCounters = { examined: number; created: number; deduped: number; failed: number };

export type CarrierResult = {
  /** The status the stage would write into engine_job_runs. */
  status: "success" | "partial" | "failed" | "skipped";
  /** The status the stage computed on its OWN, before postconditions overruled it. */
  jobView: "success" | "partial" | "failed";
  counters: CarrierCounters;
  postconditions: PostconditionSummary;
  /** The four columns engine_job_runs gains from the pending telemetry migration. */
  writeCounts: ReturnType<typeof writeCountsFrom>;
  detail: Record<string, unknown>;
  /** How many rows the input queue read actually returned. */
  queueRows: number;
  /** Whether the input read errored outright. */
  queueErrored: string | null;
  /** The stage-outcome verdict, built from the evidence this pass really produced. */
  verdict: StageVerdict;
  incident: StageIncident | null;
};

/**
 * One pass of a stage that reads a queue and writes one status-returning RPC per
 * item plus one `returns void` health RPC per pass.
 *
 * `emptinessProof` is what the stage claims about a zero-row queue read. It is a
 * parameter rather than a constant because the whole database_failure proof
 * turns on it: the SAME zero rows must classify differently depending on whether
 * the reader can prove it was awake, and a harness that hardcoded one answer
 * could not demonstrate that.
 */
export async function runCarrierStage(args: {
  client: ChaosClient;
  stage: string;
  /** The RPC that supplies work. */
  queueRpc: string;
  /** The RPC each item is written through. */
  writeRpc: string;
  /** The `returns void` health RPC, written once per pass. */
  voidRpc?: string;
  /** The migration that would give `voidRpc` a return value. */
  voidRpcMigration?: string;
  /** What the stage can honestly claim about an empty queue. */
  emptinessProof: EmptinessProof;
  /** Whether the queue read runs as a role RLS can silently deny. Engine jobs: true. */
  deniableUnderRls?: boolean;
}): Promise<CarrierResult> {
  const counters: CarrierCounters = { examined: 0, created: 0, deduped: 0, failed: 0 };
  const mutations: MutationEvidence[] = [];

  // --- 1. Read the input queue -------------------------------------------
  const queue = await args.client.rpc<unknown[]>(args.queueRpc);
  if (queue.error) {
    // discovery.ts's own shape: an errored queue read ends the pass as failed.
    const post = createPostconditionLog(counters).summarise();
    const verdict = classifyStageOutcome({
      stage: args.stage,
      counters: countersOf(counters),
      errors: [{ operation: args.queueRpc, code: queue.error.code, message: queue.error.message }],
      inputProbe: {
        source: args.queueRpc,
        available: 0,
        proof: "none",
        deniableUnderRls: args.deniableUnderRls ?? true,
      },
    });
    return {
      status: "failed",
      jobView: "failed",
      counters,
      postconditions: post,
      writeCounts: writeCountsFrom(post),
      detail: { error: queue.error.message },
      queueRows: 0,
      queueErrored: queue.error.message,
      verdict,
      incident: incidentFor(verdict),
    };
  }

  const items = (queue.data ?? []) as { id: string; subject: string }[];

  // --- 2. Work the queue, through the real postcondition log --------------
  const log = createPostconditionLog(counters);

  for (const item of items) {
    counters.examined++;
    const result = await log.rpc({
      operation: args.writeRpc,
      subject: item.subject,
      run: () => args.client.rpc<string>(args.writeRpc, { p_id: item.id }),
      accepted: ["created"],
      benign: ["deduped"],
    });
    mutations.push({
      operation: args.writeRpc,
      subject: item.subject,
      postcondition:
        result.status === "verified"
          ? "held"
          : result.status === "silent_no_op"
            ? "failed"
            : result.status === "blind"
              ? "unobservable"
              : result.status === "errored"
                ? "unknown"
                : "unknown",
      error: result.error ? { message: result.error } : null,
      // Engine tables are admin-only under RLS and the scheduled path is `anon`,
      // so every one of these writes is deniable. Saying so is what lets
      // stage-outcome.ts separate a denial from an unattributed no-op.
      rlsDeniable: true,
      rowsAffected: result.status === "verified" ? 1 : 0,
    });
  }

  // --- 3. The unobservable health write -----------------------------------
  if (args.voidRpc) {
    await log.pendingRpc({
      operation: args.voidRpc,
      migration: args.voidRpcMigration ?? "supabase/migrations/20260822_silent_success_telemetry.sql",
      accepted: ["ok"],
      run: () => args.client.rpc<string>(args.voidRpc as string, { p_success: counters.failed === 0 }),
    });
  }

  // --- 4. Status, exactly the way discovery.ts computes it ----------------
  const didUsefulWork = counters.created > 0 || counters.deduped > 0;
  const jobView: "success" | "partial" | "failed" =
    counters.failed === 0 ? "success" : didUsefulWork ? "partial" : "failed";
  const postconditions = log.summarise();
  const status = worstStatus(jobView, statusFromPostconditions(postconditions));

  // --- 5. Classify the pass -----------------------------------------------
  // NOTE: no real job file does this today — classifyStageOutcome() has zero
  // production callers (verified by grep across src/). It is included here
  // because it is the only module in the codebase that can tell a denied queue
  // from an empty one, and the proof needs to state clearly that the capability
  // exists and is not yet wired.
  const verdict = classifyStageOutcome({
    stage: args.stage,
    counters: countersOf({
      examined: counters.examined,
      created: counters.created,
      deduplicated: counters.deduped,
      failed: counters.failed,
    }),
    postconditions,
    mutations,
    inputProbe: {
      source: args.queueRpc,
      available: items.length,
      proof: args.emptinessProof,
      deniableUnderRls: args.deniableUnderRls ?? true,
    },
  });

  return {
    status,
    jobView,
    counters,
    postconditions,
    writeCounts: writeCountsFrom(postconditions),
    detail: { postconditions: postconditionDetail(postconditions) },
    queueRows: items.length,
    queueErrored: null,
    verdict,
    incident: incidentFor(verdict),
  };
}

/**
 * Turn a carrier pass into the engine_job_runs row it would write, in the shape
 * the telemetry loader hands to health.ts and silent-success.ts.
 *
 * This is the join between "a stage ran under a fault" and "the safety layer
 * reads its own audit log", and it is where a chaos run stops being a function
 * call and becomes a system observation.
 */
export function jobRunFrom(args: {
  jobName: string;
  startedAt: string;
  finishedAt?: string | null;
  result: CarrierResult;
  /** Whether the row carries an error string. */
  hasError?: boolean;
  /** Set false to model a run written BEFORE the telemetry migration. */
  telemetryColumns?: boolean;
}): SilentSuccessRun {
  const withColumns = args.telemetryColumns ?? true;
  const w = args.result.writeCounts;
  return {
    jobName: args.jobName,
    status: args.result.status,
    startedAt: args.startedAt,
    finishedAt: args.finishedAt ?? args.startedAt,
    itemsExamined: args.result.counters.examined,
    itemsCreated: args.result.counters.created,
    itemsDeduped: args.result.counters.deduped,
    itemsFailed: args.result.counters.failed,
    hasError: args.hasError ?? args.result.queueErrored !== null,
    silentNoOps: withColumns ? w.silentNoOps : null,
    unverifiedWrites: withColumns ? w.unverified : null,
    blindWrites: withColumns ? w.blind : null,
    verifiedWrites: withColumns ? w.verified : null,
  };
}

/**
 * A run row that claims `success` while carrying silent no-ops.
 *
 * Every job in this repo is SUPPOSED to route its status through
 * `statusFromPostconditions`, which makes this row unwritable. Six of them once
 * did not. This helper exists so the harness can induce the mis-wiring itself —
 * the glue bug the carrier cannot otherwise reproduce — and prove that the
 * cross-run detector catches a job that lies about its own status.
 */
export function miswiredJobRun(run: SilentSuccessRun): SilentSuccessRun {
  return { ...run, status: "success" };
}
