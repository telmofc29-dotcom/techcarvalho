// Readiness, assembled from the shadow ledger.
//
// HOW THIS RELATES TO modes.ts
// ----------------------------
// modes.ts owns the graduation criteria and is deliberately left alone here.
// This module does two things it does not do:
//
//  1. It COMPUTES the number that modes.ts is handed. `evaluateReadiness`
//     takes `shadowDecisions` on trust; whoever supplies it decides what a
//     decision is. So the anti-inflation work happens BEFORE the call —
//     `shadowDecisions` is the composition-credited count, already stripped of
//     duplicates, crashes and near-duplicate repetition. modes.ts's 500 can
//     therefore never be reached by re-running the pipeline, and modes.ts did
//     not have to change for that to be true.
//
//  2. It applies composition as an ADDITIONAL, conjunctive gate. Readiness here
//     is `modes.autonomousUnlocked AND composition.adequate`. Additional, never
//     substitutive: nothing in this module can clear a modes.ts blocker, and
//     the combined verdict is false whenever either half is false.
//
// FAILS CLOSED IN EVERY DIRECTION
// -------------------------------
// Missing evidence is not neutral. If nobody has reviewed a single shadow
// decision, the human-disagreement rate is UNKNOWN, and an unknown rate is
// reported as maximal rather than as zero — a metric with no observations
// behind it must not look like a passing one. Same for proofs: absent means not
// proven, never "presumably fine".
//
// Deterministic and pure. No I/O, no clock, no `server-only`.

import {
  evaluateReadiness,
  READINESS,
  type EngineMode,
  type ReadinessBlocker,
  type ReadinessEvidence,
  type ReadinessReport,
} from "./modes.ts";
import type { ProofRecord } from "./proofs.ts";
import { assessComposition, type CompositionEntry, type CompositionReport } from "./shadow-composition.ts";

/** One row of the shadow ledger, as returned by `engine_shadow_ledger`. */
export type LedgerRow = {
  candidateIdentity: string;
  title: string;
  publisher: string | null;
  decidedOn: string;
  recordKind: "decision" | "failure";
  outcome: "WOULD_PUBLISH" | "WOULD_REJECT" | "HUMAN_REVIEW_REQUIRED" | null;
  terminalStage: string;
  reachedGate: boolean;
  dimensions: string[];
};

/** Escape counts, as returned by `engine_shadow_escapes`. */
export type EscapeCounts = {
  wouldPublish: number;
  fabricatedClaimEscapes: number;
  unlicensedMediaEscapes: number;
  bypassedHardBlockers: number;
  duplicateLeakage: number;
  humanReviewed: number;
  humanDisagreed: number;
};

export type ShadowReadinessInput = {
  ledger: LedgerRow[];
  escapes: EscapeCounts;
  /**
   * Recorded proof EXECUTIONS, passing and failing alike. Passed straight
   * through to modes.ts, which delegates to `evaluateProof` — level, age and
   * whether a method and observation were written down all matter, and none of
   * that is this module's judgement to make. An empty list means NOT PROVEN,
   * which is the correct reading of "nobody has broken anything on purpose yet".
   */
  proofRecords: ProofRecord[];
  /** False when the ledger could not be read at all — see the failure note. */
  ledgerAvailable: boolean;
  ledgerUnavailableReason?: string;
};

export type ShadowReadinessReport = {
  /** True only when the criteria in modes.ts AND the composition floors pass. */
  autonomousUnlocked: boolean;
  highestJustifiedMode: EngineMode;
  /** modes.ts's own verdict, unmodified. */
  modes: ReadinessReport;
  composition: CompositionReport;
  /** modes blockers and composition blockers, concatenated. Never filtered. */
  blockers: ReadinessBlocker[];
  evidence: ReadinessEvidence;
  /** Decisions recorded but refused credit, and why. */
  refusedCredit: { duplicates: number; incomplete: number; familyCap: number };
  summary: string;
};

/**
 * Turn the shadow ledger into a readiness verdict.
 *
 * A ledger that could not be read produces the most pessimistic possible
 * report, not an empty one. The 2026-08 incident was precisely a failed query
 * that rendered as an honest-looking empty state; here the equivalent mistake
 * would be reporting "0 decisions, everything clean", which reads like a fresh
 * start rather than like a broken measurement.
 */
export function assessShadowReadiness(input: ShadowReadinessInput): ShadowReadinessReport {
  const entries: CompositionEntry[] = input.ledger.map((row) => ({
    identity: row.candidateIdentity,
    title: row.title,
    publisher: row.publisher,
    dimensions: row.dimensions as CompositionEntry["dimensions"],
    day: row.decidedOn,
    complete: row.recordKind === "decision" && row.outcome !== null,
    terminalStage: row.terminalStage,
    reachedGate: row.reachedGate,
  }));

  const composition = assessComposition(entries);

  // An unmeasured rate is not a passing rate. With nothing reviewed there is no
  // observation to support "the engine agrees with our editors", so the rate is
  // reported as total disagreement and blocks.
  const humanDisagreementRate =
    input.escapes.humanReviewed > 0
      ? input.escapes.humanDisagreed / input.escapes.humanReviewed
      : 1;

  // Duplicate leakage is measured against the decisions that reached
  // WOULD_PUBLISH, since a duplicate that was correctly rejected leaked nowhere.
  const duplicateLeakageRate =
    input.escapes.wouldPublish > 0 ? input.escapes.duplicateLeakage / input.escapes.wouldPublish : 0;

  const evidence: ReadinessEvidence = {
    // The credited count, not the row count. This is the whole anti-gaming
    // argument in one assignment.
    shadowDecisions: input.ledgerAvailable ? composition.creditedDecisions : 0,
    distinctDays: input.ledgerAvailable ? composition.distinctDays : 0,
    fabricatedClaimEscapes: input.escapes.fabricatedClaimEscapes,
    unlicensedMediaEscapes: input.escapes.unlicensedMediaEscapes,
    bypassedHardBlockers: input.escapes.bypassedHardBlockers,
    duplicateLeakageRate,
    humanDisagreementRate,
    humanReviewCount: input.escapes.humanReviewed,
    proofRecords: input.proofRecords,
  };

  const modes = evaluateReadiness(evidence);

  const blockers: ReadinessBlocker[] = [...modes.blockers];
  if (!input.ledgerAvailable) {
    blockers.push({
      criterion: "Shadow ledger readable",
      required: "yes",
      actual: `no — ${input.ledgerUnavailableReason ?? "unknown reason"}`,
    });
  }
  for (const b of composition.blockers) {
    blockers.push({ criterion: b.criterion, required: b.required, actual: b.actual });
  }

  const autonomousUnlocked = input.ledgerAvailable && modes.autonomousUnlocked && composition.adequate;

  // The mode is clamped by BOTH halves. Composition being inadequate cannot be
  // outvoted by a clean escape record, because a clean record over an
  // unrepresentative set is not evidence of anything.
  const highestJustifiedMode: EngineMode = autonomousUnlocked
    ? "AUTONOMOUS"
    : input.ledgerAvailable && modes.highestJustifiedMode === "CANARY" && composition.gaps.length === 0
      ? "CANARY"
      : "SHADOW";

  return {
    autonomousUnlocked,
    highestJustifiedMode,
    modes,
    composition,
    blockers,
    evidence,
    refusedCredit: {
      duplicates: composition.duplicateIdentitiesRefused,
      incomplete: composition.incompleteRefused,
      familyCap: composition.familyCapRefused,
    },
    summary: !input.ledgerAvailable
      ? `READINESS UNKNOWN — the shadow ledger could not be read (${input.ledgerUnavailableReason ?? "unknown reason"}). Treated as zero evidence, not as a clean slate.`
      : `${evidence.shadowDecisions}/${READINESS.minShadowDecisions} credited shadow decisions across ${evidence.distinctDays}/${READINESS.minDistinctDays} distinct day(s). ` +
        `${blockers.length} readiness criterion/criteria unmet. Highest justified mode: ${highestJustifiedMode}. ` +
        composition.summary,
  };
}
