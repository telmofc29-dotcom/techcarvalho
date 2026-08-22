// Entity/media match confidence — "is this a picture of THAT product?"
//
// WHY THIS IS A SEPARATE GATE FROM RIGHTS
// ---------------------------------------
// The two failure modes are completely independent and a system that conflates
// them ships wrong pictures with impeccable paperwork. docs/product-media-strategy.md
// records the exact shape:
//
//   * a freely-licensed file matching "Galaxy S26 Ultra" that is a **Samsung
//     logo SVG**, not a handset;
//   * Openverse returning 159 commercially-reusable results for "Echo Show 8",
//     every one a NASA Hubble photograph of a **light echo**;
//   * Commons files for the RTX 5080 that are a **bare PCB composite**, and for
//     the Core Ultra 9 285K that are **die micrographs of delidded silicon** —
//     correct subject matter, wrong object;
//   * `Category:DJI FC8482` — an opaque EXIF model code that looks like a
//     product category and collects photographs taken BY the drone.
//
// Every one of those has a clean licence. None of them is the product.
//
// AMBIGUOUS FAILS CLOSED
// ----------------------
// Three verdicts, not two. `ambiguous` exists because "probably the right
// camera" is the state that produces a HERO12 on a HERO13 page, and the only
// safe handling of it is to refuse. It is never rounded up.
//
// Pure. Takes descriptors the provider already fetched; performs no I/O.

import {
  describesCaptureByDevice,
  discriminators,
  identityTokens,
  isCapturingDeviceCategory,
  matchCategoryTitle,
  type SubjectIdentity,
} from "./query-expansion.ts";

/** What the provider could tell us about the item, before rights are considered. */
export type CandidateDescriptor = {
  /** Provider title, e.g. "File:GoPro Héro 13 Black - 01.jpg". */
  title: string;
  /** Original filename at source, when it differs from the title. */
  fileName: string | null;
  /** Category/tag memberships. Curated ones are the strongest signal there is. */
  categories: string[];
  /** Description or caption text, in whatever language it was written. */
  descriptionText: string | null;
  mimeType: string | null;
  /** Camera make/model from EXIF, when present. */
  exifCameraModel?: string | null;
};

export type MatchSignal = {
  name: string;
  /** Signed contribution to confidence. */
  weight: number;
  detail: string;
};

export type EntityMatchVerdict = "confirmed" | "ambiguous" | "rejected";

export type EntityMatchAssessment = {
  verdict: EntityMatchVerdict;
  /** 0-1. Never treated as permission on its own. */
  confidence: number;
  signals: MatchSignal[];
  reason: string;
};

/** At or above: the file is accepted as depicting the product. */
export const MATCH_CONFIRMED = 0.75;
/** Below this: rejected outright. Between the two: ambiguous, which FAILS CLOSED. */
export const MATCH_REJECTED = 0.4;

/**
 * Tokens that mean "this depicts something ADJACENT to the product".
 *
 * Not automatically disqualifying — a box shot is still the product, sort of —
 * but each one is a reason the file may not be what a product page needs, and
 * they are recorded so ranking can weigh them rather than silently dropping.
 */
const ADJACENT_SUBJECT_TOKENS = new Map<string, string>([
  ["packaging", "packaging rather than the device"],
  ["box", "packaging rather than the device"],
  ["render", "a render rather than a photograph"],
  ["mockup", "a mockup rather than a photograph"],
  ["concept", "a concept image rather than the shipped product"],
]);

/**
 * Tokens that mean the image is DEFINITELY not the product as a reader would
 * recognise it. Weighted hard enough to sink a candidate on their own.
 *
 * Separated from the merely-adjacent list above because these are not close
 * calls, and the real run showed a -0.3 nudge was not enough. Searching for the
 * RTX 5080 accepted `File:Nvidia RTX 5080 5090 FE PCB.png` — a bare circuit
 * board, and of two cards at once — which the earlier human audit had already
 * rejected. Searching for the Core Ultra 9 285K surfaced CC0 die micrographs of
 * delidded silicon. A reader arriving at a graphics-card page expects a
 * graphics card; a photograph of its PCB is a photograph of something else.
 */
const WRONG_SUBJECT_TOKENS = new Map<string, string>([
  ["logo", "a brand mark, not the product"],
  ["wordmark", "a brand mark, not the product"],
  ["icon", "an icon, not the product"],
  ["die", "bare silicon rather than the retail product"],
  ["wafer", "bare silicon rather than the retail product"],
  ["micrograph", "a die micrograph, not the retail product"],
  ["pcb", "a bare circuit board rather than the retail product"],
  ["teardown", "disassembled components rather than the product"],
  ["screenshot", "software UI rather than the physical product"],
  ["diagram", "a diagram rather than a photograph"],
  ["chart", "a chart rather than a photograph"],
]);

/**
 * Marks of a frame extracted from somebody's video.
 *
 * The real run returned dozens of these for the RTX 5080 and Ryzen 9800X3D —
 * titles like `RTX 5080 FE首发评测：赛博工艺品 (2160p 60fps VP9-128kbit AAC)-00.01.24.019.png`,
 * carrying resolution, frame rate, codec and a timecode. `docs/product-media-strategy.md`
 * §6 records a reviewer rejecting exactly this class, because the CC claim on a
 * frame-grab traces back to a channel-wide licence toggle rather than to
 * anybody's decision about this image.
 */
const VIDEO_FRAME_PATTERNS: RegExp[] = [
  /-\d{2}\.\d{2}\.\d{2}\.\d{3}\b/,            // timecode suffix: -00.01.24.019
  /\b\d{3,4}p\s*\d{2,3}\s*fps\b/i,            // "2160p 60fps"
  /\b(vp9|av1|h\.?26[45]|hevc|aac|opus)\b/i,  // codec names in the filename
  /\bb[-\s]?rolls?\b/i,                       // "B-Rolls der …"
  /\bframe\s*grab\b|\bscreen\s*capture\b/i,
];

/** Vector/graphic MIME types: never a photograph of a product. */
const NON_PHOTOGRAPHIC_MIME = new Set(["image/svg+xml", "image/gif", "application/pdf"]);

/**
 * How well does this item's own description match the product's identity?
 *
 * The discriminator rule is absolute in both directions:
 *   * every discriminator of the product must appear SOMEWHERE credible;
 *   * a discriminating token the product does NOT have, appearing in the
 *     title, means a different model and rejects outright.
 */
export function assessEntityMatch(
  identity: SubjectIdentity,
  descriptor: CandidateDescriptor
): EntityMatchAssessment {
  const signals: MatchSignal[] = [];
  const required = discriminators(identity.canonicalName);

  if (required.length === 0) {
    return {
      verdict: "rejected",
      confidence: 0,
      signals: [],
      reason:
        `No discriminating token could be derived from "${identity.canonicalName}", so no file can be ` +
        "shown to depict THIS product rather than a sibling. Fails closed.",
    };
  }

  const titleToks = new Set(identityTokens(descriptor.title));
  const fileToks = new Set(identityTokens(descriptor.fileName ?? ""));
  const descToks = new Set(identityTokens(descriptor.descriptionText ?? ""));
  const productToks = new Set(identityTokens(identity.canonicalName));
  const aliasToks = new Set(identity.aliases.flatMap((a) => identityTokens(a)));
  const brandToks = new Set(identityTokens(identity.manufacturer ?? ""));

  // --- Hard rejection 1: a foreign model token in the title ----------------
  // "GoPro HERO12" on a HERO13 requirement; "RTX 5090" on a 5080 requirement.
  const foreign = [...titleToks].filter(
    (t) =>
      /^\d+$/.test(t) &&
      !productToks.has(t) &&
      !aliasToks.has(t) &&
      !brandToks.has(t) &&
      // Four-digit numbers that look like years are dates, not models.
      !(t.length === 4 && Number(t) >= 1990 && Number(t) <= 2100)
  );
  // Only a numeric token adjacent to a shared alphabetic token is a model
  // conflict; a stray "03" in "(03)" is a sequence number.
  const foreignModelNumbers = foreign.filter((t) => t.length >= 2 && !/^0\d$/.test(t));
  if (foreignModelNumbers.length > 0) {
    // Distinguish "extra number that could be a model" from "the product's own
    // number is present too". If ours IS present, the extra is likelier a
    // sequence/date/resolution and we downgrade rather than reject.
    const oursPresent = required.every((t) => titleToks.has(t));
    if (!oursPresent) {
      return {
        verdict: "rejected",
        confidence: 0,
        signals: [
          {
            name: "foreign_model_number",
            weight: -1,
            detail: `Title carries model number(s) ${foreignModelNumbers.join(", ")} and not this product's (${required.join(", ")}).`,
          },
        ],
        reason:
          `"${descriptor.title}" names a different model. A visually similar sibling with a clean licence is ` +
          "the most dangerous candidate there is, so this rejects rather than scores.",
      };
    }
    signals.push({
      name: "extra_number_in_title",
      weight: -0.05,
      detail: `Extra numeric token(s) ${foreignModelNumbers.join(", ")} alongside this product's own — likely a sequence or resolution, noted not trusted.`,
    });
  }

  // --- Hard rejection 1b: the file says it was taken WITH the product ------
  // A real search for "GoPro HERO13 Black" returned 32 files titled
  // "…taken with GoPro HERO13 Black.jpg" from one street-mapping run. Every
  // discriminator is in the title, so token matching rates them highly; the
  // phrase is the only thing that distinguishes a photograph OF the camera
  // from the several thousand photographs taken BY it.
  const captureText = [descriptor.title, descriptor.fileName ?? "", descriptor.descriptionText ?? ""].join(" ");
  if (describesCaptureByDevice(captureText)) {
    return {
      verdict: "rejected",
      confidence: 0,
      signals: [
        { name: "titled_taken_with", weight: -1, detail: `"${descriptor.title}" states the image was captured with the device.` },
      ],
      reason:
        "The file's own title or description says it was TAKEN WITH this product. A photograph taken by a camera " +
        "is not a photograph of it, however many of the product's tokens the filename contains.",
    };
  }

  // --- Signal: curated category membership (strongest available) -----------
  let bestCategory: { title: string; score: number; reason: string } | null = null;
  let capturingDeviceOnly = descriptor.categories.length > 0;
  for (const cat of descriptor.categories) {
    if (!isCapturingDeviceCategory(cat)) capturingDeviceOnly = false;
    const m = matchCategoryTitle(cat, identity);
    if (m.accepted && (!bestCategory || m.score > bestCategory.score)) {
      bestCategory = { title: cat, score: m.score, reason: m.reason };
    }
  }
  if (bestCategory) {
    signals.push({
      name: "curated_category",
      weight: 0.55 * bestCategory.score,
      detail: `Member of "${bestCategory.title}". ${bestCategory.reason} Category membership is human-curated and language-independent.`,
    });
  }

  // --- Hard rejection 2: only in capturing-device categories ---------------
  if (capturingDeviceOnly && !bestCategory) {
    return {
      verdict: "rejected",
      confidence: 0,
      signals: [
        {
          name: "capturing_device_only",
          weight: -1,
          detail: `Only categories are capturing-device categories: ${descriptor.categories.join(", ")}.`,
        },
      ],
      reason:
        "Every category this file belongs to collects images TAKEN WITH the device, not images OF it. " +
        "This is the failure that buried the real GoPro photographs under 20 Mapillary street scenes.",
    };
  }

  // --- Signal: discriminators in the title --------------------------------
  const titleMissing = required.filter((t) => !titleToks.has(t));
  if (titleMissing.length === 0) {
    signals.push({
      name: "title_discriminators",
      weight: 0.45,
      detail: `Title contains every discriminator (${required.join(", ")}).`,
    });
  } else {
    const fileMissing = required.filter((t) => !fileToks.has(t));
    if (fileMissing.length === 0) {
      signals.push({
        name: "filename_discriminators",
        weight: 0.35,
        detail: `Original filename contains every discriminator; title does not (missing ${titleMissing.join(", ")}).`,
      });
    } else {
      const descMissing = required.filter((t) => !descToks.has(t));
      if (descMissing.length === 0) {
        signals.push({
          name: "description_discriminators",
          weight: 0.25,
          detail:
            `Description names every discriminator though the title does not — the case where the file is ` +
            `titled in another language.`,
        });
      } else {
        signals.push({
          name: "discriminators_absent",
          weight: -0.5,
          detail: `Discriminator(s) ${descMissing.join(", ")} appear in neither title, filename nor description.`,
        });
      }
    }
  }

  // --- Signal: brand present ----------------------------------------------
  if (identity.manufacturer) {
    const brandHit = [...brandToks].some((t) => titleToks.has(t) || descToks.has(t) || fileToks.has(t));
    signals.push(
      brandHit
        ? { name: "brand_present", weight: 0.1, detail: `Manufacturer "${identity.manufacturer}" named.` }
        : { name: "brand_absent", weight: -0.1, detail: `Manufacturer "${identity.manufacturer}" is not named anywhere.` }
    );
  }

  // --- Signal: adjacent or plainly wrong subject ---------------------------
  const haystack = new Set([...titleToks, ...fileToks, ...descToks]);
  for (const [tok, why] of ADJACENT_SUBJECT_TOKENS) {
    if (haystack.has(tok)) {
      signals.push({ name: `adjacent_subject_${tok}`, weight: -0.3, detail: `Describes ${why}.` });
    }
  }
  for (const [tok, why] of WRONG_SUBJECT_TOKENS) {
    if (haystack.has(tok)) {
      signals.push({ name: `wrong_subject_${tok}`, weight: -0.5, detail: `Describes ${why}.` });
    }
  }

  // --- Signal: a frame lifted out of somebody's video ----------------------
  if (VIDEO_FRAME_PATTERNS.some((p) => p.test(captureText))) {
    signals.push({
      name: "video_frame_grab",
      weight: -0.6,
      detail:
        "Title carries video markers (timecode, frame rate, codec or 'B-roll'), so this is a still lifted from " +
        "somebody's video rather than a photograph taken of the product. Its licence traces to a channel setting, " +
        "not to a decision about this image.",
    });
  }

  // --- Signal: non-photographic format ------------------------------------
  if (descriptor.mimeType && NON_PHOTOGRAPHIC_MIME.has(descriptor.mimeType.toLowerCase())) {
    signals.push({
      name: "non_photographic_format",
      weight: -0.35,
      detail: `${descriptor.mimeType} is a vector/graphic format. The Galaxy S26 Ultra "hit" in the earlier audit was a logo SVG.`,
    });
  }

  // --- Signal: EXIF camera equals the product ------------------------------
  // If the product IS a camera and the file's EXIF says it was taken with that
  // camera, this is a photo BY it, not OF it.
  if (descriptor.exifCameraModel) {
    const camToks = new Set(identityTokens(descriptor.exifCameraModel));
    const overlap = required.filter((t) => camToks.has(t));
    if (overlap.length === required.length) {
      signals.push({
        name: "shot_with_subject",
        weight: -0.6,
        detail:
          `EXIF says this was captured with "${descriptor.exifCameraModel}", which is the subject itself. ` +
          "A photograph taken BY the product is not a photograph OF it.",
      });
    }
  }

  const raw = signals.reduce((acc, s) => acc + s.weight, 0);
  const confidence = Math.max(0, Math.min(1, raw));

  let verdict: EntityMatchVerdict;
  let reason: string;
  if (confidence >= MATCH_CONFIRMED) {
    verdict = "confirmed";
    reason = `Confidence ${confidence.toFixed(2)} >= ${MATCH_CONFIRMED}: the file is evidenced to depict ${identity.canonicalName}.`;
  } else if (confidence < MATCH_REJECTED) {
    verdict = "rejected";
    reason = `Confidence ${confidence.toFixed(2)} < ${MATCH_REJECTED}: nothing credible ties this file to ${identity.canonicalName}.`;
  } else {
    verdict = "ambiguous";
    reason =
      `Confidence ${confidence.toFixed(2)} sits between ${MATCH_REJECTED} and ${MATCH_CONFIRMED}. ` +
      "AMBIGUOUS FAILS CLOSED — it is not acquired and not proposed. 'Probably the right model' is exactly " +
      "how a HERO12 ends up on a HERO13 page.";
  }

  return { verdict, confidence, signals, reason };
}
