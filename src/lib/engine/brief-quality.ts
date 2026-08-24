// BRIEF QUALITY — deciding what is allowed to cost the owner attention.
//
// THE PROBLEM, EXACTLY
// --------------------
// Production held 47 pending briefs and 0 approved ones. The engine was working;
// the queue was not. The reason is visible in the oldest rows:
//
//   "NIKKOR Z 50mm f/1.2 S vs NIKKOR Z 50mm f/1.4"
//     verified_facts: []   uncertainties: []   source_urls: []
//
// That brief is not a discovery. It is a pair of catalogue rows multiplied
// together — a title the engine can always generate, for any two products, in
// unlimited quantity. It sat in the same undifferentiated list as briefs built
// from real sourced evidence, and it sorted by `created_at` like everything
// else.
//
// A queue whose contents are mostly unactionable trains its owner to stop
// opening it. That is what happened, and it is a ranking failure rather than a
// generation failure: the weak briefs are not WRONG, they are just not worth a
// human's next ten minutes when better ones exist.
//
// WHY CLASSIFY RATHER THAN DELETE
// -------------------------------
// A comparison brief with no evidence today may be perfectly good in a month,
// once something is actually published about either lens. Deleting it throws
// away a real editorial idea because the research has not happened yet, and the
// engine would only regenerate it on the next tick anyway. So nothing here
// deletes, rejects, or hides a brief permanently. It sorts them, and it names
// the reason.
//
// WHY THIS IS DERIVED AND NOT A COLUMN
// ------------------------------------
// Quality is a pure function of fields `engine_briefs` already carries —
// `verified_facts`, `uncertainties`, `source_urls`, `brief_kind`,
// `freshness_sensitivity`, `discovery_id`, `opportunity_id`. Storing the verdict
// would add a column that can go stale the moment research adds a source, and
// would need a backfill migration to re-rank the existing 47.
//
// Computing it means the 47 are reclassified the instant this file changes, with
// no migration and no write. `review_state` remains the only stored decision,
// because that is the one a HUMAN makes. This module never writes anything.
//
// RELATIONSHIP TO review_state
// ----------------------------
// These are different questions and must not be conflated:
//
//   review_state   what a human decided        (pending/approved/rejected/…)
//   quality state  whether it is worth deciding (computed, here)
//
// A brief the owner already rejected is out of scope regardless of quality. A
// brief with excellent evidence is still `pending` until a human says
// otherwise. Only `ready_for_review` is allowed into the owner's main queue;
// everything else is visible on request, with its reason.
//
// PURE. No `server-only`, no Supabase, no clock — the caller supplies `now` so
// staleness is testable. The I/O half lives in src/lib/engine/queue-service.ts.

import { hostOf, registrableDomain } from "./independence.ts";
import { titleSimilarity, NEAR_DUPLICATE_THRESHOLD } from "./dedupe.ts";
import { classifyPromotional } from "./promotional.ts";

// ---------------------------------------------------------------------------
// The states
// ---------------------------------------------------------------------------

/**
 * Ordered worst-to-best is deliberately NOT the declaration order — see
 * `QUALITY_RANK`. Declaration order here is narrative: the owner asked for
 * these six names, in roughly this sequence.
 */
export type BriefQualityState =
  /** Evidence is sufficient to make a real editorial decision now. */
  | "ready_for_review"
  /** Genuinely promising, but under-sourced. The engine can and should go back for more. */
  | "needs_more_research"
  /** Sourced, but the sources are not independent of each other, or are weak. */
  | "low_confidence"
  /** No evidence at all, and nothing upstream to research from. */
  | "insufficient_evidence"
  /** TechCarvalho probably already answers this. Updating beats publishing again. */
  | "duplicate_risk"
  /** Structurally unactionable — generated combinatorially, or stale with no signal. */
  | "not_worth_pursuing";

export const BRIEF_QUALITY_STATES: readonly BriefQualityState[] = [
  "ready_for_review",
  "needs_more_research",
  "low_confidence",
  "insufficient_evidence",
  "duplicate_risk",
  "not_worth_pursuing",
] as const;

/**
 * Typed as a TOTAL record over BriefQualityState, not Record<string, …>.
 *
 * Adding a seventh state without giving it a label, a rank and a queue
 * decision now fails to COMPILE. The same shape is used throughout this
 * codebase for exactly this reason: a missing enum member that merely produces
 * `undefined` at runtime is a bug that ships.
 */
export const BRIEF_QUALITY_LABELS: Record<BriefQualityState, string> = {
  ready_for_review: "Ready for review",
  needs_more_research: "Needs more research",
  low_confidence: "Low confidence",
  insufficient_evidence: "Insufficient evidence",
  duplicate_risk: "Duplicate / cannibalisation risk",
  not_worth_pursuing: "Not worth pursuing",
};

/** Sort weight. Higher surfaces first within the "everything else" view. */
export const QUALITY_RANK: Record<BriefQualityState, number> = {
  ready_for_review: 5,
  needs_more_research: 4,
  low_confidence: 3,
  duplicate_risk: 2,
  insufficient_evidence: 1,
  not_worth_pursuing: 0,
};

/**
 * Whether the engine should keep working on this brief on later ticks.
 *
 * The owner's requirement was explicit: "The engine should be able to continue
 * researching weak but potentially useful opportunities later." So this is not
 * the same as "is it good" — `needs_more_research` and `low_confidence` are
 * both poor today and both worth another pass, whereas `duplicate_risk` needs a
 * human to choose update-vs-new before any more research is justified.
 */
export const QUALITY_INVITES_MORE_RESEARCH: Record<BriefQualityState, boolean> = {
  ready_for_review: false,
  needs_more_research: true,
  low_confidence: true,
  insufficient_evidence: true,
  duplicate_risk: false,
  not_worth_pursuing: false,
};

/**
 * Whether a brief in this state belongs in the owner's MAIN queue.
 *
 * Exactly one state qualifies, and that narrowness is the entire point of the
 * module. Widening this map is the single edit that would undo Phase C, so it
 * is stated as data with a test asserting the count.
 */
export const QUALITY_ENTERS_OWNER_QUEUE: Record<BriefQualityState, boolean> = {
  ready_for_review: true,
  needs_more_research: false,
  low_confidence: false,
  insufficient_evidence: false,
  duplicate_risk: false,
  not_worth_pursuing: false,
};

// ---------------------------------------------------------------------------
// Thresholds
// ---------------------------------------------------------------------------

/**
 * One fact is an announcement, not an article. Two is the minimum at which a
 * piece can say something and then support it.
 *
 * Chosen as an editorial default, not derived from the schema — stated here
 * once so it is changed in one place rather than per call site, the same
 * discipline as src/lib/admin/freshness.ts.
 */
export const MIN_FACTS_FOR_REVIEW = 2;

/**
 * Two INDEPENDENT publishers, not two URLs.
 *
 * This is the brief-level restatement of the rule confidence.ts enforces on
 * evidence rows: repetition is not corroboration. Five pages from one site is
 * one voice. Briefs carry only `source_urls` (strings), not evidence rows with
 * `originates_from_url`, so full `assessIndependence` cannot run here —
 * registrable domain is the strongest independence signal available from a URL
 * alone, and it is deliberately treated as an UPPER bound on independence: two
 * domains might still be one owner, so this can over-credit, never under-credit.
 */
export const MIN_INDEPENDENT_DOMAINS = 2;

/**
 * Beyond this age, a brief with no evidence has had its chance.
 *
 * Not a deletion trigger — it moves a brief from `insufficient_evidence` to
 * `not_worth_pursuing`, which is a sort position, not a tombstone.
 */
export const STALE_WITHOUT_EVIDENCE_DAYS = 21;

const MS_PER_DAY = 86_400_000;

// ---------------------------------------------------------------------------
// Input
// ---------------------------------------------------------------------------

/**
 * Deliberately a plain shape rather than the database Row type: this module is
 * pure and unit-tested, and binding it to the generated row would drag
 * `server-only` transitively into the test runner.
 */
export type BriefQualityInput = {
  id?: string;
  title: string;
  /** `engine_briefs.brief_kind` — 'comparison' generated from the catalogue is the noisy one. */
  briefKind: string | null;
  contentType: string | null;
  verifiedFacts: readonly string[];
  uncertainties: readonly string[];
  sourceUrls: readonly string[];
  freshnessSensitivity: "breaking" | "time_sensitive" | "evergreen" | null;
  /**
   * Whether anything upstream actually prompted this brief. A brief with
   * neither a discovery nor an opportunity behind it was generated from
   * internal catalogue shape alone — there is no source to go back to.
   */
  hasDiscovery: boolean;
  hasOpportunity: boolean;
  createdAt: string;
  /**
   * Titles of content TechCarvalho has already published, for the
   * cannibalisation check. Pass the candidate set, not the whole site — the
   * caller is expected to have narrowed by category.
   */
  existingTitles?: readonly string[];
  /** Optional summary/rationale, used only to sharpen the promotional check. */
  summary?: string | null;
};

export type BriefQualityVerdict = {
  state: BriefQualityState;
  label: string;
  rank: number;
  /** Ordered, human-readable. First entry is the primary reason for the state. */
  reasons: string[];
  entersOwnerQueue: boolean;
  invitesMoreResearch: boolean;
  /** Measured inputs, exposed so the UI can show evidence without recomputing. */
  factCount: number;
  uncertaintyCount: number;
  sourceCount: number;
  independentDomains: number;
  /** Best cannibalisation match found, when one crossed the threshold. */
  duplicateOf: { title: string; similarity: number } | null;
  /**
   * True when the proposed title reads as vendor marketing rather than an
   * editorial headline. Surfaced separately from `state` because it is a
   * property of the FRAMING, which a rewrite fixes, not of the evidence.
   */
  readsAsPromotional: boolean;
};

// ---------------------------------------------------------------------------
// Independence from URLs alone
// ---------------------------------------------------------------------------

/**
 * Distinct registrable domains across a brief's source URLs.
 *
 * NOTE THE COMPOSITION. `registrableDomain` takes a HOST, not a URL —
 * `hostOf` must run first. Passing a full URL straight in silently returns
 * junk (`https://news.bbc.co.uk/a` yields `"co.uk/a"`, and `"not a url"` yields
 * itself), and because those junk values are DISTINCT from one another they
 * count as separate publishers. That fails open: it inflates independence, and
 * inflated independence is precisely what lets an under-sourced brief reach
 * `ready_for_review`. This was a real bug in the first draft of this file,
 * caught by the single-publisher test below.
 *
 * Unparseable URLs collapse into ONE unknown bucket rather than being
 * discarded. Dropping them would make a brief with three broken links look
 * identical to one with no links at all, and "we could not tell" must not read
 * as "there was nothing there". Collapsing them into one keeps the failure
 * visible without letting three unparseable strings masquerade as three voices.
 */
export function countIndependentDomains(urls: readonly string[]): number {
  const domains = new Set<string>();
  let unparseable = 0;
  for (const raw of urls) {
    const domain = registrableDomain(hostOf(raw));
    if (domain) domains.add(domain);
    else if (raw && raw.trim().length > 0) unparseable += 1;
  }
  return domains.size + (unparseable > 0 ? 1 : 0);
}

/**
 * Whether this brief looks like catalogue combinatorics rather than a finding.
 *
 * The signature is specific and all three parts must hold: it is a comparison,
 * it has no evidence whatsoever, and nothing upstream prompted it. A comparison
 * brief built from a real discovery with real sources is a perfectly good
 * article idea and is NOT caught here.
 */
export function isCombinatorial(input: BriefQualityInput): boolean {
  const kind = (input.briefKind ?? input.contentType ?? "").toLowerCase();
  const looksComparative = kind === "comparison" || / vs /i.test(input.title);
  return (
    looksComparative &&
    input.verifiedFacts.length === 0 &&
    input.sourceUrls.length === 0 &&
    !input.hasDiscovery &&
    !input.hasOpportunity
  );
}

// ---------------------------------------------------------------------------
// The classifier
// ---------------------------------------------------------------------------

/**
 * Classify one brief.
 *
 * Order of checks matters and runs worst-first for the disqualifying cases:
 * a combinatorial brief that is ALSO a duplicate should report the structural
 * problem, because researching it harder cannot fix it. Only once nothing
 * disqualifies it do the evidence thresholds decide between the three
 * "promising but not there yet" states and `ready_for_review`.
 */
export function classifyBriefQuality(
  input: BriefQualityInput,
  now: Date = new Date()
): BriefQualityVerdict {
  const factCount = input.verifiedFacts.length;
  const uncertaintyCount = input.uncertainties.length;
  const sourceCount = input.sourceUrls.length;
  const independentDomains = countIndependentDomains(input.sourceUrls);
  const reasons: string[] = [];

  const duplicateOf = bestDuplicate(input);
  const promotional = classifyPromotional(input.title, input.summary ?? null);

  const base = {
    factCount,
    uncertaintyCount,
    sourceCount,
    independentDomains,
    duplicateOf,
    readsAsPromotional: promotional.isPromotional,
  };

  // ---- 1. Structurally unactionable -------------------------------------
  if (isCombinatorial(input)) {
    reasons.push(
      "Generated by pairing two catalogue entries, with no discovery or opportunity behind it and no " +
        "evidence attached. More research has no starting point, because nothing prompted this beyond " +
        "the fact that both products exist."
    );
    reasons.push("Kept rather than deleted: it becomes a real idea as soon as either product is in the news.");
    return verdict("not_worth_pursuing", reasons, base);
  }

  const ageDays = ageInDays(input.createdAt, now);
  if (sourceCount === 0 && factCount === 0 && ageDays !== null && ageDays > STALE_WITHOUT_EVIDENCE_DAYS) {
    reasons.push(
      `No sources and no verified facts after ${Math.floor(ageDays)} days. Research has had ` +
        `${STALE_WITHOUT_EVIDENCE_DAYS} days to find something and has not.`
    );
    return verdict("not_worth_pursuing", reasons, base);
  }

  // ---- 2. Already covered ----------------------------------------------
  // Ahead of the evidence checks on purpose: a well-sourced brief that
  // duplicates an existing page should become an UPDATE, and calling it
  // "ready for review" would invite exactly the duplicate publication the
  // brief forbids.
  if (duplicateOf) {
    reasons.push(
      `Closely matches already-published content: "${duplicateOf.title}" ` +
        `(title similarity ${duplicateOf.similarity.toFixed(2)}, threshold ${NEAR_DUPLICATE_THRESHOLD}).`
    );
    reasons.push("Updating the existing page is normally better than publishing a second one competing with it.");
    return verdict("duplicate_risk", reasons, base);
  }

  // ---- 3. No evidence at all -------------------------------------------
  if (sourceCount === 0 && factCount === 0) {
    reasons.push("No sources and no verified facts recorded, so there is nothing for an owner to evaluate yet.");
    if (input.hasDiscovery || input.hasOpportunity) {
      reasons.push(
        "There IS something upstream to research from" +
          `${input.hasDiscovery ? " (a discovery)" : ""}${input.hasOpportunity ? " (a scored opportunity)" : ""}` +
          ", so the engine should keep working on this."
      );
    }
    return verdict("insufficient_evidence", reasons, base);
  }

  // ---- 4. Sourced, but not independently -------------------------------
  if (independentDomains < MIN_INDEPENDENT_DOMAINS) {
    reasons.push(
      `${sourceCount} source${sourceCount === 1 ? "" : "s"} resolve to ${independentDomains} ` +
        `independent publisher${independentDomains === 1 ? "" : "s"}; ${MIN_INDEPENDENT_DOMAINS} is the minimum. ` +
        "Repetition from one publisher is not corroboration."
    );
    // The single-publisher case has two very different shapes, and saying which
    // one this is changes what the owner would do about it. An independent
    // outlet that broke a story alone needs corroboration. A vendor's own blog
    // post about the vendor's own product needs corroboration AND a headline
    // that is not the vendor's marketing copy.
    if (promotional.isPromotional) {
      reasons.push(
        `The proposed headline also reads as vendor marketing rather than reporting (${promotional.explanation}). ` +
          "A single vendor source announcing its own news is the weakest shape there is: nobody independent has " +
          "confirmed it, and the framing is the vendor's."
      );
    }
    return verdict("low_confidence", reasons, base);
  }

  // ---- 5. Independent, but thin ----------------------------------------
  if (factCount < MIN_FACTS_FOR_REVIEW) {
    reasons.push(
      `${independentDomains} independent publishers, but only ${factCount} verified ` +
        `fact${factCount === 1 ? "" : "s"} (minimum ${MIN_FACTS_FOR_REVIEW}). ` +
        "The sourcing is sound; there is not yet enough established to build a piece on."
    );
    return verdict("needs_more_research", reasons, base);
  }

  // ---- 6. Well-sourced, but framed as marketing -------------------------
  // Deliberately AFTER the evidence thresholds: this is not an evidence
  // problem, and calling it one would be misleading. The sourcing is fine; the
  // headline is the vendor's. TechCarvalho's version has to be framed around
  // what a reader wants to know, so this needs an editorial pass before it is
  // worth an owner's approval — which is work the engine can do, not the owner.
  if (promotional.isPromotional) {
    reasons.push(
      `Evidence is sufficient (${factCount} facts across ${independentDomains} independent publishers), but ` +
        `the proposed headline reads as vendor marketing: ${promotional.explanation}`
    );
    reasons.push("Needs an editorial reframe around the reader's question before it is worth approving.");
    return verdict("needs_more_research", reasons, base);
  }

  // ---- 7. Ready ---------------------------------------------------------
  reasons.push(
    `${factCount} verified facts across ${independentDomains} independent publishers ` +
      `(${sourceCount} source${sourceCount === 1 ? "" : "s"}).`
  );
  if (uncertaintyCount > 0) {
    // Stated as a strength. An article that separates what is confirmed from
    // what is merely reported is the honest kind; a brief with zero recorded
    // uncertainties about an unreleased product is usually under-examined
    // rather than unusually certain.
    reasons.push(
      `${uncertaintyCount} open question${uncertaintyCount === 1 ? "" : "s"} recorded separately from the ` +
        "verified facts, so confirmed and unconfirmed material stay distinguishable in the draft."
    );
  }
  if (input.freshnessSensitivity === "breaking" || input.freshnessSensitivity === "time_sensitive") {
    reasons.push(`Time-sensitive (${input.freshnessSensitivity.replace(/_/g, " ")}) — value decays if it waits.`);
  }
  return verdict("ready_for_review", reasons, base);
}

function verdict(
  state: BriefQualityState,
  reasons: string[],
  base: Pick<
    BriefQualityVerdict,
    | "factCount"
    | "uncertaintyCount"
    | "sourceCount"
    | "independentDomains"
    | "duplicateOf"
    | "readsAsPromotional"
  >
): BriefQualityVerdict {
  return {
    state,
    label: BRIEF_QUALITY_LABELS[state],
    rank: QUALITY_RANK[state],
    entersOwnerQueue: QUALITY_ENTERS_OWNER_QUEUE[state],
    invitesMoreResearch: QUALITY_INVITES_MORE_RESEARCH[state],
    reasons,
    ...base,
  };
}

function bestDuplicate(input: BriefQualityInput): { title: string; similarity: number } | null {
  let best: { title: string; similarity: number } | null = null;
  for (const title of input.existingTitles ?? []) {
    const similarity = titleSimilarity(input.title, title);
    if (similarity < NEAR_DUPLICATE_THRESHOLD) continue;
    if (!best || similarity > best.similarity) best = { title, similarity };
  }
  return best;
}

function ageInDays(createdAt: string, now: Date): number | null {
  const created = new Date(createdAt);
  if (Number.isNaN(created.getTime())) return null;
  const diff = now.getTime() - created.getTime();
  return diff < 0 ? 0 : diff / MS_PER_DAY;
}

// ---------------------------------------------------------------------------
// Aggregate reporting
// ---------------------------------------------------------------------------

export type QualityBreakdown = {
  total: number;
  /** Total record over every state, so a zero bucket is reported as 0 rather than omitted. */
  counts: Record<BriefQualityState, number>;
  ownerQueueCount: number;
  researchBacklogCount: number;
};

/**
 * Summarise a set of verdicts.
 *
 * `counts` is initialised with every state at zero deliberately: the owner
 * asked for a reclassification report of all 47 briefs, and a report that
 * silently omits "0 duplicate risk" is not the same as one that states it. An
 * absent bucket reads as "not checked"; an explicit zero reads as "checked,
 * none found".
 */
export function summariseQuality(verdicts: readonly BriefQualityVerdict[]): QualityBreakdown {
  const counts = Object.fromEntries(BRIEF_QUALITY_STATES.map((s) => [s, 0])) as Record<
    BriefQualityState,
    number
  >;
  for (const v of verdicts) counts[v.state] += 1;
  return {
    total: verdicts.length,
    counts,
    ownerQueueCount: verdicts.filter((v) => v.entersOwnerQueue).length,
    researchBacklogCount: verdicts.filter((v) => v.invitesMoreResearch).length,
  };
}
