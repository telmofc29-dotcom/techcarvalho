// Who owns the hero slot, and what happens when something else wants it.
//
// THE DEFECT THIS EXISTS TO FIX
// -----------------------------
// The owner assigned a new PS5 Pro image as hero and the old hero stayed
// active. Three faults stacked up, and the audit found all three live:
//
//   1. SCHEMA. product_media/content_media are unique on
//      (target_id, media_id, role) — the TRIPLE. That constrains one row per
//      asset per role, and says nothing about how many DIFFERENT assets may
//      hold 'hero' on the same target. Two heroes is a legal row set.
//   2. WRITE. Saving associations from a media asset page deletes only that
//      ASSET's rows for the target, then inserts. Assigning asset B as hero
//      therefore never touches asset A's hero row. It adds a second one.
//   3. READ. getPublishedHeroImage did .eq('role','hero').limit(1) with NO
//      ORDER BY, so with two heroes Postgres returns whichever it likes —
//      in production, the older graphic.
//
// Production state when this was written: ps5-vs-ps5-pro-worth-it had two hero
// rows, and the newer one was still `private` so it could not have rendered
// even if it had won the coin toss.
//
// This module holds the decision logic, kept pure so it can be tested without a
// database and reused by any caller that wants to move a hero.

/**
 * How a slot assignment came about.
 *
 * Ordered deliberately: a human choice outranks a machine's. The engine must
 * never quietly overwrite something a person chose on purpose.
 */
export type SlotSelectionKind =
  | "manual_owner"
  | "manual_editor"
  | "automatic"
  | "imported"
  | "inherited";

const SELECTION_RANK: Record<SlotSelectionKind, number> = {
  manual_owner: 400,
  manual_editor: 300,
  automatic: 200,
  imported: 100,
  inherited: 0,
};

export function selectionRank(kind: SlotSelectionKind): number {
  return SELECTION_RANK[kind];
}

/** True when `a` was chosen by a person and `b` was not. */
export function isManual(kind: SlotSelectionKind): boolean {
  return kind === "manual_owner" || kind === "manual_editor";
}

export type HeroOccupant = {
  mediaId: string;
  /** Absent for rows written before selection provenance existed. */
  selectedBy?: SlotSelectionKind | null;
};

/**
 * May an AUTOMATED process take the hero slot from its current occupant?
 *
 * The rule, stated plainly: no automated process may replace a hero a human
 * chose — ever, at any confidence. It may only replace a hero that was itself
 * automatic, imported or inherited, and only when it ranks strictly higher.
 *
 * A row with no recorded provenance is treated as MANUAL, not automatic. That
 * is the safe direction for the assets that already exist: every one of them
 * predates this field, and assuming a machine put them there would licence the
 * engine to overwrite the owner's own past choices.
 */
export function mayAutomaticallyReplaceHero(
  existing: HeroOccupant,
  candidateScore: number,
  existingScore: number
): { allowed: boolean; reason: string } {
  const kind = existing.selectedBy ?? "manual_owner";

  if (isManual(kind)) {
    return {
      allowed: false,
      reason:
        "The current hero was selected by a person. Automated selection never replaces a manual choice — " +
        "it can only propose an alternative for review.",
    };
  }

  if (candidateScore <= existingScore) {
    return {
      allowed: false,
      reason: `The candidate does not rank higher than the current hero (${candidateScore} vs ${existingScore}).`,
    };
  }

  return { allowed: true, reason: `Candidate ranks higher (${candidateScore} vs ${existingScore}) and the current hero was ${kind}.` };
}

/** What an admin may do when the hero slot is already taken. */
export type HeroDecision = "replace" | "add_to_gallery" | "cancel";

export type HeroAssignmentPlan =
  | { kind: "vacant"; operations: SlotOperation[] }
  | { kind: "already_hero"; operations: [] }
  | { kind: "needs_decision"; currentHeroMediaId: string }
  | { kind: "decided"; operations: SlotOperation[] };

/**
 * One row-level change. Returned rather than executed so the caller owns the
 * transaction and this stays testable.
 */
export type SlotOperation =
  | { op: "demote_hero_to_gallery"; mediaId: string }
  | { op: "remove_hero"; mediaId: string }
  | { op: "set_role"; mediaId: string; role: "hero" | "gallery" | "thumbnail" };

/**
 * Work out what assigning `candidateMediaId` as hero should actually do.
 *
 * Never silently displaces an incumbent: with a different hero present and no
 * decision supplied, this returns `needs_decision` and the caller is expected
 * to ask. That is the whole point — the previous behaviour chose for the admin,
 * and chose wrong.
 *
 * On "replace" the outgoing hero is DEMOTED TO GALLERY rather than deleted. The
 * asset keeps existing, keeps its rights and provenance, and stays attached to
 * the thing it illustrates; only the slot changes hands. Losing the hero slot
 * is not a reason to throw a picture away.
 */
export function planHeroAssignment(input: {
  candidateMediaId: string;
  currentHeroMediaId: string | null;
  decision?: HeroDecision;
}): HeroAssignmentPlan {
  const { candidateMediaId, currentHeroMediaId, decision } = input;

  if (currentHeroMediaId === candidateMediaId) {
    return { kind: "already_hero", operations: [] };
  }

  if (!currentHeroMediaId) {
    return { kind: "vacant", operations: [{ op: "set_role", mediaId: candidateMediaId, role: "hero" }] };
  }

  if (!decision) {
    return { kind: "needs_decision", currentHeroMediaId };
  }

  if (decision === "cancel") {
    return { kind: "decided", operations: [] };
  }

  if (decision === "add_to_gallery") {
    // The incumbent keeps the slot; the newcomer joins the gallery.
    return { kind: "decided", operations: [{ op: "set_role", mediaId: candidateMediaId, role: "gallery" }] };
  }

  return {
    kind: "decided",
    operations: [
      { op: "demote_hero_to_gallery", mediaId: currentHeroMediaId },
      { op: "set_role", mediaId: candidateMediaId, role: "hero" },
    ],
  };
}

/**
 * Pick ONE hero from a set of rows that should never have contained more than
 * one, without guessing.
 *
 * Used on the read path so an existing double-hero renders something sensible
 * instead of a coin toss. The order is deliberate:
 *
 *   1. An asset that can actually be shown beats one that cannot. A private
 *      asset in the hero slot renders NOTHING, which is how the owner ended up
 *      with a page that appeared to ignore the new image entirely.
 *   2. Then the lowest sort_order, which is the only ordering signal the schema
 *      carries.
 *   3. Then the row id, purely so the result is stable between requests rather
 *      than varying with physical row order.
 *
 * This is a safety net, not the fix. The fix is the partial unique index in
 * supabase/migrations_pending, which makes two heroes impossible.
 */
export function chooseActiveHero<T extends { mediaId: string; rowId: string; sortOrder: number; renderable: boolean }>(
  rows: readonly T[]
): T | null {
  if (rows.length === 0) return null;
  const ordered = [...rows].sort((a, b) => {
    if (a.renderable !== b.renderable) return a.renderable ? -1 : 1;
    if (a.sortOrder !== b.sortOrder) return a.sortOrder - b.sortOrder;
    return a.rowId < b.rowId ? -1 : a.rowId > b.rowId ? 1 : 0;
  });
  return ordered[0];
}
