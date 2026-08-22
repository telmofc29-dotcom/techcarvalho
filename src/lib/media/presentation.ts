import type { MediaSourceType } from "@/lib/types/database";
// Relative + explicit `.ts` extension: this module is loaded directly by
// `node --test` (see presentation.test.ts), which resolves neither the `@/`
// alias nor extensionless specifiers. `classifyMediaTier` is a value, not a
// type, so unlike the import above it survives type stripping and has to
// actually resolve at runtime.
import { classifyMediaTier, type ClassifiableAsset } from "./hierarchy.ts";

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

// ---------------------------------------------------------------------------
// HOW an image is fitted into its frame
// ---------------------------------------------------------------------------
//
// The site serves two kinds of image and they need opposite treatment:
//
//   Photographs   — a crop is a crop. Filling the frame is the point, and the
//                   subject survives losing its edges.
//   Our graphics  — charts, comparison tables, timelines, spec diagrams and
//                   title cards are DESIGNED RECTANGLES rendered at a fixed
//                   1600x900 canvas. Their content runs to the edges, so
//                   cropping one to fill a frame of a different shape cuts off
//                   the very information that justified showing it (and on a
//                   title card, cuts the words in half).
//
// Which one an asset is comes from classifyMediaTier() rather than from the
// URL or the filename, so a mislabelled or renamed file cannot land in the
// wrong treatment. Anything TechCarvalho generated is contained; anything
// photographic is covered.

export type MediaFit = "cover" | "contain";

/** The widest frame we will build. Beyond this a lead image becomes a letterbox strip. */
export const MAX_FRAME_RATIO = 16 / 9;
/** The tallest frame we will build. Beyond this a portrait lead image eats the whole viewport. */
export const MIN_FRAME_RATIO = 1;

/**
 * Whether this asset may be cropped to fill its frame.
 *
 * Defaults to `cover` for an unknown asset: `contain` on an unrecognised
 * photograph would letterbox it into a small floating rectangle, which is the
 * exact "tiny image in a huge card" failure this is meant to prevent.
 */
export function mediaFit(asset: ClassifiableAsset | null | undefined): MediaFit {
  if (!asset) return "cover";
  const tier = classifyMediaTier(asset);
  return tier === "data_graphic" || tier === "generic_graphic" || tier === "original_render"
    ? "contain"
    : "cover";
}

/** True for charts/diagrams/tables/timelines — the ones that earn a caption. */
export function isDataGraphic(asset: ClassifiableAsset | null | undefined): boolean {
  return Boolean(asset) && classifyMediaTier(asset) === "data_graphic";
}

/**
 * The CSS `aspect-ratio` for a LEAD (hero) frame, taken from the asset's own
 * recorded dimensions and clamped to a range a page can actually live with.
 *
 * Building the frame around the image instead of forcing every image into one
 * fixed 16:9 box is what removes the bad crops: a 3:2 Commons photograph and a
 * 1600x900 chart each get a frame of exactly their own shape, so `cover` and
 * `contain` become the same thing and nothing is lost. Only genuine outliers —
 * a panorama, or a 3:4 phone photograph that would otherwise be taller than the
 * article it leads — get clamped and therefore cropped.
 *
 * Returned as a `w / h` string rather than a float so the value serialises
 * identically on the server and the client (no float formatting drift), and
 * because it is emitted at render time it costs no layout shift.
 */
export function frameAspectRatio(
  width: number | null | undefined,
  height: number | null | undefined
): string {
  if (!width || !height || width <= 0 || height <= 0) return UNKNOWN_FRAME_RATIO;
  const ratio = width / height;
  if (ratio > MAX_FRAME_RATIO) return "16 / 9";
  if (ratio < MIN_FRAME_RATIO) return "1 / 1";
  return `${Math.round(width)} / ${Math.round(height)}`;
}

/**
 * The frame used when an asset's dimensions are not recorded.
 *
 * 4:3, not 16:9, and paired with `contain` (see `dimensionsUnknown` below).
 * Five published rows still have null width/height, and when their real files
 * are inspected three of the five are PORTRAIT — a router, a phone-shaped
 * camera shot, a vertical night-sky photograph. A 16:9 fallback frame with
 * `cover` would centre-crop those to roughly 40% of the picture. 4:3 is the
 * shape closest to the middle of what this library actually holds, so it is
 * the least-wrong guess when there is nothing to go on.
 */
export const UNKNOWN_FRAME_RATIO = "4 / 3";

/**
 * Whether we know enough about this asset to crop it.
 *
 * Cropping is a claim that the edges are expendable, and that claim cannot be
 * made about an image whose shape is unrecorded — the frame would be a guess
 * and the crop would be a guess on top of it. So an asset with no recorded
 * dimensions is contained rather than covered, whatever its tier: bars around
 * a correctly-proportioned image are a smaller error than silently deleting
 * half of a photograph.
 */
export function dimensionsUnknown(
  width: number | null | undefined,
  height: number | null | undefined
): boolean {
  return !width || !height || width <= 0 || height <= 0;
}

/**
 * Whether an asset is too small for the slot it is being asked to fill.
 *
 * A 320px-wide screenshot stretched across a 1200px hero is upscaling — the
 * browser cannot invent detail, so it renders soft. Reporting it is more useful
 * than silently rendering it badly, so this is a query callers can act on
 * rather than something that quietly changes the layout.
 */
export function isUnderSizedFor(
  width: number | null | undefined,
  renderedWidthPx: number
): boolean {
  if (!width || width <= 0) return false;
  return width < renderedWidthPx;
}
