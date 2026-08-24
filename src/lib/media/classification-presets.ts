// "Where did this file come from?", expressed once, in the owner's language.
//
// THE PROBLEM THIS SOLVES
// ----------------------
// New TechCarvalho renders arrived in the library as "Private / unknown", and
// the only route out was the provenance form, which answered with:
//
//   "This asset cannot be marked Verified until its provenance is recorded.
//    Missing: Source URL, License, Creator or Attribution text."
//
// That message is correct for a photograph licensed from somebody else. It is
// nonsense for an image TechCarvalho made, and it asked the owner to work out
// which combination of owned / source_type / rights_status would satisfy a
// database CHECK they should never have to think about.
//
// The constraint itself is fine and is NOT relaxed anywhere. What was missing
// is a way to state the ONE thing the owner actually knows — who made this and
// what it is — and have the correct, legitimate metadata follow from that.
//
// WHAT A PRESET MAY AND MAY NOT DO
// --------------------------------
// It may set only facts the owner is asserting by choosing it: that we own the
// asset, what kind of thing it is, and — because both follow directly from
// ownership — that its rights are verified and no attribution is owed.
//
// It may NEVER invent a source URL, a licence, a creator or attribution text.
// Those are claims about someone else's work, and there is no preset that
// fabricates them. The external option deliberately sets almost nothing: it
// records that the asset is NOT ours and leaves the real provenance to be
// entered by hand, exactly as before.

import type { MediaAssetRole, MediaRightsStatus, MediaSourceType } from "@/lib/types/database";

export type ClassificationPresetId =
  | "tc_photograph"
  | "tc_graphic"
  | "tc_render"
  | "tc_concept_render"
  | "external"
  | "unclassified";

export type ClassificationPatch = {
  owned?: boolean;
  source_type?: MediaSourceType | null;
  rights_status?: MediaRightsStatus;
  ai_generated?: boolean;
  asset_role?: MediaAssetRole;
  attribution_required?: boolean;
};

export type ClassificationPreset = {
  id: ClassificationPresetId;
  label: string;
  help: string;
  /** Fields this preset sets. Anything absent is left exactly as it was. */
  patch: ClassificationPatch;
  /** True when the owner must still supply real external provenance by hand. */
  requiresManualProvenance: boolean;
};

export const CLASSIFICATION_PRESETS: readonly ClassificationPreset[] = [
  {
    id: "tc_photograph",
    label: "TechCarvalho photograph",
    help: "A photograph taken by us. Owned outright, no external licence involved.",
    patch: {
      owned: true,
      source_type: "staff_photograph",
      rights_status: "verified",
      ai_generated: false,
      attribution_required: false,
    },
    requiresManualProvenance: false,
  },
  {
    id: "tc_graphic",
    label: "TechCarvalho-created graphic or diagram",
    help: "A chart, diagram, comparison table or editorial graphic we produced ourselves.",
    patch: {
      owned: true,
      source_type: "tc_graphic",
      rights_status: "verified",
      ai_generated: false,
      attribution_required: false,
    },
    requiresManualProvenance: false,
  },
  {
    id: "tc_render",
    label: "TechCarvalho-created render or illustration",
    help:
      "An illustrative render we commissioned or generated — a stylised router, a landscape, an abstract scene. " +
      "It depicts a general subject rather than making a claim about a specific unreleased product.",
    patch: {
      owned: true,
      source_type: "tc_graphic",
      rights_status: "verified",
      attribution_required: false,
    },
    requiresManualProvenance: false,
  },
  {
    id: "tc_concept_render",
    label: "TechCarvalho concept render of an unreleased product",
    help:
      "Imagery imagining hardware that has NOT been revealed. Carries a permanent public disclosure, can never " +
      "become product photography, and is never evidence for a specification.",
    patch: {
      owned: true,
      source_type: "tc_graphic",
      rights_status: "verified",
      asset_role: "concept_render",
      // A concept render is machine-made speculation by definition; the upload
      // path already forces this and the classifier must agree with it.
      ai_generated: true,
      attribution_required: false,
    },
    requiresManualProvenance: false,
  },
  {
    id: "external",
    label: "External / licensed media",
    help:
      "Somebody else's work. Records only that it is not ours — the real source URL, licence and creator must be " +
      "entered below before it can be marked Verified. Nothing is filled in for you.",
    patch: {
      owned: false,
    },
    requiresManualProvenance: true,
  },
  {
    id: "unclassified",
    label: "Not sure — classify later",
    help: "Leaves everything as it is. The asset stays private and unusable in public slots until classified.",
    patch: {},
    requiresManualProvenance: false,
  },
];

export function presetById(id: string): ClassificationPreset | null {
  return CLASSIFICATION_PRESETS.find((p) => p.id === id) ?? null;
}

/**
 * Which preset best describes an asset as it stands.
 *
 * Used to pre-select the radio so the form opens showing what the asset already
 * is, rather than making the owner re-derive it. Returns null when the current
 * state matches no preset cleanly — which is itself worth showing as "not yet
 * classified" rather than guessing.
 */
export function detectPreset(asset: {
  owned?: boolean | null;
  source_type?: string | null;
  asset_role?: string | null;
}): ClassificationPresetId | null {
  if (asset.asset_role === "concept_render") return "tc_concept_render";
  if (asset.owned === true && asset.source_type === "staff_photograph") return "tc_photograph";
  if (asset.owned === true && asset.source_type === "tc_graphic") return "tc_graphic";
  if (asset.owned === false && asset.source_type && asset.source_type !== "tc_graphic") return "external";
  return null;
}
