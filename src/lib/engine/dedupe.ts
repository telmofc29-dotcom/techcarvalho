// Deduplication for discovery candidates.
//
// The problem this solves: one product announcement gets covered by a dozen
// outlets within an hour. Without a stable fingerprint, a daily discovery run
// creates a dozen near-identical candidates and the pipeline drowns in noise.
//
// The fingerprint is deliberately built from *normalised meaning*, not from
// the URL or the exact headline — those differ per outlet for the same story.

const STOPWORDS = new Set([
  "the", "a", "an", "and", "or", "but", "is", "are", "was", "were", "be", "been",
  "to", "of", "in", "on", "at", "for", "with", "by", "from", "as", "it", "its",
  "this", "that", "these", "those", "now", "new", "official", "officially",
  "announced", "announces", "announcement", "reveals", "revealed", "launch",
  "launches", "launched", "here", "s", "what", "you", "your", "we",
]);

// Very light stemming — enough to make "increase"/"increases" and
// "confirm"/"confirms" match, which is the common case across outlets
// rewording the same headline. Deliberately not a full stemmer: aggressive
// stemming would start collapsing genuinely different product names.
function stem(token: string): string {
  // Strip a trailing plural/third-person "s" only. Stripping "es" as a unit
  // was tried and is wrong: "increases" -> "increas" no longer matches
  // "increase". Removing just the "s" makes both sides converge.
  if (token.length > 3 && token.endsWith("s") && !token.endsWith("ss")) return token.slice(0, -1);
  return token;
}

/** Lowercase, strip punctuation, drop stopwords, stem, sort — order-insensitive. */
function significantTokens(input: string): string[] {
  return [
    ...new Set(
      input
        .toLowerCase()
        .replace(/[^a-z0-9\s-]/g, " ")
        .split(/[\s-]+/)
        .filter((t) => t.length > 1 && !STOPWORDS.has(t))
        .map(stem)
        .filter((t) => !STOPWORDS.has(t))
    ),
  ].sort();
}

/**
 * Stable fingerprint for an announcement. Two headlines describing the same
 * event should produce the same key even with different wording/outlets.
 *
 * `discoveryType` is included so a "spec change" and a "product launch" about
 * the same device don't collapse into one another — they need separate
 * handling downstream.
 */
export function buildDedupeKey(input: {
  title: string;
  discoveryType: string;
  /** Optional entity anchor (product slug, manufacturer) — sharpens matching. */
  entityKey?: string | null;
}): string {
  const tokens = significantTokens(input.title);
  // Cap token count so an unusually long headline doesn't defeat matching
  // against a shorter headline about the same event.
  const core = tokens.slice(0, 8).join("-");
  const entity = input.entityKey ? significantTokens(input.entityKey).join("-") : "";
  return [input.discoveryType, entity, core].filter(Boolean).join("::").slice(0, 400);
}

/**
 * Jaccard similarity over significant tokens. Used as a secondary check for
 * near-duplicates that produce different keys (e.g. one headline naming the
 * model number and another not).
 */
export function titleSimilarity(a: string, b: string): number {
  const ta = new Set(significantTokens(a));
  const tb = new Set(significantTokens(b));
  if (ta.size === 0 || tb.size === 0) return 0;
  let shared = 0;
  for (const t of ta) if (tb.has(t)) shared++;
  const union = ta.size + tb.size - shared;
  return union === 0 ? 0 : shared / union;
}

/** Above this, two candidates are treated as the same story. */
export const NEAR_DUPLICATE_THRESHOLD = 0.6;

export function isNearDuplicate(a: string, b: string): boolean {
  return titleSimilarity(a, b) >= NEAR_DUPLICATE_THRESHOLD;
}
