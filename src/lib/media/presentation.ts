import type { MediaSourceType } from "@/lib/types/database";

// How a product's lead media must be PRESENTED to a reader.
//
// This is the public-facing counterpart to rights.ts. Where
// evaluatePublishEligibility() answers "may we publish this at all", this
// answers the question that comes immediately after: "if we do show it, what
// must we tell the reader it is?"
//
// The distinction that matters: TechCarvalho can legitimately produce original
// spec/comparison graphics for a product it has no licensed photograph of. Such
// a graphic is honest ONLY if it is labelled as a graphic. An unlabelled
// TechCarvalho graphic sitting in the hero slot where a product photo normally
// goes invites the reader to assume it depicts the real product — which is the
// exact dishonesty the no-fictional-photography rule exists to prevent.
//
// So: a photograph is presented as a photograph, an original graphic is
// presented as an original graphic with a visible label, and the absence of a
// photograph is stated plainly rather than papered over. There is no fourth
// case, and in particular there is no case in which generated imagery is
// presented as a depiction of a real product.
//
// Pure and synchronous, like rights.ts and requirements.ts, so it can be unit
// tested and called from a Server Component without a round trip.

export type ProductMediaPresentation =
  /** A real photograph of the real product. Shown in the hero slot as-is. */
  | { kind: "photograph"; attribution: string | null }
  /**
   * TechCarvalho-owned original artwork (spec table, comparison chart,
   * generation timeline, category card). MUST carry a visible label, because
   * it occupies the slot a reader expects a photograph in.
   */
  | { kind: "original_graphic"; label: string }
  /**
   * No legitimately-licensed photograph exists yet. The page says so, rather
   * than rendering a blank space that reads as a loading failure.
   */
  | { kind: "none"; label: string };

/** Source types that denote a genuine photograph of the physical product. */
const PHOTOGRAPHIC_SOURCES: MediaSourceType[] = [
  "manufacturer",
  "staff_photograph",
  "stock_licensed",
  "user_submitted",
  "press_kit",
  "public_domain_or_cc",
];

export const ORIGINAL_GRAPHIC_LABEL =
  "Original TechCarvalho graphic — not a photograph of this product";

export const NO_PHOTO_LABEL =
  "No photograph of this product is shown. We only publish product photography we hold clear rights to, and we do not generate imagery that imitates one.";

export function classifyProductMedia(
  asset: {
    source_type?: MediaSourceType | null;
    owned?: boolean;
    ai_generated?: boolean;
    attribution_required?: boolean;
    attribution?: string | null;
    creator?: string | null;
  } | null
): ProductMediaPresentation {
  if (!asset) return { kind: "none", label: NO_PHOTO_LABEL };

  // Fail closed. Anything machine-generated is never presented as a
  // photograph, whoever owns it and whatever else the row claims. This is
  // checked before the source_type switch precisely so that a mislabelled row
  // (ai_generated with source_type 'manufacturer', say) cannot slip through as
  // a photo.
  if (asset.ai_generated) {
    return { kind: "original_graphic", label: ORIGINAL_GRAPHIC_LABEL };
  }

  if (asset.source_type === "tc_graphic") {
    return { kind: "original_graphic", label: ORIGINAL_GRAPHIC_LABEL };
  }

  if (asset.source_type && PHOTOGRAPHIC_SOURCES.includes(asset.source_type)) {
    return {
      kind: "photograph",
      attribution: asset.attribution_required ? asset.attribution ?? asset.creator ?? null : null,
    };
  }

  // 'other', null, or an unrecognised value. We genuinely do not know what
  // this is, so we do not assert to the reader that it is a photograph of the
  // product — but we also do not throw away an asset a human deliberately
  // published. Treating it as a photograph WITH its credit line is the honest
  // middle: it is shown, and it is credited, but nothing in the copy claims
  // provenance the row does not establish.
  //
  // Note this is presentation only. Whether the asset may be published at all
  // was already decided by evaluatePublishEligibility(); this never widens it.
  return {
    kind: "photograph",
    attribution: asset.attribution_required ? asset.attribution ?? asset.creator ?? null : null,
  };
}
