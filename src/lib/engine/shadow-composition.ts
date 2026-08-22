// Evaluation-set composition — the anti-gaming half of shadow evaluation.
//
// WHY THIS MODULE EXISTS
// ----------------------
// READINESS.minShadowDecisions is 500. A count is the easiest number in this
// system to inflate: point the pipeline at one vendor's RSS feed, run it
// nightly for a fortnight, and 500 arrives without the engine ever having been
// asked a hard question. The number would be true and the conclusion drawn from
// it would be false.
//
// So 500 is treated here as an EVIDENCE REQUIREMENT, not a target. Three
// separate mechanisms stand between a decision being made and it counting:
//
//  1. IDENTITY DEDUPLICATION. A decision is keyed by candidate identity
//     (`shadowCandidateIdentity`), which is derived from what the candidate IS,
//     not from when it was evaluated. Re-running the pipeline over the same
//     discoveries produces the same identities, and the database's unique
//     constraint refuses the second write. Running the tick a thousand times
//     tonight accumulates no credit at all.
//
//  2. FAMILY CAPPING. Ten press releases from one newsroom in one week are one
//     editorial question asked ten times. Near-duplicate candidates from the
//     same publisher are clustered into a family and only the first
//     MAX_CREDIT_PER_FAMILY of them can be credited; the rest are recorded in
//     full and marked `suppressed_family_cap`.
//
//  3. COVERAGE FLOORS. Fifteen dimensions of editorial difficulty are named
//     below. Each needs MIN_DECISIONS_PER_DIMENSION credited decisions before
//     the set counts as covering it. 500 decisions that are all
//     news-sensitive product launches leave thirteen dimensions at zero, and
//     that is visible rather than hidden inside the total.
//
// Plus one shape check: EARLY-TERMINATION SHARE. A candidate rejected at the
// relevance stage is a legitimate decision, and a cheap one. If most of the set
// is cheap, the expensive stages — evidence, media rights, adversarial review,
// the gate — have not actually been exercised, whatever the total says.
//
// Nothing here can raise a number. Every mechanism can only refuse credit.
//
// Deterministic and pure. No I/O, no clock, no `server-only`.

import { titleSimilarity, NEAR_DUPLICATE_THRESHOLD } from "./dedupe.ts";

// ---------------------------------------------------------------------------
// The coverage dimensions
// ---------------------------------------------------------------------------

/**
 * The kinds of editorial difficulty an autonomous publisher must be shown to
 * handle before anyone can reasonably say it is ready.
 *
 * These are not content categories. Each one names a distinct way the decision
 * can go wrong, and a set missing one of them has simply never tested that
 * failure mode. A dimension is not exclusive — one candidate commonly exercises
 * several, and that is the point: a candidate that exercises five hard
 * dimensions is worth more evidence than five that each exercise one easy one.
 */
export const SHADOW_DIMENSIONS = [
  /** Perishable: correct today, wrong next week, and read most in the first days. */
  "news_sensitive",
  /** Expected to stay true for years — where staleness is the silent failure. */
  "evergreen",
  /** A product record rather than an article: specs, identity, relationships. */
  "products",
  /** "X vs Y" — where the failure is a fabricated difference between two things. */
  "comparisons",
  /** "It does not work" — where a wrong answer costs the reader money or a device. */
  "troubleshooting",
  /** "Should I buy" — commercial intent, where incentive and honesty pull apart. */
  "buying_questions",
  /** "Does A work with B", "what are the specs" — checkable, and dangerous to guess. */
  "compatibility_specification",
  /** Law, regulation, standards compliance, recalls — where being wrong has legal weight. */
  "regulatory_legal",
  /** Prices and availability — the fastest-decaying facts on the site. */
  "price_availability_sensitive",
  /** The entity resolver could not confidently tell two records apart. */
  "difficult_entity_resolution",
  /** Cleared, publishable media genuinely exists for this. */
  "media_rich",
  /** No image can lawfully be published for this, no matter how good the text is. */
  "media_impossible",
  /** Sources contradict each other and something has to reconcile them. */
  "source_disagreement",
  /** One source, or one organisation wearing several mastheads. */
  "sparse_source",
  /** The underlying facts are still moving while the decision is being made. */
  "rapidly_changing",
] as const;

export type ShadowDimension = (typeof SHADOW_DIMENSIONS)[number];

/** Why each dimension is on the list, so the set is arguable rather than arbitrary. */
export const DIMENSION_RATIONALE: Record<ShadowDimension, string> = {
  news_sensitive:
    "Perishable claims take their readership in the first days, so an error is maximally read while least verified.",
  evergreen:
    "Nothing forces a re-check, so a wrong evergreen page stays wrong for years without anything raising an alarm.",
  products:
    "Product records carry identity, specifications and relationships; the failure mode is a duplicate or a mislabelled successor rather than a bad sentence.",
  comparisons:
    "A comparison asserts a difference between two things. Inventing that difference is easy and reads as authoritative.",
  troubleshooting:
    "A reader acts on troubleshooting advice immediately, often destructively. A correction a week later reaches nobody.",
  buying_questions:
    "Commercial intent is where editorial honesty and revenue pull in different directions, so it needs the most evidence, not the least.",
  compatibility_specification:
    "These are precisely checkable, which means a fabricated one is precisely wrong and provably so.",
  regulatory_legal:
    "Being wrong here exposes the publication legally and can mislead someone into non-compliance.",
  price_availability_sensitive:
    "The fastest-decaying facts on the site, and the ones a reader is most likely to act on with a card in hand.",
  difficult_entity_resolution:
    "Ambiguous identity is the root cause of duplicate records and of a successor being described as its predecessor.",
  media_rich:
    "Proves the media path clears genuinely usable assets rather than clearing nothing and calling it caution.",
  media_impossible:
    "Proves the media path refuses when no lawful image exists, rather than reaching for the manufacturer's press kit.",
  source_disagreement:
    "Reconciliation is the check that stops the engine picking a number by accident and standing behind it.",
  sparse_source:
    "A single source is the common real-world case; the failure is treating repetition as corroboration.",
  rapidly_changing:
    "Tests whether the engine notices that the ground moved between research and decision.",
};

// ---------------------------------------------------------------------------
// Thresholds
// ---------------------------------------------------------------------------

/**
 * Credited decisions needed per dimension.
 *
 * 15 dimensions x 15 = 225, comfortably under the 500 total, so the floors
 * shape the set without dictating it. Fifteen is chosen so that a 1-in-15
 * failure mode within a dimension has a real chance of being seen at all —
 * below about ten, a clean dimension is indistinguishable from an untested one.
 */
export const MIN_DECISIONS_PER_DIMENSION = 15;

/**
 * How many credited decisions one near-duplicate family may contribute.
 *
 * Five, not one: a vendor publishing five genuinely different announcements is
 * five real decisions, and collapsing them to one would under-count honest
 * work. Above five the marginal decision is repetition — the engine has already
 * demonstrated whatever it demonstrates about that publisher and that story
 * shape.
 */
export const MAX_CREDIT_PER_FAMILY = 5;

/**
 * The largest share of the credited set one family may occupy.
 *
 * A second, proportional guard behind MAX_CREDIT_PER_FAMILY: on a small set,
 * five from one family is most of the evidence.
 */
export const MAX_FAMILY_SHARE = 0.1;

/**
 * The largest share of credited decisions that may terminate before the
 * publication gate.
 *
 * Early fail-closed decisions are real decisions and count. But a set that is
 * three-quarters relevance rejections has never run the evidence checker, the
 * media rights checker, the adversarial reviewer or the gate, so it is not
 * evidence about them. Half is the point at which the expensive stages stop
 * being a minority of the record.
 */
export const MAX_EARLY_TERMINATION_SHARE = 0.5;

// ---------------------------------------------------------------------------
// Candidate identity
// ---------------------------------------------------------------------------

/**
 * A stable identity for a candidate, derived from WHAT IT IS.
 *
 * Deliberately excludes the run time, the pipeline version and any counter.
 * Re-running the pipeline over the same discovery next week must produce a byte
 * identical string, so the store's unique constraint refuses it and no credit
 * accrues. Including a version would create a legitimate-looking way to reset
 * the deduplication and re-bank the same 500 decisions.
 */
export function shadowCandidateIdentity(input: {
  kind: "discovery" | "content" | "product";
  /** The engine's own dedupe key where one exists; otherwise the record id. */
  key: string;
}): string {
  const key = input.key.trim().toLowerCase().replace(/\s+/g, " ");
  return `${input.kind}:${key}`.slice(0, 400);
}

// ---------------------------------------------------------------------------
// Dimension classification
// ---------------------------------------------------------------------------

/**
 * Facts about a candidate that a dimension can be read off.
 *
 * Structural signals (entity ambiguity, source conflicts, media eligibility)
 * come from stages that actually ran — they are observations, not guesses.
 * Keyword signals cover the intent dimensions, where the text is the only
 * evidence available before a human reads it.
 */
export type DimensionSignals = {
  title: string;
  summary: string | null;
  discoveryType: string;
  categorySlug: string | null;
  claimStatus: string;
  suggestedAngle: string | null;
  freshnessSensitivity: "breaking" | "time_sensitive" | "evergreen" | null;
  /** Distinct evidence rows attached to the candidate. */
  evidenceCount: number;
  /** Distinct publishing organisations behind that evidence. */
  distinctPublishers: number;
  /** Sources that repeat another source rather than confirming independently. */
  derivativeSources: number;
  /** Reconcilable disagreements found between sources. */
  conflictCount: number;
  /** What the entity resolver concluded, once it has actually run. */
  entityDecision: "matched_existing" | "new_entity" | "ambiguous" | "ignored" | null;
  /**
   * Whether the media acquisition and rights stages ACTUALLY RAN.
   *
   * False for a candidate that fail-closed earlier. Without this, every
   * relevance rejection would be credited as `media_impossible` — the media
   * question was never asked, and counting an unasked question as a hard case
   * is exactly the kind of inflation this module exists to prevent.
   */
  mediaStageRan: boolean;
  /** Media assets considered. */
  mediaCandidateCount: number;
  /** Of those, how many the rights check would actually clear. */
  mediaClearedCount: number;
  /** Whether this piece cannot be published without a hero image. */
  requiresHeroMedia: boolean;
  /** True when the candidate is a product record rather than an article. */
  isProductRecord: boolean;
};

const RE_COMPARISON = /\bv\.?s\.?\b|\bversus\b|\bcompared? (?:to|with|against)\b|\bwhich (?:is|one|should)\b|\bbetter than\b|\bdifference between\b|\bhead[- ]to[- ]head\b/i;
const RE_TROUBLESHOOTING = /\bfix(?:es|ing|ed)?\b|\berror\b|\bnot working\b|\bwon'?t\b|\bcan'?t\b|\btroubleshoot|\bproblem\b|\bissue[sd]?\b|\bcrash(?:es|ing)?\b|\bfail(?:s|ing|ure)?\b|\bstuck\b|\bwhy (?:is|does|won'?t|can'?t)\b|\bbug\b/i;
const RE_BUYING = /\bbest\b|\bshould (?:i|you) buy\b|\bworth (?:it|buying)\b|\bbuying guide\b|\bwhich .{0,30}(?:should|to) (?:buy|get|choose)\b|\brecommend(?:ed|ation)?\b|\bfor beginners\b|\bon a budget\b|\bvalue for money\b/i;
const RE_COMPAT_SPEC = /\bcompatib|\bsupports?\b|\bworks with\b|\bspecification|\bspecs?\b|\bstandard\b|\bprotocol\b|\bbandwidth\b|\bresolution\b|\d+\s?(?:hz|hertz|gb|tb|mp|mm|nm|w|watt|bit)\b|\bfirmware\b|\binterface\b|\bconnector\b|\bcertif(?:y|ied|ication)\b/i;
const RE_REGULATORY = /\bregulat|\bcompliance\b|\bcomplian(?:t|ce)\b|\blegal\b|\blawsuit\b|\bantitrust\b|\bcourt\b|\bruling\b|\bdirective\b|\bgdpr\b|\bfcc\b|\bce mark\b|\bukca\b|\bstatutory\b|\brecall(?:s|ed)?\b|\bsafety notice\b|\bban(?:ned|s)?\b|\bsanction/i;
const RE_PRICE_AVAIL = /\bprice[sd]?\b|\bpricing\b|\bmsrp\b|\brrp\b|[$£€]\s?\d|\d+\s?(?:usd|gbp|eur)\b|\bavailab|\bpre-?order\b|\bin stock\b|\bout of stock\b|\bship(?:s|ping|ment)\b|\brelease date\b|\blaunch(?:es|ing|ed)? (?:on|in)\b|\bdiscount\b|\bdeal\b|\bsale\b|\bfree\b/i;
const RE_RAPID = /\bbeta\b|\bpreview\b|\bearly access\b|\broadmap\b|\bupcoming\b|\brumou?r|\bleak(?:ed|s)?\b|\breportedly\b|\bexpected to\b|\bcoming soon\b|\bthis week\b|\btoday\b|\bnow (?:available|live|rolling)\b/i;
const RE_EVERGREEN_SHAPE = /\bhow to\b|\bwhat is\b|\bguide\b|\bexplain(?:ed|er)?\b|\bunderstanding\b|\bbeginner|\bglossary\b|\btutorial\b/i;

const PRODUCT_DISCOVERY_TYPES = new Set([
  "product_launch",
  "product_update",
  "spec_change",
  "firmware_release",
]);

const RAPID_CLAIM_STATUSES = new Set(["rumour", "leak", "estimate", "unverified"]);

/**
 * Which dimensions a candidate exercises.
 *
 * Returns dimensions in SHADOW_DIMENSIONS order so two runs over the same
 * candidate produce identical arrays. May legitimately return an empty array —
 * a candidate that exercises nothing on this list still gets a decision, it
 * just contributes to no coverage floor, which is itself worth seeing.
 */
export function classifyDimensions(signals: DimensionSignals): ShadowDimension[] {
  const text = `${signals.title} ${signals.summary ?? ""}`;
  const angle = signals.suggestedAngle ?? "";
  const found = new Set<ShadowDimension>();

  // --- Time sensitivity. Mutually exclusive by construction: a piece is
  // either expected to decay or expected not to, never both.
  if (signals.freshnessSensitivity === "evergreen") {
    found.add("evergreen");
  } else if (signals.freshnessSensitivity === "breaking" || signals.freshnessSensitivity === "time_sensitive") {
    found.add("news_sensitive");
  } else if (RE_EVERGREEN_SHAPE.test(text)) {
    found.add("evergreen");
  } else if (signals.discoveryType === "technology_news") {
    found.add("news_sensitive");
  }

  // --- Record shape
  if (signals.isProductRecord || PRODUCT_DISCOVERY_TYPES.has(signals.discoveryType)) {
    found.add("products");
  }

  // --- Intent shapes, from the text and the relevance stage's own angle
  if (RE_COMPARISON.test(text) || angle === "comparison") found.add("comparisons");
  if (RE_TROUBLESHOOTING.test(text) || angle === "bug_or_problem") found.add("troubleshooting");
  if (RE_BUYING.test(text) || angle === "buying_question") found.add("buying_questions");
  if (RE_COMPAT_SPEC.test(text) || angle === "compatibility" || angle === "specifications") {
    found.add("compatibility_specification");
  }
  if (RE_REGULATORY.test(text) || angle === "recall" || angle === "security") found.add("regulatory_legal");
  if (RE_PRICE_AVAIL.test(text) || angle === "pricing") found.add("price_availability_sensitive");

  // --- Structural, from stages that actually ran
  if (signals.entityDecision === "ambiguous") found.add("difficult_entity_resolution");
  if (signals.conflictCount > 0) found.add("source_disagreement");
  if (signals.evidenceCount <= 1 || signals.distinctPublishers <= 1 || signals.derivativeSources >= signals.evidenceCount) {
    found.add("sparse_source");
  }

  // Media: "rich" means the rights check would genuinely clear something.
  // "impossible" means it would clear nothing AND the piece needs an image —
  // an article that needs no hero is neither, and saying otherwise would let
  // an easy case count as the hard one.
  //
  // Both require the media stages to have RUN. A candidate rejected at
  // relevance was never asked the media question, and crediting it as
  // media_impossible would fill that dimension's floor with decisions that
  // never exercised the media path at all.
  if (signals.mediaStageRan) {
    if (signals.mediaClearedCount > 0) {
      found.add("media_rich");
    } else if (signals.requiresHeroMedia) {
      found.add("media_impossible");
    }
  }

  if (
    signals.freshnessSensitivity === "breaking" ||
    RAPID_CLAIM_STATUSES.has(signals.claimStatus) ||
    RE_RAPID.test(text)
  ) {
    found.add("rapidly_changing");
  }

  return SHADOW_DIMENSIONS.filter((d) => found.has(d));
}

// ---------------------------------------------------------------------------
// Family clustering
// ---------------------------------------------------------------------------

/**
 * Coarse bucket a candidate belongs to before near-duplicate clustering.
 *
 * Publisher, lower-cased. Clustering is done inside a bucket rather than across
 * the whole set, both because two outlets covering the same event are two
 * genuine decisions and because it keeps the O(n^2) similarity comparison
 * bounded by the largest single publisher rather than by the whole corpus.
 */
export function familyBucket(publisher: string | null | undefined): string {
  return (publisher ?? "unknown").trim().toLowerCase() || "unknown";
}

export type CompositionEntry = {
  identity: string;
  title: string;
  publisher: string | null;
  dimensions: ShadowDimension[];
  /** YYYY-MM-DD of the decision, for the distinct-days criterion. */
  day: string;
  /** False for records that failed mid-pipeline; they are never credited. */
  complete: boolean;
  /** The stage the decision actually terminated at. */
  terminalStage: string;
  /** Whether the decision reached the publication gate rather than failing closed earlier. */
  reachedGate: boolean;
};

export type CreditVerdict = {
  identity: string;
  credited: boolean;
  /** Present only when credit was refused. */
  refusedBecause: "incomplete" | "duplicate_identity" | "family_cap" | null;
  familyId: string;
};

export type DimensionCoverage = {
  dimension: ShadowDimension;
  credited: number;
  required: number;
  met: boolean;
  rationale: string;
};

export type CompositionReport = {
  /** Every record seen, including ones refused credit. */
  totalRecords: number;
  /** Records that reached a decision (as opposed to failing mid-pipeline). */
  completeRecords: number;
  /** Records that survived every anti-inflation mechanism. This is the number
   *  that may be handed to evaluateReadiness as `shadowDecisions`. */
  creditedDecisions: number;
  duplicateIdentitiesRefused: number;
  familyCapRefused: number;
  incompleteRefused: number;
  distinctDays: number;
  distinctFamilies: number;
  /** Share of the credited set held by its single largest family. */
  largestFamilyShare: number;
  /** Share of credited decisions that never reached the publication gate. */
  earlyTerminationShare: number;
  coverage: DimensionCoverage[];
  gaps: ShadowDimension[];
  verdicts: CreditVerdict[];
  /** Reasons the set is not yet adequate evidence, whatever its size. */
  blockers: { criterion: string; required: string; actual: string }[];
  /** True only when every floor and shape check passes. Never the default. */
  adequate: boolean;
  summary: string;
};

/**
 * Assess a set of shadow decision records as evidence.
 *
 * Order matters and is deliberate: identity duplicates are removed first (they
 * are not decisions at all), then incompletes (they are failures, not
 * decisions), then the family cap is applied to what remains. Applying the cap
 * before deduplication would let a repeated identity consume a family's budget
 * and crowd out a genuine sibling.
 */
export function assessComposition(entries: readonly CompositionEntry[]): CompositionReport {
  const verdicts: CreditVerdict[] = [];
  const seen = new Set<string>();

  // --- 1. Identity deduplication and completeness -------------------------
  type Live = CompositionEntry & { familyId: string };
  const survivors: Live[] = [];

  for (const entry of entries) {
    if (seen.has(entry.identity)) {
      verdicts.push({ identity: entry.identity, credited: false, refusedBecause: "duplicate_identity", familyId: "" });
      continue;
    }
    seen.add(entry.identity);
    if (!entry.complete) {
      verdicts.push({ identity: entry.identity, credited: false, refusedBecause: "incomplete", familyId: "" });
      continue;
    }
    survivors.push({ ...entry, familyId: "" });
  }

  // --- 2. Near-duplicate family clustering, within a publisher bucket -----
  // Single-linkage: a candidate joins a family if it is a near-duplicate of ANY
  // member. That is the permissive direction on purpose — it errs towards
  // treating things as the same story, which errs towards refusing credit.
  const buckets = new Map<string, Live[]>();
  for (const s of survivors) {
    const bucket = familyBucket(s.publisher);
    const list = buckets.get(bucket) ?? [];
    list.push(s);
    buckets.set(bucket, list);
  }

  const families = new Map<string, Live[]>();
  for (const [bucket, members] of buckets) {
    const clusters: Live[][] = [];
    for (const member of members) {
      const target = clusters.find((c) => c.some((existing) => titleSimilarity(existing.title, member.title) >= NEAR_DUPLICATE_THRESHOLD));
      if (target) target.push(member);
      else clusters.push([member]);
    }
    clusters.forEach((cluster, index) => {
      const familyId = `${bucket}#${index}`;
      for (const member of cluster) member.familyId = familyId;
      families.set(familyId, cluster);
    });
  }

  // --- 3. Family cap ------------------------------------------------------
  const credited: Live[] = [];
  for (const [familyId, members] of families) {
    members.forEach((member, index) => {
      if (index < MAX_CREDIT_PER_FAMILY) {
        credited.push(member);
        verdicts.push({ identity: member.identity, credited: true, refusedBecause: null, familyId });
      } else {
        verdicts.push({ identity: member.identity, credited: false, refusedBecause: "family_cap", familyId });
      }
    });
  }

  // --- 4. Measure ---------------------------------------------------------
  const creditedCount = credited.length;
  const perDimension = new Map<ShadowDimension, number>();
  for (const d of SHADOW_DIMENSIONS) perDimension.set(d, 0);
  for (const c of credited) {
    for (const d of c.dimensions) perDimension.set(d, (perDimension.get(d) ?? 0) + 1);
  }

  const coverage: DimensionCoverage[] = SHADOW_DIMENSIONS.map((dimension) => {
    const count = perDimension.get(dimension) ?? 0;
    return {
      dimension,
      credited: count,
      required: MIN_DECISIONS_PER_DIMENSION,
      met: count >= MIN_DECISIONS_PER_DIMENSION,
      rationale: DIMENSION_RATIONALE[dimension],
    };
  });
  const gaps = coverage.filter((c) => !c.met).map((c) => c.dimension);

  const creditedFamilySizes = new Map<string, number>();
  for (const c of credited) creditedFamilySizes.set(c.familyId, (creditedFamilySizes.get(c.familyId) ?? 0) + 1);
  const largestFamily = Math.max(0, ...creditedFamilySizes.values());
  const largestFamilyShare = creditedCount > 0 ? largestFamily / creditedCount : 0;

  const earlyTerminations = credited.filter((c) => !c.reachedGate).length;
  const earlyTerminationShare = creditedCount > 0 ? earlyTerminations / creditedCount : 0;

  const distinctDays = new Set(credited.map((c) => c.day)).size;

  // --- 5. Blockers --------------------------------------------------------
  const blockers: CompositionReport["blockers"] = [];
  for (const c of coverage) {
    if (!c.met) {
      blockers.push({
        criterion: `Coverage: ${c.dimension}`,
        required: `>= ${MIN_DECISIONS_PER_DIMENSION} credited decisions`,
        actual: String(c.credited),
      });
    }
  }
  if (creditedCount > 0 && largestFamilyShare > MAX_FAMILY_SHARE) {
    blockers.push({
      criterion: "Largest near-duplicate family share",
      required: `<= ${MAX_FAMILY_SHARE}`,
      actual: largestFamilyShare.toFixed(4),
    });
  }
  if (creditedCount > 0 && earlyTerminationShare > MAX_EARLY_TERMINATION_SHARE) {
    blockers.push({
      criterion: "Decisions terminating before the publication gate",
      required: `<= ${MAX_EARLY_TERMINATION_SHARE}`,
      actual: earlyTerminationShare.toFixed(4),
    });
  }
  if (creditedCount === 0) {
    blockers.push({
      criterion: "Credited decisions",
      required: ">= 1",
      actual: "0",
    });
  }

  const adequate = blockers.length === 0;

  return {
    totalRecords: entries.length,
    completeRecords: entries.filter((e) => e.complete).length,
    creditedDecisions: creditedCount,
    duplicateIdentitiesRefused: verdicts.filter((v) => v.refusedBecause === "duplicate_identity").length,
    familyCapRefused: verdicts.filter((v) => v.refusedBecause === "family_cap").length,
    incompleteRefused: verdicts.filter((v) => v.refusedBecause === "incomplete").length,
    distinctDays,
    distinctFamilies: families.size,
    largestFamilyShare,
    earlyTerminationShare,
    coverage,
    gaps,
    verdicts,
    blockers,
    adequate,
    summary: adequate
      ? `Composition adequate: ${creditedCount} credited decisions across ${families.size} families and ${distinctDays} day(s), every dimension at or above ${MIN_DECISIONS_PER_DIMENSION}.`
      : `Composition NOT adequate: ${creditedCount} credited decision(s), ${gaps.length} of ${SHADOW_DIMENSIONS.length} dimension(s) below the floor` +
        (gaps.length ? ` (${gaps.join(", ")})` : "") +
        `, largest family holds ${(largestFamilyShare * 100).toFixed(0)}%, ${(earlyTerminationShare * 100).toFixed(0)}% terminated before the gate.`,
  };
}
