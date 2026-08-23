// The six states a (source article x target locale) pair can be in, and the
// rules that decide which one applies.
//
// Pure data and pure functions — no I/O, no framework imports. The service
// (translation-service.ts) reads rows, this file decides what they mean, and
// the page renders the decision. Keeping the decision here is what makes it
// testable: staleness in particular is the rule most likely to be got subtly
// wrong, and the cost of getting it wrong is a translation that reads as
// "current" while the English it was made from has moved on.
//
// WHY STALENESS IS DERIVED AND NOT STORED
// ---------------------------------------
// supabase/migrations/20260824_translation_model.sql argues this at length and
// the same reasoning governs here: a translation is stale iff
//
//     source.translatable_revision > translation.source_revision_seen
//
// and translatable_revision is bumped by trigger ONLY when title or body
// change. updated_at is deliberately not the signal — flipping a status or
// adding a tag would falsely stale every translation, and a publication that
// cries stale on every unrelated edit trains its editors to ignore the flag.
//
// This rule is duplicated (in SQL) inside content_translation_status(). That is
// intentional redundancy, not an accident: the RPC cannot report
// translation_reviewed_by, so the admin surface computes coverage from the
// columns directly. If one of the two is ever changed, change both — the
// staleness expression is written identically in both places on purpose so a
// grep for `source_revision_seen` finds them together.

/**
 * Ordered worst-first. The order is the ladder classifyTranslation() walks and
 * also the order the dashboard renders, so an editor reads the page top-down
 * as a work queue.
 */
export const TRANSLATION_STATES = [
  "untranslated",
  "stale",
  "needs_update",
  "draft",
  "current",
  "reviewed",
] as const;

export type TranslationCoverageState = (typeof TRANSLATION_STATES)[number];

export type TranslationSignals = {
  /** null when no row exists for this (source, locale) pair at all. */
  translationId: string | null;
  /** content_items.translation_state on the translation row. */
  translationState: string | null;
  /** content_items.translatable_revision on the SOURCE row. */
  sourceRevision: number;
  /** content_items.source_revision_seen on the TRANSLATION row. */
  sourceRevisionSeen: number | null;
  /** content_items.translation_reviewed_by — a human signed this off. */
  reviewedBy: string | null;
};

/**
 * Has the source moved on since this translation was made?
 *
 * A null source_revision_seen counts as stale rather than as current. A
 * translation that does not record which revision it came from cannot be
 * asserted to be up to date, and the safe reading of "I don't know" on a
 * coverage report is "needs a look", never "fine".
 */
export function isTranslationStale(
  sourceRevision: number,
  sourceRevisionSeen: number | null
): boolean {
  return sourceRevision > (sourceRevisionSeen ?? 0);
}

/**
 * Which of the six states this pair is in.
 *
 * The ladder is precedence-ordered and each rung is exclusive:
 *
 *  1. untranslated — no row exists. Nothing else can be true.
 *  2. stale        — the source changed after the translation was made. This
 *                    outranks every "done" state on purpose: a reviewed,
 *                    published translation whose English original has since
 *                    been rewritten is the most dangerous row on the site, not
 *                    the safest, and it must not sit in a green bucket.
 *  3. needs_update — the row itself says it needs work ('needs_review' /
 *                    'failed').
 *  4. draft        — in progress, not yet offered for review. A null
 *                    translation_state counts as draft: the column is nullable
 *                    and an unset value means nobody has declared it finished.
 *  5. reviewed     — up to date, finished, and a human signed it off.
 *  6. current      — up to date and finished, but nobody has reviewed it.
 */
export function classifyTranslation(signals: TranslationSignals): TranslationCoverageState {
  if (!signals.translationId) return "untranslated";
  if (isTranslationStale(signals.sourceRevision, signals.sourceRevisionSeen)) return "stale";

  const state = signals.translationState;
  if (state === "needs_review" || state === "failed") return "needs_update";
  if (state === null || state === "draft") return "draft";

  // 'ready' or 'published' — finished work, up to date with its source.
  if (signals.reviewedBy) return "reviewed";
  return "current";
}

export const TRANSLATION_STATE_LABELS: Record<TranslationCoverageState, string> = {
  untranslated: "Untranslated",
  stale: "Source changed",
  needs_update: "Needs update",
  draft: "Draft",
  current: "Current",
  reviewed: "Reviewed",
};

export const TRANSLATION_STATE_DESCRIPTIONS: Record<TranslationCoverageState, string> = {
  untranslated: "No row exists in this locale. The article is only available in English.",
  stale:
    "A translation exists but the English title or body changed after it was made. What is in this locale no longer matches its source.",
  needs_update: "The translation itself is marked needs_review or failed.",
  draft: "A translation row exists and is being worked on. Not offered for review yet.",
  current: "Finished and up to date with its source, but no human has signed it off.",
  reviewed: "Finished, up to date, and reviewed by a named admin.",
};

export const TRANSLATION_STATE_TONES: Record<
  TranslationCoverageState,
  "neutral" | "green" | "amber" | "red" | "blue"
> = {
  untranslated: "neutral",
  stale: "red",
  needs_update: "amber",
  draft: "blue",
  current: "green",
  reviewed: "green",
};

/** A state counts as "has prose in this locale" — used only for honest counting. */
export function isTranslated(state: TranslationCoverageState): boolean {
  return state !== "untranslated";
}

export function emptyStateTotals(): Record<TranslationCoverageState, number> {
  return {
    untranslated: 0,
    stale: 0,
    needs_update: 0,
    draft: 0,
    current: 0,
    reviewed: 0,
  };
}
