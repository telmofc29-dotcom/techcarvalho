// ATOMIC CLAIM EXTRACTION — and the hedging that must survive it.
//
// THE BUG THIS REPLACES
// ---------------------
// `brief-builder` derived facts from a discovery's CLAIM STATUS, not from what
// the source actually said, so every discovery produced at most one fact. A
// brief with one fact fails the two-fact minimum, which is why 16 well-sourced
// production briefs sat at "needs more research" forever.
//
// THE RULE THAT MATTERS MORE THAN THE COUNT
// -----------------------------------------
// Extraction is where a tech site lies to itself. A sentence like
//
//   "Apple is reportedly developing a new camera system that could arrive in 2027"
//
// contains three separable claims and FOUR hedges — reportedly, could, and the
// implicit uncertainty of "developing" and "2027". Strip the hedges and you get
//
//   "Apple is developing a new camera system, arriving 2027"
//
// which is a fabrication produced entirely by tidying. Nobody decided to lie;
// the hedge just did not survive the pipeline.
//
// So every claim carries the hedge words found in its own sentence, and
// `assertability` is derived from them. A claim whose source said "may" can
// never be emitted as a statement of fact, at any confidence, from any number
// of publishers. The hedge is part of the claim, not decoration on it.
//
// WHAT THIS IS NOT
// ----------------
// Not natural-language understanding. It is sentence splitting plus a hedge
// lexicon plus attribution detection — deterministic, free, no AI provider (the
// engine has none, by design). It will miss nuance a human would catch. It is
// built to fail toward MORE uncertainty, never less: an unrecognised
// construction stays `attributed` rather than being promoted.
//
// PURE. No `server-only`, no network, no clock.

export type ClaimAssertability =
  /** The source states it plainly and is entitled to. */
  | "assertable"
  /** Must be attributed to whoever said it. */
  | "attributed"
  /** Explicitly hedged. Must be framed as unconfirmed. */
  | "hedged";

export type AtomicClaim = {
  /** The claim sentence, normalised but never de-hedged. */
  text: string;
  /** Hedge words found, verbatim. Empty means none were present. */
  hedges: string[];
  /** Who the sentence attributes the claim to, when it says. */
  attributedTo: string | null;
  assertability: ClaimAssertability;
  /** Numbers, dates and model names found — the parts most often mis-stated. */
  values: string[];
};

/**
 * Hedge lexicon.
 *
 * Ordered longest-first at match time so "is expected to" is reported rather
 * than the bare "expected". Every entry here is a word that changes what the
 * writer is entitled to claim, which is why the list is conservative: adding a
 * word here can only ever make output MORE cautious.
 */
export const HEDGES: readonly string[] = [
  "is expected to",
  "are expected to",
  "is rumoured to",
  "is rumored to",
  "is said to",
  "is believed to",
  "is thought to",
  "appears to",
  "seems to",
  "reportedly",
  "allegedly",
  "supposedly",
  "apparently",
  "purportedly",
  "rumoured",
  "rumored",
  "expected",
  "anticipated",
  "speculation",
  "speculated",
  "could",
  "might",
  "may",
  "possibly",
  "potentially",
  "likely",
  "unconfirmed",
  "unofficial",
  "leaked",
  "leak",
  "claims to",
  "suggests",
  "hints",
  "tipped",
  "if accurate",
  "if true",
] as const;

/**
 * Attribution patterns — "according to X", "X says", "sources tell X".
 *
 * Attribution is not a hedge. "According to Apple, the battery lasts 20 hours"
 * is a firmly-sourced claim; "Apple may improve battery life" is a hedged one.
 * They are tracked separately because they license different sentences.
 */
// NOTE THE CASE HANDLING. The literal parts use explicit [Aa]-style classes
// rather than the `i` flag, because the CAPTURE must stay case-sensitive: it is
// looking for a proper noun. Making the whole pattern case-insensitive would
// have it capture "the battery" as an attributed source. Making it fully
// case-sensitive — the first version of this — missed every sentence that
// opened with "According to", which is most of them.
const ATTRIBUTION_PATTERNS: readonly RegExp[] = [
  /[Aa]ccording to ([A-Z][\w.'-]*(?:\s+[A-Z][\w.'-]*){0,3})/,
  /\b([A-Z][\w.'-]*(?:\s+[A-Z][\w.'-]*){0,2})\s+(?:says|said|reports|reported|claims|announced|confirmed)\b/,
  /\b[Pp]er\s+([A-Z][\w.'-]*(?:\s+[A-Z][\w.'-]*){0,2})\b/,
  /\b[Ss]ources?\s+(?:tell|told)\s+([A-Z][\w.'-]*(?:\s+[A-Z][\w.'-]*){0,2})/,
  /\b(?:a|an)\s+(analyst|report|leak|rumou?r|filing|listing)\b/i,
];

/**
 * Split text into atomic claims.
 *
 * "Atomic" here means one sentence, not one proposition — decomposing a
 * sentence into propositions without a language model produces garbage, and
 * garbage claims are worse than coarse ones because they read as precise. One
 * sentence is a unit a human can check against the source.
 */
export function extractClaims(text: string, options: { max?: number } = {}): AtomicClaim[] {
  const max = options.max ?? 12;
  const claims: AtomicClaim[] = [];

  for (const raw of splitSentences(text)) {
    const sentence = raw.trim();
    if (sentence.length < 25) continue; // too short to be a claim
    if (!/[a-z]/i.test(sentence)) continue;

    const hedges = findHedges(sentence);
    const attributedTo = findAttribution(sentence);
    claims.push({
      text: sentence,
      hedges,
      attributedTo,
      assertability: assertabilityOf(hedges, attributedTo),
      values: extractValues(sentence),
    });
    if (claims.length >= max) break;
  }

  return claims;
}

/**
 * Assertability from the sentence's own language.
 *
 * Hedge beats attribution: "According to Bloomberg, Apple may ship in 2027" is
 * hedged, not merely attributed, because the uncertainty is in the claim itself
 * and no amount of sourcing removes it.
 */
export function assertabilityOf(
  hedges: readonly string[],
  attributedTo: string | null
): ClaimAssertability {
  if (hedges.length > 0) return "hedged";
  if (attributedTo) return "attributed";
  // The conservative default. An unrecognised construction is NOT promoted to
  // assertable just because no hedge was matched — the lexicon is incomplete by
  // construction, and failing toward certainty is the dangerous direction.
  return "attributed";
}

export function findHedges(sentence: string): string[] {
  const lower = ` ${sentence.toLowerCase()} `;
  const found: string[] = [];
  // Longest first so "is expected to" is reported instead of "expected".
  for (const hedge of [...HEDGES].sort((a, b) => b.length - a.length)) {
    const pattern = new RegExp(`(^|[^a-z])${hedge.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}([^a-z]|$)`);
    if (!pattern.test(lower)) continue;
    // Do not also report a hedge already covered by a longer one.
    if (found.some((f) => f.includes(hedge))) continue;
    found.push(hedge);
  }
  return found;
}

export function findAttribution(sentence: string): string | null {
  for (const pattern of ATTRIBUTION_PATTERNS) {
    const m = sentence.match(pattern);
    if (m && m[1]) return m[1].trim();
  }
  return null;
}

/**
 * Numbers, dates, capacities and model designations.
 *
 * Surfaced separately because they are what a reader checks and what a pipeline
 * most often corrupts — a "2nm" that becomes "2 nm" then "2mm" is a small
 * string edit and a large factual error.
 */
export function extractValues(sentence: string): string[] {
  const out = new Set<string>();
  const patterns = [
    /\b\d{4}\b/g,                                  // years
    /\b\d+(?:\.\d+)?\s?(?:nm|mm|cm|GHz|MHz|GB|TB|MB|MP|mAh|W|Wh|fps|Hz|in|inch|"|%)\b/gi,
    /\b(?:iPhone|Galaxy|Pixel|RTX|GTX|Ryzen|Core|EOS|Z\d|RF|GeForce|Snapdragon)\s?\d+[A-Za-z]*\b/g,
    /\$\d[\d,]*(?:\.\d+)?/g,
    /£\d[\d,]*(?:\.\d+)?/g,
  ];
  for (const p of patterns) {
    for (const m of sentence.matchAll(p)) out.add(m[0].trim());
  }
  return [...out];
}

/**
 * Sentence splitting that does not break on common technical abbreviations.
 *
 * A naive split on `.` turns "the 6.2-inch display" and "Inc." into sentence
 * boundaries, which shreds exactly the sentences most worth extracting.
 */
export function splitSentences(text: string): string[] {
  const protectedText = text
    .replace(/\b(Inc|Ltd|Co|Corp|vs|approx|est|Dr|Mr|Mrs|Ms|St|No|Fig|e\.g|i\.e)\./gi, "$1<DOT>")
    .replace(/(\d)\.(\d)/g, "$1<DOT>$2");
  return protectedText
    .split(/(?<=[.!?])\s+(?=[A-Z"'])/)
    .map((s) => s.replace(/<DOT>/g, ".").trim())
    .filter(Boolean);
}

// ---------------------------------------------------------------------------
// Rolling the claims up
// ---------------------------------------------------------------------------

export type ClaimBreakdown = {
  total: number;
  assertable: number;
  attributed: number;
  hedged: number;
  /** Claims carrying a concrete value — the checkable ones. */
  withValues: number;
};

export function summariseClaims(claims: readonly AtomicClaim[]): ClaimBreakdown {
  return {
    total: claims.length,
    assertable: claims.filter((c) => c.assertability === "assertable").length,
    attributed: claims.filter((c) => c.assertability === "attributed").length,
    hedged: claims.filter((c) => c.assertability === "hedged").length,
    withValues: claims.filter((c) => c.values.length > 0).length,
  };
}

/**
 * Render a claim for a brief, with its hedging intact.
 *
 * This is the function that would be tempting to "clean up", so it is stated
 * plainly: it never removes a hedge and never adds certainty. A hedged claim is
 * prefixed so it cannot be read as settled even if the surrounding prose is
 * later edited carelessly.
 */
export function renderClaim(claim: AtomicClaim): string {
  if (claim.assertability === "hedged") {
    const source = claim.attributedTo ? ` (${claim.attributedTo})` : "";
    return `UNCONFIRMED${source}: ${claim.text}`;
  }
  if (claim.attributedTo) return `${claim.attributedTo}: ${claim.text}`;
  return claim.text;
}
