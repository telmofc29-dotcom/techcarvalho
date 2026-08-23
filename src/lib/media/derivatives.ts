// Derivatives, responsive sizes and watermarking — the DECISION layer.
//
// WHAT THIS IS
// ------------
// Given an asset row, this answers three questions and performs no I/O:
//
//   1. Which responsive widths and formats should exist for it?
//   2. Which crops does its editorial role actually need?
//   3. May this asset be watermarked at all?
//
// The bytes are somebody else's problem. Nothing here reads, writes, decodes
// or encodes an image — see the "NEXT STEP" note at the foot of the file for
// where the I/O belongs and why it is deliberately not here yet.
//
// THE INVARIANT THIS FILE EXISTS TO PROTECT
// -----------------------------------------
// WATERMARKING TOUCHES DERIVATIVES ONLY. The master — the object at
// `media_assets.storage_path` in `media-private` — is the permanent archive
// and evidence record, exactly as the two-bucket architecture already treats
// it for publish/unpublish. A watermark burned into the master is
// unrecoverable: the original photograph would be gone, and with it the
// ability to re-derive, re-crop, or prove what was shot.
//
// So the invariant is encoded in the TYPES, not in a comment. `MasterOutput`
// declares `watermarked: false` as a literal type and `transform: "none"` —
// there is no value of `MasterOutput` that says otherwise, and no code path
// that can construct one. `assertMasterRetained()` then re-checks it at
// runtime for data that crossed a boundary (a plan rebuilt from the database,
// say), because a type is not a guarantee about rows.
//
// WHY WATERMARKING IS ALMOST ALWAYS REFUSED
// -----------------------------------------
// A watermark is a claim of authorship stamped onto a picture. Making that
// claim about somebody else's photograph is a misrepresentation, and on a
// licensed image it is usually also a licence breach — most licences that
// permit REUSE do not permit MODIFICATION, and the two are routinely
// conflated. On a chart or a diagram it is worse than wrong: it obscures the
// data that was the only reason to show the graphic.
//
// Hence: the gate is an ALLOW-LIST built from positive evidence, and every
// unknown is a refusal. `unknown` here means NOBODY HAS RECORDED IT — this
// project has been bitten repeatedly by unmeasured state reading as a
// finding, and "we have no record of the licence forbidding alteration" must
// never be allowed to mean "the licence permits alteration".
//
// Pure. No I/O.

import type {
  MediaAssetRole,
  MediaBrandRole,
  MediaRightsStatus,
  MediaSourceType,
  MediaType,
} from "@/lib/types/database";

// ---------------------------------------------------------------------------
// Responsive widths
// ---------------------------------------------------------------------------
//
// Every width below is also in `deviceSizes`/`imageSizes` as next/image
// resolves them, so a stored derivative is served at a size the optimizer
// actually asks for rather than being re-scaled a second time. Deviating from
// that list would mean the optimizer downscales our downscale — two lossy
// passes to reach a size we already had.
//
// The ladder is capped at 2048 rather than 3840. The library's largest source
// is a 4203x3152 photograph; a 3840-wide derivative of it is a several-megabyte
// file that no layout on this site ever renders at native size.

/** Full-frame widths, ascending. Matches next/image `deviceSizes`. */
export const RESPONSIVE_WIDTHS = [640, 828, 1080, 1200, 1920, 2048] as const;

/** Small fixed-size widths for square/list thumbnails. Matches `imageSizes`. */
export const THUMBNAIL_WIDTHS = [128, 256, 384] as const;

/** The Open Graph card size every scraper expects. */
export const OG_WIDTH = 1200;
export const OG_HEIGHT = 630;

/**
 * Below this rendered width a watermark stops being a credit and becomes
 * illegible noise over a small picture. A 128px list thumbnail carrying a
 * smeared four-pixel-tall wordmark is worse than an unmarked thumbnail, and
 * it is not the size anybody scrapes anyway.
 */
export const MIN_WATERMARK_WIDTH = 640;

// ---------------------------------------------------------------------------
// Formats
// ---------------------------------------------------------------------------

export type DerivativeFormat = "avif" | "webp" | "jpeg" | "png";

/**
 * Modern formats, in the same order as `images.formats` in next.config.ts.
 * The order is load-bearing there (first match against the Accept header
 * wins) and is mirrored here so the stored set and the served set agree.
 */
export const MODERN_FORMATS = ["avif", "webp"] as const satisfies readonly DerivativeFormat[];

/**
 * The universal fallback, for the browser that accepts neither modern format.
 *
 * PNG for anything with flat colour or transparency — our generated graphics,
 * logos, icons, screenshots — where JPEG's ringing artefacts land exactly on
 * the hard edges that carry the information. JPEG for photographs, where PNG
 * would be several times the size for no visible gain.
 */
export function fallbackFormat(asset: DerivativeAsset | null | undefined): DerivativeFormat {
  if (!asset) return "png";
  const role = (asset.asset_role ?? "") as string;
  const source = (asset.source_type ?? "") as string;
  if (asset.brand_role) return "png";
  if (source === "tc_graphic") return "png";
  if (FLAT_COLOUR_ROLES.has(role)) return "png";
  return "jpeg";
}

const FLAT_COLOUR_ROLES = new Set<string>([
  "diagram",
  "chart",
  "comparison_graphic",
  "logo_brand",
  "icon",
  "screenshot",
]);

/** Every format a derivative set should contain, in serving order. */
export function formatsFor(asset: DerivativeAsset | null | undefined): DerivativeFormat[] {
  return [...MODERN_FORMATS, fallbackFormat(asset)];
}

// ---------------------------------------------------------------------------
// Crops
// ---------------------------------------------------------------------------
//
// Deliberately few. src/lib/media/presentation.ts already builds each lead
// frame around the image's OWN aspect ratio rather than forcing everything
// into 16:9, precisely so that nothing is cropped that does not have to be.
// Adding a battery of fixed editorial crops here would reintroduce the bad
// crops that design removed. So there are exactly three, and two of them
// exist only because an external consumer dictates the shape.

export type CropName =
  /** The whole frame at its native aspect ratio. Never cropped. */
  | "natural"
  /** 1:1, for list rows and dense grids that must line up. */
  | "square"
  /** 1200x630, because that is what social scrapers read. */
  | "og";

export type CropSpec = {
  readonly name: CropName;
  /** width / height, or null for "keep the source's own ratio". */
  readonly aspect: number | null;
  readonly widths: readonly number[];
  readonly why: string;
};

export const CROP_SPECS: Record<CropName, CropSpec> = {
  natural: {
    name: "natural",
    aspect: null,
    widths: RESPONSIVE_WIDTHS,
    why: "The image's own shape. The default, and the only crop most assets get.",
  },
  square: {
    name: "square",
    aspect: 1,
    widths: THUMBNAIL_WIDTHS,
    why: "Dense product grids and list rows need a uniform box; a photograph survives it.",
  },
  og: {
    name: "og",
    aspect: OG_WIDTH / OG_HEIGHT,
    widths: [OG_WIDTH],
    why: "Social scrapers crop to 1.91:1 regardless, so choosing the crop ourselves beats letting them.",
  },
};

/**
 * Roles whose content runs to the edges of a designed rectangle — cropping one
 * cuts off the information that justified showing it. Same judgement
 * presentation.ts encodes as `contain` rather than `cover`, applied one stage
 * earlier so the crop is never generated in the first place.
 */
const UNCROPPABLE_ROLES = new Set<string>([
  "diagram",
  "chart",
  "comparison_graphic",
  "logo_brand",
  "icon",
  "screenshot",
  "social_og",
]);

/** Whether a fixed-ratio crop of this role is safe. Unknown roles: no. */
export function isCroppable(role: MediaAssetRole | string | null | undefined): boolean {
  if (!role) return false;
  return !UNCROPPABLE_ROLES.has(role);
}

/**
 * Which crops a role needs.
 *
 * `natural` is always present — it is the asset itself. Everything beyond it
 * has to be earned by a slot that genuinely demands a fixed shape, and an
 * unrecorded role earns nothing.
 */
export function cropsForRole(role: MediaAssetRole | string | null | undefined): CropName[] {
  if (!role) return ["natural"];
  if (!isCroppable(role)) return ["natural"];

  switch (role) {
    // A product appears full-bleed on its own page, in square list rows, and
    // as the OG card for both.
    case "product_photo":
      return ["natural", "square", "og"];
    // Lead images that are also the page's social card.
    case "article_hero":
    case "category_hero":
    case "homepage_feature":
      return ["natural", "og"];
    // A banner is already a designed strip; a background is decorative.
    case "banner":
    case "background":
      return ["natural"];
    default:
      return ["natural"];
  }
}

// ---------------------------------------------------------------------------
// The asset shape these functions read
// ---------------------------------------------------------------------------

/**
 * Structural, so a `media_assets` row can be passed straight in.
 *
 * Every field is optional and nullable ON PURPOSE: this must behave correctly
 * when handed a partially-selected row, and the correct behaviour when a field
 * is absent is to refuse, not to assume.
 */
export type DerivativeAsset = {
  media_type?: MediaType | null;
  source_type?: MediaSourceType | string | null;
  asset_role?: MediaAssetRole | string | null;
  brand_role?: MediaBrandRole | string | null;
  rights_status?: MediaRightsStatus | string | null;
  owned?: boolean | null;
  ai_generated?: boolean | null;
  license?: string | null;
  attribution_required?: boolean | null;
  storage_path?: string | null;
  width?: number | null;
  height?: number | null;
  /**
   * Tri-state, and the third state is the point.
   *
   * `true`  — a human recorded that the licence permits modification.
   * `false` — a human recorded that it does not.
   * `null`  — NOBODY HAS RECORDED IT. Not a synonym for `true`.
   *
   * Added by supabase/migrations_pending/20260825_media_derivatives.sql. Until
   * that is applied the column does not exist, every row reads `undefined`,
   * and the gate below treats that as "unknown" — i.e. it fails closed, which
   * is why the code works without the migration.
   */
  licence_permits_modification?: boolean | null;
};

// ---------------------------------------------------------------------------
// shouldWatermark — the gate
// ---------------------------------------------------------------------------

export type WatermarkRefusal =
  | "no_asset"
  | "not_an_image"
  | "restricted"
  | "brand_asset"
  | "information_graphic"
  | "screenshot"
  | "unsuitable_role"
  | "unknown_role"
  | "ai_generated"
  | "press_kit"
  | "third_party_source"
  | "unknown_source"
  | "not_owned"
  | "modification_forbidden"
  | "modification_unknown";

export type WatermarkDecision =
  | { watermark: true; reason: string }
  | { watermark: false; code: WatermarkRefusal; reason: string };

/**
 * Filenames the graphic generators produce, mirroring DATA_GRAPHIC_PREFIX in
 * hierarchy.ts.
 *
 * Checked here INDEPENDENTLY of source_type, which is the one thing
 * classifyMediaTier() cannot do: it short-circuits on
 * `source_type = 'staff_photograph'` and returns `original_photo` before it
 * ever looks at the path. A chart uploaded with the wrong source_type would
 * sail past it. A watermark over a chart destroys the chart, so this check
 * runs on the filename regardless of what the row claims to be.
 */
const DATA_GRAPHIC_FILENAME = /-(cmp|comparison|chart|spec_diagram|timeline|p3)-/i;

/** Roles a watermark can sit on without damaging what the image is FOR. */
const WATERMARKABLE_ROLES = new Set<string>([
  "product_photo",
  "article_hero",
  "category_hero",
  "homepage_feature",
  "banner",
]);

/**
 * MAY THIS ASSET BE WATERMARKED?
 *
 * Watermark only our OWN original photography, and only where the mark does
 * not damage what the picture is for. Every other answer is no.
 *
 * The checks are ordered so the reason a caller shows an admin is the most
 * specific true one: "this is a comparison chart" is more useful than "this
 * isn't a staff photograph", even though both are true of a chart. Nothing
 * about the ordering can turn a no into a yes — the function returns at the
 * first refusal and reaches `true` only after passing all of them.
 */
export function shouldWatermark(asset: DerivativeAsset | null | undefined): WatermarkDecision {
  if (!asset) {
    return { watermark: false, code: "no_asset", reason: "No asset was supplied." };
  }

  // Video watermarking is a different pipeline with different tooling, and an
  // absent media_type is an unknown, not an image.
  if (asset.media_type !== "image") {
    return {
      watermark: false,
      code: "not_an_image",
      reason: "Watermarking applies to still images only; this asset is not recorded as an image.",
    };
  }

  // Consistent with evaluatePublishEligibility, where 'restricted' always
  // wins. A restricted asset should not be processed at all, let alone marked.
  if (asset.rights_status === "restricted") {
    return {
      watermark: false,
      code: "restricted",
      reason: "The asset is marked restricted. Nothing is derived from it and nothing is marked.",
    };
  }

  const role = (asset.asset_role ?? "") as string;

  // ---- Damage-to-the-image refusals, checked before provenance ----

  // A logo IS the mark. Stamping another mark over it defaces a trademark —
  // usually someone else's — and a favicon or app icon has no room for one.
  if (asset.brand_role || role === "logo_brand" || role === "icon") {
    return {
      watermark: false,
      code: "brand_asset",
      reason: "Logos, marks and icons are never watermarked — a watermark defaces the mark itself.",
    };
  }

  // Charts, diagrams and comparison graphics: the pixels ARE the information.
  // A watermark over a data graphic damages the data.
  if (
    role === "diagram" ||
    role === "chart" ||
    role === "comparison_graphic" ||
    DATA_GRAPHIC_FILENAME.test(asset.storage_path ?? "")
  ) {
    return {
      watermark: false,
      code: "information_graphic",
      reason:
        "Charts, diagrams and comparison graphics carry information in the image itself; a watermark over one obscures the data it exists to show.",
    };
  }

  if (role === "screenshot") {
    return {
      watermark: false,
      code: "screenshot",
      reason:
        "A screenshot shows somebody else's interface, and a mark over it both obscures the UI and claims authorship of it.",
    };
  }

  if (!role) {
    return {
      watermark: false,
      code: "unknown_role",
      reason:
        "No asset role is recorded, so there is no way to tell a photograph from a diagram. Record the role first — unknown is not permission.",
    };
  }

  if (!WATERMARKABLE_ROLES.has(role)) {
    return {
      watermark: false,
      code: "unsuitable_role",
      reason: `Assets with the role '${role}' are not watermarked — the mark would sit over content it damages or serves no purpose on.`,
    };
  }

  // ---- Provenance refusals ----

  // Fail closed on anything machine-generated, before the source_type switch,
  // for the same reason classifyProductMedia() does: a mislabelled row must
  // not be able to present generated imagery as our photography.
  if (asset.ai_generated) {
    return {
      watermark: false,
      code: "ai_generated",
      reason:
        "The asset is recorded as machine-generated. A watermark would assert it is our photograph, which it is not.",
    };
  }

  const source = (asset.source_type ?? "") as string;

  // Called out separately from the generic third-party refusal because press
  // kits are the case most likely to be argued: "the manufacturer WANTS us to
  // use it". Permission to use is not permission to alter, and press imagery
  // stamped with our mark misrepresents whose photograph it is.
  if (source === "press_kit" || source === "manufacturer") {
    return {
      watermark: false,
      code: "press_kit",
      reason:
        "Manufacturer and press-kit media stays exactly as supplied. Permission to publish an image is not permission to alter it, and our mark on the maker's photograph misstates who took it.",
    };
  }

  if (!source) {
    return {
      watermark: false,
      code: "unknown_source",
      reason: "No source type is recorded, so there is no evidence this is our own photograph.",
    };
  }

  if (source !== "staff_photograph") {
    return {
      watermark: false,
      code: "third_party_source",
      reason: `This is a third-party asset (source '${source}'). Only photography we took ourselves is watermarked.`,
    };
  }

  // staff_photograph says who pressed the shutter; `owned` says we hold the
  // copyright. They can legitimately differ — a contributor's shot, a photo
  // taken under a loan agreement — and a watermark is a claim about the
  // second, not the first.
  if (asset.owned !== true) {
    return {
      watermark: false,
      code: "not_owned",
      reason:
        "The asset is not recorded as owned. A watermark asserts ownership, so it requires the ownership flag, not just a staff credit.",
    };
  }

  const modification = modificationPermission(asset);
  if (modification === "forbidden") {
    return {
      watermark: false,
      code: "modification_forbidden",
      reason:
        "The recorded licence forbids modification (a no-derivatives term, or an explicit 'modification not permitted'). A watermark is a modification.",
    };
  }
  if (modification === "unknown") {
    return {
      watermark: false,
      code: "modification_unknown",
      reason:
        "A licence is recorded on this asset but whether it permits modification is not. A licence that permits reuse does not necessarily permit alteration, so this stays unmarked until someone records the answer.",
    };
  }

  return {
    watermark: true,
    reason:
      "Our own photograph, owned outright, in a role where a mark does not obscure anything. Derivatives are marked; the master is not.",
  };
}

// ---------------------------------------------------------------------------
// Licence: reuse is not modification
// ---------------------------------------------------------------------------

export type ModificationPermission = "permitted" | "forbidden" | "unknown";

/**
 * No-derivatives terms, in the forms that actually appear in this library's
 * `license` column plus the common spellings.
 *
 * The bare-`ND` pattern requires a separator or string edge on the left so it
 * cannot fire inside an ordinary word ("Standard", "Second").
 */
const NO_DERIVATIVES = [
  /no[\s-]?derivat/i,
  /\bcc[\s-]?by[\s-]?(nc[\s-]?)?nd\b/i,
  /(?:^|[\s\-_/])nd(?:[\s\-_/]|\d|$)/i,
];

/**
 * Whether this asset's licence permits altering the image.
 *
 * The explicit recorded value wins in both directions, EXCEPT that a
 * no-derivatives licence string is checked first and cannot be overridden by
 * the flag. If the two disagree, the state is contradictory, and a
 * contradiction resolves to the safe answer rather than to whichever field was
 * written last.
 *
 * Ownership of our own work is the only implicit `permitted`: there is no
 * external licence over a photograph we took and own, so there is nothing to
 * breach. It still requires BOTH `staff_photograph` and `owned` — either alone
 * leaves the copyright question open.
 */
export function modificationPermission(asset: DerivativeAsset | null | undefined): ModificationPermission {
  if (!asset) return "unknown";

  const licence = (asset.license ?? "").trim();
  if (licence && NO_DERIVATIVES.some((p) => p.test(licence))) return "forbidden";

  if (asset.licence_permits_modification === false) return "forbidden";
  if (asset.licence_permits_modification === true) return "permitted";

  // Our own work. No external licence exists over it.
  if (asset.owned === true && asset.source_type === "staff_photograph") {
    // ...unless a licence string was nonetheless recorded, which means the row
    // is claiming both "we own this outright" and "it is used under someone's
    // terms". Do not guess which is true.
    if (!licence) return "permitted";
    return "unknown";
  }

  return "unknown";
}

// ---------------------------------------------------------------------------
// The master/derivative invariant, as types
// ---------------------------------------------------------------------------

/** Everything a derivative pipeline writes goes under this prefix. */
export const DERIVATIVE_PATH_PREFIX = "derivatives/";

/**
 * The retained original.
 *
 * `watermarked` is the literal type `false` and `transform` is the literal
 * `"none"` — not `boolean` and not `string`. There is no assignable value that
 * says a master was marked or resized, so "the master is never modified" is
 * checked by the compiler rather than remembered by a reader.
 */
export type MasterOutput = {
  readonly kind: "master";
  readonly retained: true;
  readonly watermarked: false;
  readonly transform: "none";
  /** The master keeps `media_assets.storage_path`; nothing is written for it. */
  readonly path: string;
  readonly bucket: "media-private";
};

export type DerivativeOutput = {
  readonly kind: "derivative";
  readonly crop: CropName;
  readonly width: number;
  /** Null when the source dimensions are unknown for a `natural` crop. */
  readonly height: number | null;
  readonly format: DerivativeFormat;
  readonly watermarked: boolean;
  readonly path: string;
  readonly bucket: "media-private";
};

export type PipelineOutput = MasterOutput | DerivativeOutput;

export function masterOutput(storagePath: string): MasterOutput {
  return Object.freeze({
    kind: "master",
    retained: true,
    watermarked: false,
    transform: "none",
    path: storagePath,
    bucket: "media-private",
  });
}

export function derivativePath(
  assetId: string,
  crop: CropName,
  width: number,
  format: DerivativeFormat
): string {
  return `${DERIVATIVE_PATH_PREFIX}${assetId}/${crop}/${width}.${format}`;
}

/**
 * Re-check the invariant at runtime.
 *
 * The types make an unmarked master unconstructable in TypeScript; this covers
 * a plan that was rebuilt from JSON, a database row, or any other boundary
 * where the type was an assumption rather than a fact. It throws rather than
 * returning a boolean because there is no sensible way to continue: a pipeline
 * about to overwrite its own master must stop, not log.
 */
export function assertMasterRetained(outputs: readonly PipelineOutput[], masterPath: string): void {
  const masters = outputs.filter((o): o is MasterOutput => o.kind === "master");

  if (masters.length !== 1) {
    throw new Error(
      `Derivative plan must retain exactly one master; found ${masters.length}. The untouched original is the archive record and cannot be dropped.`
    );
  }
  if (outputs[0]?.kind !== "master") {
    throw new Error("The master must be the first step of a derivative plan — it is retained before anything is derived.");
  }
  if (masters[0].path !== masterPath) {
    throw new Error(
      `Retained master path '${masters[0].path}' does not match the asset's storage_path '${masterPath}'.`
    );
  }
  // Belt and braces against a hand-built object that lied about its `kind`.
  if (masters[0].watermarked !== false || masters[0].transform !== "none") {
    throw new Error("A master may never be watermarked or transformed. Watermarking operates on derivatives only.");
  }

  for (const output of outputs) {
    if (output.kind === "master") continue;
    if (!output.path.startsWith(DERIVATIVE_PATH_PREFIX)) {
      throw new Error(
        `Derivative '${output.path}' is written outside '${DERIVATIVE_PATH_PREFIX}'. Derived bytes must never share a namespace with masters.`
      );
    }
    if (output.path === masterPath) {
      throw new Error(`Derivative would overwrite the master at '${masterPath}'.`);
    }
  }
}

// ---------------------------------------------------------------------------
// Width selection
// ---------------------------------------------------------------------------

export type NativeSize = { width?: number | null; height?: number | null };

function usable(n: number | null | undefined): n is number {
  return typeof n === "number" && Number.isFinite(n) && n > 0;
}

/**
 * The widths to generate for a crop, ascending.
 *
 * NEVER UPSCALES. A browser asked to render a 900px image at 1920 produces a
 * soft picture; a pipeline that ENCODES that upscale produces a soft picture
 * AND a large file, and hides the fact that the source was too small.
 *
 * Returns `[]` when the source dimensions are unrecorded. That is a refusal,
 * not an oversight: without a native size every width is a guess about whether
 * it upscales. Five published rows in this library still have null dimensions
 * (see presentation.ts) — the fix is to record them, not to assume.
 */
export function widthsForCrop(crop: CropName, native: NativeSize): number[] {
  const w = native.width;
  const h = native.height;
  if (!usable(w)) return [];

  if (crop === "og") {
    // A crop to 1.91:1 needs enough of both dimensions to cut from.
    if (w < OG_WIDTH) return [];
    if (usable(h) && h < OG_HEIGHT) return [];
    return [OG_WIDTH];
  }

  if (crop === "square") {
    // A square is limited by the SHORT side, not the width.
    if (!usable(h)) return [];
    const shortest = Math.min(w, h);
    return THUMBNAIL_WIDTHS.filter((tw) => tw <= shortest);
  }

  const fitted = RESPONSIVE_WIDTHS.filter((rw) => rw <= w);
  // A source narrower than the smallest ladder rung still deserves a
  // format-converted derivative at its own size.
  return fitted.length > 0 ? [...fitted] : [Math.round(w)];
}

/** Rendered height for a crop at a width, or null when it cannot be known. */
export function heightForCrop(crop: CropName, width: number, native: NativeSize): number | null {
  const spec = CROP_SPECS[crop];
  if (spec.aspect !== null) return Math.round(width / spec.aspect);
  if (!usable(native.width) || !usable(native.height)) return null;
  return Math.round((width * native.height) / native.width);
}

// ---------------------------------------------------------------------------
// The plan
// ---------------------------------------------------------------------------

/**
 * Every output for an asset: the retained master first, then each crop's
 * responsive ladder in every format.
 *
 * The master is prepended unconditionally and by construction — a caller
 * cannot ask for a plan without it, which is the point.
 */
export function planDerivatives(
  assetId: string,
  masterPath: string,
  asset: DerivativeAsset
): PipelineOutput[] {
  const outputs: PipelineOutput[] = [masterOutput(masterPath)];

  const decision = shouldWatermark(asset);
  const formats = formatsFor(asset);
  const native: NativeSize = { width: asset.width, height: asset.height };

  for (const crop of cropsForRole(asset.asset_role)) {
    for (const width of widthsForCrop(crop, native)) {
      for (const format of formats) {
        outputs.push({
          kind: "derivative",
          crop,
          width,
          height: heightForCrop(crop, width, native),
          format,
          // Both conditions, every time: the asset must be markable AND the
          // derivative must be big enough for a mark to be legible.
          watermarked: decision.watermark && width >= MIN_WATERMARK_WIDTH,
          path: derivativePath(assetId, crop, width, format),
          bucket: "media-private",
        });
      }
    }
  }

  assertMasterRetained(outputs, masterPath);
  return outputs;
}

// ---------------------------------------------------------------------------
// NEXT STEP — deliberately not in this file
// ---------------------------------------------------------------------------
//
// Nothing here touches bytes. Actually producing the derivatives needs a raster
// library (sharp is the obvious one) and `package.json` currently has NO image
// processing dependency at all — adding one is a decision for the owner, not a
// side effect of this change, so it has not been made.
//
// When the I/O layer lands it must:
//   * read the master from `media-private` and write every derivative back to
//     `media-private` under `derivatives/`, never to `media-public`;
//   * treat `planDerivatives()` as the only source of what to produce, calling
//     `assertMasterRetained()` on whatever it is handed;
//   * record each written object in `media_derivatives` (see
//     supabase/migrations_pending/20260825_media_derivatives.sql);
//   * leave publication alone. Publishing stays an explicit, separate,
//     rights-gated action, exactly as it is today.
