import type { ClaimStatus, EngineEvidence, TrustLevel } from "./types.ts";
import { assessIndependence, type IndependenceAssessment } from "./independence.ts";

// Confidence scoring for a discovery, computed from its evidence rows.
//
// The governing rule, from the Phase 3 brief: "Never convert an uncertain
// claim into a fact merely because many websites repeated the same original
// claim." Two mechanisms enforce that here:
//
// 1. The claim's ceiling is set by its STRONGEST evidence, not by how much
//    evidence exists. Twenty secondary outlets cannot exceed the ceiling of
//    a secondary claim; only an actual primary source raises it.
// 2. Corroboration only counts from INDEPENDENT sources — and independence is
//    now decided by independence.ts, which collapses evidence rows into
//    distinct originating VOICES rather than testing one nullable column.
//
// WHY (2) CHANGED
// ---------------
// The old test for independence was `!e.originates_from_url`. Nothing in the
// codebase ever wrote that column — engine_upsert_discovery's signature had no
// parameter for it — so in production it was NULL on 118 of 118 evidence rows,
// every row read as independent, and the corroboration bonus had never once
// fired. Worse, the test could not have detected the cases that actually
// matter even if the column had been populated: five pages on one publisher's
// domain, or a vendor announcement plus an article quoting it, are one voice
// each, and both would have scored as multiple independent sources.
//
// independence.ts answers "how many voices", never "how many URLs", and
// returns a weighted count in which a voice nobody checked for an upstream
// citation is worth half of one that was checked and found original. Unknown
// lowers the score; it never raises it.
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

// Each additional *independent* corroborating VOICE adds a diminishing
// amount. Capped so corroboration can nudge confidence but never manufacture
// certainty on its own. The multiplier is a weighted voice count from
// independence.ts, not a row count, so more URLs from a voice already counted
// add exactly nothing.
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
  /**
   * Distinct originating VOICES, not rows. Five pages from one publisher, or a
   * vendor announcement plus an article quoting it, is one.
   */
  independentSources: number;
  /** Rows that added no voice: echoes of a voice already counted, or extra pages from one. */
  derivativeSources: number;
  /** The full voice breakdown, so a score can be explained row by row. */
  independence: IndependenceAssessment;
  explanation: string;
};

/**
 * `url`, `publisher` and `origin_examined` are optional so every existing
 * caller keeps compiling, but a caller that omits the URL gets a materially
 * weaker answer: without it, rows cannot be attributed to a publisher and
 * cannot be shown to be the same voice, so corroboration collapses toward
 * zero. That is the fail-closed direction — an unattributable row must never
 * be worth as much as an attributed one.
 */
type EvidenceInput = Pick<EngineEvidence, "claim_status" | "trust_level" | "originates_from_url"> & {
  id?: string | null;
  url?: string | null;
  publisher?: string | null;
  /** True when something actually looked for an upstream citation on this row. */
  origin_examined?: boolean | null;
};

export function computeConfidence(evidence: EvidenceInput[]): ConfidenceResult {
  if (evidence.length === 0) {
    return {
      confidence: 0,
      effectiveClaimStatus: "unverified",
      independentSources: 0,
      derivativeSources: 0,
      independence: assessIndependence([]),
      explanation: "No evidence recorded yet, so no confidence can be assigned.",
    };
  }

  const independence = assessIndependence(
    evidence.map((e, i) => ({
      id: e.id ?? `evidence:${i}`,
      url: e.url ?? null,
      publisher: e.publisher ?? null,
      originatesFromUrl: e.originates_from_url ?? null,
      originExamined: e.origin_examined ?? false,
    }))
  );

  // A row that names where it got the claim is repeating, not confirming.
  const nonDerivative = evidence.filter((e) => !e.originates_from_url);
  const derivative = independence.echoedRows + independence.sameVoiceRows;

  // Ceiling comes from the strongest claim anywhere in the evidence — but the
  // base credibility below only ever draws on non-derivative rows, so a row
  // quoting a primary source can't fabricate a primary-grade score on its own.
  const strongest = evidence.reduce<ClaimStatus>(
    (best, e) => (CLAIM_RANK[e.claim_status] > CLAIM_RANK[best] ? e.claim_status : best),
    "rumour"
  );

  const pool = nonDerivative.length > 0 ? nonDerivative : evidence;
  const bestTrust = pool.reduce<number>((best, e) => Math.max(best, TRUST_BASE[e.trust_level]), 0);

  // Corroboration comes from VOICES beyond the strongest one, weighted by how
  // well each voice's independence is established. Row count is not an input.
  const corroborating = independence.corroborationWeight;
  const bonus = Math.min(corroborating * CORROBORATION_STEP, MAX_CORROBORATION_BONUS);

  const ceiling = CLAIM_CEILING[strongest];
  const raw = bestTrust + bonus;
  const confidence = Math.min(raw, ceiling);

  const voices = independence.independentVoices;
  const parts = [
    `Strongest claim status is "${strongest}" (ceiling ${ceiling.toFixed(2)}).`,
    `${evidence.length} evidence row${evidence.length === 1 ? "" : "s"} resolve to ${voices} distinct originating voice${voices === 1 ? "" : "s"}` +
      (derivative > 0
        ? `; ${derivative} row${derivative === 1 ? "" : "s"} add no voice (a repeat of one already counted, or another page from it).`
        : "."),
    corroborating > 0
      ? `Corroboration from ${corroborating.toFixed(2)} additional weighted voice${corroborating === 1 ? "" : "s"} added ${bonus.toFixed(2)}.`
      : "No independent corroboration beyond the strongest voice.",
  ];
  if (raw > ceiling) {
    parts.push(`Score capped by claim status: repetition alone cannot raise an unconfirmed claim.`);
  }
  if (independence.unexaminedRows > 0) {
    parts.push(
      `${independence.unexaminedRows} row(s) were never checked for an upstream citation; that is unknown, not independent, and counts at half weight.`
    );
  }

  return {
    confidence: Number(confidence.toFixed(3)),
    effectiveClaimStatus: strongest,
    independentSources: voices,
    derivativeSources: derivative,
    independence,
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
