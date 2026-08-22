// Update-signal classification.
//
// The failure this exists to prevent: a firmware release for a camera we
// already cover becomes a brand-new article, and six months later the site has
// four thin pages about one product instead of one maintained page.
//
// So before anything is drafted, a discovery is checked for signals that it
// describes a CHANGE to something already covered. When it does, the engine
// proposes an update to the existing record rather than a new page.
//
// Deterministic keyword classification. It never decides on its own that a
// page should change — it produces a PROPOSAL for a human, with the evidence
// attached.

/** Reasons mirrored exactly by the engine_update_proposals.reason check. */
export type UpdateReason =
  | "firmware_update"
  | "successor_released"
  | "discontinued"
  | "spec_change"
  | "price_change"
  | "newer_evidence"
  | "broken_source";

type Rule = { reason: UpdateReason; patterns: RegExp[]; weight: number };

// Ordered by specificity: the first matching rule wins, so "discontinued" is
// checked before the much broader price/spec rules.
const RULES: Rule[] = [
  {
    reason: "discontinued",
    patterns: [/\bdiscontinu/i, /\bend of (life|support|production)\b/i, /\bno longer (available|sold|produced)\b/i, /\bpulled from sale\b/i],
    weight: 0.75,
  },
  {
    reason: "firmware_update",
    patterns: [/\bfirmware\b/i, /\bsoftware update\b/i, /\bversion \d+\.\d+/i, /\bpatch(ed|es)?\b/i, /\bdriver update\b/i],
    weight: 0.7,
  },
  {
    reason: "successor_released",
    patterns: [/\bsuccessor\b/i, /\breplac(es|ed|ement) (the|for)\b/i, /\bnext[- ]gen(eration)?\b/i, /\bmark\s+[iv]+\b/i, /\bmk\s*[iv]+\b/i],
    weight: 0.6,
  },
  {
    reason: "price_change",
    patterns: [/\bprice (cut|drop|increase|rise|hike)\b/i, /\bnow costs\b/i, /\bprice[sd]? (at|to)\b/i, /\bcheaper\b/i, /\bdeal\b/i],
    weight: 0.55,
  },
  {
    reason: "spec_change",
    patterns: [/\bspecification/i, /\bspec(s)? (change|update|revis)/i, /\brevised\b/i, /\bnow (supports|includes)\b/i],
    weight: 0.55,
  },
  {
    reason: "broken_source",
    patterns: [/\bretracted\b/i, /\bcorrection\b/i, /\bwithdrawn\b/i],
    weight: 0.5,
  },
];

export type UpdateSignal = {
  reason: UpdateReason;
  /** 0-1. Never a claim of truth — how strongly the wording indicates a change. */
  confidence: number;
  matchedOn: string;
  explanation: string;
};

/**
 * Classify a discovery as describing a change to an existing record.
 *
 * Returns null when nothing indicates a change. Null is the common and correct
 * outcome — most discoveries are new topics, not updates, and inventing an
 * update reason for them would flood the review queue with noise.
 */
export function classifyUpdateSignal(title: string, summary?: string | null): UpdateSignal | null {
  const haystack = `${title} ${summary ?? ""}`;

  for (const rule of RULES) {
    for (const pattern of rule.patterns) {
      const match = haystack.match(pattern);
      if (match) {
        return {
          reason: rule.reason,
          confidence: rule.weight,
          matchedOn: match[0],
          explanation: `Wording "${match[0]}" indicates ${rule.reason.replace(/_/g, " ")} affecting an existing record. Proposed as an update to that record rather than as a new article.`,
        };
      }
    }
  }
  return null;
}

// proposed_changes is a flat text[] in the database, so the verified/unverified
// split has to survive as part of each line. These two prefixes ARE that split:
// they are written here and read back by the admin review UI, which is why they
// are exported constants rather than inline strings in two places.
export const VERIFIED_CHANGE_PREFIX = "Verified — may be stated directly: ";
export const UNVERIFIED_CHANGE_PREFIX = "Unverified — attribute or omit: ";

/**
 * The concrete changes to propose. Verified facts and unverified claims are
 * kept apart here exactly as they are in an assembled draft — an editor acting
 * on a proposal must be able to see which is which before touching a published
 * page.
 */
export function proposedChanges(input: {
  verifiedFacts: string[];
  uncertainties: string[];
}): string[] {
  return [
    ...input.verifiedFacts.map((f) => `${VERIFIED_CHANGE_PREFIX}${f}`),
    ...input.uncertainties.map((u) => `${UNVERIFIED_CHANGE_PREFIX}${u}`),
  ];
}

export type ChangeEvidence = "verified" | "unverified" | "unclassified";

/**
 * Read the verified/unverified split back off a stored proposed_changes line.
 *
 * The third outcome is the important one. A line written by some earlier
 * revision of this file, or by hand, carries no prefix — and the only safe
 * reading of "we cannot tell" is "we cannot tell". Defaulting an unrecognised
 * line to `verified` would let an unattributed rumour be edited into a
 * published page as established fact, which is precisely the failure the
 * prefixes exist to prevent.
 */
export function classifyProposedChange(line: string): ChangeEvidence {
  if (line.startsWith(VERIFIED_CHANGE_PREFIX)) return "verified";
  if (line.startsWith(UNVERIFIED_CHANGE_PREFIX)) return "unverified";
  return "unclassified";
}

/** The line with its evidence prefix removed, for rendering under a heading. */
export function stripChangePrefix(line: string): string {
  if (line.startsWith(VERIFIED_CHANGE_PREFIX)) return line.slice(VERIFIED_CHANGE_PREFIX.length);
  if (line.startsWith(UNVERIFIED_CHANGE_PREFIX)) return line.slice(UNVERIFIED_CHANGE_PREFIX.length);
  return line;
}
