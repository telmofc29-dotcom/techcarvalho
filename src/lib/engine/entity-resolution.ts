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

/** Canonical form for comparison: synonyms applied, noise dropped, sorted. */
export function normaliseEntityName(input: string): string {
  let s = input.toLowerCase();
  for (const [pattern, replacement] of SYNONYMS) s = s.replace(pattern, replacement);
  const tokens = s
    .replace(/[^a-z0-9\s-]/g, " ")
    .split(/[\s-]+/)
    .filter((t) => t.length > 0 && !NOISE.has(t));
  return [...new Set(tokens)].sort().join("-");
}

// Tokens that distinguish one MODEL from another within the same family.
// If one name carries one of these and the other does not, they are different
// products however much else they share — "Canon EOS R5" and "Canon EOS R5
// Mark II" are not the same camera, and merging them would silently destroy a
// successor product.
const MODEL_DISCRIMINATORS = new Set([
  "mki", "mkii", "mkiii", "mkiv", "mkv",
  "pro", "max", "ultra", "plus", "lite", "mini", "se", "air",
  "xt", "xtx", "ti", "super", "gt", "gre",
  "digital", "disc", "edition", "elite", "slim",
]);

/** Tokens that look like a model number, e.g. r5, 9070, 5090, s26. */
function isModelToken(t: string): boolean {
  return /\d/.test(t);
}

/**
 * Token-overlap similarity on normalised forms.
 *
 * Containment-biased so a short catalogue name still matches a longer headline
 * that contains it — but with two hard guards that override that bias, because
 * containment alone happily merges a product into its own successor.
 */
export function entitySimilarity(a: string, b: string): number {
  const ta = new Set(normaliseEntityName(a).split("-").filter(Boolean));
  const tb = new Set(normaliseEntityName(b).split("-").filter(Boolean));
  if (ta.size === 0 || tb.size === 0) return 0;

  // Guard 1: differing model-variant tokens mean different products.
  const da = [...ta].filter((t) => MODEL_DISCRIMINATORS.has(t)).sort().join(",");
  const db = [...tb].filter((t) => MODEL_DISCRIMINATORS.has(t)).sort().join(",");
  if (da !== db) return 0.3;

  // Guard 2: differing model numbers mean different products (R5 vs R6,
  // 5080 vs 5090). Only applies when both sides actually carry one.
  const na = [...ta].filter(isModelToken).sort().join(",");
  const nb = [...tb].filter(isModelToken).sort().join(",");
  if (na && nb && na !== nb) return 0.3;

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
