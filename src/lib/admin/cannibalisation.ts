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

function tokenize(value: string): Set<string> {
  return new Set(normalize(value).split(/[^a-z0-9]+/).filter(Boolean));
}

// Ratio of shared tokens over the smaller title's token count, so "Sony A7
// IV Review" vs "Sony A7 IV In-Depth Review" scores high even though the
// titles aren't the same length.
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
