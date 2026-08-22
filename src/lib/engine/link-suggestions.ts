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

/** Shared-term overlap, with a bonus for same-category pairs. */
export function relatedness(a: LinkCandidate, b: LinkCandidate): number {
  const ta = topicTerms(a.title);
  const tb = topicTerms(b.title);
  if (ta.size === 0 || tb.size === 0) return 0;

  let shared = 0;
  for (const t of ta) if (tb.has(t)) shared++;
  if (shared === 0) return 0;

  // Overlap relative to the smaller title, so a short focused title can still
  // match a longer one about the same subject.
  const overlap = shared / Math.min(ta.size, tb.size);

  // Same category is real evidence of relatedness, but only a nudge — the
  // whole point is to find links, not to link everything in a category to
  // everything else in it.
  const sameCategory = a.categoryId && a.categoryId === b.categoryId ? 0.15 : 0;

  // Two pieces of the SAME type about the same subject are often competitors
  // for the same search intent rather than complements. A small penalty keeps
  // comparison-to-comparison links from crowding out more useful pairings.
  const sameTypePenalty = a.type === b.type ? 0.05 : 0;

  return Math.max(0, Math.min(1, overlap + sameCategory - sameTypePenalty));
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
  limit = 4
): LinkSuggestion[] {
  const out: LinkSuggestion[] = [];
  for (const other of candidates) {
    if (other.id === item.id) continue;
    if (existingPairs.has(pairKey(item.id, other.id))) continue;

    const score = relatedness(item, other);
    if (score <= 0) continue;

    const shared = [...topicTerms(item.title)].filter((t) =>
      topicTerms(other.title).has(t)
    );
    out.push({
      fromId: item.id,
      toId: other.id,
      toTitle: other.title,
      score: Number(score.toFixed(3)),
      reason:
        `Shares ${shared.length} topic term(s) (${shared.slice(0, 4).join(", ")})` +
        (item.categoryId && item.categoryId === other.categoryId ? " and the same category" : "") +
        `. Score ${score.toFixed(2)}.`,
    });
  }
  out.sort((a, b) => b.score - a.score);
  return out.slice(0, limit);
}

/** Order-independent key, since a relationship counts in either direction. */
export function pairKey(a: string, b: string): string {
  return a < b ? `${a}|${b}` : `${b}|${a}`;
}
