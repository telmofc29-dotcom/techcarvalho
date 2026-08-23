// Content quality inventory.
//
// WHAT THIS IS FOR
// ----------------
// The corpus is bimodal: a handful of genuinely strong pieces and a long tail
// of accurate-but-empty ones, all published inside a 72-hour window. The
// problem is the RATIO, and the leverage is consolidation rather than
// expansion — seven strong pieces out of eighty-one reads as a content farm
// that occasionally tries; seven out of twenty reads as a small publication.
//
// WHAT THIS IS NOT FOR
// --------------------
// It is not a score to optimise, and it must never become one. There is no
// aggregate number anywhere in here, deliberately: a single "quality score"
// invites padding, and padding is explicitly the wrong answer. A 200-word
// article that completely answers its question is better than a 900-word one
// that circles it.
//
// So every verdict names the SIGNALS behind it, and the signals are things that
// can be measured rather than felt: length against the intent the piece claims,
// whether anyone can check it, whether it duplicates a neighbour, whether the
// page shows the thing it is about.
//
// LENGTH IS JUDGED AGAINST INTENT, NOT AGAINST A CONSTANT
// -------------------------------------------------------
// This is the part that matters most. A news item is allowed to be short — that
// is what news is. A comparison at 200 words has not compared anything, and a
// buying guide at 200 words has not guided. The floors below are per content
// type for exactly that reason, and they are floors for SUSPICION, not targets
// to write to.
//
// Pure. No I/O, no clock beyond the dates handed in.

import { countBodyWords } from "./reading-time.ts";

export type ContentVerdict =
  /** Good as it stands. */
  | "KEEP"
  /** Real potential, materially under-served. Improve with research. */
  | "IMPROVE"
  /** Substantially overlaps a stronger sibling. Fold it in. */
  | "MERGE"
  /** Ambiguous. A human decides — deliberately NOT auto-actioned. */
  | "REVIEW";

/**
 * Word counts below which a piece has probably not satisfied its own intent.
 *
 * Derived from what each format has to DO, not from SEO folklore:
 *   comparison    — must state what differs, for at least two things, with
 *                   enough detail to choose. Hard under ~600 words.
 *   guide         — must take a reader from not-knowing to deciding.
 *   troubleshooting — must cover more than one cause, or it fails the reader
 *                   whose cause is the second one.
 *   review        — not published on this site at all today (no hands-on
 *                   testing happens), so the floor is high on purpose.
 *   news          — legitimately short. A 200-word news item is a news item.
 */
export const INTENT_FLOOR: Record<string, number> = {
  comparison: 600,
  guide: 600,
  troubleshooting: 500,
  review: 800,
  news: 150,
};

export const DEFAULT_FLOOR = 400;

export function floorFor(contentType: string): number {
  return INTENT_FLOOR[contentType] ?? DEFAULT_FLOOR;
}

export type ContentSignals = {
  id: string;
  slug: string;
  title: string;
  contentType: string;
  body: string | null;
  /** Rows in source_records for this piece. */
  sourceCount: number;
  /** Of those, how many are reliability_tier = 'primary'. */
  primarySourceCount: number;
  /** Published products linked through content_products. */
  linkedProductCount: number;
  /** True when the hero is a generated graphic rather than a real photograph. */
  heroIsGeneric: boolean;
  /** Internal links in or out (content_relationships, either direction). */
  internalLinkCount: number;
  /** Titles of pieces this one substantially overlaps, if any. */
  overlaps: string[];
};

export type ContentAssessment = {
  id: string;
  slug: string;
  title: string;
  verdict: ContentVerdict;
  words: number;
  floor: number;
  /** The specific, checkable observations behind the verdict. */
  reasons: string[];
};

/**
 * How much of a title's significant vocabulary must be shared before two
 * pieces are treated as covering the same ground.
 *
 * High on purpose. Two camera articles inevitably share "canon" and "camera";
 * that is a topic, not a duplicate. Only a strong overlap suggests the pages
 * are competing rather than neighbouring.
 */
export const OVERLAP_THRESHOLD = 0.7;

/**
 * Words that carry no SUBJECT.
 *
 * The formulaic half of this list is the important half, and it was learned the
 * expensive way: a first run of this detector proposed merging "Canon 6D vs 6D
 * Mark II" into "PS5 vs. PS5 Pro". They share nothing but "worth", "upgrade"
 * and "actually" — a headline FORMULA, not a topic. Acting on that would have
 * redirected a camera article to a games console.
 *
 * This corpus is unusually vulnerable to it: 52% of its titles contain the word
 * "actually", so house style alone can push two unrelated pieces over any
 * naive similarity threshold.
 */
const STOPWORDS = new Set([
  "what", "which", "does", "your", "with", "from", "that", "this", "when", "how",
  "the", "and", "for", "you", "are", "actually", "really", "explained", "guide",
  "best", "should", "here", "their", "them", "into", "about", "than", "then",
  // Formulaic headline vocabulary — house style, not subject matter.
  "worth", "buying", "upgrade", "still", "need", "want", "know", "matter",
  "matters", "give", "gain", "lose", "much", "make", "sense", "begin", "start",
  "versus", "between", "difference", "differences", "compared", "everything",
  "anything", "something", "getting", "before", "after", "right", "wrong",
  "good", "better", "worse", "cheap", "expensive", "buy", "pick", "choose",
  "choosing", "picking", "using", "new", "old", "next", "first", "last",
]);

/**
 * The subject-bearing words in a title.
 *
 * MODEL TOKENS SURVIVE THE LENGTH FILTER, and that is the load-bearing rule.
 * A plain `length > 3` test discards "eos", "60d", "r5", "r6", "ps5" — every
 * model identifier in this catalogue — so "Canon EOS 60D: Is It Still Worth
 * Buying?" reduced to the single token {canon}. Every Canon article then
 * matched every other Canon article at 100%, and the detector proposed merging
 * an R5-vs-R6 comparison into a 60D buying guide.
 *
 * Anything containing a digit is kept whatever its length: that is precisely
 * where the product identity lives in technology writing.
 */
export function titleTokens(title: string): Set<string> {
  return new Set(
    title
      .toLowerCase()
      .replace(/[^a-z0-9\s-]/g, " ")
      .split(/\s+/)
      .filter((w) => {
        if (w === "") return false;
        if (STOPWORDS.has(w)) return false;
        // A model number is subject matter however short: r5, r7, 60d, ps5.
        if (/\d/.test(w)) return true;
        return w.length > 3;
      })
  );
}

/**
 * Below this many subject words, a title cannot support a similarity claim.
 *
 * A one-token title is a brand. Comparing {canon} to {canon} yields a perfect
 * score and means nothing at all.
 */
export const MIN_TOKENS_FOR_OVERLAP = 2;

/** Share of the SMALLER title's vocabulary that the larger one also contains. */
export function titleOverlap(a: string, b: string): number {
  const ta = titleTokens(a);
  const tb = titleTokens(b);
  // A single shared brand is not an overlap. See MIN_TOKENS_FOR_OVERLAP.
  if (ta.size < MIN_TOKENS_FOR_OVERLAP || tb.size < MIN_TOKENS_FOR_OVERLAP) return 0;
  const [small, large] = ta.size <= tb.size ? [ta, tb] : [tb, ta];
  let shared = 0;
  for (const w of small) if (large.has(w)) shared++;
  return shared / small.size;
}

/**
 * Assess one piece.
 *
 * Ordering matters: MERGE is decided before IMPROVE, because improving a piece
 * that should be folded into a neighbour is work spent making two pages compete
 * harder with each other.
 */
export function assessContent(signals: ContentSignals): ContentAssessment {
  const words = countBodyWords(signals.body);
  const floor = floorFor(signals.contentType);
  const reasons: string[] = [];

  const thin = words < floor;
  if (thin) {
    reasons.push(
      `${words} words against a ${floor}-word floor for a ${signals.contentType} — that format has to do ` +
        `something this length probably cannot.`
    );
  }
  if (signals.sourceCount === 0) {
    reasons.push("No source records at all, so nothing here can be checked by a reader.");
  } else if (signals.primarySourceCount === 0) {
    reasons.push(`${signals.sourceCount} source(s), none of them primary.`);
  }
  if (signals.heroIsGeneric && signals.linkedProductCount > 0) {
    reasons.push(
      `Leads with a generated graphic while covering ${signals.linkedProductCount} catalogue product(s) ` +
        `that may already have real photography.`
    );
  }
  if (signals.internalLinkCount === 0) {
    reasons.push("Nothing links to it and it links to nothing.");
  }

  // MERGE first. A thin piece that substantially duplicates a sibling should
  // be folded in, not lengthened — lengthening it makes two pages compete.
  if (signals.overlaps.length > 0 && thin) {
    reasons.unshift(`Substantially overlaps: ${signals.overlaps.join("; ")}.`);
    return { id: signals.id, slug: signals.slug, title: signals.title, verdict: "MERGE", words, floor, reasons };
  }
  if (signals.overlaps.length > 0) {
    reasons.unshift(`Overlaps ${signals.overlaps.join("; ")}, but is substantial in its own right.`);
    return { id: signals.id, slug: signals.slug, title: signals.title, verdict: "REVIEW", words, floor, reasons };
  }

  if (thin && signals.sourceCount === 0) {
    return { id: signals.id, slug: signals.slug, title: signals.title, verdict: "IMPROVE", words, floor, reasons };
  }
  if (thin) {
    return { id: signals.id, slug: signals.slug, title: signals.title, verdict: "IMPROVE", words, floor, reasons };
  }
  if (signals.sourceCount === 0 && signals.contentType !== "troubleshooting") {
    // A troubleshooting piece written from first principles can legitimately
    // carry no external source; a spec-bearing format cannot.
    return { id: signals.id, slug: signals.slug, title: signals.title, verdict: "IMPROVE", words, floor, reasons };
  }

  return {
    id: signals.id,
    slug: signals.slug,
    title: signals.title,
    verdict: "KEEP",
    words,
    floor,
    reasons: reasons.length > 0 ? reasons : ["Meets its format's floor and carries checkable sources."],
  };
}

/**
 * Find genuinely overlapping pieces.
 *
 * TITLE SIMILARITY ALONE IS NOT ENOUGH, and the first version of this function
 * proved it by proposing that a Canon DSLR comparison be merged into a
 * PlayStation one. Both are "X vs Y: is the upgrade worth it", which is a
 * house-style formula rather than a shared subject.
 *
 * So a pair must ALSO be about the same things: sharing a linked product, or a
 * category, is what turns "these headlines rhyme" into "these pages compete".
 * Where no such corroboration exists the pair is not reported at all — a missed
 * merge costs a little duplication, while a wrong merge redirects one subject
 * to another and destroys the original.
 */
export function findOverlaps(
  items: { id: string; title: string; productIds?: string[]; categoryId?: string | null }[]
): Map<string, string[]> {
  const out = new Map<string, string[]>();
  for (const a of items) {
    const hits: string[] = [];
    for (const b of items) {
      if (a.id === b.id) continue;
      if (titleOverlap(a.title, b.title) < OVERLAP_THRESHOLD) continue;

      const sharesProduct =
        (a.productIds ?? []).length > 0 &&
        (a.productIds ?? []).some((p) => (b.productIds ?? []).includes(p));
      // A shared CATEGORY is deliberately NOT corroboration. Every Canon piece
      // sits in cameras-photography, so category agreement is satisfied by
      // almost any pair in a vertical and adds no evidence that two pages
      // compete. A shared linked PRODUCT does: two articles about the same
      // camera, with near-identical titles, are genuinely the same page twice.
      const sharesCategory = false;
      void a.categoryId;
      void b.categoryId;

      // Neither supplied (a caller with no relationship data) falls back to
      // title-only, which is why the stopword list above has to be strict.
      const noCorroborationAvailable =
        a.productIds === undefined && a.categoryId === undefined;

      if (sharesProduct || sharesCategory || noCorroborationAvailable) hits.push(b.title);
    }
    if (hits.length > 0) out.set(a.id, hits);
  }
  return out;
}
