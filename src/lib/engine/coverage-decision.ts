// NEW ARTICLE, UPDATE, SUPPORTING, OR NOTHING?
//
// THE PROBLEM
// -----------
// Five publications reporting one Samsung update is ONE development. A pipeline
// that turns each corroborated opportunity into an article produces five
// near-identical pages competing with each other for the same readers and the
// same queries — and the site gets worse the harder the engine works.
//
// So before anything is created, the opportunity is compared against what
// TechCarvalho already has, and exactly one editorial decision comes out.
//
// WHY UPDATE IS THE DEFAULT WHEN COVERAGE EXISTS
// ----------------------------------------------
// A developing story usually belongs on the page that already ranks for it,
// gathering detail as it develops. Publishing again splits the authority
// between two URLs and leaves the older one quietly wrong. Updating is almost
// always the better editorial act and almost never the one an automated
// pipeline reaches for, because creating is easier to implement.
//
// THE FOUR DECISIONS, AND WHAT SEPARATES THEM
// -------------------------------------------
//   NEW_ARTICLE        nothing close enough exists
//   UPDATE_EXISTING    a page covers this subject and this is more of it
//   SUPPORTING         related, genuinely distinct, and adds something the
//                      existing page should link to rather than absorb
//   NO_COVERAGE        nothing here worth a reader's time
//
// SUPPORTING is the narrow one and is deliberately hard to reach. It is the
// decision most easily abused to justify publishing anyway — "it's related but
// different!" — so it requires the existing page to be about a DIFFERENT
// primary subject, not merely a different angle on the same one.
//
// PURE. No `server-only`, no Supabase, no clock beyond what is passed in.

import { titleSimilarity } from "./dedupe.ts";

export type CoverageDecision =
  | "NEW_ARTICLE"
  | "UPDATE_EXISTING"
  | "SUPPORTING"
  | "NO_COVERAGE";

export const DECISION_LABELS: Record<CoverageDecision, string> = {
  NEW_ARTICLE: "New article",
  UPDATE_EXISTING: "Update existing",
  SUPPORTING: "Supporting article",
  NO_COVERAGE: "No coverage needed",
};

export type ExistingPiece = {
  id: string;
  title: string;
  slug: string;
  status: "published" | "draft" | "archived" | string;
  categorySlug: string | null;
  publishedAt: string | null;
  /** How many other pieces link to or from it. Real editorial structure. */
  referenceCount?: number;
};

export type CoverageInput = {
  /** The opportunity's proposed subject. */
  subject: string;
  categorySlug: string | null;
  /** Independent origins behind it. */
  independentOrigins: number;
  framing: "confirmed" | "reported" | "rumoured" | "insufficient";
  /** Extractable claims. Two is the floor for anything worth reading. */
  claimCount: number;
  existing: readonly ExistingPiece[];
  now?: Date;
};

export type CoverageVerdict = {
  decision: CoverageDecision;
  /** The page to update or support, when there is one. */
  target: ExistingPiece | null;
  /** 0..1 similarity with `target`. */
  similarity: number;
  /** Ordered, human-readable. First entry is the primary reason. */
  reasons: string[];
  /** Everything close enough to matter, so the owner sees what was considered. */
  nearby: { piece: ExistingPiece; similarity: number }[];
};

// THRESHOLDS, MEASURED RATHER THAN GUESSED.
//
// Real titleSimilarity values for the cases these rules exist to separate:
//
//   0.75  "Samsung One UI 8 rolls out to Galaxy S25"
//         "One UI 8 rolling out to Samsung Galaxy S25"      same development
//   0.56  "... rolls out to Galaxy S25" / "Samsung begins One UI 8 rollout"
//   0.44  "... rolls out to Galaxy S25" / "Galaxy S25 gets One UI 8 update"
//   0.33  "Wi-Fi 7 explained" / "Wi-Fi 7 router placement tips"   related
//   0.29  "Wi-Fi 7 explained" / "Wi-Fi 7 router placement in older houses"
//   0.00  "Wi-Fi 7 explained" / "Canon RF 24-70mm announced"      unrelated
//
// The gap between "same development" (>= 0.44) and "related" (<= 0.33) is
// wide, and unrelated material sits at zero, so both lines have real headroom.
// My first attempt used NEAR_DUPLICATE_THRESHOLD (0.6) for consolidation and
// failed to collapse the One UI reports at all — the exact duplication this
// module exists to prevent.

/** Related enough to be worth comparing against. Below this, different subjects. */
export const SAME_SUBJECT_THRESHOLD = 0.25;

/**
 * The same underlying development, not merely the same topic.
 *
 * This is the line that decides UPDATE versus SUPPORTING, and the line that
 * collapses five reports of one event into one opportunity.
 */
export const SAME_STORY_THRESHOLD = 0.42;

/** Days after which a published piece is stale enough that new reporting updates it. */
export const UPDATE_WINDOW_DAYS = 400;

const MS_PER_DAY = 86_400_000;

export function decideCoverage(input: CoverageInput): CoverageVerdict {
  const now = input.now ?? new Date();
  const reasons: string[] = [];

  const scored = input.existing
    .map((piece) => ({ piece, similarity: titleSimilarity(input.subject, piece.title) }))
    .filter((x) => x.similarity >= SAME_SUBJECT_THRESHOLD)
    .sort((a, b) => b.similarity - a.similarity);

  const nearby = scored.slice(0, 5);

  // ---- 1. is it worth covering at all? ----------------------------------
  //
  // Checked FIRST. An opportunity too thin to write is too thin to justify
  // updating something either, and reaching UPDATE on no evidence would launder
  // a weak story into an existing strong page.
  if (input.framing === "insufficient" || input.claimCount < 2) {
    reasons.push(
      `Nothing to write: ${input.claimCount} extractable claim(s) and framing "${input.framing}".`
    );
    return { decision: "NO_COVERAGE", target: null, similarity: 0, reasons, nearby };
  }

  // ---- 2. nothing exists -------------------------------------------------
  if (scored.length === 0) {
    reasons.push(
      `No existing TechCarvalho page is about this subject (nothing scored above ${SAME_SUBJECT_THRESHOLD}).`
    );
    reasons.push(
      `${input.independentOrigins} independent origin(s) and ${input.claimCount} claims support a new piece.`
    );
    return { decision: "NEW_ARTICLE", target: null, similarity: 0, reasons, nearby };
  }

  const best = scored[0];

  // ---- 3. a near-duplicate exists ----------------------------------------
  if (best.similarity >= SAME_STORY_THRESHOLD) {
    const ageDays = best.piece.publishedAt
      ? (now.getTime() - new Date(best.piece.publishedAt).getTime()) / MS_PER_DAY
      : null;

    // A DRAFT covering the same thing is the same work already queued, not a
    // page to update. Publishing beside it would produce the duplicate twice.
    if (best.piece.status === "draft") {
      reasons.push(
        `A draft already covers this: "${best.piece.title}" (similarity ${best.similarity.toFixed(2)}).`
      );
      reasons.push("Finish that draft rather than starting a second piece on the same development.");
      return { decision: "NO_COVERAGE", target: best.piece, similarity: best.similarity, reasons, nearby };
    }

    reasons.push(
      `"${best.piece.title}" already covers this development (similarity ${best.similarity.toFixed(2)}, threshold ${SAME_STORY_THRESHOLD}).`
    );
    reasons.push(
      "Updating the page that already holds this subject keeps the authority on one URL. " +
        "Publishing again splits it and leaves the older page quietly wrong."
    );
    if (ageDays !== null && ageDays > UPDATE_WINDOW_DAYS) {
      reasons.push(
        `It is ${Math.floor(ageDays)} days old, so this is a substantial refresh rather than an addition.`
      );
    }
    return { decision: "UPDATE_EXISTING", target: best.piece, similarity: best.similarity, reasons, nearby };
  }

  // ---- 4. related but not the same ---------------------------------------
  //
  // SUPPORTING is the narrow decision and the one most easily abused to justify
  // publishing anyway. It requires REAL new material — more than a couple of
  // claims and more than one voice — otherwise the honest answer is that the
  // existing page should absorb it.
  const substantial = input.claimCount >= 5 && input.independentOrigins >= 2;
  if (substantial) {
    reasons.push(
      `Related to "${best.piece.title}" (similarity ${best.similarity.toFixed(2)}) but not the same subject.`
    );
    reasons.push(
      `${input.claimCount} claims across ${input.independentOrigins} independent origins is enough for its own piece, linked to that one.`
    );
    return { decision: "SUPPORTING", target: best.piece, similarity: best.similarity, reasons, nearby };
  }

  reasons.push(
    `Related to "${best.piece.title}" (similarity ${best.similarity.toFixed(2)}) but carries only ` +
      `${input.claimCount} claims from ${input.independentOrigins} origin(s).`
  );
  reasons.push("Too thin for its own page; the existing piece should absorb it instead.");
  return { decision: "UPDATE_EXISTING", target: best.piece, similarity: best.similarity, reasons, nearby };
}

/**
 * Collapse opportunities that describe the same development.
 *
 * Five outlets covering one Samsung update arrive as five opportunities. This
 * groups them so the pipeline downstream sees ONE, which is the only reason
 * the site does not end up with five competing pages.
 *
 * Deterministic: groups are keyed by the strongest member, and ties break on
 * subject text, so the same input always produces the same grouping.
 */
export function consolidateOpportunities<T extends { subject: string; independentOrigins: number }>(
  opportunities: readonly T[]
): { primary: T; duplicates: T[] }[] {
  const ordered = [...opportunities].sort(
    (a, b) => b.independentOrigins - a.independentOrigins || a.subject.localeCompare(b.subject)
  );
  const groups: { primary: T; duplicates: T[] }[] = [];
  const claimed = new Set<T>();

  for (const candidate of ordered) {
    if (claimed.has(candidate)) continue;
    claimed.add(candidate);
    const duplicates: T[] = [];
    for (const other of ordered) {
      if (claimed.has(other)) continue;
      if (titleSimilarity(candidate.subject, other.subject) >= SAME_STORY_THRESHOLD) {
        claimed.add(other);
        duplicates.push(other);
      }
    }
    groups.push({ primary: candidate, duplicates });
  }
  return groups;
}
