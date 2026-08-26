// ORDERING OPPORTUNITIES WHEN SOME OF THEM HONESTLY HAVE NO SCORE.
//
// WHY A NULL SCORE IS CORRECT AND MUST NOT BE "FIXED"
// ---------------------------------------------------
// Twelve category opportunities carry score = NULL, each with this explanation
// written by the scoring job itself:
//
//   "Not enough measured demand to score (0 combined searches/views,
//    minimum 5). Reported as unscored rather than guessed."
//
// That is the project's rule working exactly as intended. Category
// opportunities are scored from MEASURED first-party demand, the site has
// almost no traffic yet, and inventing a number would be fabricating the
// demand data this codebase refuses to fabricate everywhere else.
//
// So the defect is not the NULL. The defect is what a reader does with it:
// PostgreSQL puts NULLs FIRST on `ORDER BY score DESC`, so any screen ranking
// opportunities would have shown twelve unscored categories above every
// urgent, fully-scored development. The number was honest and the list was
// still wrong.
//
// THE FIX IS SEPARATION, NOT A SUBSTITUTE VALUE
// ---------------------------------------------
// Scored and unscored opportunities answer different questions:
//
//   scored    "which development should I act on first?"     — ranked
//   unscored  "which sections have no demand signal yet?"    — not ranked,
//             because there is nothing to rank them BY
//
// Mixing them into one ordering implies a comparison that cannot be made.
// Partitioning them says the true thing: these are ranked, those are waiting
// for data. Nothing is hidden — the unscored list is returned in full, with
// each row's own reason.
//
// This lives in one place so a future screen cannot reintroduce the bug by
// writing its own `.order("score")`.

export type OpportunityRow = {
  subject_type: string;
  subject_key: string;
  label: string;
  /** NULL means "not enough measured demand to score" — never "zero value". */
  score: number | null;
  explanation: string | null;
  inputs: Record<string, unknown> | null;
  computed_at?: string | null;
};

export type PartitionedOpportunities<T extends OpportunityRow> = {
  /** Scored, highest first. The only list that is a ranking. */
  ranked: T[];
  /**
   * Unscored, in stable alphabetical order.
   *
   * Deliberately NOT ranked: there is no measurement to rank them by, and any
   * ordering here would imply one. Alphabetical is visibly arbitrary, which is
   * the honest signal.
   */
  awaitingData: T[];
  /** True when nothing has a score yet, so a screen can say so plainly. */
  nothingScored: boolean;
};

/**
 * Split opportunities into a real ranking and a list awaiting data.
 *
 * An unscored row can never appear above a scored one, because they are never
 * in the same list.
 */
export function partitionOpportunities<T extends OpportunityRow>(
  rows: readonly T[]
): PartitionedOpportunities<T> {
  const ranked: T[] = [];
  const awaitingData: T[] = [];

  for (const row of rows) {
    // Number(null) is 0 and Number(undefined) is NaN, either of which would
    // silently sort an unscored row into the ranking. Checked explicitly.
    if (row.score === null || row.score === undefined || Number.isNaN(Number(row.score))) {
      awaitingData.push(row);
    } else {
      ranked.push(row);
    }
  }

  ranked.sort((a, b) => {
    const diff = Number(b.score) - Number(a.score);
    if (diff !== 0) return diff;
    // Stable tiebreak so the list does not reshuffle between reloads.
    return a.subject_key.localeCompare(b.subject_key);
  });
  awaitingData.sort((a, b) => a.subject_key.localeCompare(b.subject_key));

  return { ranked, awaitingData, nothingScored: ranked.length === 0 };
}

/**
 * Why a row has no score, for display.
 *
 * Prefers the scoring job's own explanation, which already says what is
 * missing and that it was not guessed. The fallback never invents a reason.
 */
export function unscoredReason(row: OpportunityRow): string {
  const own = row.explanation?.trim();
  if (own) return own;
  return "No score yet: there is not enough measured demand to calculate one.";
}

/** Watchlist rows are developments; everything else is a section-level signal. */
export function isWatchlistOpportunity(row: OpportunityRow): boolean {
  return row.subject_key.startsWith("watchlist:");
}
