// IS THIS NEW ASSET SUBSTANTIALLY BETTER THAN THE ONE ALREADY IN THE SLOT?
//
// Filling an EMPTY slot is a different question from REPLACING an occupied one,
// and the second is much harder to get right. An empty slot has no downside to
// weigh; a replacement trades a known image for a claimed improvement, and if
// the bar is low the site churns its own pages every time the library grows.
//
// THREE RULES DECIDE EVERYTHING HERE
// ----------------------------------
// 1. WHOSE CHOICE IS IT. `human` and `unknown` are never replaced, not even by
//    something obviously better. That is selection-policy.ts's rule and this
//    module only enforces it — an owner's deliberate hero being silently
//    upgraded is the failure mode that would make the whole feature untrustable.
//    `unknown` sits with `human` because 179 links predate provenance.
//
// 2. IMPROVEMENT MUST BE IN KIND, NOT IN DEGREE. A replacement needs a reason a
//    person would recognise as a real upgrade: an exact model where there was
//    only a family, a photograph where there was a title card, a Discover-sized
//    image where there was a thumbnail. Two good photographs of the same camera
//    are not an upgrade, however much the newer one scores.
//
// 3. NEWER IS NOT BETTER. Nothing in this file reads a timestamp. An asset
//    uploaded this morning has no advantage over one from last year; the older
//    one stays if it is the better picture.
//
// Pure. No I/O.

import type { MediaMatch, MatchAsset, MediaRole } from "./match-engine.ts";
import { depictsRealObject } from "./match-engine.ts";
import { isProtectedSelection } from "./selection-policy.ts";
import { DISCOVER_MIN_WIDTH, DISCOVER_MIN_PIXELS } from "../seo/discover-readiness.ts";
import type { MediaSelectionKind } from "@/lib/types/database";

/** One reason the proposed asset is better, in words an editor can check. */
export type UpgradeReason = {
  /** Short machine-readable kind, for grouping in a report. */
  kind:
    | "exact_model_over_family"
    | "family_over_topical"
    | "photograph_over_graphic"
    | "discover_size"
    | "aspect_ratio"
    | "owned_over_generic"
    | "verified_identity"
    | "described_over_undescribed";
  detail: string;
};

export type UpgradeVerdict =
  /** Replace the current asset in this slot. */
  | { decision: "replace"; reasons: UpgradeReason[]; refusals: string[] }
  /** Keep what is there. */
  | { decision: "keep"; reasons: UpgradeReason[]; refusals: string[] };

export type SlotOccupant = {
  role: MediaRole;
  selectionKind: MediaSelectionKind | null;
  asset: MatchAsset;
  /** The current asset's match against this same target. */
  match: MediaMatch;
};

const SPECIFICITY_RANK = { topical: 0, family: 1, exact_model: 2 } as const;

/**
 * How many DISTINCT kinds of improvement a replacement must show.
 *
 * One is enough when it is a specificity jump — a generic manufacturer graphic
 * giving way to a verified photograph of the actual product is not a marginal
 * call. Anything else needs two, so a replacement is never justified by a size
 * difference alone.
 */
export const DECISIVE_KINDS: ReadonlySet<UpgradeReason["kind"]> = new Set([
  "exact_model_over_family",
  "photograph_over_graphic",
  "verified_identity",
]);

/**
 * A photograph only outranks a graphic when it is a photograph OF THE THING.
 *
 * THE PROPOSAL THAT FORCED THIS RULE. Run against production, the policy offered
 * to replace `hero-canon-eos-r5-vs-r6.png` in the gallery of "Canon EOS R vs RP"
 * with `1280px-milky-way-night-sky-black-rock-desert-nevada.jpg`. Both matched
 * at FAMILY level — the Milky Way shot is filed under cameras-photography — and
 * "photograph beats graphic" did the rest.
 *
 * A comparison graphic that names the actual cameras is more use to that reader
 * than a landscape photograph taken with one. The brief says "real RELEVANT
 * photograph > generic generated title card", and the word doing the work is
 * relevant. So the photograph advantage is decisive only at exact_model; at
 * family level it still counts, but it needs a second independent reason.
 */
function photographAdvantageIsDecisive(specificity: MediaMatch["specificity"]): boolean {
  return specificity === "exact_model";
}

function meetsDiscoverSize(a: MatchAsset): boolean {
  if (a.width === null || a.height === null) return false;
  return a.width >= DISCOVER_MIN_WIDTH && a.width * a.height >= DISCOVER_MIN_PIXELS;
}

function ratioDistance(a: MatchAsset): number | null {
  if (!a.width || !a.height) return null;
  return Math.abs(a.width / a.height - 16 / 9);
}

/**
 * Compare a candidate against the asset currently in a slot.
 *
 * `slot` matters: a prominent slot is worth upgrading for reasons a gallery slot
 * is not. Discover size is a real argument about a hero or a card and close to
 * meaningless about the third image in a gallery.
 */
export function assessUpgrade(
  occupant: SlotOccupant,
  candidate: MatchAsset,
  candidateMatch: MediaMatch
): UpgradeVerdict {
  const reasons: UpgradeReason[] = [];
  const refusals: string[] = [];

  // ---- rule 1: whose choice is it --------------------------------------
  if (isProtectedSelection(occupant.selectionKind)) {
    refusals.push(
      occupant.selectionKind === "human"
        ? `${occupant.role}: a person chose the current image. It is never replaced automatically; propose it to them instead.`
        : `${occupant.role}: the current selection predates provenance tracking, so it is treated as an editorial choice and left alone.`
    );
    return { decision: "keep", reasons, refusals };
  }

  // ---- the candidate must itself be usable ------------------------------
  if (candidate.publicationStatus !== "published") {
    refusals.push(`${occupant.role}: the proposed asset is ${candidate.publicationStatus}, not published.`);
    return { decision: "keep", reasons, refusals };
  }
  if (candidateMatch.proposedSlots.length === 0 || !candidateMatch.proposedSlots.includes(occupant.role)) {
    refusals.push(
      `${occupant.role}: the matcher does not offer the proposed asset for this slot` +
        (candidateMatch.withheld[0] ? ` — ${candidateMatch.withheld[0]}` : ".")
    );
    return { decision: "keep", reasons, refusals };
  }

  // ---- rule 2: improvement in kind --------------------------------------
  const currentRank = SPECIFICITY_RANK[occupant.match.specificity];
  const candidateRank = SPECIFICITY_RANK[candidateMatch.specificity];

  if (candidateRank > currentRank) {
    reasons.push({
      kind: candidateRank === 2 ? "exact_model_over_family" : "family_over_topical",
      detail: `identifies the subject as ${candidateMatch.specificity} where the current image is only ${occupant.match.specificity}`,
    });
  } else if (candidateRank < currentRank) {
    refusals.push(
      `${occupant.role}: the proposed asset is ${candidateMatch.specificity} and the current one is ` +
        `${occupant.match.specificity}. A less specific image is never an upgrade.`
    );
    return { decision: "keep", reasons, refusals };
  }

  const currentReal = depictsRealObject(occupant.match.nature);
  const candidateReal = depictsRealObject(candidateMatch.nature);
  if (candidateReal && !currentReal) {
    reasons.push({
      kind: "photograph_over_graphic",
      detail: `is ${candidateMatch.nature} where the current image is ${occupant.match.nature}, which explains rather than depicts`,
    });
  } else if (currentReal && !candidateReal) {
    refusals.push(
      `${occupant.role}: the current image depicts a real object and the proposed one (${candidateMatch.nature}) does not.`
    );
    return { decision: "keep", reasons, refusals };
  }

  if ((candidate.verifiedProducts?.length ?? 0) > 0 && (occupant.asset.verifiedProducts?.length ?? 0) === 0) {
    reasons.push({
      kind: "verified_identity",
      detail: "its subject is recorded in the media library rather than inferred from its filename",
    });
  }

  if (candidate.owned && !occupant.asset.owned) {
    reasons.push({ kind: "owned_over_generic", detail: "is owned outright, so its rights are not in question" });
  }

  // Size and shape matter for the slots a reader sees first.
  if (occupant.role === "hero" || occupant.role === "thumbnail") {
    if (meetsDiscoverSize(candidate) && !meetsDiscoverSize(occupant.asset)) {
      reasons.push({
        kind: "discover_size",
        detail:
          `is ${candidate.width}x${candidate.height}, clearing Google's stated ${DISCOVER_MIN_WIDTH}px / ` +
          `${DISCOVER_MIN_PIXELS.toLocaleString()}px minimums that the current image does not`,
      });
    }
    const cd = ratioDistance(candidate);
    const od = ratioDistance(occupant.asset);
    // A replacement that is a WORSE shape for a slot the reader sees first is
    // not an upgrade, whatever else it has going for it. The two photographs
    // this rule caught in production are portrait (1280x1707, 1280x1793)
    // against a 16x9 graphic — better pictures, worse cards.
    if (cd !== null && od !== null && cd - od > 0.3) {
      refusals.push(
        `${occupant.role}: the proposed image is a worse shape for this slot ` +
          `(${(candidate.width! / candidate.height!).toFixed(2)}:1 against ${(occupant.asset.width! / occupant.asset.height!).toFixed(2)}:1, ` +
          "target 1.78:1), so more of it would be lost to cropping."
      );
      return { decision: "keep", reasons, refusals };
    }
    if (cd !== null && od !== null && od - cd > 0.3) {
      reasons.push({
        kind: "aspect_ratio",
        detail: `is closer to 16x9 (${(candidate.width! / candidate.height!).toFixed(2)}:1 against ${(occupant.asset.width! / occupant.asset.height!).toFixed(2)}:1), so less is lost to cropping`,
      });
    }
  }

  const candidateDescribed = (candidate.altText ?? "").trim().length >= 10;
  const currentDescribed = (occupant.asset.altText ?? "").trim().length >= 10;
  if (candidateDescribed && !currentDescribed) {
    reasons.push({ kind: "described_over_undescribed", detail: "carries alt text where the current image has none" });
  }

  // ---- the threshold ----------------------------------------------------
  if (reasons.length === 0) {
    refusals.push(
      `${occupant.role}: no improvement in kind. Two comparable images are not a reason to churn a page.`
    );
    return { decision: "keep", reasons, refusals };
  }
  const decisive = reasons.some(
    (r) =>
      DECISIVE_KINDS.has(r.kind) &&
      (r.kind !== "photograph_over_graphic" || photographAdvantageIsDecisive(candidateMatch.specificity))
  );
  if (!decisive && reasons.length < 2) {
    refusals.push(
      `${occupant.role}: only one non-decisive improvement (${reasons[0].kind}). A replacement needs a specificity or ` +
        "photography jump, or at least two independent improvements."
    );
    return { decision: "keep", reasons, refusals };
  }

  return { decision: "replace", reasons, refusals };
}

/** One line an editor can read in a queue. */
export function describeUpgrade(v: UpgradeVerdict): string {
  if (v.decision === "keep") return v.refusals[0] ?? "Keeping the current image.";
  return `Better because it ${v.reasons.map((r) => r.detail).join("; and it ")}.`;
}
