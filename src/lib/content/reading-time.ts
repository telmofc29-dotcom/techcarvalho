// Estimated reading time, from the article's actual readable prose.
//
// WHY IT IS DERIVED AND NOT A COLUMN
// ----------------------------------
// A hand-entered reading time is a number nobody updates. It is right on the
// day it is typed and wrong from the first edit onward, and a reader who
// notices "3 min read" on a piece that takes ten has learned something about
// how much care the publication takes. Deriving it means it cannot drift.
//
// WHAT IT COUNTS, AND WHAT IT DELIBERATELY DOES NOT
// -------------------------------------------------
// Only the article BODY, parsed into blocks. That excludes navigation,
// breadcrumbs, metadata, the source/citation list, related-article rails and
// the footer — none of which a reader "reads" in the sense the estimate is
// promising. Counting page chrome would inflate every short article by roughly
// the same amount, which is worse than useless: it would make the number look
// plausible while being systematically wrong in one direction.
//
// Headings ARE counted, because a reader does read them, and lists are counted
// item by item. What is not counted is anything outside the body column.
//
// THE CONSTANT
// ------------
// 220 words per minute. Adult silent reading of general prose sits around
// 200-250 wpm in the literature, and technology writing carrying model numbers
// and specifications sits at the slower end of whatever range a reader is
// personally in. 220 is a defensible middle rather than a flattering one; a
// higher figure would make every article look like a quicker read than it is,
// which is the direction that erodes trust.
//
// Pure. No I/O, no clock, no database.

import { parseBodyBlocks } from "./body-format.ts";

export const WORDS_PER_MINUTE = 220;

/**
 * The floor, in minutes.
 *
 * Nothing reports "0 min read": a reader seeing that learns the number is not
 * being computed from anything. A very short piece is honestly "1 min read".
 */
export const MINIMUM_MINUTES = 1;

/**
 * Below this many words, no estimate is offered at all.
 *
 * A 40-word stub rounded up to "1 min read" dresses a fragment as an article.
 * Returning null lets the caller render nothing, which is the honest output for
 * something too short to have a meaningful reading time — and, usefully, makes
 * thin content visible rather than papering over it.
 */
export const MINIMUM_WORDS_FOR_ESTIMATE = 60;

export type ReadingTime = {
  words: number;
  minutes: number;
  /** Ready to render, e.g. "6 min read". */
  label: string;
};

/** Words in one run of text. Deliberately simple and deliberately documented. */
function countWords(text: string): number {
  const trimmed = text.trim();
  if (trimmed === "") return 0;
  // Split on whitespace. A hyphenated compound ("Wi-Fi", "9800X3D") counts as
  // one word, which is what a reader experiences; splitting on punctuation
  // would inflate technology prose specifically, since it is dense with model
  // numbers and hyphenated names.
  return trimmed.split(/\s+/).filter(Boolean).length;
}

/**
 * Count the readable words in an article body.
 *
 * Exported separately from the estimate because word count is itself useful —
 * the content-quality audit needs it to find thin articles, and deriving both
 * from one parser means the two can never disagree about what counts as prose.
 */
export function countBodyWords(body: string | null | undefined): number {
  if (!body) return 0;
  let words = 0;
  for (const block of parseBodyBlocks(body)) {
    if (block.kind === "paragraph") words += countWords(block.text);
    else if (block.kind === "heading") words += countWords(block.text);
    else if (block.kind === "list") {
      for (const item of block.items) words += countWords(item);
    }
  }
  return words;
}

/**
 * Estimate reading time, or null when the body is too short to justify one.
 *
 * Rounds to the nearest minute rather than always up. Always rounding up makes
 * every article one minute longer than it is, which is a small systematic lie
 * repeated on every page.
 */
export function estimateReadingTime(body: string | null | undefined): ReadingTime | null {
  const words = countBodyWords(body);
  if (words < MINIMUM_WORDS_FOR_ESTIMATE) return null;

  const raw = words / WORDS_PER_MINUTE;
  const minutes = Math.max(MINIMUM_MINUTES, Math.round(raw));
  return { words, minutes, label: `${minutes} min read` };
}
