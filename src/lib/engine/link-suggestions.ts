// Internal-link suggestion and orphan detection.
//
// The problem this exists for: an article can be technically published and
// still be invisible. If nothing links to it and it links to nothing, readers
// never reach it from anywhere else on the site and search engines see a page
// with no internal support. This project's standard is explicit — a published
// article isolated from the rest of TechCarvalho is not finished.
//
// Nine such orphans were found and linked by hand; this module is that work
// generalised so it does not have to be done by hand again.
//
// Deliberately conservative. A weak "related" link is worse than none: it
// wastes the reader's click and dilutes the real relationships. So the bar for
// an automatic link is high, and anything below it is surfaced for a human
// rather than guessed at.
//
// Deterministic. No AI provider.

import { compareDesignations } from "../media/identity.ts";

/** Words that carry no topical signal in a tech headline. */
const STOPWORDS = new Set([
  "the", "a", "an", "and", "or", "for", "with", "your", "you", "is", "are",
  "to", "of", "in", "on", "how", "what", "why", "when", "which", "best",
  "vs", "versus", "new", "actually", "really", "guide", "explained", "about",
  "should", "need", "needs", "do", "does", "it", "its", "that", "this",
  "buy", "buying", "worth", "before", "after", "here", "s", "t",
  // Filler that survives the length filter and would otherwise create
  // spurious overlap between unrelated headlines.
  "there", "almost", "have", "has", "had", "not", "dont", "doesnt", "wont",
  "get", "got", "make", "makes", "know", "know", "one", "two", "out", "off",
  "but", "than", "then", "into", "from", "over", "under", "still", "just",
  "much", "many", "most", "more", "less", "own", "way", "ways", "now", "was",
  "were", "been", "who", "whose", "will", "can", "cant", "and", "all", "any",
]);

/**
 * Light stemming: strips only a trailing "s".
 *
 * Enough to make "GPUs" match "GPU" and "lenses" match "lens", which is the
 * common case in headlines. Deliberately not a real stemmer — an aggressive
 * one turns "bus" into "bu" and starts matching things that are not related,
 * and the same conservative choice is already made in dedupe.ts.
 */
function stem(token: string): string {
  return token.length > 3 && token.endsWith("s") ? token.slice(0, -1) : token;
}

// Concept groups.
//
// Measured need, not speculation: scoring 29 hand-picked links found that pure
// term overlap reproduced only 5 of them. Every miss was conceptual rather
// than lexical — "Why There Are Almost No New Nvidia GPUs" and "RTX 5090 vs
// RTX 5080" are plainly the same subject and share no word at all.
//
// Each entry adds a concept token when any of its terms appears, so the two
// headlines above both gain "concept:gpu". The terms themselves are kept, so
// this only ever adds signal.
const CONCEPTS: [string, RegExp][] = [
  ["gpu", /\b(gpu|gpus|graphics|nvidia|geforce|rtx|radeon|amd's gpu|vram)\b/i],
  ["cpu", /\b(cpu|cpus|processor|ryzen|intel|core i\d|x3d|chip|chips)\b/i],
  ["upgrade", /\b(upgrade|upgrading|upgrades|worth it|next-gen|generation|newer)\b/i],
  ["console", /\b(ps5|ps6|playstation|xbox|switch|console|consoles)\b/i],
  ["camera", /\b(camera|cameras|dslr|mirrorless|eos|sensor|lens|lenses|photograph)\b/i],
  ["phone", /\b(phone|phones|smartphone|iphone|galaxy|pixel|android)\b/i],
  ["network", /\b(wi-?fi|wifi|router|routers|mesh|ethernet|network|networking)\b/i],
  ["ai", /\b(ai|llm|llms|neural|machine learning|openai|humane|rabbit)\b/i],
  ["robot", /\b(robot|robots|robotic|vacuum|humanoid)\b/i],
  ["storage", /\b(ssd|nvme|storage|drive|drives|memory card|capacity)\b/i],
  ["video", /\b(4k|8k|video|footage|recording|codec)\b/i],
  ["smarthome", /\b(smart home|matter|thread|zigbee|hue|homekit)\b/i],
  ["drone", /\b(drone|drones|fpv|dji|osmo)\b/i],
  ["astro", /\b(astro|astrophotography|milky way|telescope|equatorial|bortle|meteor)\b/i],
  ["power", /\b(power supply|psu|wattage|watts|battery|batteries)\b/i],
  ["price", /\b(price|prices|pricing|expensive|cost|costs|\$\d)\b/i],
];

/** Topical terms in a title, normalised, lightly stemmed, concept-expanded. */
export function topicTerms(title: string): Set<string> {
  const terms = new Set(
    title
      .toLowerCase()
      .replace(/[^a-z0-9\s-]/g, " ")
      .split(/[\s-]+/)
      .filter((t) => t.length > 2 && !STOPWORDS.has(t))
      .map(stem)
      .filter((t) => t.length > 1 && !STOPWORDS.has(t))
  );
  for (const [concept, pattern] of CONCEPTS) {
    if (pattern.test(title)) terms.add(`concept:${concept}`);
  }
  return terms;
}

export type LinkCandidate = {
  id: string;
  title: string;
  categoryId: string | null;
  type: string;
  /** Recorded associations. Optional — absent means "nothing is known". */
  evidence?: LinkEvidence;
};

export type LinkSuggestion = {
  fromId: string;
  toId: string;
  toTitle: string;
  /** 0-1. How strongly these two pieces actually belong together. */
  score: number;
  reason: string;
};

/**
 * Above this an automatic link is justified. Set high on purpose: the cost of
 * a wrong link is paid by every reader who clicks it.
 */
export const AUTO_LINK_THRESHOLD = 0.5;

/**
 * What is KNOWN about a piece, as opposed to what its title happens to say.
 *
 * WHY THIS WAS ADDED
 * ------------------
 * `relatedness()` was shared-term overlap over titles. That is raw keyword
 * matching, and on this site's headlines it links on ordinary English: two
 * pieces both titled "... What They Actually Promise" share three terms and
 * score as related while being about system requirements and humanoid robots.
 * It is the same defect the media matcher had, in a different subsystem, and it
 * is fixed the same way — with evidence rather than a longer stopword list.
 *
 * Every field here is a RECORDED RELATIONSHIP the site already stores. None of
 * it is inferred from prose:
 *
 *   productIds     content_products      which products the piece is about
 *   tagIds         content_tags          editorial taxonomy
 *   conceptIds     content_technologies  knowledge-graph concepts
 *   manufacturerIds  derived from the products
 *   familyIds        derived from the products
 *
 * Optional, every one of them. A piece with no associations falls back to the
 * title comparison it always had, which is why adding this can strengthen a
 * link but never invents one where nothing was known.
 */
export type LinkEvidence = {
  productIds?: readonly string[];
  familyIds?: readonly string[];
  manufacturerIds?: readonly string[];
  tagIds?: readonly string[];
  conceptIds?: readonly string[];
};

/**
 * Words that name something this publication covers.
 *
 * The SAME vocabulary the media matcher uses (media/entity-vocabulary.ts),
 * built from the same catalogue rows. Supplying it makes an ordinary shared
 * word worth nothing here too; omitting it leaves the previous behaviour
 * exactly as it was.
 */
export type LinkContext = {
  entityVocabulary?: ReadonlySet<string>;
};

const overlapCount = (a?: readonly string[], b?: readonly string[]): number => {
  if (!a?.length || !b?.length) return 0;
  const set = new Set(a);
  return b.filter((x) => set.has(x)).length;
};

/**
 * How much two pieces genuinely belong together, on evidence.
 *
 * THE WEIGHTS, AND WHY THEY ARE ORDERED THIS WAY
 * ----------------------------------------------
 *   same product        0.55  the strongest thing the site can know. Two pieces
 *                             recorded against the same product row ARE related.
 *   same concept        0.35  a knowledge-graph link somebody established
 *   same family         0.25  the same product line, not the same product
 *   shared tag          0.20  editorial taxonomy, chosen by a person
 *   same manufacturer   0.08  weak on purpose. "Both mention Samsung" is the
 *                             brief's example of a link that must not be made,
 *                             so it can contribute but never carry a pairing.
 *   naming-word overlap 0.30  title words that name something real
 *   same category       0.15  a nudge, unchanged
 *   same type          -0.05  two comparisons compete for one intent
 *
 * A DIFFERENT MODEL CAPS THE RESULT. If both titles name a model designation and
 * the designations disagree, the pieces are about different products and the
 * score is held below AUTO_LINK_THRESHOLD — an EOS R5 review and an EOS R5 Mark
 * II review are related and are not interchangeable. This is the same
 * compareDesignations veto the coverage engine and the media matcher use.
 */
export function relatedness(
  a: LinkCandidate,
  b: LinkCandidate,
  context: LinkContext = {}
): number {
  const vocabulary = context.entityVocabulary;

  let score = 0;
  const ea = a.evidence ?? {};
  const eb = b.evidence ?? {};

  if (overlapCount(ea.productIds, eb.productIds) > 0) score += 0.55;
  if (overlapCount(ea.conceptIds, eb.conceptIds) > 0) score += 0.35;
  if (overlapCount(ea.familyIds, eb.familyIds) > 0) score += 0.25;
  if (overlapCount(ea.tagIds, eb.tagIds) > 0) score += 0.2;
  if (overlapCount(ea.manufacturerIds, eb.manufacturerIds) > 0) score += 0.08;

  // Title overlap still contributes, but only on words that NAME something when
  // a vocabulary is supplied. Without one, behaviour is unchanged.
  const ta = topicTerms(a.title);
  const tb = topicTerms(b.title);
  const shared = [...ta].filter((t) => tb.has(t));
  const naming = vocabulary
    ? shared.filter((t) => vocabulary.has(t) || t.startsWith("concept:"))
    : shared;
  // STRICTLY ADDITIVE. This is the ORIGINAL overlap term, at its original
  // weight, so a pair that scored above the bar before still does. Evidence
  // above can only ever strengthen a pairing; it never weakens one.
  //
  // The one change is WHICH shared terms count. With a vocabulary supplied,
  // only words that name something the site covers do — so "both say
  // 'actually'" stops being relatedness while "both say 'GPU'" still is.
  // Without a vocabulary the filter is a no-op and behaviour is unchanged,
  // which is what keeps this safe to add underneath existing callers.
  if (naming.length > 0 && ta.size > 0 && tb.size > 0) {
    score += naming.length / Math.min(ta.size, tb.size);
  }

  if (score <= 0) return 0;

  if (a.categoryId && a.categoryId === b.categoryId) score += 0.15;
  if (a.type === b.type) score -= 0.05;

  // THE VETO. Same shape as the coverage engine's and the media matcher's.
  const identity = compareDesignations(a.title, b.title);
  if (identity.conflict) {
    score = Math.min(score, AUTO_LINK_THRESHOLD - 0.01);
  }

  return Math.max(0, Math.min(1, score));
}

/** Why two pieces were paired, in words an editor can check. */
export function explainRelatedness(
  a: LinkCandidate,
  b: LinkCandidate,
  context: LinkContext = {}
): string {
  const ea = a.evidence ?? {};
  const eb = b.evidence ?? {};
  const parts: string[] = [];
  if (overlapCount(ea.productIds, eb.productIds) > 0) parts.push("both are recorded against the same product");
  if (overlapCount(ea.conceptIds, eb.conceptIds) > 0) parts.push("share a knowledge-graph concept");
  if (overlapCount(ea.familyIds, eb.familyIds) > 0) parts.push("cover the same product family");
  if (overlapCount(ea.tagIds, eb.tagIds) > 0) parts.push("share an editorial tag");
  if (overlapCount(ea.manufacturerIds, eb.manufacturerIds) > 0) parts.push("share a manufacturer");

  const vocabulary = context.entityVocabulary;
  const tb = topicTerms(b.title);
  const shared = [...topicTerms(a.title)].filter((t) => tb.has(t));
  const naming = vocabulary ? shared.filter((t) => vocabulary.has(t) || t.startsWith("concept:")) : shared;
  if (naming.length > 0) parts.push(`name the same things (${naming.slice(0, 4).join(", ")})`);
  if (a.categoryId && a.categoryId === b.categoryId) parts.push("sit in the same category");

  const identity = compareDesignations(a.title, b.title);
  const veto = identity.conflict
    ? ` They name DIFFERENT models (${[...identity.onlyInSubject, ...identity.onlyInOther].slice(0, 3).join(", ")}), so this is a related-reading link, not the same subject.`
    : "";

  return (parts.length > 0 ? `They ${parts.join(", ")}.` : "No recorded relationship.") + veto;
}

/**
 * Content that is published but connected to nothing.
 *
 * @param linkedIds ids appearing in ANY relationship, in either direction, or
 *   carrying a product association. Both count as connection — a piece linked
 *   to a product page is reachable, even with no sibling article.
 */
export function findOrphans(
  published: LinkCandidate[],
  linkedIds: Set<string>
): LinkCandidate[] {
  return published.filter((c) => !linkedIds.has(c.id));
}

/**
 * Ranked link suggestions for one item.
 *
 * Excludes pairs that already exist in either direction — content
 * relationships are stored one-directional and the reverse is inferred at
 * query time, so inserting the reciprocal would be a duplicate, not a second
 * link.
 */
export function suggestLinksFor(
  item: LinkCandidate,
  candidates: LinkCandidate[],
  existingPairs: Set<string>,
  limit = 4,
  context: LinkContext = {}
): LinkSuggestion[] {
  const out: LinkSuggestion[] = [];
  for (const other of candidates) {
    if (other.id === item.id) continue;
    if (existingPairs.has(pairKey(item.id, other.id))) continue;

    const score = relatedness(item, other, context);
    if (score <= 0) continue;

    out.push({
      fromId: item.id,
      toId: other.id,
      toTitle: other.title,
      score: Number(score.toFixed(3)),
      reason: `${explainRelatedness(item, other, context)} Score ${score.toFixed(2)}.`,
    });
  }
  out.sort((a, b) => b.score - a.score);
  return out.slice(0, limit);
}

/** Order-independent key, since a relationship counts in either direction. */
export function pairKey(a: string, b: string): string {
  return a < b ? `${a}|${b}` : `${b}|${a}`;
}
