// Claim-level evidence coverage.
//
// WHY CLAIM LEVEL
// ---------------
// Everything upstream of this reasons about an ARTICLE: this discovery has a
// confidence of 0.62, this brief has four sources. That is the wrong unit. An
// article with four excellent sources can still contain one sentence with a
// price nobody published, and the article-level number will not move at all.
// A single fabricated figure is the whole failure; averaging it against nine
// correct sentences hides it.
//
// So coverage is computed per claim, and a claim is either covered or it is
// not. There is no partial credit that lets a well-sourced article carry an
// unsourced price.
//
// THE VERBATIM TEST
// -----------------
// The strongest check here is also the dumbest one: a number that appears in a
// claim must appear in a source excerpt. £1,799 is either in the evidence or it
// is not. This cannot be argued with, cannot be reasoned around, and catches
// the exact failure mode a generative system has — producing a figure that is
// the right SHAPE for the sentence. A currency conversion the writer did
// themselves fails this test, and should: "$1,999" is not evidence for
// "£1,799".
//
// HIGH-RISK CLAIM TYPES
// ---------------------
// Prices, release dates, specifications, compatibility and legal/regulatory
// requirements each demand a stronger and fresher standard than a general
// statement, because they are the claims a reader spends money or takes an
// irreversible action on. Those standards are declared once, in CLAIM_STANDARD,
// with the reason attached.
//
// Deterministic. No AI provider, no network, no cost.

import type { ClaimStatus, TrustLevel, EngineSourceType } from "./types.ts";
import {
  classifySource,
  isAuthoritativeFor,
  type ClaimDomain,
  type SourceClass,
  type SourceClassification,
} from "./source-quality.ts";

// ---------------------------------------------------------------------------
// Claim types
// ---------------------------------------------------------------------------

export type ClaimType =
  | "price"
  | "release_date"
  | "availability"
  | "specification"
  | "compatibility"
  | "benchmark"
  | "legal_regulatory"
  | "safety_recall"
  | "general";

export type ClaimStandard = {
  /**
   * The authority a supporting source must actually hold, expressed as a claim
   * domain rather than as a source class.
   *
   * "Must be a primary source" is the wrong test and gets this backwards in
   * both directions. Canon's own newsroom is the best possible authority for
   * Canon's own RRP and classifies as `vendor_press_release`; a standards body
   * classifies as `primary` and is no authority at all on how fast a graphics
   * card renders. So the requirement names the domain, and source-quality.ts
   * decides which classes hold it.
   *
   * Null means no particular authority is required beyond having a source.
   */
  requiredAuthority: ClaimDomain | null;
  /** At least two independent sources must support it. */
  requiresIndependentCorroboration: boolean;
  /** Evidence older than this is too stale to carry the claim. Null = no limit. */
  maxEvidenceAgeDays: number | null;
  /** The weakest claim_status any supporting row may have. */
  minClaimStatus: ClaimStatus;
  /** Classes that may never be the *only* support for this type. */
  insufficientAlone: readonly SourceClass[];
  reason: string;
};

const CLAIM_RANK: Record<ClaimStatus, number> = {
  rumour: 0,
  unverified: 1,
  leak: 2,
  estimate: 3,
  reported_secondary: 4,
  confirmed_primary: 5,
};

export const CLAIM_STANDARD: Record<ClaimType, ClaimStandard> = {
  price: {
    requiredAuthority: "vendor_own_price",
    requiresIndependentCorroboration: false,
    maxEvidenceAgeDays: 14,
    minClaimStatus: "confirmed_primary",
    insufficientAlone: ["social_forum", "unclassified"],
    reason: "A reader budgets against a price. A stale or second-hand figure costs them money.",
  },
  release_date: {
    requiredAuthority: "vendor_own_release_date",
    requiresIndependentCorroboration: false,
    maxEvidenceAgeDays: 30,
    minClaimStatus: "confirmed_primary",
    insufficientAlone: ["social_forum", "unclassified"],
    reason: "Dates slip constantly and a leaked date is not a date. Only the party shipping the thing can state it.",
  },
  availability: {
    // Shipping/stock is the same authority as a ship date: the party doing the
    // shipping. There is no separate availability domain.
    requiredAuthority: "vendor_own_release_date",
    requiresIndependentCorroboration: false,
    maxEvidenceAgeDays: 7,
    minClaimStatus: "confirmed_primary",
    insufficientAlone: ["social_forum", "unclassified"],
    reason: "Stock status is the most perishable claim on the site; a week-old check is already wrong.",
  },
  specification: {
    requiredAuthority: "vendor_own_specification",
    requiresIndependentCorroboration: false,
    maxEvidenceAgeDays: 180,
    minClaimStatus: "confirmed_primary",
    insufficientAlone: ["social_forum", "unclassified"],
    reason: "Specifications end up in the product spec table and are then repeated everywhere. A wrong one propagates.",
  },
  compatibility: {
    // Deliberately NOT vendor_own_*: a vendor saying its accessory works with
    // something is marketing until somebody independent plugs the two together.
    requiredAuthority: "third_party_compatibility",
    requiresIndependentCorroboration: true,
    maxEvidenceAgeDays: 365,
    minClaimStatus: "confirmed_primary",
    insufficientAlone: ["social_forum", "unclassified"],
    reason: "A reader buys hardware on a compatibility claim. Getting it wrong means a returned purchase, or a non-returnable one.",
  },
  benchmark: {
    // Only independent measurement carries a performance number. A vendor's
    // own benchmark is a claim about a vendor.
    requiredAuthority: "independent_performance",
    requiresIndependentCorroboration: true,
    maxEvidenceAgeDays: 365,
    minClaimStatus: "reported_secondary",
    insufficientAlone: ["social_forum", "unclassified", "vendor_press_release"],
    reason: "A performance number is only meaningful if somebody independent measured it. A vendor benchmark is a claim about a vendor.",
  },
  legal_regulatory: {
    requiredAuthority: "legal_regulatory",
    requiresIndependentCorroboration: false,
    maxEvidenceAgeDays: 365,
    minClaimStatus: "confirmed_primary",
    insufficientAlone: ["social_forum", "unclassified", "vendor_press_release", "independent_high_quality"],
    reason: "Telling a reader what the law or a regulation requires is only defensible from the regulator or the text itself.",
  },
  safety_recall: {
    // A recall is a regulatory instrument. The official notice — regulator or
    // the manufacturer's own documentation — is the only acceptable source; a
    // newsroom post about it is not the notice.
    requiredAuthority: "legal_regulatory",
    requiresIndependentCorroboration: false,
    maxEvidenceAgeDays: 90,
    minClaimStatus: "confirmed_primary",
    insufficientAlone: ["social_forum", "unclassified"],
    reason: "Both directions are harmful: a missed real recall, and a fabricated one that sends readers to a service centre.",
  },
  general: {
    requiredAuthority: null,
    requiresIndependentCorroboration: false,
    maxEvidenceAgeDays: null,
    minClaimStatus: "reported_secondary",
    insufficientAlone: ["social_forum", "unclassified"],
    reason: "General statements still need a source, but do not carry an action a reader takes.",
  },
};

export const HIGH_RISK_CLAIM_TYPES: readonly ClaimType[] = [
  "price",
  "release_date",
  "availability",
  "specification",
  "compatibility",
  "benchmark",
  "legal_regulatory",
  "safety_recall",
];

export function isHighRisk(type: ClaimType): boolean {
  return HIGH_RISK_CLAIM_TYPES.includes(type);
}

// Checked in risk order — a sentence carrying both a price and a spec is
// judged by the more dangerous of the two.
const TYPE_PATTERNS: { type: ClaimType; pattern: RegExp }[] = [
  {
    type: "safety_recall",
    pattern: /\brecall(ed|s|ing)?\b|\bsafety (notice|advisory|warning)\b|\bfire (hazard|risk)\b|\bcve-\d{4}|\bsecurity (advisory|vulnerability|patch)\b|\bstop using\b/i,
  },
  {
    type: "legal_regulatory",
    pattern: /\b(gdpr|ukca|ce mark(ing)?|fcc|rohs|weee|ofcom|regulation|directive|statutory|legally (required|obliged)|must comply|consumer rights act|warranty period|by law)\b/i,
  },
  {
    type: "price",
    pattern: /[£$€]\s?\d|\b\d+\s?(gbp|usd|eur)\b|\b(price[sd]?|pricing|msrp|rrp|costs?|retails? (at|for)|free of charge)\b/i,
  },
  {
    type: "availability",
    pattern: /\b(in stock|out of stock|sold out|back ?order|pre-?order|available (now|today|immediately)|shipping now|on shelves)\b/i,
  },
  {
    type: "release_date",
    pattern: /\b(release date|launch date|on sale (on|from)|ships? (on|from)|arrives? (on|in)|available from)\b|\b\d{4}-\d{2}-\d{2}\b|\b\d{1,2}(st|nd|rd|th)?\s+(january|february|march|april|may|june|july|august|september|october|november|december)\b|\b(january|february|march|april|may|june|july|august|september|october|november|december)\s+\d{1,2}\b/i,
  },
  {
    type: "benchmark",
    pattern: /\bbenchmark(s|ed|ing)?\b|\b\d+(\.\d+)?%\s*(faster|slower|quicker|better|higher|lower|more efficient)\b|\b(we|our) (tested|testing|tests|benchmarks?|measured|measurements)\b|\bin (our|independent) (testing|tests|lab)\b|\b(3dmark|cinebench|geekbench|time spy)\b/i,
  },
  {
    type: "compatibility",
    pattern: /\bcompatib(le|ility)\b|\bworks? with\b|\bsupports?\b|\brequires?\b|\bbackwards?[- ]compatible\b|\bfits\b|\bdrop-?in replacement\b/i,
  },
  {
    type: "specification",
    pattern: /\b\d+(\.\d+)?\s?(mp|megapixels?|[gtm]b|[mg]hz|hz|fps|mm|cm|nm|kwh?|wh|w|mah|kg|lbs?|inch(es)?|bit|nits|ms|rpm|cores?|threads?|lanes?)\b|\bspec(ification)?s?\b|\bsensor\b|\bresolution\b|\bbattery (life|capacity)\b/i,
  },
];

/** The riskiest claim type a sentence matches. Never guesses beyond the text. */
export function classifyClaimType(text: string): ClaimType {
  for (const { type, pattern } of TYPE_PATTERNS) {
    if (pattern.test(text)) return type;
  }
  return "general";
}

// ---------------------------------------------------------------------------
// Verbatim value attestation
// ---------------------------------------------------------------------------

const MONTHS: Record<string, string> = {
  jan: "01", january: "01", feb: "02", february: "02", mar: "03", march: "03",
  apr: "04", april: "04", may: "05", jun: "06", june: "06", jul: "07", july: "07",
  aug: "08", august: "08", sep: "09", sept: "09", september: "09", oct: "10",
  october: "10", nov: "11", november: "11", dec: "12", december: "12",
};

const MONTH_ALT = Object.keys(MONTHS).sort((a, b) => b.length - a.length).join("|");

/**
 * Canonical text for comparison: thousands separators removed, "24 GB" joined
 * to "24GB", whitespace collapsed. Applied identically to claim and excerpt so
 * the comparison is like-for-like.
 */
function canonicalise(text: string): string {
  return text
    .toLowerCase()
    .replace(/[–—]/g, "-")
    .replace(/[   ]/g, " ")
    .replace(/(\d),(?=\d{3}\b)/g, "$1")
    .replace(/\s+/g, " ")
    .replace(/(\d)\s+(?=[a-z%])/g, "$1")
    .trim();
}

/** ISO form for the date spellings that actually appear in feeds, or null. */
export function normaliseDate(text: string): string | null {
  const iso = text.match(/\b(\d{4})-(\d{2})-(\d{2})\b/);
  if (iso) return `${iso[1]}-${iso[2]}-${iso[3]}`;

  const dmy = text.match(new RegExp(`\\b(\\d{1,2})(?:st|nd|rd|th)?\\s+(${MONTH_ALT})\\.?\\s+(\\d{4})\\b`, "i"));
  if (dmy) return `${dmy[3]}-${MONTHS[dmy[2].toLowerCase()]}-${dmy[1].padStart(2, "0")}`;

  const mdy = text.match(new RegExp(`\\b(${MONTH_ALT})\\.?\\s+(\\d{1,2})(?:st|nd|rd|th)?,?\\s+(\\d{4})\\b`, "i"));
  if (mdy) return `${mdy[3]}-${MONTHS[mdy[1].toLowerCase()]}-${mdy[2].padStart(2, "0")}`;

  // 12/09/2026 is deliberately NOT parsed. It is genuinely ambiguous between
  // British and American ordering, and guessing is exactly the behaviour this
  // module exists to prevent.
  return null;
}

/** Every ISO-normalised date mentioned anywhere in a passage. */
function allDates(text: string): string[] {
  const found: string[] = [];
  const patterns = [
    /\b\d{4}-\d{2}-\d{2}\b/g,
    new RegExp(`\\b\\d{1,2}(?:st|nd|rd|th)?\\s+(?:${MONTH_ALT})\\.?\\s+\\d{4}\\b`, "gi"),
    new RegExp(`\\b(?:${MONTH_ALT})\\.?\\s+\\d{1,2}(?:st|nd|rd|th)?,?\\s+\\d{4}\\b`, "gi"),
  ];
  for (const p of patterns) {
    for (const m of text.matchAll(p)) {
      const iso = normaliseDate(m[0]);
      if (iso) found.push(iso);
    }
  }
  return [...new Set(found)];
}

export type ExtractedValue = {
  /** As written in the claim. */
  raw: string;
  /** Canonical form used for matching. */
  canonical: string;
  kind: "money" | "percent" | "measurement" | "date";
};

const MONEY = /[£$€]\s?\d[\d,]*(?:\.\d+)?(?:\s?(?:k|m|bn|billion|million))?/gi;
const PERCENT = /\b\d+(?:\.\d+)?\s?%/g;
const MEASUREMENT =
  /\b\d+(?:\.\d+)?\s?(?:mp|megapixels?|[gtm]b|[mg]hz|hz|fps|mm|cm|nm|kwh|wh|kw|w|mah|kg|lbs?|inches|inch|bit|nits|ms|rpm|cores?|threads?|lanes?)\b/gi;

/**
 * The checkable figures inside a claim. Deliberately narrow: money, percentages,
 * measurements and dates are the values a generative system invents most
 * readily and the only ones that can be mechanically matched against a source.
 */
export function extractClaimValues(text: string): ExtractedValue[] {
  const out: ExtractedValue[] = [];
  const seen = new Set<string>();
  const push = (raw: string, kind: ExtractedValue["kind"], canonical: string) => {
    const key = `${kind}:${canonical}`;
    if (canonical && !seen.has(key)) {
      seen.add(key);
      out.push({ raw: raw.trim(), canonical, kind });
    }
  };

  for (const m of text.matchAll(MONEY)) push(m[0], "money", canonicalise(m[0]));
  for (const m of text.matchAll(PERCENT)) push(m[0], "percent", canonicalise(m[0]));
  for (const m of text.matchAll(MEASUREMENT)) push(m[0], "measurement", canonicalise(m[0]));
  for (const d of allDates(text)) push(d, "date", d);

  return out;
}

function escapeRegExp(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/** Whether a single extracted value literally appears in one of the excerpts. */
export function isValueAttested(value: ExtractedValue, excerpts: (string | null | undefined)[]): boolean {
  const texts = excerpts.filter((e): e is string => typeof e === "string" && e.length > 0);
  if (!texts.length) return false;

  if (value.kind === "date") {
    return texts.some((t) => allDates(t).includes(value.canonical));
  }

  // Boundaries stop "24GB" matching inside "1024GB", and stop "£1799" being
  // satisfied by "£1799.99" — a near miss is not an attestation.
  const pattern = new RegExp(`(?<![0-9a-z])${escapeRegExp(value.canonical)}(?![0-9a-z]|\\.\\d)`, "i");
  return texts.some((t) => pattern.test(canonicalise(t)));
}

// ---------------------------------------------------------------------------
// Coverage assessment
// ---------------------------------------------------------------------------

export type EvidenceRecord = {
  id: string;
  url: string;
  publisher?: string | null;
  organisation?: string | null;
  excerpt?: string | null;
  claimStatus: ClaimStatus;
  trustLevel: TrustLevel;
  originatesFromUrl?: string | null;
  /** ISO timestamp. Missing is treated as unknown age, which fails a freshness standard. */
  retrievedAt?: string | null;
  sourceType?: EngineSourceType | null;
  /** Claim ids this row was recorded as supporting. */
  supports?: string[];
};

export type Claim = {
  id: string;
  text: string;
  /** Inferred from the text when omitted. */
  type?: ClaimType;
  /** Evidence rows the author says back this claim. */
  evidenceIds?: string[];
  /** Publisher the body attributes the claim to, if any. */
  attributedTo?: string | null;
  /** True when written in TechCarvalho's own voice rather than as an attributed claim. */
  statedAsFact?: boolean;
  /** True when the claim carries an explicit as-of date in the text. */
  timeAnchored?: boolean;
};

export type ClaimFailureCode =
  | "no_evidence"
  | "value_not_attested"
  | "insufficient_claim_status"
  | "no_authoritative_source"
  | "no_independent_corroboration"
  | "stale_evidence"
  | "evidence_age_unknown"
  | "derivative_only"
  | "insufficient_source_class";

export type ClaimFailure = { code: ClaimFailureCode; message: string };

export type ClaimAssessment = {
  claimId: string;
  text: string;
  type: ClaimType;
  highRisk: boolean;
  standard: ClaimStandard;
  supportingEvidenceIds: string[];
  independentSupportCount: number;
  sourceClasses: SourceClass[];
  bestClaimStatus: ClaimStatus | null;
  /** Days since the freshest supporting evidence was retrieved; null when unknown. */
  freshestEvidenceAgeDays: number | null;
  /** Figures in the claim that appear in no supporting excerpt. */
  unattestedValues: ExtractedValue[];
  /** Fraction of this claim's own standard that is met, 0..1. Reporting only. */
  coverage: number;
  supported: boolean;
  failures: ClaimFailure[];
  explanation: string;
};

export type CoverageReport = {
  claims: ClaimAssessment[];
  claimCount: number;
  supportedCount: number;
  /** Supported claims / total claims. 1 with zero claims is NOT reported — see below. */
  coverageRatio: number;
  unsupportedClaims: ClaimAssessment[];
  highRiskUnsupported: ClaimAssessment[];
  /** Figures anywhere in the piece that appear in no source. */
  fabricatedValueCount: number;
  explanation: string;
};

function daysBetween(laterIso: string, earlierIso: string | null | undefined): number | null {
  if (!earlierIso) return null;
  const later = Date.parse(laterIso);
  const earlier = Date.parse(earlierIso);
  if (Number.isNaN(later) || Number.isNaN(earlier)) return null;
  return (later - earlier) / 86_400_000;
}

export function assessClaimCoverage(input: {
  claims: Claim[];
  evidence: EvidenceRecord[];
  /** ISO timestamp used as "now". Explicit so results are reproducible in tests. */
  now: string;
}): CoverageReport {
  const { claims, evidence, now } = input;

  const byId = new Map(evidence.map((e) => [e.id, e]));
  const classifications = new Map<string, SourceClassification>(
    evidence.map((e) => [
      e.id,
      classifySource({
        url: e.url,
        publisher: e.publisher,
        organisation: e.organisation,
        sourceType: e.sourceType,
        trustLevel: e.trustLevel,
        originatesFromUrl: e.originatesFromUrl,
      }),
    ])
  );

  const assessments = claims.map((claim) => {
    const type = claim.type ?? classifyClaimType(claim.text);
    const standard = CLAIM_STANDARD[type];
    const highRisk = isHighRisk(type);

    // Support is EXPLICIT. An evidence row that happens to be in the same
    // article does not support a claim; somebody has to have linked it. This is
    // the difference between "we have four sources" and "this sentence has a
    // source".
    const linkedIds = [
      ...new Set([
        ...(claim.evidenceIds ?? []),
        ...evidence.filter((e) => e.supports?.includes(claim.id)).map((e) => e.id),
      ]),
    ]
      .filter((id) => byId.has(id))
      .sort();

    const linked = linkedIds.map((id) => byId.get(id)!);
    const linkedClasses = linkedIds.map((id) => classifications.get(id)!);
    const independent = linked.filter((e) => !e.originatesFromUrl);
    const failures: ClaimFailure[] = [];

    const values = extractClaimValues(claim.text);
    const excerpts = linked.map((e) => e.excerpt);
    const unattestedValues = values.filter((v) => !isValueAttested(v, excerpts));

    if (linked.length === 0) {
      failures.push({
        code: "no_evidence",
        message: `No evidence record is linked to this claim. Unknown must stay unknown: omit the claim, or attach the source it came from.`,
      });
    }

    if (unattestedValues.length > 0) {
      failures.push({
        code: "value_not_attested",
        message:
          `${unattestedValues.map((v) => `"${v.raw}"`).join(", ")} ` +
          `${unattestedValues.length === 1 ? "does" : "do"} not appear in any linked source excerpt. ` +
          `A figure that is not in the evidence was produced somewhere else.`,
      });
    }

    const bestClaimStatus =
      linked.length === 0
        ? null
        : linked.reduce<ClaimStatus>(
            (best, e) => (CLAIM_RANK[e.claimStatus] > CLAIM_RANK[best] ? e.claimStatus : best),
            "rumour"
          );

    if (bestClaimStatus && CLAIM_RANK[bestClaimStatus] < CLAIM_RANK[standard.minClaimStatus]) {
      failures.push({
        code: "insufficient_claim_status",
        message: `Best supporting evidence is "${bestClaimStatus}"; a ${type} claim needs at least "${standard.minClaimStatus}". ${standard.reason}`,
      });
    }

    const hasAuthority =
      standard.requiredAuthority === null ||
      linkedClasses.some((c) => c.independent && isAuthoritativeFor(c.sourceClass, standard.requiredAuthority!));
    if (!hasAuthority) {
      failures.push({
        code: "no_authoritative_source",
        message:
          `No independent source linked to this claim holds authority for ${standard.requiredAuthority}` +
          (linkedClasses.length ? ` (linked: ${[...new Set(linkedClasses.map((c) => c.sourceClass))].join(", ")})` : "") +
          `. ${standard.reason}`,
      });
    }

    if (standard.requiresIndependentCorroboration && independent.length < 2) {
      failures.push({
        code: "no_independent_corroboration",
        message: `A ${type} claim needs two independent sources; ${independent.length} linked. ${standard.reason}`,
      });
    }

    if (linked.length > 0 && independent.length === 0) {
      failures.push({
        code: "derivative_only",
        message: `Every linked source repeats another source's claim. That is one claim reported several times, not corroboration.`,
      });
    }

    const distinctClasses = [...new Set(linkedClasses.map((c) => c.sourceClass))];
    if (
      linked.length > 0 &&
      distinctClasses.length > 0 &&
      distinctClasses.every((c) => standard.insufficientAlone.includes(c))
    ) {
      failures.push({
        code: "insufficient_source_class",
        message: `Supported only by ${distinctClasses.join(", ")}, which cannot carry a ${type} claim on its own. ${standard.reason}`,
      });
    }

    const ages = linked.map((e) => daysBetween(now, e.retrievedAt));
    const known = ages.filter((a): a is number => a !== null);
    const freshestEvidenceAgeDays = known.length ? Math.min(...known) : null;

    if (standard.maxEvidenceAgeDays !== null && linked.length > 0) {
      if (freshestEvidenceAgeDays === null) {
        failures.push({
          code: "evidence_age_unknown",
          message: `No retrieval timestamp on any supporting source, so this ${type} claim cannot be shown to be current (limit ${standard.maxEvidenceAgeDays} days).`,
        });
      } else if (freshestEvidenceAgeDays > standard.maxEvidenceAgeDays) {
        failures.push({
          code: "stale_evidence",
          message: `Freshest supporting source is ${Math.round(freshestEvidenceAgeDays)} days old; a ${type} claim needs evidence no older than ${standard.maxEvidenceAgeDays} days. ${standard.reason}`,
        });
      }
    }

    // Reporting-only score. It exists so a dashboard can show "how far off is
    // this", never so a high average can carry an unsupported claim — the
    // `supported` flag is what anything downstream is supposed to read.
    const checks = 4;
    const met =
      (linked.length > 0 ? 1 : 0) +
      (unattestedValues.length === 0 ? 1 : 0) +
      (hasAuthority ? 1 : 0) +
      (standard.maxEvidenceAgeDays === null ||
      (freshestEvidenceAgeDays !== null && freshestEvidenceAgeDays <= standard.maxEvidenceAgeDays)
        ? 1
        : 0);

    const supported = failures.length === 0;

    return {
      claimId: claim.id,
      text: claim.text,
      type,
      highRisk,
      standard,
      supportingEvidenceIds: linkedIds,
      independentSupportCount: independent.length,
      sourceClasses: distinctClasses,
      bestClaimStatus,
      freshestEvidenceAgeDays,
      unattestedValues,
      coverage: Number((met / checks).toFixed(2)),
      supported,
      failures,
      explanation: supported
        ? `Covered: ${linkedIds.length} linked source(s), every figure attested, ${type} standard met.`
        : failures.map((f) => f.message).join(" "),
    } satisfies ClaimAssessment;
  });

  const unsupportedClaims = assessments.filter((a) => !a.supported);
  const highRiskUnsupported = unsupportedClaims.filter((a) => a.highRisk);
  const supportedCount = assessments.length - unsupportedClaims.length;

  return {
    claims: assessments,
    claimCount: assessments.length,
    supportedCount,
    // Zero claims is zero coverage, not perfect coverage. A piece nobody has
    // broken into claims has not been checked; saying 1.0 would be the same
    // "empty looks like success" failure the 2026-08 incident turned on.
    coverageRatio: assessments.length === 0 ? 0 : Number((supportedCount / assessments.length).toFixed(3)),
    unsupportedClaims,
    highRiskUnsupported,
    fabricatedValueCount: assessments.reduce((n, a) => n + a.unattestedValues.length, 0),
    explanation:
      assessments.length === 0
        ? "No claims were submitted for checking. That is not a clean result — nothing has been verified."
        : `${supportedCount}/${assessments.length} claims covered. ` +
          (highRiskUnsupported.length
            ? `${highRiskUnsupported.length} unsupported high-risk claim(s): ${highRiskUnsupported.map((c) => c.type).join(", ")}.`
            : unsupportedClaims.length
              ? `${unsupportedClaims.length} unsupported claim(s), none high-risk.`
              : "No unsupported claims."),
  };
}
