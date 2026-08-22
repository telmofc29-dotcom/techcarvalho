import type { ContentRelationshipType } from "@/lib/types/database";

// ---------------------------------------------------------------------------
// Clustering rules for the public site: which published pieces belong together,
// and which one of them is the hub.
//
// Everything in this file is pure so it can be unit-tested without a database.
// The queries that feed it live in article-detail.ts / family-detail.ts.
//
// Two hard constraints shaped these rules, both verified against production
// rather than assumed:
//
//  1. `content_products` is invisible to `anon` unless BOTH sides are published
//     ("public can read content-product links when both published",
//     20260819202305_rls_policies.sql). Against production that is 9 of 123
//     rows. So product links CANNOT be the backbone of a public cluster while
//     most of the catalogue is unpublished — `content_tags` (all 250 rows
//     readable) and `content_relationships` (all 161 readable) can.
//  2. `content_relationships` is documented as directional with the reverse
//     inferred at query time, but production actually contains 33 pairs stored
//     in BOTH directions (a `pillar_of` row plus its mirrored `supporting_of`
//     row). Both spellings mean the same thing, so this file normalises them
//     to one edge per pair rather than showing a piece twice.
// ---------------------------------------------------------------------------

// Tags that describe the FORMAT of a piece rather than its subject. They are
// deliberately excluded from "these two pieces are about the same thing"
// reasoning: `/articles?type=comparison` already owns the format intent (see
// article-hubs.ts), so treating `comparison` as a shared subject would cluster
// a Canon lens guide with a robot-vacuum guide purely because both are guides.
// Measured: `buying-guide` spans 9 categories and `comparison` spans 8.
export const FORMAT_TAG_SLUGS: ReadonlySet<string> = new Set([
  "buying-guide",
  "comparison",
  "troubleshooting",
  "beginner-guide",
  "used-gear",
  "old-vs-new",
  "rumours",
]);

export function subjectTags(tagSlugs: readonly string[]): string[] {
  return tagSlugs.filter((slug) => !FORMAT_TAG_SLUGS.has(slug));
}

export type RelationshipEdge = {
  otherId: string;
  type: ContentRelationshipType;
  // "outgoing" = this piece is content_relationships.content_id.
  // "incoming" = this piece is content_relationships.related_content_id.
  direction: "outgoing" | "incoming";
};

export type ClusterRoles = {
  // Pieces that support THIS piece — i.e. this piece is the pillar of a
  // cluster and these are its members.
  supportedByIds: string[];
  // Pieces THIS piece supports — i.e. the hub(s) it should link up to.
  pillarIds: string[];
  // Peer relationships with no hierarchy.
  relatedIds: string[];
};

// Reads both stored spellings of the same claim:
//   (X, Y, 'pillar_of')     outgoing  → X is the pillar, Y supports it
//   (Y, X, 'supporting_of') incoming  → Y supports X, so X is the pillar
// and likewise for the inverse. Deduplicates per bucket, so a pair recorded in
// both directions (33 of them exist in production) yields one entry, not two.
//
// Hierarchy beats peerage: if a pair is recorded both as pillar/supporting AND
// as related_to, the hierarchical reading wins and the pair is not repeated in
// `relatedIds` — otherwise the same piece would render in two sections of the
// same page.
export function classifyClusterEdges(edges: readonly RelationshipEdge[]): ClusterRoles {
  const supportedBy = new Set<string>();
  const pillars = new Set<string>();
  const related = new Set<string>();

  for (const edge of edges) {
    const thisIsPillar =
      (edge.direction === "outgoing" && edge.type === "pillar_of") ||
      (edge.direction === "incoming" && edge.type === "supporting_of");
    const thisIsSupporting =
      (edge.direction === "outgoing" && edge.type === "supporting_of") ||
      (edge.direction === "incoming" && edge.type === "pillar_of");

    if (thisIsPillar) supportedBy.add(edge.otherId);
    else if (thisIsSupporting) pillars.add(edge.otherId);
    else related.add(edge.otherId);
  }

  for (const id of [...supportedBy, ...pillars]) related.delete(id);
  // A genuinely contradictory pair (recorded as pillar in one row and
  // supporting in another) would otherwise appear in both hierarchical
  // buckets and render as its own parent. Resolve toward "this piece is the
  // hub", which is the reading that keeps the cluster on one page.
  for (const id of supportedBy) pillars.delete(id);

  return {
    supportedByIds: [...supportedBy],
    pillarIds: [...pillars],
    relatedIds: [...related],
  };
}

// A cluster is worth presenting as a hub section only when it has more than
// one member — a "series" of one is just a link, and labelling it as a series
// overstates what exists.
export const MIN_CLUSTER_MEMBERS = 2;

export type ComparisonCandidate = {
  id: string;
  tagSlugs: readonly string[];
  categoryId: string | null;
  publishedAt: string | null;
};

export type ComparisonSibling = {
  id: string;
  // The subject tags this sibling genuinely shares with the source piece.
  // Empty means it was included only as same-category filler, and callers
  // must not claim a shared subject for it.
  sharedTags: string[];
};

// Groups the "X vs Y" pieces into clusters. Ranking, strongest first:
//
//  1. most shared SUBJECT tags (format tags excluded — see FORMAT_TAG_SLUGS),
//  2. then most recently published.
//
// Pieces sharing no subject tag are only used to top the list up to `limit`,
// and only from the same category, and they are returned with an empty
// `sharedTags` so the caller can label them honestly ("more comparisons in
// Computing") rather than implying a subject relationship that isn't there.
export function rankComparisonSiblings(
  self: { id: string; tagSlugs: readonly string[]; categoryId: string | null },
  candidates: readonly ComparisonCandidate[],
  limit: number
): ComparisonSibling[] {
  if (limit <= 0) return [];
  const selfSubjects = new Set(subjectTags(self.tagSlugs));

  const scored: (ComparisonSibling & { publishedAt: string | null })[] = [];
  const filler: (ComparisonSibling & { publishedAt: string | null })[] = [];

  for (const candidate of candidates) {
    if (candidate.id === self.id) continue;
    const shared = subjectTags(candidate.tagSlugs).filter((slug) => selfSubjects.has(slug));
    if (shared.length > 0) {
      scored.push({ id: candidate.id, sharedTags: shared, publishedAt: candidate.publishedAt });
    } else if (self.categoryId !== null && candidate.categoryId === self.categoryId) {
      filler.push({ id: candidate.id, sharedTags: [], publishedAt: candidate.publishedAt });
    }
  }

  const byRecency = (a: { publishedAt: string | null }, b: { publishedAt: string | null }) =>
    (b.publishedAt ?? "").localeCompare(a.publishedAt ?? "");

  scored.sort((a, b) => b.sharedTags.length - a.sharedTags.length || byRecency(a, b));
  filler.sort(byRecency);

  return [...scored, ...filler].slice(0, limit).map(({ id, sharedTags }) => ({ id, sharedTags }));
}
