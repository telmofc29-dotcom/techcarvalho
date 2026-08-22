// Entity resolution for products and content.
//
// The problem: "Sony PlayStation 5 Pro", "PS5 Pro" and "PlayStation5 Pro" are
// one product. Without resolution, three feed items create three product rows,
// and the catalogue quietly fills with near-duplicates that are painful to
// merge later.
//
// Deterministic and explainable by design — every decision records why it was
// made, so a wrong match can be audited rather than guessed at.

/** Common brand/model synonyms seen in real feed titles. */
const SYNONYMS: [RegExp, string][] = [
  [/\bplaystation\s*(\d)\b/gi, "ps$1"],
  [/\bps\s*(\d)\b/gi, "ps$1"],
  [/\bxbox\s+series\s+([xs])\b/gi, "xboxseries$1"],
  [/\bnintendo\s+switch\b/gi, "switch"],
  [/\bgeforce\s+rtx\b/gi, "rtx"],
  [/\bradeon\s+rx\b/gi, "rx"],
  [/\biphone\s*/gi, "iphone"],
  [/\bgalaxy\s+s\s*(\d+)/gi, "galaxys$1"],
  [/\bmark\s+([iv]+)\b/gi, "mk$1"],
  [/\bmk\s*([iv]+)\b/gi, "mk$1"],
];

const NOISE = new Set([
  "the", "a", "an", "new", "official", "officially", "announced", "announces",
  "launch", "launches", "launched", "review", "hands", "on", "first", "look",
  "everything", "you", "need", "to", "know", "vs", "versus", "and", "with",
  "for", "is", "are", "now", "available", "release", "released", "update",
]);

/**
 * Meaningful tokens IN THE ORDER THEY WERE WRITTEN, deduplicated.
 *
 * Order is discarded by `normaliseEntityName` (which sorts, so that two
 * spellings of one name produce one key) but it carries real information that
 * the guards below need: a manufacturer qualifier is written BEFORE the model
 * ("Sony PlayStation 5 Pro"), a variant suffix AFTER it ("Pixel 10 Pro XL").
 */
function orderedTokens(input: string): string[] {
  let s = input.toLowerCase();
  for (const [pattern, replacement] of SYNONYMS) s = s.replace(pattern, replacement);
  const tokens = s
    .replace(/[^a-z0-9\s-]/g, " ")
    .split(/[\s-]+/)
    .filter((t) => t.length > 0 && !NOISE.has(t));
  return [...new Set(tokens)];
}

/** Canonical form for comparison: synonyms applied, noise dropped, sorted. */
export function normaliseEntityName(input: string): string {
  return orderedTokens(input).sort().join("-");
}

// Tokens that distinguish one MODEL from another within the same family.
// If one name carries one of these and the other does not, they are different
// products however much else they share — "Canon EOS R5" and "Canon EOS R5
// Mark II" are not the same camera, and merging them would silently destroy a
// successor product.
//
// This list is deliberately NOT the only defence. It was the only defence
// twice, and both times the next unlisted word walked straight through it —
// "mark ii" first, then a bare "2". A closed allow-list of variant words can
// only ever be one product launch behind reality, so Guard 4 below catches the
// unlisted ones structurally. Entries here are an optimisation: a KNOWN variant
// word resolves to a confident "different product" instead of landing in the
// ambiguous queue for a human to look at.
//
// Kept deliberately close to VARIANT_DISCRIMINATORS in
// src/lib/media/providers/query-expansion.ts, which is the same idea applied to
// media candidates.
const MODEL_DISCRIMINATORS = new Set([
  "mki", "mkii", "mkiii", "mkiv", "mkv",
  "pro", "max", "ultra", "plus", "lite", "mini", "se", "air",
  "xt", "xtx", "ti", "super", "gt", "gre",
  "digital", "disc", "edition", "elite", "slim",
  // Added 2026-08-22 after an adversarial sweep found each of these merging a
  // real sibling product into its base model at 1.00.
  "xl", "fe", "oled", "nano", "neo", "turbo", "fold", "flip", "cellular",
]);

/** Tokens that look like a model number, e.g. r5, 9070, 5090, s26. */
function isModelToken(t: string): boolean {
  return /\d/.test(t);
}

/** Different products. Below AMBIGUOUS_THRESHOLD, so the caller creates a new row. */
const DIFFERENT_PRODUCTS = 0.3;
/**
 * Genuinely undecidable: this could be a sibling variant or a headline that
 * happens to append one word. Sits inside [AMBIGUOUS_THRESHOLD,
 * MATCH_THRESHOLD) on purpose, so `resolveEntity` returns "ambiguous" and a
 * human decides. Never rounded up — an overwrite is unrecoverable, a question
 * is not.
 */
const UNDECIDABLE_VARIANT = 0.6;

/**
 * Token-overlap similarity on normalised forms.
 *
 * Containment-biased so a short catalogue name still matches a longer headline
 * that contains it — but with two hard guards that override that bias, because
 * containment alone happily merges a product into its own successor.
 */
export function entitySimilarity(a: string, b: string): number {
  const oa = orderedTokens(a);
  const ob = orderedTokens(b);
  const ta = new Set(oa);
  const tb = new Set(ob);
  if (ta.size === 0 || tb.size === 0) return 0;

  // Guard 1: differing model-variant tokens mean different products.
  const da = [...ta].filter((t) => MODEL_DISCRIMINATORS.has(t)).sort().join(",");
  const db = [...tb].filter((t) => MODEL_DISCRIMINATORS.has(t)).sort().join(",");
  if (da !== db) return DIFFERENT_PRODUCTS;

  // Guard 2: MUTUAL difference — each name says something the other does not.
  //
  // The containment bias below is only ever justified when one name CONTAINS
  // the other: a catalogue name inside a headline about it. When each side
  // carries a token the other lacks, neither is a headline about the other;
  // they are two names, and the shared remainder is a family, not an identity.
  //
  // `shared / min(size)` badly overstates this case, because the family words
  // are the ones both sides share. Found 2026-08-22 merging real products:
  //
  //   "Intel Core Ultra 9 285K"    vs "Intel Core Ultra 9 265K"    -> 0.80
  //   "TP-Link Deco X50 5G"        vs "TP-Link Deco X55 5G"        -> 0.80
  //   "Samsung Galaxy Z Fold 7"    vs "Samsung Galaxy Z Flip 7"    -> 0.80
  //   "Canon EOS R5 with 24-70mm"  vs "Canon EOS R6 with 24-70mm"  -> 0.80
  //
  // Four shared family tokens are not evidence that the fifth token agrees.
  // The cost of this rule is that two DIFFERENT headlines about one product no
  // longer resolve to each other ("R5 gets 8K firmware" vs "R5 hits 45MP
  // burst"), which produces a duplicate content row. That is the survivable
  // direction; the other direction overwrites a product.
  const onlyA = oa.filter((t) => !tb.has(t));
  const onlyB = ob.filter((t) => !ta.has(t));
  if (onlyA.length > 0 && onlyB.length > 0) return DIFFERENT_PRODUCTS;

  // Guard 3: model numbers.
  //
  // Three distinct situations hide behind "the numbers differ", and collapsing
  // them produces a bug in one direction or the other:
  //
  //   DISJOINT   "R5" vs "R6", "5080" vs "5090"
  //              Different products. Must not match.
  //   EXTRA BARE DIGIT
  //              "Nintendo Switch 2" vs "Nintendo Switch"
  //              A generation marker. A DIFFERENT product, and the one this
  //              guard originally missed entirely — it required BOTH sides to
  //              carry a number, so a successor whose predecessor has no digit
  //              scored 1.00 through the containment bias and resolved to
  //              matched_existing. Same failure as the Canon EOS R5 Mark II
  //              incident, which had only been fixed for word-shaped
  //              discriminators like "mark ii".
  //   EXTRA ALPHANUMERIC
  //              "Canon EOS R5 gets 8K firmware" vs "Canon EOS R5"
  //              An incidental specification in a headline. The SAME product —
  //              blocking this would stop firmware and update stories from
  //              ever resolving to the product they are about.
  const numsA = new Set([...ta].filter(isModelToken));
  const numsB = new Set([...tb].filter(isModelToken));

  if (numsA.size > 0 && numsB.size > 0) {
    let overlap = 0;
    for (const t of numsA) if (numsB.has(t)) overlap++;
    // No shared model number at all: genuinely different products.
    if (overlap === 0) return DIFFERENT_PRODUCTS;
  }

  // Model numbers one side carries and the other does not, taken from BOTH
  // sides. The old code took them from whichever set was larger, breaking the
  // tie by argument order — which made the whole function asymmetric:
  // "Core Ultra 9 285K" vs "Core Ultra 9 285" scored 0.75 one way and 0.30 the
  // other, so the verdict depended on the order rows came back from the
  // database. Guard 2 now catches most of that, but the symmetric difference is
  // what makes it true by construction rather than by luck.
  const extra = [...numsA].filter((t) => !numsB.has(t)).concat([...numsB].filter((t) => !numsA.has(t)));
  // A bare digit is a generation marker; an alphanumeric token is a spec.
  if (extra.some((t) => /^\d+$/.test(t))) return DIFFERENT_PRODUCTS;

  // Guard 4: an unlisted variant word appended to a product name.
  //
  // Everything above this point still lets a SHORT unknown suffix through, and
  // that is exactly how the Mark II bug worked. Guard 1 only knows the variant
  // words somebody thought to list; every real product launch invents another.
  // A sweep on 2026-08-22 found all of these scoring 1.00 and resolving to
  // matched_existing — i.e. overwriting the base product's row:
  //
  //   "Pixel 10 Pro XL" -> "Pixel 10 Pro"       "Steam Deck OLED" -> "Steam Deck"
  //   "RTX 5080 FE"     -> "RTX 5080"           "Sonos Era 300 Gaming" -> "Sonos Era 300"
  //   "Apple Watch Series 11 Cellular" -> "Apple Watch Series 11"
  //
  // The structural difference between a variant suffix and a headline is how
  // MUCH follows the product name. A variant appends one or two words and
  // stops; a headline keeps talking. So: a name that is fully contained in the
  // other, with one or two leftover tokens AFTER the last shared one, is not
  // resolvable either way. It is a sibling variant or a terse headline, and
  // nothing in the string says which.
  //
  // Note what does NOT trip this: a manufacturer qualifier, which is written
  // BEFORE the model ("Sony PlayStation 5 Pro" vs "PS5 Pro", "NVIDIA GeForce
  // RTX 5090" vs "RTX 5090") and so leaves nothing trailing.
  const [longer, shorter] = oa.length >= ob.length ? [oa, ob] : [ob, oa];
  const shortSet = new Set(shorter);
  let lastShared = -1;
  for (let i = 0; i < longer.length; i++) if (shortSet.has(longer[i])) lastShared = i;
  const trailing = longer.slice(lastShared + 1).filter((t) => !shortSet.has(t));
  if (trailing.length > 0 && trailing.length <= 2) return UNDECIDABLE_VARIANT;

  let shared = 0;
  for (const t of ta) if (tb.has(t)) shared++;
  return shared / Math.min(ta.size, tb.size);
}

/** Above this, treat as the same entity. */
export const MATCH_THRESHOLD = 0.8;
/** Between AMBIGUOUS_THRESHOLD and MATCH_THRESHOLD, ask a human. */
export const AMBIGUOUS_THRESHOLD = 0.55;

export type ResolutionDecision = "matched_existing" | "new_entity" | "ambiguous" | "ignored";

export type ResolutionResult = {
  decision: ResolutionDecision;
  matchedId: string | null;
  matchedKind: "product" | "content" | null;
  matchedName: string | null;
  score: number;
  normalised: string;
  explanation: string;
};

export function resolveEntity(
  candidateName: string,
  existing: { kind: "product" | "content"; id: string; name: string }[]
): ResolutionResult {
  const normalised = normaliseEntityName(candidateName);

  if (!normalised) {
    return {
      decision: "ignored", matchedId: null, matchedKind: null, matchedName: null,
      score: 0, normalised,
      explanation: "Name reduced to nothing after removing noise words — not a usable entity name.",
    };
  }

  let best: { kind: "product" | "content"; id: string; name: string; score: number } | null = null;
  for (const e of existing) {
    const score = entitySimilarity(candidateName, e.name);
    if (!best || score > best.score) best = { ...e, score };
  }

  if (!best || best.score < AMBIGUOUS_THRESHOLD) {
    return {
      decision: "new_entity", matchedId: null, matchedKind: null, matchedName: null,
      score: best?.score ?? 0, normalised,
      explanation: `No existing entity scored above ${AMBIGUOUS_THRESHOLD} (best ${best ? best.score.toFixed(2) + ' "' + best.name + '"' : "none"}). Treated as new.`,
    };
  }

  if (best.score >= MATCH_THRESHOLD) {
    return {
      decision: "matched_existing", matchedId: best.id, matchedKind: best.kind,
      matchedName: best.name, score: best.score, normalised,
      explanation: `Matches existing ${best.kind} "${best.name}" at ${best.score.toFixed(2)} (>= ${MATCH_THRESHOLD}). Update the existing record rather than creating a duplicate.`,
    };
  }

  return {
    decision: "ambiguous", matchedId: best.id, matchedKind: best.kind,
    matchedName: best.name, score: best.score, normalised,
    explanation: `Similar to existing ${best.kind} "${best.name}" at ${best.score.toFixed(2)} — above ${AMBIGUOUS_THRESHOLD} but below ${MATCH_THRESHOLD}. Too close to call automatically; a human should decide.`,
  };
}

/** Slug that will not collide, derived from a title. */
export function proposeSlug(title: string, taken: Set<string>): string {
  const base = title
    .toLowerCase()
    .replace(/[^a-z0-9\s-]/g, "")
    .trim()
    .replace(/\s+/g, "-")
    .replace(/-+/g, "-")
    .slice(0, 80)
    .replace(/^-+|-+$/g, "");
  if (!base) return "";
  if (!taken.has(base)) return base;
  for (let i = 2; i <= 20; i++) {
    const candidate = `${base}-${i}`.slice(0, 90);
    if (!taken.has(candidate)) return candidate;
  }
  return "";
}
