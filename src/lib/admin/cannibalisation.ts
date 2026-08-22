// Cannibalisation warnings — never blocks, only flags. Uses the existing
// search_intent/primary_query/intent_fingerprint columns (already on
// content_items, already collected via the admin content form); no schema
// change needed. Deliberately simple, explainable matching — no ML/
// embeddings, no new dependency: exact intent_fingerprint match, exact
// primary_query match (case-insensitive), or a normalized-token-overlap
// heuristic on the title, in that priority order (most to least certain).

export type ContentSignal = {
  id: string;
  title: string;
  primary_query: string | null;
  intent_fingerprint: string | null;
};

export type CannibalisationMatch = {
  id: string;
  title: string;
  reason: string;
};

function normalize(value: string): string {
  return value.toLowerCase().trim();
}

// Structural words that carry no subject meaning. Excluded from the title
// heuristic because the overlap ratio below is measured against the SHORTER
// title's token count, which makes short titles collide on grammar alone.
//
// Both pairs the detector flagged across the whole published corpus were false
// positives of exactly this kind, and both are in this house style's most
// common title shapes ("X vs Y: Is It Worth It?", "Do You Actually Need X?"):
//
//   canon-6d-vs-6d-mark-ii            vs  ps5-vs-ps5-pro-worth-it
//     shared tokens: "vs", "worth", "it"        — nothing in common
//   do-you-need-rtx-5090-for-1440p    vs  psu-wattage-for-rtx-5090-build
//     shared tokens: "rtx", "5090", "for"       — genuinely related, but
//                                                 flagged for the wrong reason
//
// The second pair IS a real relationship, but it is a pillar/supporting one,
// not a duplicate-intent one, and a detector that reaches the right verdict
// via "for" would reach a wrong one just as easily. Stripping these makes the
// signal come from the subject tokens ("rtx", "5090") alone.
//
// Deliberately conservative: only words that are never a product name or a
// distinguishing subject. "pro", "max", "air" and "mini" are NOT here — they
// are model names in this catalogue.
const STOPWORDS: ReadonlySet<string> = new Set([
  "a", "an", "and", "are", "at", "be", "but", "by", "can", "do", "does", "for", "from", "how", "i",
  "in", "is", "it", "its", "just", "my", "need", "needs", "of", "on", "or", "our", "should", "than",
  "that", "the", "their", "them", "then", "there", "these", "this", "to", "vs", "versus", "want",
  "was", "we", "what", "whats", "when", "which", "who", "why", "will", "with", "worth", "you",
  "your", "actually", "really", "still", "now", "get", "got", "make", "makes", "much", "many",
]);

function tokenize(value: string): Set<string> {
  return new Set(
    normalize(value)
      .split(/[^a-z0-9]+/)
      .filter((token) => token && !STOPWORDS.has(token))
  );
}

// Ratio of shared tokens over the smaller title's token count, so "Sony A7
// IV Review" vs "Sony A7 IV In-Depth Review" scores high even though the
// titles aren't the same length.
//
// A title made entirely of stopwords tokenizes to nothing and scores 0 rather
// than dividing by zero — the same guard that already covered an empty title.
function titleTokenOverlapRatio(a: string, b: string): number {
  const tokensA = tokenize(a);
  const tokensB = tokenize(b);
  if (tokensA.size === 0 || tokensB.size === 0) return 0;
  let shared = 0;
  for (const token of tokensA) if (tokensB.has(token)) shared++;
  return shared / Math.min(tokensA.size, tokensB.size);
}

const TITLE_OVERLAP_THRESHOLD = 0.7;

export function findCannibalisationMatches(
  candidate: { title: string; primary_query: string; intent_fingerprint: string },
  existing: ContentSignal[]
): CannibalisationMatch[] {
  const matches: CannibalisationMatch[] = [];

  for (const item of existing) {
    if (
      candidate.intent_fingerprint &&
      item.intent_fingerprint &&
      normalize(candidate.intent_fingerprint) === normalize(item.intent_fingerprint)
    ) {
      matches.push({ id: item.id, title: item.title, reason: "same intent fingerprint" });
      continue;
    }
    if (
      candidate.primary_query &&
      item.primary_query &&
      normalize(candidate.primary_query) === normalize(item.primary_query)
    ) {
      matches.push({ id: item.id, title: item.title, reason: "same target query" });
      continue;
    }
    if (candidate.title && item.title && titleTokenOverlapRatio(candidate.title, item.title) >= TITLE_OVERLAP_THRESHOLD) {
      matches.push({ id: item.id, title: item.title, reason: "very similar title" });
    }
  }

  return matches;
}
