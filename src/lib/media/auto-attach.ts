// MAY THE ENGINE ATTACH THIS IMAGE BY ITSELF?
//
// The last gate before a machine writes into content_media. Everything upstream
// has already run — the canonical matcher decided what this image IS relative to
// the target, rights and publication state were read, the SKU rule refused
// anything family-level on a model-specific page. This module answers only the
// remaining question: given all of that, is attaching WITHOUT A HUMAN safe?
//
// IT IS NOT A SECOND MATCHER. It never re-scores, never re-reads a filename and
// never overrides a refusal. It takes a MediaMatch the one canonical matcher
// produced and either narrows it or rejects it. If this file ever starts
// deciding what an image depicts, the "one canonical matching engine" property
// is gone.
//
// WHY THE BAR IS HIGHER THAN "THE MATCHER OFFERED IT"
// ---------------------------------------------------
// `proposedSlots` answers "would this be a defensible choice for an editor to
// make". Auto-attach answers "would this be a defensible choice for NOBODY to
// make". Those are different questions and the second one deserves a stricter
// answer, because there is no review step behind it — the engine's guess becomes
// the page, and the reader cannot tell which images were chosen and which were
// computed.
//
// SLOT BY SLOT, DELIBERATELY UNEQUAL
// ----------------------------------
//   HERO       the face of the article. Exact model, high confidence, a real
//              photograph of a real object, and nothing already in the slot.
//   THUMBNAIL  appears in listings, on the homepage, and on any surface that
//              syndicates cards. Held to the SAME bar as hero: a wrong card
//              image is seen by more people than a wrong hero.
//   GALLERY    additive and collides with nothing, so family-level imagery is
//              allowed — but only where the matcher established a real subject
//              relationship, never on shared ordinary wording.
//
// Pure. No I/O.

import type { MediaMatch, MediaRole, MatchAsset } from "./match-engine.ts";
import { depictsRealObject } from "./match-engine.ts";
import { evaluatePublishEligibility } from "./rights.ts";

/**
 * The score a GALLERY attachment must clear.
 *
 * Above MIN_SCORE (20), because 20 is "an editor could reasonably be shown
 * this" and this is "nobody will look at it before it appears". Below the hero
 * bar, because a gallery image that is merely of the right family is honest.
 */
export const AUTO_GALLERY_MIN_SCORE = 45;

export type AutoAttachDecision = {
  /** Slots the engine may fill without asking. Empty is the common answer. */
  slots: MediaRole[];
  /** Why each slot was allowed. One entry per slot, in the same order. */
  reasons: string[];
  /** Why every other slot was not. Never silent. */
  refusals: string[];
};

/** What the caller must already know about the target's current slots. */
export type SlotState = {
  role: MediaRole;
  /** True for 'human' and 'unknown'. See selection-policy.ts. */
  protectedSelection: boolean;
};

/**
 * Decide what, if anything, may be attached automatically.
 *
 * `asset` is re-checked here rather than trusted from the match, because this is
 * the function standing immediately in front of a write. Rights and publication
 * state are the two things whose cost of being wrong is a licence violation or a
 * private image on a public page, and both are cheap to check twice.
 */
export function decideAutoAttach(
  asset: MatchAsset,
  match: MediaMatch,
  occupied: readonly SlotState[]
): AutoAttachDecision {
  const slots: MediaRole[] = [];
  const reasons: string[] = [];
  const refusals: string[] = [];

  // ---- gate 1: the image must be publicly usable at all -----------------
  //
  // A private asset attached to a published article is a leak, and the leak
  // happens at render time when nobody is watching. Checked before anything
  // about relevance, because no amount of relevance fixes it.
  if (asset.publicationStatus !== "published") {
    refusals.push(
      `Refused every slot: this asset is ${asset.publicationStatus}, not published. ` +
        "The engine never attaches private media, whatever it depicts."
    );
    return { slots, reasons, refusals };
  }

  const eligibility = evaluatePublishEligibility({
    rights_status: asset.rightsStatus as never,
    owned: asset.owned,
    source_type: asset.sourceType as never,
  });
  if (!eligibility.allowed) {
    refusals.push(`Refused every slot on rights: ${eligibility.reason}`);
    return { slots, reasons, refusals };
  }

  // ---- gate 2: the matcher must have offered something ------------------
  if (match.proposedSlots.length === 0) {
    refusals.push(
      match.withheld[0] ?? "The matcher offered no slot for this pairing, so there is nothing to attach."
    );
    return { slots, reasons, refusals };
  }

  const held = new Map(occupied.map((s) => [s.role, s]));
  const exact = match.specificity === "exact_model";
  const confident = match.strength === "high";
  const real = depictsRealObject(match.nature);

  // ---- HERO and THUMBNAIL: the prominent slots --------------------------
  for (const role of ["hero", "thumbnail"] as const) {
    if (!match.proposedSlots.includes(role)) {
      refusals.push(`${role}: the matcher did not offer it.`);
      continue;
    }
    const current = held.get(role);
    if (current) {
      // A protected slot is never taken. An engine-held slot is not taken
      // either — replacing one machine guess with another is churn, and the
      // re-matching pass that improves them is a separate, explicit action.
      refusals.push(
        current.protectedSelection
          ? `${role}: already filled by a choice a person made (or one predating provenance). Never taken automatically.`
          : `${role}: already filled by an earlier engine selection. Reconsidering it is an explicit action, not a side effect.`
      );
      continue;
    }
    if (!exact) {
      refusals.push(
        `${role}: the match is ${match.specificity}, not an exact model. A prominent slot would present it ` +
          "as a picture of this exact thing, which is a claim the evidence does not support."
      );
      continue;
    }
    if (!confident) {
      refusals.push(`${role}: confidence is ${match.strength}. Prominent slots require high confidence.`);
      continue;
    }
    if (!real) {
      refusals.push(
        `${role}: ${match.nature} does not depict a real object. A render or a diagram in a prominent slot ` +
          "reads as a photograph of the product."
      );
      continue;
    }
    slots.push(role);
    reasons.push(
      `${role}: exact-model match at high confidence, ${match.nature}, and the slot was empty. ` +
        `Attached as an ENGINE selection, so it can be reconsidered later.`
    );
  }

  // ---- GALLERY: additive, so a broader bar ------------------------------
  if (match.proposedSlots.includes("gallery")) {
    if (match.specificity === "topical") {
      // Unreachable via the matcher today, which refuses topical outright.
      // Kept because "unreachable" is a property of today's caller, not of this
      // function, and the cost of being wrong here is a wrong picture.
      refusals.push("gallery: only a category-level association.");
    } else if (match.score < AUTO_GALLERY_MIN_SCORE) {
      refusals.push(
        `gallery: score ${match.score} is below the automatic threshold of ${AUTO_GALLERY_MIN_SCORE}. ` +
          "An editor may still choose it."
      );
    } else {
      slots.push("gallery");
      reasons.push(
        `gallery: ${match.specificity} match at score ${match.score}, additive and displacing nothing.`
      );
    }
  } else {
    refusals.push("gallery: the matcher did not offer it.");
  }

  return { slots, reasons, refusals };
}

/**
 * The provenance stamp for an engine selection.
 *
 * `selected_by` is NULL and must stay NULL: content_media_human_needs_actor
 * refuses an 'engine' row that names a person. The engine does not get to
 * attribute its guesses to the owner.
 */
export function engineSelection(): {
  selection_kind: "engine";
  selected_by: null;
  selected_at: string;
} {
  return { selection_kind: "engine", selected_by: null, selected_at: new Date().toISOString() };
}
