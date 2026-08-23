// Is this product record good enough to be a public page?
//
// WHY THIS EXISTS
// ---------------
// 170 unpublished products are sitting in the catalogue. Publishing them all
// would add 170 URLs, most with no image and some with six specifications, at
// exactly the moment the site is being judged for thin content. Publishing none
// of them wastes the work. The question is which ones, and "it has specs" is
// not an answer.
//
// WHAT THIS DELIBERATELY IS NOT
// -----------------------------
// It is NOT a publish button, and nothing here writes anything. It returns a
// verdict and the reasons behind it; a person decides. A score that publishes
// is a score that will one day publish something embarrassing at 3am, and the
// whole point of this project's boundaries is that publication is an editorial
// act.
//
// It is also not a ranking. Two products both READY are not usefully ordered by
// a decimal, and inventing one would imply a precision these signals do not
// have. The output is a verdict plus the specific things still missing, which
// is what someone can act on.
//
// THE BLOCKING RULE
// -----------------
// Some gaps are shortfalls and some are disqualifying. A product with no
// primary source is not "less ready" — it is not publishable at all, because
// the entire premise of this catalogue is that its facts are traceable. Those
// are BLOCKERS and no amount of other quality compensates.
//
// Pure. No I/O.

export type ReadinessVerdict =
  /** Publishable now. */
  | "ready"
  /** Genuinely close; the gaps are worth an hour. */
  | "nearly"
  /** Real work needed before this is a page. */
  | "not_ready"
  /** Something disqualifying. No amount of polish fixes it. */
  | "blocked";

export type ReadinessInput = {
  slug: string;
  name: string;
  /** Specification rows actually held. */
  specCount: number;
  /** Of those, how many are the ones a reader of this category expects. */
  keySpecCount: number;
  /** source_records with source_class 'manufacturer_official' or a primary tier. */
  primarySourceCount: number;
  /** Any source at all. */
  sourceCount: number;
  /** Media that genuinely depicts THIS product — see media/subject-match.ts. */
  hasExactMedia: boolean;
  /** Media attached at all, of any relevance. */
  hasAnyMedia: boolean;
  /** Edges to other products: successor, alternative, competes_with… */
  relationshipCount: number;
  /** technology_concepts linked. */
  technologyCount: number;
  /** A human-readable summary on the record. */
  hasSummary: boolean;
  /** A rights problem on any attached asset. Disqualifying. */
  hasRightsIssue: boolean;
  /** True when the product's identity is uncertain (name collision, no model). */
  identityUncertain: boolean;
};

export type ReadinessResult = {
  slug: string;
  verdict: ReadinessVerdict;
  /** Everything still missing, in the order worth fixing. */
  gaps: string[];
  /** Disqualifying problems. Non-empty means verdict is 'blocked'. */
  blockers: string[];
};

/** Below this, a specification table is not worth a page of its own. */
export const MIN_SPECS_FOR_PAGE = 8;
/** The specs a reader of any category expects before the page is useful. */
export const MIN_KEY_SPECS = 4;

/**
 * Judge one product.
 *
 * Blockers are evaluated first and short-circuit: reporting a rights problem
 * alongside "add two more specifications" invites someone to fix the specs and
 * publish.
 */
export function assessReadiness(input: ReadinessInput): ReadinessResult {
  const blockers: string[] = [];

  if (input.hasRightsIssue) {
    blockers.push("An attached asset has an unresolved rights problem.");
  }
  if (input.primarySourceCount === 0) {
    blockers.push(
      "No primary source. Every fact on this page would be unattributable, which is the one thing this catalogue cannot publish."
    );
  }
  if (input.identityUncertain) {
    blockers.push("Product identity is uncertain — publishing would assert a model designation nobody has confirmed.");
  }

  if (blockers.length > 0) {
    return { slug: input.slug, verdict: "blocked", gaps: [], blockers };
  }

  const gaps: string[] = [];
  if (input.specCount < MIN_SPECS_FOR_PAGE) {
    gaps.push(`Only ${input.specCount} specifications; a useful page needs about ${MIN_SPECS_FOR_PAGE}.`);
  }
  if (input.keySpecCount < MIN_KEY_SPECS) {
    gaps.push(`Missing the specifications a reader of this category looks for first (${input.keySpecCount}/${MIN_KEY_SPECS}).`);
  }
  if (!input.hasExactMedia) {
    gaps.push(
      input.hasAnyMedia
        ? "Attached imagery does not show this exact product."
        : "No imagery at all."
    );
  }
  if (input.relationshipCount === 0) {
    gaps.push("No relationships — the page would be a dead end with nothing to click.");
  }
  if (input.technologyCount === 0) {
    gaps.push("No technology concepts linked, so nothing explains the terms on the page.");
  }
  if (!input.hasSummary) {
    gaps.push("No summary — the page would open with a specification table and no sentence.");
  }

  // Media is weighted deliberately. A product page with no picture of the
  // product is the specific failure this site is currently being judged for, so
  // it alone prevents "ready" however complete the data is.
  const verdict: ReadinessVerdict =
    gaps.length === 0
      ? "ready"
      : !input.hasExactMedia && gaps.length <= 2
        ? "nearly"
        : gaps.length <= 2
          ? "nearly"
          : "not_ready";

  return { slug: input.slug, verdict, gaps, blockers: [] };
}

export type ReadinessSummary = Record<ReadinessVerdict, number>;

export function summarise(results: readonly ReadinessResult[]): ReadinessSummary {
  const out: ReadinessSummary = { ready: 0, nearly: 0, not_ready: 0, blocked: 0 };
  for (const r of results) out[r.verdict]++;
  return out;
}

/**
 * The single most common gap across a set, which is where effort pays best.
 *
 * Returns the gap text and how many products share it. Ordering a backlog by
 * what is wrong MOST OFTEN beats ordering it by product, because one fix
 * (running a media search, linking a concept) frequently clears dozens.
 */
export function commonestGaps(results: readonly ReadinessResult[], limit = 8): { gap: string; count: number }[] {
  const counts = new Map<string, number>();
  for (const r of results) {
    for (const g of r.gaps) {
      // Normalise the numeric prefix so "Only 6 specifications" and "Only 7"
      // group together — otherwise every product looks like a unique problem.
      const key = g.replace(/\d+/g, "N");
      counts.set(key, (counts.get(key) ?? 0) + 1);
    }
  }
  return [...counts.entries()]
    .map(([gap, count]) => ({ gap, count }))
    .sort((a, b) => b.count - a.count)
    .slice(0, limit);
}
