// The two derived values in the mobile article header, kept out of the page.
//
// Both are computed from what the article already contains rather than stored,
// for the same reason the reading estimate is: a field somebody has to remember
// to fill in is a field that is right once and wrong afterwards.
//
// Pure. No I/O, no clock beyond the dates handed in.

import { excerptFromBody } from "./body-format.ts";

/**
 * How much later than publication counts as a real revision.
 *
 * `updated_at` moves for reasons a reader does not care about — a status flip,
 * a tag change, a re-run of a backfill. Labelling a piece "Updated" because its
 * row was touched an hour after publication overstates the maintenance, and a
 * publication that overstates its maintenance is exactly what this project is
 * trying not to be.
 *
 * A full day is the threshold because it is the granularity actually shown: the
 * header renders a date, not a time, so anything inside the same day would
 * print "Updated 21 August" beside a piece published on 21 August — which reads
 * as either a lie or a bug.
 */
export const REVISION_THRESHOLD_MS = 24 * 60 * 60 * 1000;

export type DisplayDate = {
  iso: string;
  label: string;
  /** True when this is a genuine later revision, not the original publication. */
  revised: boolean;
};

/**
 * Which date to show, and whether to call it Published or Updated.
 *
 * The page previously rendered "Published" and nothing else. `updated_at`
 * reached the JSON-LD — so a crawler saw the revision — while the reader was
 * shown the original date. A piece revised a month after publication therefore
 * looked stale to the person and current to the machine, which is precisely
 * backwards.
 */
/**
 * Evidence that the PROSE actually changed.
 *
 * WHY A TIME THRESHOLD WAS NOT ENOUGH
 * -----------------------------------
 * REVISION_THRESHOLD_MS assumed `updated_at` moving a long way from
 * `published_at` meant a revision. It does not. On 2026-08-23 a single bulk
 * write touched all 81 rows within the same minute, two days after most of them
 * were published, and every article on the site began announcing
 * "Updated 23 August 2026" — and emitting that date as `dateModified` in its
 * structured data. Nothing had been revised. Eighty-one pages were making a
 * maintenance claim that was false, to readers and to crawlers alike.
 *
 * The lesson is that `updated_at` is a ROW-TOUCH timestamp. Nothing in this
 * system writes it to mean "an editor revised this", so it cannot be read as
 * that no matter how large the gap. A revision claim now needs positive
 * evidence, and there are two real sources of it:
 *
 *   proseRevisions   content_items.translatable_revision, bumped by trigger
 *                    ONLY when title or body change (verified behaviourally
 *                    against production: a status flip leaves it alone, a title
 *                    edit is +1, a body edit is +1). Starts at 1, so > 1 means
 *                    the words genuinely changed at least once.
 *   lastReviewedAt   a freshness_log row — a person recorded a review.
 *
 * With neither, the honest label is the publication date. Absence of evidence
 * is not evidence of revision.
 */
export type RevisionEvidence = {
  /** content_items.translatable_revision. 1 means never edited since creation. */
  proseRevisions?: number | null;
  /** Most recent freshness_log.reviewed_at, if any. */
  lastReviewedAt?: string | null;
};

export function articleDisplayDate(
  publishedAt: string | null | undefined,
  updatedAt: string | null | undefined,
  evidence: RevisionEvidence = {}
): DisplayDate | null {
  const published = publishedAt ? new Date(publishedAt) : null;
  const updated = updatedAt ? new Date(updatedAt) : null;
  const valid = (d: Date | null): d is Date => d !== null && !Number.isNaN(d.getTime());

  const format = (d: Date) =>
    d.toLocaleDateString("en-GB", { year: "numeric", month: "long", day: "numeric" });

  const p = valid(published) ? published : null;
  const u = valid(updated) ? updated : null;

  if (p === null && u === null) return null;
  if (p === null) {
    // Updated but never published is not a state this site should reach; if it
    // does, show the date without claiming a publication that did not happen.
    return { iso: u!.toISOString(), label: format(u!), revised: true };
  }
  if (u === null) {
    return { iso: p.toISOString(), label: format(p), revised: false };
  }

  // A revision claim needs BOTH a plausible gap AND positive evidence that the
  // prose changed. Either alone is how 81 pages came to announce an update
  // nobody made — see RevisionEvidence.
  const gapIsPlausible = u.getTime() - p.getTime() >= REVISION_THRESHOLD_MS;

  const reviewed = evidence.lastReviewedAt ? new Date(evidence.lastReviewedAt) : null;
  const reviewedAfterPublication =
    valid(reviewed) && reviewed.getTime() - p.getTime() >= REVISION_THRESHOLD_MS;
  const proseChanged = (evidence.proseRevisions ?? 1) > 1;

  const revised = gapIsPlausible && (proseChanged || reviewedAfterPublication);
  const shown = revised ? u : p;
  return { iso: shown.toISOString(), label: format(shown), revised };
}

/** Below this, a deck is a fragment rather than a sentence. */
export const MIN_DECK_LENGTH = 40;

/**
 * How similar to the headline a deck may be before it is worthless.
 *
 * A deck that restates the headline costs a reader a line and tells them
 * nothing. Measured as the share of the headline's significant words that also
 * appear in the deck.
 */
export const MAX_HEADLINE_OVERLAP = 0.8;

function significantWords(text: string): string[] {
  return text
    .toLowerCase()
    .replace(/[^a-z0-9\s-]/g, " ")
    .split(/\s+/)
    .filter((w) => w.length > 3);
}

/**
 * The short summary shown under the metadata line.
 *
 * Prefers a hand-written meta description, because somebody chose those words.
 * Falls back to the article's OWN first paragraph — which is the important
 * property: the deck can never be generic SEO filler bolted on afterwards,
 * because it is literally the piece's opening sentence.
 *
 * Returns null rather than something weak. A deck that restates the headline,
 * or that is too short to be a sentence, is worse than no deck: it costs a
 * reader a line of screen on a phone and gives them nothing for it.
 */
export function articleDeck(input: {
  metaDescription: string | null | undefined;
  body: string | null | undefined;
  title: string;
}): string | null {
  const candidate =
    (input.metaDescription && input.metaDescription.trim()) || excerptFromBody(input.body) || null;
  if (!candidate) return null;

  const text = candidate.replace(/\s+/g, " ").trim();
  if (text.length < MIN_DECK_LENGTH) return null;

  const titleWords = new Set(significantWords(input.title));
  if (titleWords.size > 0) {
    const deckWords = new Set(significantWords(text));
    let shared = 0;
    for (const w of titleWords) if (deckWords.has(w)) shared++;
    if (shared / titleWords.size > MAX_HEADLINE_OVERLAP) return null;
  }

  return text;
}
