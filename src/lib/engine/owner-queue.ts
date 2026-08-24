// THE OWNER QUEUE — one ranked list of things that genuinely need a human.
//
// WHY THIS EXISTS
// ---------------
// The engine had sixteen admin pages and no front door. Every capability got a
// tab, which is the right shape for a specialist drilling into one stage and
// the wrong shape for the person who owns the site. Operating it meant opening
// `discoveries`, then `briefs`, then `media-acquisition`, then `media-blockers`,
// then `update-proposals`, then `freshness`, and holding the state of all six in
// your head. Production had 130 pending records spread across them and 0
// approvals, which is what that costs.
//
// So this module answers ONE question — "what should the owner do next?" — and
// it answers it in one ranked list regardless of which table the work came from.
//
// WHAT IT DELIBERATELY DOES NOT DO
// --------------------------------
// It does not surface every pending record. That number (130) is an engine
// statistic, not a to-do list, and putting it in front of the owner is what
// caused the problem in the first place. Each source of work applies its own
// admission rule BEFORE anything reaches here — briefs through the Phase C
// quality gate, media through the rights rules, and so on. This module ranks
// what survived; it is not the place to add a new escape hatch that lets weak
// work in.
//
// RANKING IS NOT SCORING
// ----------------------
// `urgency` orders the list. It is not shown as a number and it is not a
// confidence, a quality or a prediction — there is no measured demand data in
// this system (48 analytics events total), and dressing a sort key up as a
// score would be exactly the fake precision the brief forbids. Every item
// carries `why` in plain words instead, and the words are the product; the
// number only decides what is on top.
//
// PURE. No `server-only`, no Supabase, no clock beyond what the caller passes.
// The I/O half is src/lib/engine/queue-service.ts.

import type { BriefQualityVerdict } from "./brief-quality.ts";

// ---------------------------------------------------------------------------
// Item shape
// ---------------------------------------------------------------------------

export type QueueItemKind =
  /** A researched brief that cleared the Phase C evidence bar. */
  | "brief"
  /** Media whose rights the engine is not permitted to decide. Always a human call. */
  | "media_rights"
  /** Something already covered has changed — update rather than duplicate. */
  | "update_proposal"
  /** Published content that has gone stale enough to mislead. */
  | "freshness";

export const QUEUE_ITEM_KINDS: readonly QueueItemKind[] = [
  "brief",
  "media_rights",
  "update_proposal",
  "freshness",
] as const;

export const QUEUE_KIND_LABELS: Record<QueueItemKind, string> = {
  brief: "New coverage",
  media_rights: "Media rights",
  update_proposal: "Update existing page",
  freshness: "Ageing content",
};

/**
 * Base weight per kind, before per-item adjustment.
 *
 * `media_rights` sits at the top for a reason that is not editorial: it is the
 * only kind here that the engine is STRUCTURALLY forbidden to resolve on its
 * own. Everything else in this list is work the engine could eventually do
 * unattended under AUTOMATIC mode; a rights decision on third-party material
 * never is. Work that only a human can ever do should not queue behind work
 * that is merely waiting for a human today.
 */
const KIND_BASE_URGENCY: Record<QueueItemKind, number> = {
  media_rights: 400,
  update_proposal: 300,
  brief: 200,
  freshness: 100,
};

export type SignalTone = "good" | "warn" | "bad" | "neutral";

/** A single fact shown on the row. Short enough to read without stopping. */
export type QueueSignal = {
  label: string;
  tone: SignalTone;
};

export type QueueAction =
  | "review"
  | "approve"
  | "reject"
  | "ignore"
  | "details";

export type OwnerQueueItem = {
  /** Stable across renders: `${kind}:${id}`. */
  key: string;
  kind: QueueItemKind;
  id: string;
  title: string;
  /** The one-line classification, e.g. "Researched and sourced". */
  headline: string;
  /** Why this needs the OWNER specifically, in plain words. */
  why: string;
  signals: QueueSignal[];
  /**
   * What is missing, stated only where it is actually known. Never inferred
   * from absence of a join the caller did not perform — an unchecked thing is
   * not a missing thing.
   */
  gaps: string[];
  actions: QueueAction[];
  /** Where "View details" goes — always an existing specialist page. */
  href: string;
  urgency: number;
  /** ISO timestamp used for tie-breaking and for "waiting N days". */
  since: string;
};

// ---------------------------------------------------------------------------
// Builders — one per source, each stating its own admission rule
// ---------------------------------------------------------------------------

export type BriefQueueInput = {
  id: string;
  title: string;
  quality: BriefQualityVerdict;
  freshnessSensitivity: "breaking" | "time_sensitive" | "evergreen" | null;
  createdAt: string;
  /** True when the brief names no product and none was resolved. */
  productLinkMissing: boolean;
};

/**
 * Admission rule: `quality.entersOwnerQueue`, which today means exactly
 * `ready_for_review`.
 *
 * Returns null rather than a filtered-out marker so the call site cannot
 * accidentally render a rejected item — there is no "include weak ones" flag
 * to flip.
 */
export function briefQueueItem(input: BriefQueueInput): OwnerQueueItem | null {
  if (!input.quality.entersOwnerQueue) return null;
  const q = input.quality;

  const signals: QueueSignal[] = [
    { label: `${q.factCount} verified facts`, tone: "good" },
    {
      label: `${q.sourceCount} sources across ${q.independentDomains} independent publishers`,
      tone: "good",
    },
  ];
  if (q.uncertaintyCount > 0) {
    signals.push({
      label: `${q.uncertaintyCount} open questions kept separate from the facts`,
      tone: "neutral",
    });
  }

  const gaps: string[] = [];
  if (input.productLinkMissing) gaps.push("No product linked yet");

  let urgency = KIND_BASE_URGENCY.brief;
  // Time sensitivity is a property of the STORY, so it moves an item within the
  // list. Breaking news that waits a week is worth less than an evergreen guide
  // that waits a week, and the order should say so.
  if (input.freshnessSensitivity === "breaking") urgency += 60;
  else if (input.freshnessSensitivity === "time_sensitive") urgency += 30;
  // Evidence depth breaks ties between otherwise comparable stories, capped so
  // a heavily-sourced evergreen piece cannot outrank breaking news.
  urgency += Math.min(q.factCount, 10) + Math.min(q.independentDomains, 5) * 2;

  return {
    key: `brief:${input.id}`,
    kind: "brief",
    id: input.id,
    title: input.title,
    headline: "Researched and sourced",
    why: "Evidence clears the bar, so the editorial call — cover this or not — is yours.",
    signals,
    gaps,
    actions: ["review", "approve", "reject", "ignore", "details"],
    // The package, not the briefs list. A brief that cleared the evidence bar
    // is one decision away from being an article, and the package is where that
    // decision is actually made — sending the owner to a filtered table instead
    // is the fragmentation this queue exists to remove.
    href: `/admin/engine/packages/${input.id}`,
    urgency,
    since: input.createdAt,
  };
}

export type MediaRightsQueueInput = {
  id: string;
  title: string;
  /** Why the engine stopped, verbatim from the rights evaluation. */
  blockerReason: string;
  /** The content or product this asset was being acquired for, when known. */
  forTitle: string | null;
  detectedAt: string;
};

/**
 * Admission rule: the caller passes only assets the engine REFUSED to clear.
 *
 * There is deliberately no quality threshold here. "Never guess rights" means
 * every unresolved rights question is the owner's, however minor it looks, so
 * this builder never returns null.
 */
export function mediaRightsQueueItem(input: MediaRightsQueueInput): OwnerQueueItem {
  const gaps: string[] = [];
  if (input.forTitle) gaps.push(`Blocking: ${input.forTitle}`);

  return {
    key: `media_rights:${input.id}`,
    kind: "media_rights",
    id: input.id,
    title: input.title,
    headline: "Rights need a human decision",
    why: "The engine will never assume rights it cannot prove, so this cannot proceed without you.",
    signals: [{ label: input.blockerReason, tone: "warn" }],
    gaps,
    actions: ["review", "details"],
    href: `/admin/engine/media-blockers#${input.id}`,
    urgency: KIND_BASE_URGENCY.media_rights,
    since: input.detectedAt,
  };
}

export type UpdateProposalQueueInput = {
  id: string;
  title: string;
  /** The existing page the change affects. */
  targetTitle: string | null;
  reason: string;
  sourceCount: number;
  detectedAt: string;
};

export function updateProposalQueueItem(input: UpdateProposalQueueInput): OwnerQueueItem {
  return {
    key: `update_proposal:${input.id}`,
    kind: "update_proposal",
    id: input.id,
    title: input.targetTitle ?? input.title,
    headline: "Existing page may be out of date",
    why: "Updating what is already published usually beats publishing a second page that competes with it.",
    signals: [
      { label: input.reason, tone: "warn" },
      ...(input.sourceCount > 0
        ? [{ label: `${input.sourceCount} supporting sources`, tone: "good" as SignalTone }]
        : []),
    ],
    gaps: [],
    actions: ["review", "approve", "reject", "details"],
    href: `/admin/engine/update-proposals#${input.id}`,
    urgency: KIND_BASE_URGENCY.update_proposal + Math.min(input.sourceCount, 5),
    since: input.detectedAt,
  };
}

export type FreshnessQueueInput = {
  id: string;
  title: string;
  reason: string;
  severity: "low" | "medium" | "high" | string;
  detectedAt: string;
};

/**
 * Admission rule: severity. Low-severity ageing is a maintenance backlog, not
 * an owner decision, and including it would refill the queue with exactly the
 * kind of noise Phase C removed from it.
 */
export function freshnessQueueItem(input: FreshnessQueueInput): OwnerQueueItem | null {
  if (input.severity !== "high") return null;
  return {
    key: `freshness:${input.id}`,
    kind: "freshness",
    id: input.id,
    title: input.title,
    headline: "Published page is ageing badly",
    why: "This is live and may mislead a reader; it is already public, so the cost of waiting is ongoing.",
    signals: [{ label: input.reason, tone: "warn" }],
    gaps: [],
    actions: ["review", "ignore", "details"],
    href: `/admin/engine/freshness#${input.id}`,
    urgency: KIND_BASE_URGENCY.freshness + 40,
    since: input.detectedAt,
  };
}

// ---------------------------------------------------------------------------
// Ranking
// ---------------------------------------------------------------------------

/**
 * Sort the queue.
 *
 * Ties break on AGE, oldest first. That is the opposite of most feeds and it is
 * deliberate: an item that has waited three weeks is the one the owner has
 * repeatedly skipped, and letting fresh arrivals keep jumping ahead of it is
 * how a queue grows a permanent tail nobody ever reaches.
 */
export function rankOwnerQueue(items: readonly OwnerQueueItem[]): OwnerQueueItem[] {
  return [...items].sort((a, b) => {
    if (b.urgency !== a.urgency) return b.urgency - a.urgency;
    const at = new Date(a.since).getTime();
    const bt = new Date(b.since).getTime();
    if (Number.isNaN(at) || Number.isNaN(bt)) return 0;
    return at - bt;
  });
}

export type QueueSummary = {
  total: number;
  byKind: Record<QueueItemKind, number>;
  /** Oldest waiting item, for the "waiting since" line. */
  oldest: OwnerQueueItem | null;
};

export function summariseOwnerQueue(items: readonly OwnerQueueItem[]): QueueSummary {
  const byKind = Object.fromEntries(QUEUE_ITEM_KINDS.map((k) => [k, 0])) as Record<
    QueueItemKind,
    number
  >;
  for (const i of items) byKind[i.kind] += 1;

  let oldest: OwnerQueueItem | null = null;
  for (const i of items) {
    const t = new Date(i.since).getTime();
    if (Number.isNaN(t)) continue;
    if (!oldest || t < new Date(oldest.since).getTime()) oldest = i;
  }
  return { total: items.length, byKind, oldest };
}

/** Whole days an item has been waiting. Floors at 0 so a clock skew never shows -1. */
export function waitingDays(item: OwnerQueueItem, now: Date = new Date()): number {
  const t = new Date(item.since).getTime();
  if (Number.isNaN(t)) return 0;
  return Math.max(0, Math.floor((now.getTime() - t) / 86_400_000));
}
