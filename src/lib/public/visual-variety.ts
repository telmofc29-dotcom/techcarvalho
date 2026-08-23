// Stop the top of the homepage being four diagrams in a row.
//
// WHAT WAS MEASURED
// -----------------
// On the live homepage, at 1280x900:
//
//   above the fold   4 of 4  images are generated graphics   (100%)
//   first ten        9 of 10                                  (90%)
//   whole page       9 of 44                                  (20%)
//   the largest image on the page — the lead hero — is a graphic
//
// The site is not short of photography. Every photograph is simply below the
// fold, because ranking is by recency and editorial centrality and the stories
// that happen to rank highest happen to be the explainers, and explainers are
// the pieces that legitimately carry diagrams.
//
// So the homepage reads as synthetic even though four fifths of its images are
// photographs. That is a SELECTION problem, and it is fixable without touching
// the media library at all.
//
// WHAT THIS DOES AND DOES NOT DO
// ------------------------------
// It does NOT change which stories appear. It does not promote a weaker story
// over a stronger one, and it does not rank by image type — a story is not more
// important because it has a photograph.
//
// It reorders WITHIN the already-selected set to break up runs of the same
// visual kind, moving an item at most MAX_DISPLACEMENT positions from where
// ranking put it. A story ranked first stays at or near the front; what changes
// is that the four things next to it are not all the same shape.
//
// A DIAGRAM IS NOT A DEFECT
// ------------------------
// This is the point that stops the fix becoming a different mistake. A chart
// explaining what a specification means is frequently the best possible lead
// image, and a rule that pushed every graphic down the page would make the site
// worse. The goal is variety, not photograph-supremacy: a run of four
// photographs is broken up exactly as readily as a run of four diagrams.
//
// Pure. No I/O.

export type VisualKind = "photograph" | "graphic" | "none";

export type VisuallyRankable = {
  /** Position from the editorial ranking. Lower is better. */
  rank: number;
  kind: VisualKind;
};

/**
 * The furthest an item may move from its ranked position.
 *
 * Two. Enough to break a run, small enough that the ordering a reader sees is
 * still recognisably the editorial one. A larger value would let visual rhythm
 * override editorial judgement, which is the opposite of the intent.
 */
export const MAX_DISPLACEMENT = 2;

/** How many consecutive items of one kind before it reads as monotonous. */
export const MAX_RUN = 2;

/**
 * Classify a hero image by what it actually is.
 *
 * Reads the same signals the media pipeline already stores. `none` is its own
 * kind rather than being folded into `graphic`: an item with no image is a
 * different visual event from one with a diagram, and grouping them would let
 * two image-less cards sit together.
 */
export function visualKind(input: {
  hasImage: boolean;
  sourceType?: string | null;
  assetRole?: string | null;
}): VisualKind {
  if (!input.hasImage) return "none";
  if (input.sourceType === "tc_graphic") return "graphic";
  if (["diagram", "chart", "comparison_graphic"].includes(input.assetRole ?? "")) return "graphic";
  return "photograph";
}

/**
 * Reorder to break up runs, without letting anything drift far from its rank.
 *
 * Greedy and stable: at each position it takes the best-ranked candidate whose
 * kind does not extend the current run beyond MAX_RUN; if every eligible
 * candidate would, it takes the best-ranked one anyway rather than reaching
 * further down the list. Variety is a preference, never a mandate — a section
 * whose items genuinely are all diagrams stays in rank order.
 */
export function diversifyByMedia<T extends VisuallyRankable>(items: readonly T[]): T[] {
  const pool = [...items].sort((a, b) => a.rank - b.rank);
  const out: T[] = [];
  let runKind: VisualKind | null = null;
  let runLength = 0;

  while (pool.length > 0) {
    let chosenIndex = 0;

    if (runKind !== null && runLength >= MAX_RUN) {
      // Look for the best-ranked candidate of a DIFFERENT kind, but only within
      // reach: an item may not jump more than MAX_DISPLACEMENT places.
      const limit = Math.min(pool.length, MAX_DISPLACEMENT + 1);
      const alt = pool.slice(0, limit).findIndex((i) => i.kind !== runKind);
      if (alt !== -1) chosenIndex = alt;
    }

    const [chosen] = pool.splice(chosenIndex, 1);
    out.push(chosen);
    if (chosen.kind === runKind) runLength++;
    else { runKind = chosen.kind; runLength = 1; }
  }

  return out;
}

/**
 * The longest run of one visual kind in a sequence. Used by tests and by the
 * homepage audit to state the problem in one number.
 */
export function longestRun(items: readonly VisuallyRankable[]): number {
  let best = 0;
  let cur = 0;
  let kind: VisualKind | null = null;
  for (const i of items) {
    if (i.kind === kind) cur++;
    else { kind = i.kind; cur = 1; }
    if (cur > best) best = cur;
  }
  return best;
}
