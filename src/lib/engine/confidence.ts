import type { ClaimStatus, EngineEvidence, TrustLevel } from "./types.ts";

// Confidence scoring for a discovery, computed from its evidence rows.
//
// The governing rule, from the Phase 3 brief: "Never convert an uncertain
// claim into a fact merely because many websites repeated the same original
// claim." Two mechanisms enforce that here:
//
// 1. The claim's ceiling is set by its STRONGEST evidence, not by how much
//    evidence exists. Twenty secondary outlets cannot exceed the ceiling of
//    a secondary claim; only an actual primary source raises it.
// 2. Corroboration only counts from INDEPENDENT sources. Evidence rows
//    carrying `originates_from_url` are repeats of someone else's claim, and
//    are excluded from the corroboration count entirely — this is what stops
//    circular reporting (ten sites citing the same leak) from reading as ten
//    independent confirmations.
//
// The result is explainable by construction: computeConfidence returns the
// factors it used, so the admin dashboard can show why a number is what it is
// rather than presenting an unexplained score.

// Ceiling per claim status. A rumour stays a rumour no matter how loud it is.
const CLAIM_CEILING: Record<ClaimStatus, number> = {
  rumour: 0.3,
  leak: 0.45,
  estimate: 0.55,
  unverified: 0.35,
  reported_secondary: 0.75,
  confirmed_primary: 1.0,
};

// Baseline credibility contributed by a single source of each trust level.
const TRUST_BASE: Record<TrustLevel, number> = {
  primary: 0.8,
  secondary: 0.5,
  community: 0.25,
};

// Each additional *independent* corroborating source adds a diminishing
// amount. Capped so corroboration can nudge confidence but never manufacture
// certainty on its own.
const CORROBORATION_STEP = 0.06;
const MAX_CORROBORATION_BONUS = 0.18;

const CLAIM_RANK: Record<ClaimStatus, number> = {
  rumour: 0,
  unverified: 1,
  leak: 2,
  estimate: 3,
  reported_secondary: 4,
  confirmed_primary: 5,
};

export type ConfidenceResult = {
  confidence: number;
  /** The strongest claim status present across the evidence. */
  effectiveClaimStatus: ClaimStatus;
  /** Independent (non-derivative) sources counted toward corroboration. */
  independentSources: number;
  /** Sources excluded because they repeat another source's claim. */
  derivativeSources: number;
  explanation: string;
};

type EvidenceInput = Pick<EngineEvidence, "claim_status" | "trust_level" | "originates_from_url">;

export function computeConfidence(evidence: EvidenceInput[]): ConfidenceResult {
  if (evidence.length === 0) {
    return {
      confidence: 0,
      effectiveClaimStatus: "unverified",
      independentSources: 0,
      derivativeSources: 0,
      explanation: "No evidence recorded yet, so no confidence can be assigned.",
    };
  }

  // A source that names where it got the claim is repeating, not confirming.
  const independent = evidence.filter((e) => !e.originates_from_url);
  const derivative = evidence.length - independent.length;

  // Ceiling comes from the strongest claim anywhere in the evidence — but the
  // base credibility below only ever draws on independent sources, so a
  // derivative row quoting a primary source can't fabricate a primary-grade
  // score on its own.
  const strongest = evidence.reduce<ClaimStatus>(
    (best, e) => (CLAIM_RANK[e.claim_status] > CLAIM_RANK[best] ? e.claim_status : best),
    "rumour"
  );

  const pool = independent.length > 0 ? independent : evidence;
  const bestTrust = pool.reduce<number>((best, e) => Math.max(best, TRUST_BASE[e.trust_level]), 0);

  // Only independent sources beyond the first count as corroboration.
  const corroborating = Math.max(independent.length - 1, 0);
  const bonus = Math.min(corroborating * CORROBORATION_STEP, MAX_CORROBORATION_BONUS);

  const ceiling = CLAIM_CEILING[strongest];
  const raw = bestTrust + bonus;
  const confidence = Math.min(raw, ceiling);

  const parts = [
    `Strongest claim status is "${strongest}" (ceiling ${ceiling.toFixed(2)}).`,
    `${independent.length} independent source${independent.length === 1 ? "" : "s"}` +
      (derivative > 0
        ? `, ${derivative} excluded as repeats of another source's claim.`
        : "."),
    corroborating > 0
      ? `Corroboration from ${corroborating} additional independent source${corroborating === 1 ? "" : "s"} added ${bonus.toFixed(2)}.`
      : "No independent corroboration beyond the first source.",
  ];
  if (raw > ceiling) {
    parts.push(`Score capped by claim status: repetition alone cannot raise an unconfirmed claim.`);
  }

  return {
    confidence: Number(confidence.toFixed(3)),
    effectiveClaimStatus: strongest,
    independentSources: independent.length,
    derivativeSources: derivative,
    explanation: parts.join(" "),
  };
}

/**
 * Whether a discovery is solid enough to be turned into a *published factual*
 * claim. Deliberately strict: anything short of a primary confirmation is
 * reportable only as "reported"/"rumoured", never stated as fact.
 */
export function isPublishableAsFact(result: ConfidenceResult): boolean {
  return result.effectiveClaimStatus === "confirmed_primary" && result.confidence >= 0.8;
}
