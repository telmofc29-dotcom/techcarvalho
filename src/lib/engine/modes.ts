// Engine run modes and the autonomy readiness scorecard.
//
// THE BOUNDARY THAT ACTUALLY MATTERS
// ----------------------------------
// A mode is a value in a table. A value in a table is not a security boundary,
// and treating it as one is how "autonomous publishing is off" becomes a
// checkbox somebody can tick.
//
// The real boundary here is structural: engine jobs run as `anon` and reach
// the database only through narrow SECURITY DEFINER RPCs. Verified against
// production on 2026-08-22 — as `anon`, a direct UPDATE or INSERT setting
// `content_items.status = 'published'` or `products.is_published = true` is
// refused with 42501 (insufficient privilege), not silently ignored. And no
// RPC callable by `anon` can set either: `engine_assemble_draft` is hard-wired
// to `'draft'` and `engine_assemble_product` to `is_published = false`, with
// no parameter on either capable of changing it.
//
// **The engine cannot publish because there is nothing for it to call**, not
// because a flag says no. Enabling AUTONOMOUS would require adding a
// publishing RPC that does not exist today — a deliberate, reviewable act
// rather than a configuration change.
//
// This module governs what the engine DECIDES, and gates that decision on
// evidence. Deterministic. No AI provider.

import { evaluateAllProofs, type ProofRecord } from "./proofs.ts";

export type EngineMode =
  /** Nothing runs. */
  | "OFF"
  /** The complete autonomous decision process runs and publishes NOTHING.
   *  Every would-be decision is recorded with its reasoning, which is how
   *  trust gets earned before it is granted. */
  | "SHADOW"
  /** Extremely low-risk content only, under strict caps, with rollback. */
  | "CANARY"
  /** Unavailable until the readiness criteria below are objectively met. */
  | "AUTONOMOUS";

export const MODE_ORDER: EngineMode[] = ["OFF", "SHADOW", "CANARY", "AUTONOMOUS"];

/**
 * Graduation criteria.
 *
 * Stated as counts and rates rather than a single percentage — "97% ready"
 * would be a number with nothing attached to it.
 *
 * The sample size is the load-bearing choice. 500 shadow decisions across at
 * least 30 distinct days is not arbitrary: large enough that a 1-in-100
 * failure mode is very unlikely to go unobserved, and long enough to span the
 * weekly rhythm of vendor announcements, standards-body publication and the
 * quiet stretches between them. A shorter window could be satisfied by one
 * busy fortnight of unusually easy material.
 */
export const READINESS = {
  minShadowDecisions: 500,
  minDistinctDays: 30,

  // Escapes. All must be ZERO — these damage readers or expose the
  // publication legally, and there is no acceptable rate.
  maxFabricatedClaimEscapes: 0,
  maxUnlicensedMediaEscapes: 0,
  maxBypassedHardBlockers: 0,

  /** Duplicate/cannibalisation leakage. Not zero, because near-duplicate
   *  judgement is genuinely hard and a small rate is survivable — an editor
   *  can merge two pages; they cannot un-publish a fabricated price. */
  maxDuplicateLeakageRate: 0.01,

  /** How often a human disagreed with the engine's accept/reject decision.
   *  Above this the engine's judgement is not yet aligned with the
   *  publication's, whatever its error counts say. */
  maxHumanDisagreementRate: 0.1,

  /** Proof obtained by deliberately breaking things, not by them not breaking. */
  requiredProofs: [
    "rollback_test",
    "circuit_breaker_test",
    "concurrency_test",
    "source_outage_test",
    "database_failure_test",
    "media_validation_outage_test",
    "duplicate_scheduler_test",
  ] as const,
} as const;

export type ReadinessProof = (typeof READINESS.requiredProofs)[number];

// The proof list is DERIVED from recorded evidence, never supplied.
//
// This used to be `passedProofs: ReadinessProof[]` on the evidence object —
// a caller could simply hand over all seven names and unlock autonomy without
// anything having been exercised. That is exactly the bypass this scorecard
// exists to prevent, and it was sitting in the type.
//
// evaluateProof() decides PROVEN from a record of an execution: what was run,
// what was observed, at which commit, and how recently. A name in a list is
// not evidence.

export type ReadinessEvidence = {
  shadowDecisions: number;
  distinctDays: number;
  fabricatedClaimEscapes: number;
  unlicensedMediaEscapes: number;
  bypassedHardBlockers: number;
  duplicateLeakageRate: number;
  humanDisagreementRate: number;
  /**
   * How many decisions a human actually reviewed, if known.
   *
   * REPORTING ONLY — it changes no verdict. With nothing reviewed the rate is
   * computed as 1 so it fails closed, which is right. But printing "actual
   * 1.0000" states a measurement that was never taken: it reads as "editors
   * disagreed with every decision" when the truth is "no editor has looked at
   * one". This project's own rule is that unmeasured must never be presentable
   * as measured, and a readiness dashboard is the last place to break it.
   */
  humanReviewCount?: number;
  /** Recorded proof EXECUTIONS. Not a list of names — see the note above.
   *  Which of these actually count is decided by evaluateProof(). */
  proofRecords: ProofRecord[];
};

export type ReadinessBlocker = {
  criterion: string;
  required: string;
  actual: string;
};

export type ReadinessReport = {
  /** Whether AUTONOMOUS is permitted. Never true by default. */
  autonomousUnlocked: boolean;
  /** The highest mode the evidence currently justifies. */
  highestJustifiedMode: EngineMode;
  blockers: ReadinessBlocker[];
  progress: { shadowDecisions: number; required: number; distinctDays: number; requiredDays: number };
};

/**
 * Evaluate readiness from evidence.
 *
 * Fails closed in every direction: missing evidence, a proof not yet run, or
 * any escape at all keeps AUTONOMOUS locked. There is deliberately no override
 * parameter — an override is the thing that gets used at 2am.
 */
export function evaluateReadiness(evidence: ReadinessEvidence): ReadinessReport {
  const blockers: ReadinessBlocker[] = [];
  const need = (criterion: string, required: string, actual: string, ok: boolean) => {
    if (!ok) blockers.push({ criterion, required, actual });
  };

  need("Shadow decisions", `>= ${READINESS.minShadowDecisions}`, String(evidence.shadowDecisions),
    evidence.shadowDecisions >= READINESS.minShadowDecisions);
  need("Distinct days observed", `>= ${READINESS.minDistinctDays}`, String(evidence.distinctDays),
    evidence.distinctDays >= READINESS.minDistinctDays);
  need("Fabricated-claim escapes", "0", String(evidence.fabricatedClaimEscapes),
    evidence.fabricatedClaimEscapes <= READINESS.maxFabricatedClaimEscapes);
  need("Unlicensed-media escapes", "0", String(evidence.unlicensedMediaEscapes),
    evidence.unlicensedMediaEscapes <= READINESS.maxUnlicensedMediaEscapes);
  need("Bypassed hard blockers", "0", String(evidence.bypassedHardBlockers),
    evidence.bypassedHardBlockers <= READINESS.maxBypassedHardBlockers);
  need("Duplicate leakage rate", `<= ${READINESS.maxDuplicateLeakageRate}`, evidence.duplicateLeakageRate.toFixed(4),
    evidence.duplicateLeakageRate <= READINESS.maxDuplicateLeakageRate);
  need(
    "Human disagreement rate",
    `<= ${READINESS.maxHumanDisagreementRate}`,
    // Same verdict either way; only the wording changes. See humanReviewCount.
    evidence.humanReviewCount === 0
      ? "UNMEASURED — no decision has been reviewed by a human yet, so there is no " +
        "observation to support any agreement rate. Blocks, as an unmeasured criterion must."
      : evidence.humanDisagreementRate.toFixed(4),
    evidence.humanDisagreementRate <= READINESS.maxHumanDisagreementRate
  );

  // Derived, not asserted. A proof counts only if a recorded execution reached
  // the level that kind requires, passed, carried a real observation, and has
  // not expired.
  const proofStatus = new Map(
    evaluateAllProofs(evidence.proofRecords).statuses.map((s) => [s.kind, s])
  );
  for (const proof of READINESS.requiredProofs) {
    const st = proofStatus.get(proof);
    need(`Proof: ${proof}`, "PROVEN", st?.state === "PROVEN" ? "PROVEN" : (st?.reason ?? "never exercised"),
      st?.state === "PROVEN");
  }

  const autonomousUnlocked = blockers.length === 0;

  // CANARY needs meaningful shadow evidence and zero escapes, but not the full
  // sample — it exists precisely to gather the rest under real conditions.
  const canaryJustified =
    evidence.shadowDecisions >= Math.floor(READINESS.minShadowDecisions / 5) &&
    evidence.fabricatedClaimEscapes === 0 &&
    evidence.unlicensedMediaEscapes === 0 &&
    evidence.bypassedHardBlockers === 0 &&
    proofStatus.get("rollback_test")?.state === "PROVEN" &&
    proofStatus.get("circuit_breaker_test")?.state === "PROVEN";

  return {
    autonomousUnlocked,
    highestJustifiedMode: autonomousUnlocked ? "AUTONOMOUS" : canaryJustified ? "CANARY" : "SHADOW",
    blockers,
    progress: {
      shadowDecisions: evidence.shadowDecisions,
      required: READINESS.minShadowDecisions,
      distinctDays: evidence.distinctDays,
      requiredDays: READINESS.minDistinctDays,
    },
  };
}

/**
 * Whether a mode may actually publish.
 *
 * SHADOW is the important row: it runs the entire decision process and
 * publishes nothing. That is what makes its record trustworthy as evidence —
 * a shadow decision costs nothing to get wrong, so there is no incentive to
 * be lenient.
 */
export function modeMayPublish(mode: EngineMode): boolean {
  return mode === "CANARY" || mode === "AUTONOMOUS";
}

/**
 * The mode the engine should actually operate in.
 *
 * The requested mode is clamped by evidence. Asking for AUTONOMOUS without the
 * proofs gives SHADOW — not an error, and not AUTONOMOUS. The safe reading of
 * an unjustified request is the safest mode that still does useful work.
 */
export function resolveEffectiveMode(
  requested: EngineMode,
  /**
   * STRUCTURAL, not `ReadinessReport`, and that is the fix rather than a
   * convenience.
   *
   * This took a ReadinessReport — modes.ts's own verdict — which does NOT
   * include the composition gate that lives in shadow-readiness.ts. The admin
   * page passed `readiness.modes` and therefore displayed "Requesting
   * AUTONOMOUS resolves to CANARY" the moment rollback_test became proven,
   * while the actual combined verdict was SHADOW because 8 of 15 coverage
   * dimensions were below their floor. CANARY publishes; SHADOW does not. The
   * page was announcing a publishing mode as justified on evidence that had not
   * cleared its own composition requirement.
   *
   * Nothing in the engine consumed this — the publication boundary is
   * structural (no publishing RPC exists, and anon is refused with 42501) — so
   * this was an overstated DISPLAY rather than a live escape. That is still the
   * defect class this project treats most seriously.
   *
   * Accepting the minimal shape means the COMBINED report satisfies it too, so
   * the clamped verdict is the natural thing to pass.
   */
  report: { highestJustifiedMode: EngineMode; blockers: readonly { criterion: string }[] }
): {
  mode: EngineMode;
  clamped: boolean;
  reason: string;
} {
  if (requested === "OFF") return { mode: "OFF", clamped: false, reason: "Explicitly off." };

  const requestedRank = MODE_ORDER.indexOf(requested);
  const justifiedRank = MODE_ORDER.indexOf(report.highestJustifiedMode);

  if (requestedRank <= justifiedRank) {
    return { mode: requested, clamped: false, reason: `Evidence justifies ${report.highestJustifiedMode}.` };
  }
  return {
    mode: report.highestJustifiedMode,
    clamped: true,
    reason: `${requested} requested but not justified: ${report.blockers.length} readiness criterion/criteria unmet. Running in ${report.highestJustifiedMode}.`,
  };
}
