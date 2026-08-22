// The proof registry — what has actually been DEMONSTRATED, not implemented.
//
// WHY THIS EXISTS SEPARATELY FROM THE CODE IT DESCRIBES
// -----------------------------------------------------
// Every capability in this engine has a module and a passing unit test. None
// of that is evidence that the capability works against production behaviour.
// A unit test proves the function does what its author believed; it cannot
// prove that RLS denies the write, that the lease is held across two real
// workers, or that a rollback restores dependent rows nobody remembered.
//
// So a proof is a RECORD OF AN EXECUTION: what was run, when, against what,
// and what was actually observed. "The code exists" and "npm test passes" are
// explicitly NOT accepted as evidence — see `ProofLevel`.
//
// PROOFS GO STALE
// ---------------
// A rollback proof obtained 200 commits ago is evidence about code that no
// longer exists. Each proof records the commit it was obtained at and expires,
// which is the difference between a readiness dashboard and a trophy cabinet.
//
// Deterministic. No AI provider.

/** The seven graduation proofs, plus the ones this phase added. */
export const PROOF_KINDS = [
  "rollback_test",
  "circuit_breaker_test",
  "concurrency_test",
  "source_outage_test",
  "database_failure_test",
  "media_validation_outage_test",
  "duplicate_scheduler_test",
  // Added for autonomous media acquisition.
  "provider_outage_test",
  "media_acquisition_test",
  "rights_verification_test",
] as const;

export type ProofKind = (typeof PROOF_KINDS)[number];

/**
 * How strong the evidence is. The ordering is the whole point.
 *
 * `code_exists` and `unit_tested` are recorded so the dashboard can show
 * progress honestly, but neither ever counts toward graduation. A capability
 * that has only these is NOT PROVEN, however green the test run looks.
 */
export type ProofLevel =
  /** A module exists. Evidence of intent, nothing more. */
  | "code_exists"
  /** Unit tests pass. Proves the author's model of the function, not reality. */
  | "unit_tested"
  /** Exercised end to end against a real subsystem in a safe environment. */
  | "integration_proven"
  /** The failure was deliberately INDUCED and the system's real response
   *  observed. The only level that proves fail-closed behaviour. */
  | "chaos_proven"
  /** Observed against the production database or a live production path. */
  | "production_proven";

const LEVEL_RANK: Record<ProofLevel, number> = {
  code_exists: 0,
  unit_tested: 1,
  integration_proven: 2,
  chaos_proven: 3,
  production_proven: 4,
};

/** The minimum level each proof must reach to count toward graduation. */
export const REQUIRED_LEVEL: Record<ProofKind, ProofLevel> = {
  // These are all about what happens when something BREAKS, so a passing
  // unit test is definitionally insufficient — the failure has to be induced.
  rollback_test: "chaos_proven",
  circuit_breaker_test: "chaos_proven",
  source_outage_test: "chaos_proven",
  database_failure_test: "chaos_proven",
  media_validation_outage_test: "chaos_proven",
  provider_outage_test: "chaos_proven",
  // Concurrency can only be proven where the lock actually lives.
  concurrency_test: "production_proven",
  duplicate_scheduler_test: "production_proven",
  // Acquisition and rights verification are about real external material.
  media_acquisition_test: "integration_proven",
  rights_verification_test: "integration_proven",
};

/**
 * How long a proof stays valid, in days.
 *
 * Short on purpose. These are claims about how the current code behaves under
 * failure, and this codebase changes daily.
 */
export const PROOF_TTL_DAYS = 30;

export type ProofRecord = {
  kind: ProofKind;
  level: ProofLevel;
  /** When it was obtained. */
  observedAt: string;
  /** The commit the code was at. A proof about other code is not a proof. */
  commit: string | null;
  /** What was actually done, in words. Required. */
  method: string;
  /** What was actually OBSERVED — not what was expected. Required. */
  observed: string;
  /** Whether the observed behaviour was the required fail-closed one. */
  passed: boolean;
};

/**
 * Whether the thing a proof is ABOUT actually exists in this codebase.
 *
 * WHY THIS IS SEPARATE FROM PROVEN/NOT_PROVEN
 * -------------------------------------------
 * "NOT PROVEN" reads as: the capability is built, and nobody has broken it on
 * purpose yet. That is a to-do. It is a very different statement from: there is
 * no such capability, so there is nothing that could ever be exercised.
 *
 * `rollback_test` was the case that forced this distinction. A search of the
 * whole repository for rollback, undo, revert or compensating logic found the
 * word only in this file and in modes.ts — both times as a NOUN in a comment.
 * No rollback mechanism exists. The dashboard nevertheless rendered
 * "NOT PROVEN — Never exercised", which invited the reading that a rollback
 * path was sitting there waiting for a test. Collapsing "unbuilt" into
 * "untested" is exactly the kind of quiet overstatement this project treats as
 * a defect, so the two are now different words on the page.
 *
 * This map is hand-maintained and deliberately pessimistic: a kind stays
 * `absent` until somebody can point at the code that implements it.
 */
export const CAPABILITY_IMPLEMENTED: Record<ProofKind, boolean> = {
  // Implemented: src/lib/engine/circuit-breaker.ts
  circuit_breaker_test: true,
  // Implemented: src/lib/engine/concurrency.ts + engine_begin_run's lease.
  concurrency_test: true,
  duplicate_scheduler_test: true,
  // Implemented: postconditions.ts / silent-success.ts detect the failure, and
  // discovery.ts records source failures through engine_record_source_check.
  database_failure_test: true,
  source_outage_test: true,
  // Implemented: src/lib/media/providers/* (outcome.ts, rights-verification.ts).
  media_validation_outage_test: true,
  provider_outage_test: true,
  media_acquisition_test: true,
  rights_verification_test: true,
  // NOT IMPLEMENTED. There is no rollback, undo, revert or compensating
  // mechanism anywhere in src/. Nothing in this engine can reverse a write it
  // has made; the safety model is entirely "do not make the write in the first
  // place". That is a legitimate design, but it means this proof is not merely
  // unobtained — it is unobtainable until such a mechanism exists.
  rollback_test: false,
};

export type ProofStatus = {
  kind: ProofKind;
  /**
   * NOT_IMPLEMENTED is strictly weaker than NOT_PROVEN and never counts as
   * progress toward it. It exists so the dashboard cannot imply a capability
   * is merely untested when it does not exist.
   */
  state: "PROVEN" | "NOT_PROVEN" | "NOT_IMPLEMENTED";
  /** Why it is not proven, when it is not. */
  reason: string;
  level: ProofLevel | null;
  observedAt: string | null;
  ageDays: number | null;
};

/**
 * Decide PROVEN / NOT_PROVEN for one kind from its records.
 *
 * Fails closed at every step: no record, a failed record, too weak a level, an
 * expired record, or a record missing its method or observation all resolve to
 * NOT_PROVEN. There is no partial credit, because a partially-proven rollback
 * is an unproven rollback.
 */
export function evaluateProof(
  kind: ProofKind,
  records: ProofRecord[],
  now: Date = new Date()
): ProofStatus {
  const required = REQUIRED_LEVEL[kind];
  const mine = records.filter((r) => r.kind === kind);

  // Checked BEFORE the records, and it cannot be overridden by one. If somebody
  // records a passing rollback proof while no rollback code exists, the record
  // is the thing that is wrong, and the honest answer is still NOT_IMPLEMENTED.
  if (!CAPABILITY_IMPLEMENTED[kind]) {
    return {
      kind,
      state: "NOT_IMPLEMENTED",
      reason:
        "There is no implementation to exercise. This is not a missing test — the capability " +
        "does not exist in the codebase, so the proof is unobtainable until it is built. " +
        (mine.length > 0
          ? `${mine.length} record(s) exist for this kind and are IGNORED: a proof cannot be more real than the thing it describes.`
          : "No records exist, which is consistent."),
      level: null,
      observedAt: null,
      ageDays: null,
    };
  }

  if (mine.length === 0) {
    return { kind, state: "NOT_PROVEN", reason: "Never exercised.", level: null, observedAt: null, ageDays: null };
  }

  // Only passing records with a real method and observation can count. A
  // record with no observation is somebody asserting a result, not recording
  // one.
  const usable = mine.filter(
    (r) => r.passed && r.method.trim().length > 10 && r.observed.trim().length > 10
  );
  if (usable.length === 0) {
    const failed = mine.filter((r) => !r.passed).length;
    return {
      kind, state: "NOT_PROVEN",
      reason: failed > 0
        ? `${failed} recorded run(s), all FAILED. A failed proof is evidence against readiness, not toward it.`
        : "Recorded but with no method or observation. An assertion is not a proof.",
      level: null, observedAt: null, ageDays: null,
    };
  }

  // Strongest, then most recent.
  const best = [...usable].sort((a, b) =>
    LEVEL_RANK[b.level] - LEVEL_RANK[a.level] ||
    new Date(b.observedAt).getTime() - new Date(a.observedAt).getTime()
  )[0];

  const ageMs = now.getTime() - new Date(best.observedAt).getTime();
  const ageDays = Math.floor(ageMs / 86_400_000);

  if (LEVEL_RANK[best.level] < LEVEL_RANK[required]) {
    return {
      kind, state: "NOT_PROVEN",
      reason: `Best evidence is ${best.level}; ${kind} requires ${required}. ${
        best.level === "unit_tested"
          ? "A passing unit test proves the author's model of the function, not what the system does when the thing actually breaks."
          : "The failure has to be induced and the real response observed."
      }`,
      level: best.level, observedAt: best.observedAt, ageDays,
    };
  }

  if (ageDays > PROOF_TTL_DAYS) {
    return {
      kind, state: "NOT_PROVEN",
      reason: `Last proven ${ageDays} days ago, beyond the ${PROOF_TTL_DAYS}-day window. This codebase changes daily; a proof about older code is not a proof about this one.`,
      level: best.level, observedAt: best.observedAt, ageDays,
    };
  }

  return {
    kind, state: "PROVEN",
    reason: `${best.level} on ${best.observedAt.slice(0, 10)}${best.commit ? ` at ${best.commit.slice(0, 7)}` : ""}: ${best.observed}`,
    level: best.level, observedAt: best.observedAt, ageDays,
  };
}

/** Every proof's status, and the list of kinds still blocking graduation. */
export function evaluateAllProofs(records: ProofRecord[], now: Date = new Date()): {
  statuses: ProofStatus[];
  provenCount: number;
  blockingKinds: ProofKind[];
} {
  const statuses = PROOF_KINDS.map((k) => evaluateProof(k, records, now));

  // COUNTED POSITIVELY, not by subtraction.
  //
  // This read `statuses.length - blocking.length`, where `blocking` was only the
  // NOT_PROVEN ones. That is safe while there are exactly two states and becomes
  // wrong the moment a third appears: adding NOT_IMPLEMENTED would have made
  // every unimplemented capability count as PROVEN, inflating the headline
  // number on the readiness dashboard. Counting what is actually proven cannot
  // drift that way when a state is added later.
  const proven = statuses.filter((s) => s.state === "PROVEN");

  // Anything not PROVEN blocks, NOT_IMPLEMENTED emphatically included — an
  // absent capability is a stronger reason to stay locked than an untested one.
  const blocking = statuses.filter((s) => s.state !== "PROVEN").map((s) => s.kind);

  return {
    statuses,
    provenCount: proven.length,
    blockingKinds: blocking,
  };
}
