// Adversarial reviewer — an independent critic whose job is to REJECT.
//
// WHY A DETERMINISTIC CRITIC
// --------------------------
// There is no AI provider in this system (src/lib/engine/ai-provider.ts is a
// NullAiProvider with no SDK, no key and no network call possible), so the
// reviewer is mechanical rather than a second generative pass. That is not a
// compromise. A generative critic can be talked round — by a confident tone, by
// a well-formed citation that points nowhere, by its own prior. This one checks
// claims against evidence records and cannot be persuaded that a figure is in a
// source when it is not. It is narrower than a human editor and more reliable
// than a second model at the one thing it does.
//
// INDEPENDENCE FROM THE GENERATOR
// -------------------------------
// The pipeline that produced a draft also produced an opinion that the draft is
// fine. If the reviewer reads that opinion, the review is worthless — two
// stages agreeing is not two opinions when the second one read the first.
//
// So `input.generator` is QUARANTINED. It is copied into the result for
// reporting and used for exactly one thing: detecting that the reviewer and the
// generator disagree. No check reads it. Deleting the field would not change a
// single finding, and there is a test that asserts precisely that.
//
// WHAT IT ANSWERS
// ---------------
//   1. Which claims are not supported by an evidence record?  (claim-coverage)
//   2. What could mislead a reader?                           (body checks)
//   3. Does an existing TechCarvalho page already answer this? (dedupe +
//      cannibalisation)
//   4. Are the sources actually independent?                  (confidence.ts's
//      originates_from_url guard, extended to same-organisation and
//      shared-origin clustering)
//   5. Is any source being misrepresented?                    (attribution and
//      hedging checks)
//   6. Could this media cause a copyright problem?            (media rights)
//   7. Would I publish this if nobody were available to correct it for seven
//      days?                                                  (computed — see
//      assessSevenDayQuestion below)
//
// It returns structured findings with severities, never a single score. A score
// invites a threshold, and a threshold invites "0.82 is close enough". The
// strongest thing this module will ever say is "no objection found" — it does
// not have an approval verdict, because approving is not its job.
//
// Deterministic and pure. No AI provider, no network, no cost, no `server-only`.

import type { MediaRightsStatus, MediaSourceType, EngineMediaRightsStatus } from "@/lib/types/database";
import { evaluatePublishEligibility } from "../media/rights.ts";
import { licenceUrl, requiresAttribution } from "../media/licence-links.ts";
import { findCannibalisationMatches, type ContentSignal } from "../admin/cannibalisation.ts";
import { titleSimilarity, NEAR_DUPLICATE_THRESHOLD } from "./dedupe.ts";
import { classifyPromotional, isVerbatimVendorHeadline } from "./promotional.ts";
import { findUnfinishedAssemblyMarkers } from "./draft-assembly.ts";
import { computeConfidence, type ConfidenceResult } from "./confidence.ts";
import {
  assessClaimCoverage,
  classifyClaimType,
  extractClaimValues,
  normaliseDate,
  type Claim,
  type ClaimAssessment,
  type ClaimType,
  type CoverageReport,
  type EvidenceRecord,
} from "./claim-coverage.ts";
import {
  classifySource,
  qualifiesAsNews,
  reconcileConflict,
  type ClaimDomain,
  type Reconciliation,
  type SourceClassification,
} from "./source-quality.ts";

// ---------------------------------------------------------------------------
// Findings
// ---------------------------------------------------------------------------

export type ReviewSeverity = "blocker" | "serious" | "caution" | "note";

export type ReviewCategory =
  | "evidence"
  | "reader_harm"
  | "duplication"
  | "independence"
  | "misrepresentation"
  | "media_rights"
  | "unattended_risk"
  | "process";

export type ReviewFinding = {
  code: string;
  severity: ReviewSeverity;
  category: ReviewCategory;
  message: string;
  /** Concrete pointers — claim ids, URLs, asset ids. Never a vague gesture. */
  detail: string[];
};

const SEVERITY_ORDER: Record<ReviewSeverity, number> = { blocker: 3, serious: 2, caution: 1, note: 0 };

// ---------------------------------------------------------------------------
// Input
// ---------------------------------------------------------------------------

export type MediaCandidate = {
  id: string;
  label?: string | null;
  rightsStatus?: MediaRightsStatus;
  owned?: boolean;
  sourceType?: MediaSourceType | null;
  /** Licence string as recorded on the asset, e.g. "CC BY-SA 4.0". */
  licence?: string | null;
  attributionText?: string | null;
  sourceUrl?: string | null;
  /** Registry permissions for wherever the file came from. */
  registry?: {
    organisation?: string | null;
    mediaRepublicationPermitted?: boolean;
    mediaRightsStatus?: EngineMediaRightsStatus;
    editorialUseOnly?: boolean;
    attributionRequired?: boolean;
    registrationRequired?: boolean;
  } | null;
};

export type ClaimConflict = {
  /** Human-readable name for what is being disagreed about, e.g. "UK launch price". */
  claimKey: string;
  domain: ClaimDomain;
  assertions: { evidenceId: string; value: string }[];
};

/**
 * The generator's own opinion of its work. Quarantined — see the module header.
 */
export type GeneratorClaim = {
  verdict?: string | null;
  confidence?: number | null;
  note?: string | null;
};

export type ReviewInput = {
  /** ISO timestamp used as "now", so a review is reproducible. */
  now: string;
  title: string;
  body?: string | null;
  contentType?: string | null;
  freshnessSensitivity?: "breaking" | "time_sensitive" | "evergreen" | null;
  primaryQuery?: string | null;
  intentFingerprint?: string | null;
  /** The source's own headline, to detect a verbatim reprint. */
  sourceHeadline?: string | null;
  claims?: Claim[];
  evidence?: EvidenceRecord[];
  media?: MediaCandidate[];
  /** Already-published TechCarvalho content, for the duplication check. */
  existingContent?: ContentSignal[];
  /** Known disagreements between sources, to reconcile rather than pick from. */
  conflicts?: ClaimConflict[];
  /** Whether the piece needs a hero image before it can be published. */
  requiresHeroMedia?: boolean;
  /** True only when TechCarvalho actually ran the tests the body describes. */
  firstPartyTestingPerformed?: boolean;
  generator?: GeneratorClaim | null;
};

// ---------------------------------------------------------------------------
// The seven-day question
// ---------------------------------------------------------------------------

export const SEVEN_DAY_HORIZON_DAYS = 7;

/**
 * Risk score above which a piece is not left unattended even with no blocker.
 * Set so a single serious finding, or one perishable claim, is enough.
 */
export const UNATTENDED_RISK_CEILING = 20;

/**
 * How long a claim of each type can be expected to stay true with nobody
 * watching it. Null means it does not decay on this timescale.
 *
 * These are editorial judgements, not facts about the world, and they live here
 * once rather than being re-guessed at each call site — same convention as
 * FRESHNESS_OVERDUE_DAYS in src/lib/admin/freshness.ts.
 */
export const PERISHABILITY_DAYS: Record<ClaimType, number | null> = {
  availability: 1,
  safety_recall: 2,
  price: 3,
  release_date: 7,
  benchmark: 30,
  compatibility: 60,
  specification: 90,
  legal_regulatory: 90,
  general: null,
};

export type ExpiringClaim = {
  claimId: string;
  claimType: ClaimType;
  /** Days until the claim can no longer be relied on. */
  expiresInDays: number;
  whatGoesWrong: string;
};

export type SevenDayAssessment = {
  horizonDays: number;
  /** The answer to the question. False is the default and the common answer. */
  wouldPublishUnattended: boolean;
  unattendedRiskScore: number;
  expiringClaims: ExpiringClaim[];
  /** Harm that cannot be undone by editing the page a week later. */
  irreversibleRisks: string[];
  /** Harm that gets worse the longer the page stands. */
  compoundingRisks: string[];
  explanation: string;
};

const TIME_ANCHOR = /\bas of\b|\bat the time of writing\b|\bat launch\b|\bwhen (this was |we )?(published|checked|wrote)\b|\bon \d{1,2}\s+\w+\s+\d{4}\b/i;

function isTimeAnchored(claim: Claim): boolean {
  return claim.timeAnchored === true || TIME_ANCHOR.test(claim.text);
}

/**
 * "Would I publish this if nobody were available to correct it for seven days?"
 *
 * Computed, not asserted. Four things are worked out from the actual content:
 *
 *  - EXPIRY. Each claim type has a shelf life (PERISHABILITY_DAYS). A claim
 *    whose shelf life is shorter than the horizon expires inside it, unless the
 *    text anchors it in time ("as of 22 August 2026, Canon lists it at £4,299"),
 *    which converts a claim that goes wrong into one that stays true. A release
 *    date falling inside the window is always expiring, anchored or not — the
 *    article will be describing a past event in the future tense while nobody
 *    is watching.
 *  - IRREVERSIBILITY. A rights complaint, an unsupported safety/legal claim, or
 *    an unconfirmed breaking story cannot be fixed by a correction a week
 *    later; the damage has already been done to whoever acted on it.
 *  - COMPOUNDING. Unsupported high-risk claims get indexed, quoted and
 *    syndicated. A duplicate page entrenches its own cannibalisation. These get
 *    worse with time rather than fading.
 *  - EXPOSURE. Breaking coverage takes its traffic in exactly the first days,
 *    so an unconfirmed breaking claim is maximally read while maximally wrong.
 *
 * The answer is yes only when there are no blockers, no serious findings, no
 * expiring claims, no irreversible risks, and the residual score is under the
 * ceiling. Anything else answers no, with the specific reasons listed.
 */
export function assessSevenDayQuestion(input: {
  now: string;
  claims: Claim[];
  coverage: CoverageReport;
  findings: ReviewFinding[];
  freshnessSensitivity?: "breaking" | "time_sensitive" | "evergreen" | null;
  confidence: ConfidenceResult;
  reconciliations: Reconciliation[];
}): SevenDayAssessment {
  const { now, claims, coverage, findings, confidence, reconciliations } = input;
  const horizon = SEVEN_DAY_HORIZON_DAYS;
  const nowMs = Date.parse(now);

  const byId = new Map(coverage.claims.map((c) => [c.claimId, c]));
  const expiringClaims: ExpiringClaim[] = [];

  for (const claim of claims) {
    const assessment = byId.get(claim.id);
    const type = assessment?.type ?? claim.type ?? classifyClaimType(claim.text);
    const shelfLife = PERISHABILITY_DAYS[type];

    // A dated event inside the window is the unambiguous case: the sentence is
    // simply false from that day on.
    if (type === "release_date" && !Number.isNaN(nowMs)) {
      for (const value of extractClaimValues(claim.text)) {
        if (value.kind !== "date") continue;
        const iso = normaliseDate(value.raw);
        if (!iso) continue;
        const days = (Date.parse(`${iso}T00:00:00Z`) - nowMs) / 86_400_000;
        if (days >= 0 && days <= horizon) {
          expiringClaims.push({
            claimId: claim.id,
            claimType: type,
            expiresInDays: Math.round(days),
            whatGoesWrong: `The date ${iso} falls inside the seven-day window, so the piece will describe a past event in the future tense with nobody able to change the tense.`,
          });
        }
      }
    }

    if (shelfLife !== null && shelfLife < horizon && !isTimeAnchored(claim)) {
      expiringClaims.push({
        claimId: claim.id,
        claimType: type,
        expiresInDays: shelfLife,
        whatGoesWrong:
          `A ${type} claim stated without an as-of date stops being reliable after roughly ${shelfLife} day(s), ` +
          `and would stand uncorrected for the remaining ${horizon - shelfLife}. Anchoring it in time ("as of ${now.slice(0, 10)}, …") fixes this.`,
      });
    }
  }

  const irreversibleRisks: string[] = [];
  const compoundingRisks: string[] = [];

  const mediaProblems = findings.filter(
    (f) => f.category === "media_rights" && (f.severity === "blocker" || f.severity === "serious")
  );
  for (const f of mediaProblems) {
    irreversibleRisks.push(
      `Media rights: ${f.message} A rights holder's complaint arriving during the window cannot be answered by editing the page afterwards.`
    );
  }

  for (const c of coverage.highRiskUnsupported) {
    if (c.type === "safety_recall" || c.type === "legal_regulatory") {
      irreversibleRisks.push(
        `An unsupported ${c.type} claim (${c.claimId}) is acted on immediately by whoever reads it. A correction on day seven reaches nobody who already acted.`
      );
    } else {
      compoundingRisks.push(
        `Unsupported ${c.type} claim (${c.claimId}) would be indexed and quoted for a week before anyone could withdraw it.`
      );
    }
  }

  if (coverage.fabricatedValueCount > 0) {
    compoundingRisks.push(
      `${coverage.fabricatedValueCount} figure(s) in the text appear in no source. Unattended, they become the citation somebody else uses.`
    );
  }

  const breaking = input.freshnessSensitivity === "breaking";
  const primaryConfirmed = confidence.effectiveClaimStatus === "confirmed_primary";
  if (breaking && !primaryConfirmed) {
    irreversibleRisks.push(
      `Breaking coverage takes most of its readership in the first days, so an unconfirmed claim (status "${confidence.effectiveClaimStatus}") is read by the largest audience it will ever have while it is least verified.`
    );
  }

  for (const r of reconciliations) {
    if (r.outcome === "needs_human_review") {
      compoundingRisks.push(
        `Sources disagree on ${r.claimKey} and nobody has decided which is right. Publishing picks one by accident and stands behind it for a week.`
      );
    }
  }

  for (const f of findings) {
    if (f.category === "duplication" && SEVERITY_ORDER[f.severity] >= SEVERITY_ORDER.serious) {
      compoundingRisks.push(`${f.message} A duplicate page entrenches its own ranking damage the longer it stands.`);
    }
  }

  const counts = countSeverities(findings);
  let score =
    counts.blocker * 30 +
    counts.serious * 15 +
    counts.caution * 6 +
    counts.note * 1 +
    expiringClaims.length * 12 +
    irreversibleRisks.length * 20 +
    compoundingRisks.length * 8 +
    (breaking && !primaryConfirmed ? 15 : 0);

  // Small credit where the piece has actually done the work: every claim
  // covered, and every perishable claim anchored in time.
  if (coverage.claimCount > 0 && coverage.coverageRatio === 1 && expiringClaims.length === 0) score -= 10;

  const unattendedRiskScore = Math.max(0, Math.min(100, score));

  const wouldPublishUnattended =
    counts.blocker === 0 &&
    counts.serious === 0 &&
    expiringClaims.length === 0 &&
    irreversibleRisks.length === 0 &&
    unattendedRiskScore <= UNATTENDED_RISK_CEILING;

  const reasons: string[] = [];
  if (counts.blocker) reasons.push(`${counts.blocker} blocking finding(s)`);
  if (counts.serious) reasons.push(`${counts.serious} serious finding(s)`);
  if (expiringClaims.length) reasons.push(`${expiringClaims.length} claim(s) expire inside the window`);
  if (irreversibleRisks.length) reasons.push(`${irreversibleRisks.length} risk(s) that a later correction cannot undo`);
  if (compoundingRisks.length) reasons.push(`${compoundingRisks.length} risk(s) that worsen with time`);

  return {
    horizonDays: horizon,
    wouldPublishUnattended,
    unattendedRiskScore,
    expiringClaims,
    irreversibleRisks,
    compoundingRisks,
    explanation: wouldPublishUnattended
      ? `Would publish unattended: no blocking or serious findings, nothing in the piece expires within ${horizon} days, and no risk here is one a later correction could not undo (residual score ${unattendedRiskScore}/${UNATTENDED_RISK_CEILING}).`
      : `Would NOT publish unattended for ${horizon} days — ${reasons.join(", ")} (risk score ${unattendedRiskScore}). ` +
        (expiringClaims.length
          ? `Specifically: ${expiringClaims.map((e) => `${e.claimType} claim ${e.claimId} in ~${e.expiresInDays}d`).join("; ")}.`
          : ""),
  };
}

function countSeverities(findings: ReviewFinding[]): Record<ReviewSeverity, number> {
  const counts: Record<ReviewSeverity, number> = { blocker: 0, serious: 0, caution: 0, note: 0 };
  for (const f of findings) counts[f.severity]++;
  return counts;
}

// ---------------------------------------------------------------------------
// Body-level reader-harm patterns
// ---------------------------------------------------------------------------

// Claims of first-party testing. TechCarvalho's honesty rule forbids stating
// that we tested something we did not; this is the sentence-level form of it.
const FIRST_PARTY_TESTING =
  /\b(?:we|our)\s+(?:tested|test|tests|testing|benchmarked|benchmarks?|measured|timed|clocked|reviewed)\b|\bin\s+our\s+(?:testing|tests|lab|benchmarks?|measurements|experience)\b|\bhands[- ]on\s+(?:testing|time)\b/i;

// A rating we have no data for. The site has no ratings system at all, so any
// score in a body is by definition invented.
const FABRICATED_RATING =
  /\b\d(?:\.\d)?\s*(?:\/|out of)\s*(?:5|10)\b|[★☆]|\bwe rate\b|\brated\s+\d(?:\.\d)?\b|\bscore of \d/i;

// Unhedged absolutes. Each is a factual claim about the whole market that
// nothing short of an exhaustive survey supports.
const UNSUPPORTED_ABSOLUTE =
  /\b(?:the\s+)?(?:fastest|most powerful|best[- ]in[- ]class|world'?s first|first ever|only .{0,20}\bthat can\b|unrivalled|unmatched|nothing else comes close)\b/i;

// Attributed voice. Presence means the writer is reporting rather than asserting.
const ATTRIBUTION_MARKER =
  /\baccording to\b|\breport(s|ed|edly)?\b|\bsays?\b|\bsaid\b|\bclaims?\b|\bannounced\b|\bper their\b|\bthe company (says|said|states)\b/i;

// Hedging in a SOURCE. If the source hedges and the article does not, the
// article has upgraded somebody else's guess into a fact.
const HEDGE =
  /\b(?:reportedly|allegedly|rumou?red|expected to|due to|is said to|could|may|might|appears? to|believed to|sources? (?:say|claim|suggest)|unconfirmed|we understand|is thought to|slated to|tipped to)\b/i;

const UNIVERSAL_QUANTIFIER = /\b(?:all|every|any|each|never|always|universally|entirely|fully|no other)\b/i;

// ---------------------------------------------------------------------------
// Result
// ---------------------------------------------------------------------------

export type ReviewVerdict = "reject" | "hold_for_human" | "revise" | "no_objection";

export type ReviewResult = {
  findings: ReviewFinding[];
  blockers: ReviewFinding[];
  severityCounts: Record<ReviewSeverity, number>;
  /**
   * The reviewer's own conclusion. Note there is no "publish" — "no_objection"
   * means this critic found nothing, which is not the same as approval. The
   * publication gate decides.
   */
  verdict: ReviewVerdict;
  coverage: CoverageReport;
  confidence: ConfidenceResult;
  reconciliations: Reconciliation[];
  sourceClassifications: { evidenceId: string; classification: SourceClassification }[];
  sevenDay: SevenDayAssessment;
  /** What the generating stage thought. Reported, never used as an input. */
  generatorClaim: GeneratorClaim | null;
  disagreesWithGenerator: boolean;
  explanation: string;
};

const GENERATOR_OPTIMISTIC = /^(?:ready|ready_to_publish|publish|publishable|success|approved|complete|ok|pass)$/i;

// ---------------------------------------------------------------------------
// The reviewer
// ---------------------------------------------------------------------------

export function reviewProposedPublication(input: ReviewInput): ReviewResult {
  const findings: ReviewFinding[] = [];
  const add = (
    code: string,
    severity: ReviewSeverity,
    category: ReviewCategory,
    message: string,
    detail: string[] = []
  ) => {
    findings.push({ code, severity, category, message, detail });
  };

  const evidence = input.evidence ?? [];
  const claims = input.claims ?? [];
  const media = input.media ?? [];
  const body = input.body ?? "";

  const classifications = evidence.map((e) => ({
    evidenceId: e.id,
    classification: classifySource({
      url: e.url,
      publisher: e.publisher,
      organisation: e.organisation,
      sourceType: e.sourceType,
      trustLevel: e.trustLevel,
      originatesFromUrl: e.originatesFromUrl,
    }),
  }));
  const classById = new Map(classifications.map((c) => [c.evidenceId, c.classification]));

  const confidence = computeConfidence(
    evidence.map((e) => ({
      id: e.id,
      claim_status: e.claimStatus,
      trust_level: e.trustLevel,
      // url/publisher are what let independence.ts collapse rows into VOICES.
      // Dropping them here would make five pages from one publisher look like
      // five sources, which is the exact miscount confidence.ts exists to stop.
      url: e.url,
      publisher: e.publisher,
      originates_from_url: e.originatesFromUrl ?? null,
    }))
  );

  const coverage = assessClaimCoverage({ claims, evidence, now: input.now });

  // --- 1. Evidence: which claims are not supported by an evidence record? ---

  if (evidence.length === 0) {
    add(
      "no_sources",
      "blocker",
      "evidence",
      "No evidence records at all. Nothing in this piece is traceable to a source.",
      []
    );
  }

  if (claims.length === 0) {
    add(
      "no_claims_submitted",
      "blocker",
      "process",
      "No claims were submitted for checking. A piece nobody has broken into checkable claims has not been reviewed — an empty claim list is not a clean bill of health.",
      []
    );
  }

  for (const assessment of coverage.unsupportedClaims) {
    const severity: ReviewSeverity = assessment.highRisk ? "blocker" : "serious";
    add(
      "unsupported_claim",
      severity,
      "evidence",
      `Claim ${assessment.claimId} (${assessment.type}) is not supported: ${assessment.explanation}`,
      [assessment.text, ...assessment.failures.map((f) => f.code)]
    );
  }

  // The single most important check in the module: a figure that is not in any
  // source came from somewhere other than reporting.
  const fabricated = coverage.claims.filter((c) => c.unattestedValues.length > 0);
  if (fabricated.length) {
    add(
      "value_not_in_any_source",
      "blocker",
      "evidence",
      `${coverage.fabricatedValueCount} figure(s) appear in the text but in no source excerpt. Unknown must stay unknown — remove the figure or attach the source it came from.`,
      fabricated.flatMap((c) => c.unattestedValues.map((v) => `${c.claimId}: ${v.raw} (${v.kind})`))
    );
  }

  if (coverage.claimCount > 0 && coverage.coverageRatio < 0.6) {
    add(
      "low_claim_coverage",
      "serious",
      "evidence",
      `Only ${coverage.supportedCount} of ${coverage.claimCount} claims are covered by evidence (${(coverage.coverageRatio * 100).toFixed(0)}%).`,
      []
    );
  }

  // --- 2. What could mislead a reader? ---

  const unfinished = findUnfinishedAssemblyMarkers(body);
  if (unfinished.length) {
    add(
      "unfinished_assembly",
      "blocker",
      "reader_harm",
      "The body still contains engine scaffolding, which would publish instructions-to-the-writer as though they were an article.",
      unfinished
    );
  }

  const promo = classifyPromotional(input.title, null);
  if (promo.isPromotional) {
    add(
      "promotional_headline",
      "blocker",
      "reader_harm",
      `The headline reads as vendor promotion rather than reporting. ${promo.explanation}`,
      promo.matched
    );
  }

  if (isVerbatimVendorHeadline(input.title, input.sourceHeadline)) {
    add(
      "verbatim_vendor_headline",
      "serious",
      "reader_harm",
      "The proposed headline is the source's headline word for word. Republishing a vendor's framing is not coverage.",
      [input.sourceHeadline ?? ""]
    );
  }

  if (FIRST_PARTY_TESTING.test(body) && !input.firstPartyTestingPerformed) {
    add(
      "fabricated_first_party_testing",
      "blocker",
      "reader_harm",
      'The body claims TechCarvalho tested or measured something ("we tested", "in our testing"), but no first-party testing is recorded. Claiming testing that did not happen is the most damaging thing this site can publish.',
      matchesOf(body, FIRST_PARTY_TESTING)
    );
  }

  if (FABRICATED_RATING.test(body)) {
    add(
      "fabricated_rating",
      "blocker",
      "reader_harm",
      "The body contains a rating or score. TechCarvalho has no ratings data, so any score here was invented.",
      matchesOf(body, FABRICATED_RATING)
    );
  }

  if (UNSUPPORTED_ABSOLUTE.test(body)) {
    add(
      "unsupported_absolute",
      "serious",
      "reader_harm",
      "The body states a market-wide absolute (fastest / first ever / best in class). Nothing short of an exhaustive survey supports that, and no source excerpt here is one.",
      matchesOf(body, UNSUPPORTED_ABSOLUTE)
    );
  }

  const nothingConfirmed = evidence.length > 0 && confidence.effectiveClaimStatus !== "confirmed_primary";
  if (nothingConfirmed && body.length > 0 && !ATTRIBUTION_MARKER.test(body)) {
    add(
      "unattributed_throughout",
      "serious",
      "reader_harm",
      `Nothing here reached primary confirmation (status "${confidence.effectiveClaimStatus}"), yet the body contains no attribution language at all. Every claim must read as "X reports…", not as TechCarvalho's own assertion.`,
      []
    );
  }

  // --- 3. Does an existing page already answer this? ---

  const existing = input.existingContent ?? [];
  if (existing.length) {
    const matches = findCannibalisationMatches(
      {
        title: input.title,
        primary_query: input.primaryQuery ?? "",
        intent_fingerprint: input.intentFingerprint ?? "",
      },
      existing
    );
    for (const m of matches) {
      const exact = m.reason === "same intent fingerprint" || m.reason === "same target query";
      add(
        exact ? "duplicate_of_existing" : "cannibalisation_risk",
        exact ? "blocker" : "caution",
        "duplication",
        exact
          ? `"${m.title}" already targets exactly this (${m.reason}). Publishing a second page for the same intent splits it rather than adding anything.`
          : `"${m.title}" is close enough to overlap (${m.reason}). Either fold this into it or sharpen the angle.`,
        [m.id, m.title]
      );
    }

    for (const item of existing) {
      const similarity = titleSimilarity(input.title, item.title);
      if (similarity >= NEAR_DUPLICATE_THRESHOLD && !matches.some((m) => m.id === item.id)) {
        add(
          "near_duplicate_title",
          "serious",
          "duplication",
          `"${item.title}" covers the same story (title similarity ${similarity.toFixed(2)}). This looks like the same event arriving from a second outlet.`,
          [item.id, item.title]
        );
      }
    }
  }

  // --- 4. Are the sources actually independent? ---

  if (evidence.length > 0) {
    if (confidence.independentSources <= 1 && confidence.derivativeSources > 0) {
      add(
        "circular_reporting",
        "serious",
        "independence",
        `${confidence.derivativeSources} of ${evidence.length} sources repeat another source's claim. This is one claim reported many times, not corroboration.`,
        evidence.filter((e) => e.originatesFromUrl).map((e) => `${e.url} <- ${e.originatesFromUrl}`)
      );
    }

    const originCounts = new Map<string, string[]>();
    for (const e of evidence) {
      if (!e.originatesFromUrl) continue;
      const bucket = originCounts.get(e.originatesFromUrl) ?? [];
      bucket.push(e.url);
      originCounts.set(e.originatesFromUrl, bucket);
    }
    for (const [origin, urls] of originCounts) {
      if (urls.length >= 2) {
        add(
          "shared_origin",
          "serious",
          "independence",
          `${urls.length} sources all trace back to ${origin}. They corroborate each other only in the sense that they read the same page.`,
          urls
        );
      }
    }

    const organisations = new Set(
      evidence.map((e) => (e.organisation ?? e.publisher ?? hostOf(e.url) ?? "unknown").toLowerCase())
    );
    if (evidence.length >= 2 && organisations.size === 1) {
      add(
        "single_organisation",
        "serious",
        "independence",
        `All ${evidence.length} sources are the same organisation (${[...organisations][0]}). A source count above one is not independence.`,
        evidence.map((e) => e.url)
      );
    }

    if (confidence.independentSources <= 1 && confidence.derivativeSources === 0) {
      add(
        "single_source",
        "caution",
        "independence",
        "Only one independent source. Anything specific here rests entirely on it.",
        evidence.map((e) => e.url)
      );
    }

    const news = qualifiesAsNews(classifications.map((c) => c.classification));
    if (!news.qualifies) {
      add(
        "vendor_only_sourcing",
        "serious",
        "independence",
        news.reason,
        classifications.map((c) => `${c.evidenceId}: ${c.classification.sourceClass}`)
      );
    }

    const signalOnly = classifications.filter((c) => c.classification.signalOnly);
    if (signalOnly.length && signalOnly.length === classifications.length) {
      add(
        "signal_only_sourcing",
        "blocker",
        "independence",
        "Every source is a forum, social post or unclassified page. Those can tell us a question exists; none of them can answer it.",
        signalOnly.map((c) => c.evidenceId)
      );
    }
  }

  // --- 5. Is any source being misrepresented? ---

  const knownPublishers = new Set(
    evidence.flatMap((e) => [e.publisher, e.organisation].filter((p): p is string => !!p).map((p) => p.toLowerCase()))
  );
  for (const claim of claims) {
    if (claim.attributedTo && !knownPublishers.has(claim.attributedTo.toLowerCase())) {
      add(
        "attribution_not_in_evidence",
        "blocker",
        "misrepresentation",
        `Claim ${claim.id} is attributed to "${claim.attributedTo}", but no evidence record comes from them. A citation to a source we do not hold is a fabricated citation.`,
        [claim.text]
      );
    }
  }

  const byClaimId = new Map(coverage.claims.map((c) => [c.claimId, c]));
  for (const claim of claims) {
    const assessment = byClaimId.get(claim.id);
    if (!assessment) continue;
    const linked = assessment.supportingEvidenceIds
      .map((id) => evidence.find((e) => e.id === id))
      .filter((e): e is EvidenceRecord => !!e);

    if (claim.statedAsFact && assessment.bestClaimStatus && assessment.bestClaimStatus !== "confirmed_primary") {
      add(
        "claim_status_overstated",
        "blocker",
        "misrepresentation",
        `Claim ${claim.id} is written as established fact, but its strongest evidence is "${assessment.bestClaimStatus}". A rumour restated confidently is still a rumour.`,
        [claim.text]
      );
    }

    const hedgedSources = linked.filter((e) => e.excerpt && HEDGE.test(e.excerpt));
    if (hedgedSources.length && hedgedSources.length === linked.length && !HEDGE.test(claim.text)) {
      add(
        "hedged_evidence_stated_flatly",
        "serious",
        "misrepresentation",
        `Every source for claim ${claim.id} hedges ("expected to", "reportedly", …) but the claim does not. Dropping the source's own caveat misrepresents it.`,
        hedgedSources.map((e) => `${e.url}: ${e.excerpt?.slice(0, 120)}`)
      );
    }

    const overreachTypes: ClaimType[] = ["compatibility", "specification", "benchmark"];
    if (
      overreachTypes.includes(assessment.type) &&
      UNIVERSAL_QUANTIFIER.test(claim.text) &&
      linked.length > 0 &&
      !linked.some((e) => e.excerpt && UNIVERSAL_QUANTIFIER.test(e.excerpt))
    ) {
      add(
        "quantifier_overreach",
        "serious",
        "misrepresentation",
        `Claim ${claim.id} generalises ("all"/"every"/"any") beyond what any source says. The sources describe specific cases; the claim describes a category.`,
        [claim.text, ...linked.map((e) => e.excerpt?.slice(0, 120) ?? e.url)]
      );
    }

    if (assessment.type === "benchmark") {
      const independentMeasured = linked.some((e) => {
        const c = classById.get(e.id);
        return c?.independent && c.sourceClass === "independent_high_quality";
      });
      if (linked.length > 0 && !independentMeasured) {
        add(
          "benchmark_without_independent_measurement",
          "serious",
          "misrepresentation",
          `Claim ${claim.id} is a performance number with no independent measurement behind it. A vendor's own benchmark is a claim about the vendor.`,
          linked.map((e) => `${e.id}: ${classById.get(e.id)?.sourceClass ?? "unclassified"}`)
        );
      }
    }
  }

  // --- Source conflicts ---

  const reconciliations: Reconciliation[] = (input.conflicts ?? []).map((conflict) =>
    reconcileConflict({
      claimKey: conflict.claimKey,
      domain: conflict.domain,
      assertions: conflict.assertions.map((a) => ({
        sourceId: a.evidenceId,
        value: a.value,
        classification:
          classById.get(a.evidenceId) ??
          classifySource({ originatesFromUrl: null }),
      })),
    })
  );

  for (const r of reconciliations) {
    if (r.outcome === "needs_human_review") {
      add(
        "unresolved_source_conflict",
        "blocker",
        "evidence",
        r.explanation,
        r.groups.map((g) => `${g.value} <- ${g.sourceIds.join(", ")} (${g.bestClass})`)
      );
    } else if (r.outcome === "resolved_by_authority") {
      add(
        "source_conflict_resolved",
        "caution",
        "evidence",
        r.explanation,
        r.distinctValues
      );
    } else if (r.chosenValue === null) {
      add(
        "agreement_without_authority",
        "serious",
        "evidence",
        r.explanation,
        r.distinctValues
      );
    }
  }

  // --- 6. Could this media cause a copyright or licensing problem? ---

  if (input.requiresHeroMedia && media.length === 0) {
    add(
      "no_media",
      "caution",
      "media_rights",
      "This piece requires a hero image and none is attached. It cannot be published until one exists and is cleared.",
      []
    );
  }

  for (const asset of media) {
    const name = asset.label ?? asset.id;

    const eligibility = evaluatePublishEligibility({
      rights_status: asset.rightsStatus,
      owned: asset.owned,
      source_type: asset.sourceType,
    });
    if (!eligibility.allowed) {
      add(
        "media_not_cleared",
        "blocker",
        "media_rights",
        `${name}: ${eligibility.reason}`,
        [asset.sourceUrl ?? asset.id]
      );
    }

    const registry = asset.registry;
    if (registry) {
      if (registry.mediaRepublicationPermitted === false) {
        add(
          "media_republication_not_permitted",
          "blocker",
          "media_rights",
          `${name} came from ${registry.organisation ?? "a registered source"}, which is not cleared for image republication. Permission to read facts from a source is never permission to republish its pictures.`,
          [asset.sourceUrl ?? asset.id]
        );
      }
      const rights = registry.mediaRightsStatus;
      if (rights === "prohibited" || rights === "no_source_found") {
        add(
          "media_rights_prohibited",
          "blocker",
          "media_rights",
          `${name}: source media rights are "${rights}".`,
          [asset.sourceUrl ?? asset.id]
        );
      } else if (rights === "unclear_manual_review" || rights === "requires_registration" || rights === "unverified") {
        add(
          "media_rights_unresolved",
          "serious",
          "media_rights",
          `${name}: source media rights are "${rights}" — unresolved, which is not the same as permitted.`,
          [asset.sourceUrl ?? asset.id]
        );
      }
      if (registry.attributionRequired && !asset.attributionText) {
        add(
          "attribution_required_missing",
          "blocker",
          "media_rights",
          `${name} is from a source that requires attribution, and no attribution text is recorded. An unmet licence condition is an unlicensed use.`,
          [asset.sourceUrl ?? asset.id]
        );
      }
      if (registry.editorialUseOnly) {
        add(
          "media_editorial_use_only",
          "caution",
          "media_rights",
          `${name} is editorial-use-only. Confirm this piece is editorial and that the restriction is recorded with the asset.`,
          [asset.sourceUrl ?? asset.id]
        );
      }
    }

    if (asset.licence) {
      if (requiresAttribution(asset.licence) && !asset.attributionText) {
        add(
          "licence_attribution_missing",
          "blocker",
          "media_rights",
          `${name} is licensed "${asset.licence}", which requires attribution, and none is recorded.`,
          [asset.sourceUrl ?? asset.id]
        );
      }
      if (licenceUrl(asset.licence) === null && requiresAttribution(asset.licence)) {
        add(
          "unrecognised_licence",
          "serious",
          "media_rights",
          `${name} records a licence ("${asset.licence}") whose exact terms this system does not know, so the conditions being relied on cannot be stated or linked. Verify it by hand.`,
          [asset.sourceUrl ?? asset.id]
        );
      }
    }

    // Manufacturer imagery is the recurring trap: a press kit exists to be
    // used, which is not the same as being licensed to us.
    if ((asset.sourceType === "manufacturer" || asset.sourceType === "press_kit") && asset.rightsStatus !== "verified") {
      add(
        "manufacturer_imagery_unverified",
        "serious",
        "media_rights",
        `${name} is manufacturer/press-kit imagery with rights status "${asset.rightsStatus ?? "unknown"}". A press kit being downloadable is not a licence.`,
        [asset.sourceUrl ?? asset.id]
      );
    }
  }

  // --- 7. The seven-day question ---

  const sevenDay = assessSevenDayQuestion({
    now: input.now,
    claims,
    coverage,
    findings,
    freshnessSensitivity: input.freshnessSensitivity,
    confidence,
    reconciliations,
  });

  if (!sevenDay.wouldPublishUnattended) {
    add(
      "fails_seven_day_test",
      sevenDay.irreversibleRisks.length ? "blocker" : "serious",
      "unattended_risk",
      sevenDay.explanation,
      [...sevenDay.irreversibleRisks, ...sevenDay.compoundingRisks]
    );
  }

  // --- Verdict ---

  findings.sort(
    (a, b) => SEVERITY_ORDER[b.severity] - SEVERITY_ORDER[a.severity] || a.code.localeCompare(b.code)
  );

  const severityCounts = countSeverities(findings);
  const blockers = findings.filter((f) => f.severity === "blocker");

  const verdict: ReviewVerdict = severityCounts.blocker
    ? "reject"
    : severityCounts.serious
      ? "hold_for_human"
      : severityCounts.caution
        ? "revise"
        : "no_objection";

  // The generator's opinion is read HERE and nowhere else — after every finding
  // has already been produced.
  const generatorClaim = input.generator ?? null;
  const generatorOptimistic =
    !!generatorClaim?.verdict && GENERATOR_OPTIMISTIC.test(generatorClaim.verdict.trim());
  const disagreesWithGenerator = generatorOptimistic && verdict !== "no_objection";

  return {
    findings,
    blockers,
    severityCounts,
    verdict,
    coverage,
    confidence,
    reconciliations,
    sourceClassifications: classifications,
    sevenDay,
    generatorClaim,
    disagreesWithGenerator,
    explanation:
      `${verdictSentence(verdict)} ` +
      `${severityCounts.blocker} blocking, ${severityCounts.serious} serious, ${severityCounts.caution} caution, ${severityCounts.note} note. ` +
      `${sevenDay.explanation}` +
      (disagreesWithGenerator
        ? ` The generating stage reported "${generatorClaim?.verdict}"; this review reached a different conclusion from the evidence records alone.`
        : ""),
  };
}

function verdictSentence(verdict: ReviewVerdict): string {
  switch (verdict) {
    case "reject":
      return "REJECT — at least one finding must be resolved before this can be considered.";
    case "hold_for_human":
      return "HOLD — nothing is outright disqualifying, but a person has to make a judgement here.";
    case "revise":
      return "REVISE — minor problems worth fixing before publication.";
    case "no_objection":
      return "NO OBJECTION — this critic found nothing. That is not approval; the publication gate still decides.";
  }
}

function matchesOf(text: string, pattern: RegExp): string[] {
  const global = new RegExp(pattern.source, pattern.flags.includes("g") ? pattern.flags : pattern.flags + "g");
  return [...new Set([...text.matchAll(global)].map((m) => m[0].trim()))].slice(0, 5);
}

function hostOf(url: string | null | undefined): string | null {
  if (!url) return null;
  try {
    return new URL(url).hostname.replace(/^www\./, "").toLowerCase();
  } catch {
    return null;
  }
}
