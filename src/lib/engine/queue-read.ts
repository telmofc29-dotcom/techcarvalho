// QUEUE READS — separating "the queue was empty" from "we were not allowed to look".
//
// THE PROBLEM, EXACTLY
// --------------------
// Under RLS a denied SELECT does not raise. It returns `{ data: [], error: null }`
// — byte-identical to a genuinely empty table. Every engine job begins by
// reading an input queue, and every one of them turns that read into
// `(data ?? [])`, loops zero times, and records
// `status: success, examined: 0`. There is no column, no counter and no log line
// anywhere in that run that differs from the run of a healthy engine on a quiet
// night.
//
// That is not a hypothetical. It is how the 2026-08 grants incident survived for
// weeks: `anon` had no table grants at all, every public page rendered an honest
// looking empty state, and nothing distinguished "genuinely no data" from "the
// query failed".
//
// stage-outcome.ts already models the answer — `InputProbe`, `EmptinessProof`,
// and the one-way door that makes NOTHING_TO_DO reachable only through positive
// proof. What was missing is the thing that CONSTRUCTS an honest probe from what
// a real read actually returned, without the job author having to reason about
// RLS semantics at each call site. That is this file.
//
// THE RULE
// --------
// Zero rows is never, on its own, evidence of anything. To claim NOTHING_TO_DO a
// stage must additionally show that its reader was AWAKE — that something came
// back from somewhere that could have been silenced and was not. Three forms of
// that evidence exist, and they are NOT interchangeable:
//
//   SAME_READ_FILTERED  The queue read returned N rows and application code
//                       filtered them down to zero eligible. Strongest available:
//                       it is the same statement, the same grant, the same
//                       policy. Nothing about the read can have been denied,
//                       because rows came out of it.
//
//   CONTROL_READ        A SEPARATE, cheap read that must return rows whenever the
//                       reader's grants are intact came back non-empty. This
//                       excludes the BLANKET denial — the actual 2026-08 shape,
//                       where the role had nothing at all. It does NOT exclude a
//                       revocation targeted at the queue object itself.
//
//                       Sufficient ONLY for a SECURITY DEFINER RPC queue read,
//                       and the asymmetry is the whole argument: revoking EXECUTE
//                       on a function makes PostgREST answer PGRST202 — an ERROR,
//                       which the job already treats as a failure — rather than
//                       zero rows. stage-outcome.ts's own PERMISSION_ERROR_CODES
//                       set records that behaviour. So for a function, "the call
//                       succeeded" is itself evidence about that specific object,
//                       and the control read supplies the rest.
//
//                       NOT sufficient for a direct table SELECT. There a
//                       targeted RLS policy denies exactly one table by returning
//                       zero rows and no error, and a control read of a different
//                       table says nothing at all about it.
//
//   NONE                No evidence. Includes the case where the control read
//                       itself came back empty — an empty corroborator
//                       corroborates nothing, and treating it as reassurance
//                       would reproduce the bug one level up.
//
// WHAT THIS STILL DOES NOT ESTABLISH, SAID OUT LOUD
// -------------------------------------------------
// A SECURITY DEFINER function reads as its OWNER, so RLS cannot silence its
// internal reads — but its own body can still return zero rows for a reason that
// is not a permission problem and not an empty queue. `engine_assemblable_briefs`
// is the live example: it opens with
// `if not public.engine_flag_enabled('research') then return; end if;`, so a
// research flag that is off produces zero rows with no error from a function that
// executed perfectly. A CONTROL_READ cannot see that.
//
// Closing it needs an UNFILTERED COUNT from the queue object itself — the
// `engine_queue_probe` function drafted in
// supabase/migrations_pending/20260823_queue_probe_and_stage_outcome.sql. Until
// that is applied, `unfilteredCount` below is unreachable in production and this
// module reports CONTROL_READ as what it is rather than as what we would like it
// to be.
//
// PURE. No `server-only`, no Supabase, no clock. The I/O half is
// src/lib/engine/jobs/reader-liveness.ts.

import {
  classifyStageOutcome,
  countersOf,
  hasBlockingIncident,
  incidentFor,
  type InputProbe,
  type StageCounters,
  type StageEvidence,
  type StageVerdict,
} from "./stage-outcome.ts";

// ---------------------------------------------------------------------------
// What kind of read it was
// ---------------------------------------------------------------------------

export type QueueReadKind =
  /**
   * `supabase.rpc(...)` against a SECURITY DEFINER function granted to `anon`.
   * A revoked grant answers with an ERROR (PGRST202 / 42883), not zero rows.
   */
  | "security_definer_rpc"
  /**
   * `supabase.from(table).select(...)` as `anon`, under RLS. A denial answers
   * with zero rows and no error. This is the silent one.
   */
  | "rls_table_select";

export const QUEUE_READ_KIND_NOTES: Record<QueueReadKind, string> = {
  security_definer_rpc:
    "A SECURITY DEFINER RPC. Revoking EXECUTE from anon makes PostgREST answer PGRST202 ('could not " +
    "find the function in the schema cache'), which arrives as an error and is already handled as a " +
    "failure. A call that SUCCEEDED and returned zero rows is therefore not a denial of this object.",
  rls_table_select:
    "A direct table SELECT as anon, under RLS. A policy that denies this table returns zero rows and NO " +
    "error, indistinguishable from an empty table. Nothing about the call itself can rule that out.",
};

// ---------------------------------------------------------------------------
// The liveness evidence
// ---------------------------------------------------------------------------

export type LivenessForm = "same_read_filtered" | "unfiltered_count" | "control_read" | "none";

export type LivenessEvidence =
  /** The queue read returned rows; application code filtered them to zero eligible. */
  | { form: "same_read_filtered"; rowsReturned: number }
  /** An unfiltered count of the SAME object came back greater than zero. */
  | { form: "unfiltered_count"; source: string; total: number }
  /** A separate read that must return rows if the grants are intact came back non-empty. */
  | { form: "control_read"; source: string; rows: number }
  /** Nothing was established. Includes "the corroborator itself came back empty". */
  | { form: "none"; why: string };

export const NO_LIVENESS: LivenessEvidence = {
  form: "none",
  why: "No corroborating read was supplied, so nothing establishes that the reader was awake.",
};

/**
 * How much a piece of liveness evidence actually rules out.
 *
 * Machine-readable on purpose. `same_read_filtered` and `control_read` can both
 * reach `reader_alive`, and the difference between them matters enormously to
 * anyone reading an incident — so it is carried as data rather than buried in a
 * sentence.
 */
export type LivenessStrength =
  /** Excludes any denial of this object, targeted or blanket. */
  | "object_specific"
  /** Excludes a blanket denial of the role. A targeted one could still hide here. */
  | "blanket_only"
  /** Excludes nothing. */
  | "none";

export function livenessStrength(kind: QueueReadKind, liveness: LivenessEvidence): LivenessStrength {
  switch (liveness.form) {
    case "same_read_filtered":
      return liveness.rowsReturned > 0 ? "object_specific" : "none";
    case "unfiltered_count":
      return liveness.total > 0 ? "object_specific" : "none";
    case "control_read":
      if (liveness.rows <= 0) return "none";
      // A control read of a DIFFERENT object cannot speak for a table whose own
      // policy can deny it silently. For a function it can, because a revoked
      // function grant is loud.
      return kind === "security_definer_rpc" ? "blanket_only" : "none";
    case "none":
      return "none";
  }
}

// ---------------------------------------------------------------------------
// What a job observed
// ---------------------------------------------------------------------------

export type QueueReadFacts = {
  /** The RPC or table that was asked for work, by name. */
  source: string;
  kind: QueueReadKind;
  /** True when the read raised, or was never made at all. Proves nothing either way. */
  errored: boolean;
  /**
   * Rows the read returned BEFORE any application-side filtering. `null` when
   * the job cannot say — which is itself treated as no evidence, never as zero.
   */
  rowsReturned: number | null;
  /** Rows the stage considered eligible to work on, after its own filtering. */
  eligible: number;
  liveness: LivenessEvidence;
};

/**
 * Turn what a read returned into an honest `InputProbe`.
 *
 * `deniableUnderRls` is TRUE for every engine read, always. Engine jobs run as
 * `anon` (a Vercel Cron request carries no cookies), so every read they make is
 * one RLS could in principle deny. Declaring a read non-deniable is the single
 * edit that would turn this whole file back into a rubber stamp, so it is not
 * a per-call-site choice: the LIVENESS evidence is what earns a stronger proof,
 * and it has to be produced rather than asserted.
 */
export function inputProbeFor(facts: QueueReadFacts): InputProbe {
  const strength = livenessStrength(facts.kind, facts.liveness);
  const base = {
    source: facts.source,
    available: facts.eligible,
    deniableUnderRls: true,
  } as const;

  if (facts.errored) {
    return {
      ...base,
      proof: "none",
      corroboration:
        `The read of ${facts.source} errored or was never made, so zero eligible rows prove nothing ` +
        `whatsoever about the queue.`,
    };
  }

  if (strength === "none") {
    return {
      ...base,
      proof: "zero_rows_only",
      corroboration: describeMissingLiveness(facts),
    };
  }

  return {
    ...base,
    proof: "reader_alive",
    corroboration: describeLiveness(facts, strength),
  };
}

function describeLiveness(facts: QueueReadFacts, strength: LivenessStrength): string {
  const l = facts.liveness;
  switch (l.form) {
    case "same_read_filtered":
      return (
        `${facts.source} returned ${l.rowsReturned} row(s), which application code then filtered down to ` +
        `${facts.eligible} eligible. Rows came out of the read, so the read was not denied — this is the ` +
        `strongest form available, because it is the same statement under the same policy.`
      );
    case "unfiltered_count":
      return (
        `An unfiltered count of the same object (${l.source}) returned ${l.total}, while the eligibility ` +
        `filter matched ${facts.eligible}. The object is readable and the queue is genuinely empty of ` +
        `ELIGIBLE work.`
      );
    case "control_read":
      return (
        `${l.source} returned ${l.rows} row(s), so the anon reader is demonstrably awake and engine ` +
        `SECURITY DEFINER RPCs are executing and returning data. Strength: ${strength} — this excludes a ` +
        `BLANKET loss of grants (the 2026-08 shape). It does not exclude a defect inside ${facts.source}'s ` +
        `own body, such as an internal flag check returning early; only an unfiltered count of that object ` +
        `can. Revoking EXECUTE on ${facts.source} itself would have raised PGRST202 rather than returning ` +
        `zero rows, and did not.`
      );
    case "none":
      return l.why;
  }
}

function describeMissingLiveness(facts: QueueReadFacts): string {
  const l = facts.liveness;
  if (l.form === "control_read" && l.rows <= 0) {
    return (
      `The corroborating read ${l.source} itself came back EMPTY, so it establishes nothing. An empty ` +
      `corroborator corroborates nothing — treating it as reassurance would reproduce the failure one ` +
      `level up.`
    );
  }
  if (l.form === "control_read" && facts.kind === "rls_table_select") {
    return (
      `${l.source} returned ${l.rows} row(s), but ${facts.source} is a direct table SELECT under RLS. A ` +
      `policy can deny exactly that one table by returning zero rows and no error, and a control read of ` +
      `a different object says nothing about it. ${QUEUE_READ_KIND_NOTES.rls_table_select}`
    );
  }
  if (l.form === "same_read_filtered" && l.rowsReturned <= 0) {
    return (
      `${facts.source} returned zero rows in total, so there was nothing for application code to filter ` +
      `and nothing came out of the read to show it was permitted.`
    );
  }
  if (l.form === "unfiltered_count" && l.total <= 0) {
    return (
      `The unfiltered count of ${l.source} was also zero, which is the same ambiguity one level out: an ` +
      `empty object and an unreadable one produce the same number.`
    );
  }
  return (
    `${facts.source} returned zero rows with no error and no corroborating evidence was supplied. ` +
    `${QUEUE_READ_KIND_NOTES[facts.kind]}`
  );
}

// ---------------------------------------------------------------------------
// The verdict a job records
// ---------------------------------------------------------------------------

export type QueueReadOutcome = {
  verdict: StageVerdict;
  /** The status the job must record. `failed` whenever the emptiness is unproven. */
  status: "success" | "failed";
  /** The `error` string for engine_job_runs, so `has_error` is set. Null on success. */
  error: string | null;
  /** The block to merge into the run's detail payload. */
  detail: Record<string, unknown>;
};

/**
 * Classify a pass whose queue came back empty, and decide what it must record.
 *
 * The status mapping is the point of the whole exercise:
 *
 *   NOTHING_TO_DO  -> success. Earned, not assumed.
 *   anything else  -> failed.  Including UNCLASSIFIED, which is what an unproven
 *                              empty queue produces.
 *
 * `failed` rather than `partial` deliberately. `partial` says "some of it
 * worked"; a stage that cannot establish whether it was allowed to see its own
 * input did not partly work, and the whole value of this change is that the row
 * it writes is DIFFERENT from the row a quiet night writes. health.ts's
 * `input_unproven` detector keys on exactly that row shape — failed, with every
 * counter at zero — and needs no history to fire, which is what makes a stage
 * denied FROM BIRTH detectable.
 */
export function concludeQueueRead(args: {
  stage: string;
  facts: QueueReadFacts;
  counters?: Partial<StageCounters>;
  /** The job's own human-readable reason, kept so existing detail keys survive. */
  reason?: string;
  evidence?: Partial<Omit<StageEvidence, "stage" | "counters" | "inputProbe">>;
}): QueueReadOutcome {
  const probe = inputProbeFor(args.facts);
  const verdict = classifyStageOutcome({
    stage: args.stage,
    counters: countersOf(args.counters ?? {}),
    inputProbe: probe,
    ...(args.evidence ?? {}),
  });

  const blocking = hasBlockingIncident([verdict]);
  const incident = incidentFor(verdict);
  const status: "success" | "failed" = blocking ? "failed" : "success";

  return {
    verdict,
    status,
    error: blocking
      ? `[STAGE_OUTCOME/${verdict.outcome}${verdict.ambiguity ? `/${verdict.ambiguity}` : ""}] ${verdict.reason}`
      : null,
    detail: {
      ...(args.reason ? { reason: args.reason } : {}),
      stageOutcome: verdict.outcome,
      stageOutcomeAmbiguity: verdict.ambiguity,
      stageOutcomeWhy: verdict.reason,
      inputProbe: {
        source: args.facts.source,
        kind: args.facts.kind,
        eligible: args.facts.eligible,
        rowsReturned: args.facts.rowsReturned,
        proof: probe.proof,
        livenessForm: args.facts.liveness.form,
        livenessStrength: livenessStrength(args.facts.kind, args.facts.liveness),
        corroboration: probe.corroboration ?? null,
      },
      ...(incident
        ? {
            incident: {
              severity: incident.severity,
              headline: incident.headline,
              whyItMatters: incident.whyItMatters,
              whereToLook: incident.whereToLook,
            },
          }
        : {}),
    },
  };
}

// ---------------------------------------------------------------------------
// Convenience constructors, so a call site cannot get the shape subtly wrong
// ---------------------------------------------------------------------------

/** A queue read through a SECURITY DEFINER RPC, corroborated by a control read. */
export function rpcQueue(args: {
  source: string;
  errored: boolean;
  rowsReturned: number | null;
  eligible: number;
  liveness: LivenessEvidence;
}): QueueReadFacts {
  return { ...args, kind: "security_definer_rpc" };
}

/** A queue derived by filtering the rows a read returned, in application code. */
export function filteredQueue(args: {
  source: string;
  kind?: QueueReadKind;
  errored: boolean;
  rowsReturned: number;
  eligible: number;
}): QueueReadFacts {
  return {
    source: args.source,
    kind: args.kind ?? "security_definer_rpc",
    errored: args.errored,
    rowsReturned: args.rowsReturned,
    eligible: args.eligible,
    liveness: { form: "same_read_filtered", rowsReturned: args.rowsReturned },
  };
}

/** Liveness from a separate control read. `rows === 0` deliberately proves nothing. */
export function controlRead(source: string, rows: number): LivenessEvidence {
  return { form: "control_read", source, rows };
}
