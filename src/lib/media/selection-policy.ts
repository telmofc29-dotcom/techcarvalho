// WHOSE CHOICE MAY THE ENGINE RECONSIDER, AND WHICH OF TWO EQUAL IMAGES SHOULD
// IT PICK?
//
// Two rules that only became expressible on 2026-08-27, when
// 20260826_media_selection_provenance.sql was applied and content_media finally
// recorded WHO filled a slot.
//
// BEFORE: suggestion-service.ts treated EVERY occupied hero and thumbnail as
// human-selected, because it had no way to tell, and overwriting a deliberate
// editorial choice is the worse error. That was correct and it blocked
// automatic media association completely — an engine attach would have become
// indistinguishable from the owner's decision the instant it was written, and
// then protected from the very re-matching meant to improve it.
//
// NOW: 'human' and 'unknown' are protected; 'engine' may be reconsidered.
// `unknown` sits with `human` deliberately. 170 links predate the column and
// nobody can say which were deliberate; calling them engine would licence the
// machine to overwrite images the owner did choose. The safe reading of an
// unknown is the conservative one.
//
// Pure. No I/O.

import type { MediaSelectionKind } from "@/lib/types/database";

/**
 * May the engine take this slot from whoever holds it?
 *
 * The ONLY place this question is answered. A second copy of it would drift the
 * way the four copies of the model-identity vocabulary drifted, and the cost
 * here is higher: the failure mode is silently replacing an image a person
 * chose on purpose.
 */
export function isProtectedSelection(kind: MediaSelectionKind | null | undefined): boolean {
  return kind !== "engine";
}

/** How a slot came to be filled, for display and for the rules below. */
export const SELECTION_LABEL: Record<MediaSelectionKind, string> = {
  human: "chosen by an admin",
  engine: "attached automatically, and may be reconsidered",
  unknown: "predates provenance tracking, so treated as an editorial choice",
};

// ---------------------------------------------------------------------------
// Rotation
// ---------------------------------------------------------------------------

/**
 * A candidate for one slot, reduced to what rotation is allowed to see.
 *
 * Deliberately NOT the whole MediaMatch: rotation must not be able to reach
 * specificity or rights, because the one thing it must never do is let a
 * less-accurate image win.
 */
export type RotationCandidate = {
  assetId: string;
  /** The matcher's score. Higher is a better match. */
  score: number;
  /** How many slots this asset already occupies anywhere on the site. */
  usageCount: number;
};

/**
 * How close two scores must be before they count as equally good.
 *
 * RELEVANCE BEATS DIVERSITY, and this constant is where that is enforced. Set
 * it too wide and a worse image wins because it happens to be fresher; set it
 * to zero and the same photograph leads every article about a product forever.
 *
 * 6 is one notch on the scale scoreMatch actually uses: a description-derived
 * match is worth +8 over a filename-derived one, and a nature bonus separates
 * an owner photograph (+30) from an official one (+18). So a 6-point band can
 * only ever group images that differ by rounding, never by kind of evidence.
 */
export const ROTATION_BAND = 6;

/**
 * Order candidates for one slot: best match first, and among equals, the one
 * doing the least work elsewhere.
 *
 * WHAT THIS CANNOT DO, BY CONSTRUCTION. It cannot promote a lower-scoring image
 * above a higher-scoring one outside the band, so usage tracking can never make
 * an inaccurate image beat an accurate one. If one image is uniquely the best
 * exact match, it is returned first every time and is reused — which is the
 * correct answer, not a diversity failure.
 *
 * AGE IS NOT A FACTOR. Older media stays fully eligible: nothing here reads a
 * timestamp. An accurate photograph from two years ago outranks a fresher
 * near-miss, because the fresher one scores lower.
 *
 * Ties beyond usage break on assetId, so the order is stable across runs rather
 * than depending on the order rows came back from the database.
 */
export function orderForSlot(candidates: readonly RotationCandidate[]): RotationCandidate[] {
  const sorted = [...candidates].sort((a, b) => b.score - a.score || a.assetId.localeCompare(b.assetId));
  const out: RotationCandidate[] = [];

  let i = 0;
  while (i < sorted.length) {
    // A band is anchored on the best remaining score, not on a rolling
    // comparison — otherwise a chain of 5-point steps would quietly group a
    // candidate 30 points worse than the leader with the leader.
    const anchor = sorted[i].score;
    let j = i;
    while (j < sorted.length && anchor - sorted[j].score <= ROTATION_BAND) j++;
    const band = sorted.slice(i, j);
    band.sort(
      (a, b) => a.usageCount - b.usageCount || b.score - a.score || a.assetId.localeCompare(b.assetId)
    );
    out.push(...band);
    i = j;
  }

  return out;
}

/**
 * Why this asset was preferred over another of similar quality.
 *
 * Returned so the suggestion queue can say it out loud. A rotation that cannot
 * explain itself is indistinguishable from a random one.
 */
export function explainRotation(
  chosen: RotationCandidate | null,
  runnerUp: RotationCandidate | null
): string | null {
  if (!chosen || !runnerUp) return null;
  if (chosen.score - runnerUp.score > ROTATION_BAND) return null;
  if (chosen.usageCount === runnerUp.usageCount) return null;
  return (
    `Preferred over an equally good candidate (score ${chosen.score} vs ${runnerUp.score}) because it is used ` +
    `${chosen.usageCount === 0 ? "nowhere else yet" : `in ${chosen.usageCount} other place${chosen.usageCount === 1 ? "" : "s"}`}, ` +
    `against ${runnerUp.usageCount}.`
  );
}
