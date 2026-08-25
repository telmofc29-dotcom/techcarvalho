// MEDIA INTELLIGENCE — which image belongs on which page, and how sure we are.
//
// WHY THIS EXISTS
// ---------------
// The library has grown past the point where a human can hold it in their head.
// Assigning one image meant opening it, classifying it, writing alt text,
// publishing it, then searching hundreds of articles and products for the right
// target, then resolving a slot collision. That is a filing job, and the data
// needed to do it is already in the database.
//
// It runs in BOTH directions from one scorer, because they are the same
// question asked from opposite ends: media -> content ("where does this image
// belong?") and content -> media ("what could illustrate this page?"). Two
// scorers would drift, and the day they disagreed nobody would notice.
//
// THE RULE THAT MATTERS MOST: NEVER INVENT A SKU
// ----------------------------------------------
// A photograph of a Ryzen chip is genuine evidence about Ryzen chips. It is NOT
// evidence that it is a 9950X, and captioning it as one would be a fabrication
// this system produced on its own.
//
// So a match carries a SPECIFICITY, and specificity is earned from the asset's
// OWN recorded metadata — filename, alt text, caption, all of them either
// written by a human or chosen by one:
//
//   exact_model  the asset's metadata carries the target's model tokens
//                (digit-bearing: "9950x", "eos-r7", "ps5"). Safe to name.
//   family       the asset's metadata carries the brand or family but no model
//                ("ryzen", "cpu"). Safe for general coverage, NEVER for a
//                specific SKU's page.
//   topical      only category overlap. Suggestion only, never a lead image.
//
// `familyOnlyOnSpecificTarget` is the guard: a family-level asset offered to a
// model-specific target is refused outright rather than downgraded, because a
// low-confidence suggestion still ends up on a product page if somebody clicks
// approve on a list of twenty.
//
// OWNER PHOTOGRAPHY IS THE MOST VALUABLE THING HERE
// -------------------------------------------------
// It is original, it is owned outright, its rights are not somebody else's
// problem, and it shows a real object rather than a rendering of one. It is
// therefore boosted — but boosted within its specificity, never across it. An
// owner photograph does not become a 9950X by being an owner photograph.
//
// PURE. No `server-only`, no Supabase, no clock.

import { identityTokens, modelTokens } from "./subject-match.ts";

export type MediaRole = "hero" | "thumbnail" | "gallery";

export type MatchSpecificity = "exact_model" | "family" | "topical";
export type MatchStrength = "high" | "medium" | "low";

/** What kind of picture this is. Drives both value and what it may claim. */
export type AssetNature =
  /** TechCarvalho's own photograph of a real object. The most valuable kind. */
  | "owner_photograph"
  /** A manufacturer or press-kit image of a real product. */
  | "official_photograph"
  /** Licensed or public-domain photography of a real object. */
  | "licensed_photograph"
  /** An illustration of something that does not exist yet. Never evidence. */
  | "concept_render"
  /** A chart, diagram or title card. Explains; does not depict. */
  | "graphic"
  /** A screenshot of software. */
  | "screenshot"
  | "unknown";

export const NATURE_LABELS: Record<AssetNature, string> = {
  owner_photograph: "TechCarvalho photograph",
  official_photograph: "Official/press photograph",
  licensed_photograph: "Licensed photograph",
  concept_render: "Concept render",
  graphic: "Graphic or diagram",
  screenshot: "Screenshot",
  unknown: "Unclassified",
};

export type MatchAsset = {
  id: string;
  /** Storage path; its filename is often the only description an upload has. */
  storagePath: string;
  altText: string | null;
  caption: string | null;
  sourceType: string | null;
  assetRole: string | null;
  brandRole: string | null;
  owned: boolean;
  aiGenerated: boolean;
  publicationStatus: string;
  rightsStatus: string;
  width: number | null;
  height: number | null;
};

export type MatchTarget = {
  id: string;
  kind: "content" | "product";
  title: string;
  /** Manufacturer name, when the target has one. */
  manufacturerName: string | null;
  categorySlug: string | null;
  /**
   * True when the target names one specific model — a product row always does;
   * an article may. A family-level asset is refused for these.
   */
  isModelSpecific: boolean;
  /** Slots already filled, so nothing proposes to displace a human choice. */
  occupiedSlots: { role: MediaRole; humanSelected: boolean }[];
};

export type MediaMatch = {
  assetId: string;
  target: MatchTarget;
  specificity: MatchSpecificity;
  strength: MatchStrength;
  score: number;
  nature: AssetNature;
  /** Slots this asset may safely fill on this target. Empty is a valid answer. */
  proposedSlots: MediaRole[];
  /** Ordered, human-readable. Shown verbatim in the suggestion queue. */
  reasons: string[];
  /** Why a slot was withheld. Never silent. */
  withheld: string[];
};

// ---------------------------------------------------------------------------
// Classification
// ---------------------------------------------------------------------------

/**
 * What kind of picture this is.
 *
 * Order matters: `concept_render` is checked before anything that could make it
 * look like photography, because that is the misclassification with real
 * consequences — a render of an unreleased phone presented as a photograph of
 * one is a false factual claim about a product that does not exist yet.
 */
export function classifyNature(asset: MatchAsset): AssetNature {
  if (asset.assetRole === "concept_render") return "concept_render";
  if (asset.assetRole === "screenshot") return "screenshot";
  if (asset.brandRole) return "graphic";

  if (asset.sourceType === "staff_photograph") return "owner_photograph";
  if (asset.sourceType === "manufacturer" || asset.sourceType === "press_kit") {
    return "official_photograph";
  }
  if (asset.sourceType === "stock_licensed" || asset.sourceType === "public_domain_or_cc") {
    return "licensed_photograph";
  }
  // tc_graphic covers both hand-made diagrams and AI-generated illustration.
  // Neither depicts a real object, so neither is photography.
  if (asset.sourceType === "tc_graphic") {
    return asset.aiGenerated ? "concept_render" : "graphic";
  }
  if (asset.assetRole === "diagram" || asset.assetRole === "chart" || asset.assetRole === "comparison_graphic") {
    return "graphic";
  }
  return "unknown";
}

/** True for natures that show a real object and can therefore lead a page. */
export function depictsRealObject(nature: AssetNature): boolean {
  return (
    nature === "owner_photograph" ||
    nature === "official_photograph" ||
    nature === "licensed_photograph"
  );
}

// ---------------------------------------------------------------------------
// Describing an asset from what is recorded about it
// ---------------------------------------------------------------------------

/**
 * Every word the asset itself carries.
 *
 * Filename is included deliberately: an upload often has nothing else, and a
 * filename a human chose ("ryzen-9950x-installed.jpg") is owner-provided
 * metadata, not a guess. It is the weakest of the three and is scored as such,
 * but ignoring it would make a fresh upload unmatchable.
 */
export function assetVocabulary(asset: MatchAsset): {
  all: Set<string>;
  fromFilename: Set<string>;
  fromDescription: Set<string>;
} {
  const filename = asset.storagePath.split("/").pop() ?? "";
  // Strip the uuid prefix uploads carry, or every asset shares its tokens.
  const cleaned = filename
    .replace(/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}-?/i, "")
    .replace(/\.(png|jpe?g|webp|avif|gif)$/i, "")
    .replace(/[_-]+/g, " ");

  const fromFilename = withHyphenVariants(identityTokens(cleaned));
  const fromDescription = withHyphenVariants(
    identityTokens(`${asset.altText ?? ""} ${asset.caption ?? ""}`)
  );
  return {
    all: new Set([...fromFilename, ...fromDescription]),
    fromFilename,
    fromDescription,
  };
}

/**
 * Add a de-hyphenated form of every hyphenated token.
 *
 * "wi-fi" and "wifi" are the same word, and a filename almost never spells it
 * the way an article title does. Without this a router photograph named
 * "wifi-7-router.jpg" missed "Wi-Fi 7 explained" entirely -- found by the
 * acceptance run, not by reasoning about it. The same gap affects "e-mount"
 * versus "emount" and "24-70mm" versus "2470mm".
 *
 * Both forms are kept rather than normalising to one, so a token that is only
 * ever written hyphenated still matches itself.
 */
function withHyphenVariants(tokens: Set<string>): Set<string> {
  const out = new Set(tokens);
  for (const t of tokens) {
    if (!t.includes("-")) continue;
    const flat = t.replace(/-/g, "");
    if (flat.length >= 2) out.add(flat);
  }
  return out;
}

// ---------------------------------------------------------------------------
// Scoring one pairing
// ---------------------------------------------------------------------------

const NATURE_BONUS: Record<AssetNature, number> = {
  // Original, owned outright, shows a real thing. The whole reason to prefer it.
  owner_photograph: 30,
  official_photograph: 18,
  licensed_photograph: 12,
  screenshot: 6,
  graphic: 0,
  // Not penalised into uselessness — a concept render is the right image for an
  // article about an unannounced product — but it must never outrank a real
  // photograph of a real thing.
  concept_render: -8,
  unknown: -4,
};

/**
 * Tokens that distinguish one variant of a product from another.
 *
 * "Canon EOS 5D Mark III" and "Canon EOS 5D Mark II" share the model token
 * "5d"; everything that separates them is here. Without this, a Mark III
 * photograph matched the Mark II product page as an EXACT MODEL match — the
 * precise false-SKU claim this module exists to prevent, produced by the rule
 * that was supposed to prevent it.
 */
const VARIANT_TOKENS = new Set([
  "ii", "iii", "iv", "vi", "vii", "viii", "ix",
  "mark", "mk", "pro", "max", "plus", "ultra", "mini", "air", "lite", "se",
  "xt", "ti", "super", "gen", "rev",
]);

/**
 * Whether a set of model tokens is specific enough to identify a product.
 *
 * A bare single digit is not. "DJI Mini 4 Pro" and "Neptune 4 Pro" both carry
 * "4", and treating that as an identity match put a drone photograph on a
 * 3D-printer page. A real model designation has either more than one character
 * or a letter mixed in — "5d", "9950x", "r7" — so that is what is required.
 */
function isDistinctiveModel(tokens: readonly string[]): boolean {
  return tokens.some((t) => t.length >= 2 || /[a-z]/.test(t));
}

export const MIN_SCORE = 20;

export function scoreMatch(asset: MatchAsset, target: MatchTarget): MediaMatch {
  const nature = classifyNature(asset);
  const vocab = assetVocabulary(asset);
  const reasons: string[] = [];
  const withheld: string[] = [];

  const targetIdentity = withHyphenVariants(
    identityTokens(`${target.title} ${target.manufacturerName ?? ""}`)
  );
  const targetModels = withHyphenVariants(modelTokens(target.title));

  // Bare single digits ("the 9 in Ryzen 9", "the 4 in Mini 4") are series
  // designators, not designations. They are neither required nor sufficient:
  // requiring them rejected a correct 9950X photo, and accepting them alone
  // matched a DJI drone to a "Neptune 4 Pro" printer.
  const distinctiveTargetModels = [...targetModels].filter(
    (t) => t.length >= 2 || /[a-z]/.test(t)
  );
  const matchedModels = distinctiveTargetModels.filter((t) => vocab.all.has(t));
  const missingModels = distinctiveTargetModels.filter((t) => !vocab.all.has(t));
  const matchedIdentity = [...targetIdentity].filter(
    (t) => !/\d/.test(t) && vocab.all.has(t)
  );

  // Variant words the TARGET carries that the asset does not. These are what
  // separate a Mark III from a Mark II, so a missing one means the asset is a
  // picture of a DIFFERENT variant, not of this one.
  const missingVariants = [...targetIdentity].filter(
    (t) => VARIANT_TOKENS.has(t) && !vocab.all.has(t)
  );
  // And the reverse: a variant the ASSET claims that the target does not have.
  // A "5D Mark III" photograph is not a picture of the plain "Canon EOS 5D",
  // and without this check the bare model page would accept it as exact.
  const extraVariants = [...vocab.all].filter(
    (t) => VARIANT_TOKENS.has(t) && !targetIdentity.has(t)
  );

  // ---- specificity -------------------------------------------------------
  //
  // EXACT requires the whole designation, not a fragment of it. Matching any
  // single model token was enough to call it exact, which put a 5D Mark III
  // photograph on the 5D Mark II page and a DJI Mini 4 Pro render on a
  // "Neptune 4 Pro" printer.
  let specificity: MatchSpecificity;
  const modelComplete =
    matchedModels.length > 0 &&
    missingModels.length === 0 &&
    isDistinctiveModel(matchedModels) &&
    missingVariants.length === 0 &&
    extraVariants.length === 0;

  if (modelComplete) {
    specificity = "exact_model";
    reasons.push(
      `Names the exact model: ${matchedModels.join(", ")} appears in the image's own filename, alt text or caption.`
    );
  } else if (matchedModels.length > 0 || matchedIdentity.length > 0) {
    specificity = "family";
    if (extraVariants.length > 0) {
      reasons.push(
        `This image identifies a different variant (${extraVariants.join(", ")}) from "${target.title}", ` +
          `so it is treated as family-level rather than a picture of this exact unit.`
      );
    } else if (missingVariants.length > 0) {
      reasons.push(
        `Related but NOT the same variant: "${target.title}" is distinguished by ${missingVariants.join(", ")}, ` +
          `which this image does not claim. Treated as family-level, not as a picture of this exact unit.`
      );
    } else if (missingModels.length > 0) {
      reasons.push(
        `Partial model match only (${matchedModels.join(", ")} present, ${missingModels.join(", ")} absent), ` +
          `so it cannot be attributed to a specific unit.`
      );
    } else {
      reasons.push(
        `Matches the family (${matchedIdentity.join(", ")}) but carries no model number, so it cannot be attributed to a specific unit.`
      );
    }
  } else {
    specificity = "topical";
  }

  // ---- score -------------------------------------------------------------
  let score = 0;
  score += matchedModels.length * 30;
  score += matchedIdentity.length * 12;
  // A description a human wrote is better evidence than a filename.
  const describedHits = [...targetIdentity, ...targetModels].filter((t) =>
    vocab.fromDescription.has(t)
  ).length;
  if (describedHits > 0) {
    score += 8;
    reasons.push("The match comes from written alt text or a caption, not only the filename.");
  }
  score += NATURE_BONUS[nature];

  if (nature === "owner_photograph") {
    reasons.push(
      "Original TechCarvalho photography: owned outright, rights are not in question, and it shows a real object."
    );
  }

  // ---- hard safety refusals ---------------------------------------------
  //
  // These come BEFORE slot proposal so nothing downstream has to remember them.
  if (asset.rightsStatus === "restricted") {
    withheld.push("Rights are marked restricted; this asset cannot be used anywhere.");
    return finish(asset, target, specificity, nature, -1, reasons, withheld, []);
  }
  if (asset.brandRole) {
    withheld.push("Site-brand asset (logo or wordmark), not editorial imagery.");
    return finish(asset, target, specificity, nature, -1, reasons, withheld, []);
  }

  // THE SKU RULE. A family-level image on a model-specific target would be
  // presented as a picture of THAT model. Refused, not downgraded.
  if (specificity === "family" && target.isModelSpecific) {
    withheld.push(
      `Refused: this image identifies the family but not the model, and "${target.title}" names a specific one. ` +
        `Using it here would present it as a picture of that exact unit.`
    );
    return finish(asset, target, specificity, nature, -1, reasons, withheld, []);
  }
  if (specificity === "topical") {
    withheld.push("Only a category-level association; too weak to attach automatically.");
    return finish(asset, target, specificity, nature, score, reasons, withheld, []);
  }

  // ---- slots -------------------------------------------------------------
  const proposed: MediaRole[] = [];
  const heroTaken = target.occupiedSlots.find((s) => s.role === "hero");
  const thumbTaken = target.occupiedSlots.find((s) => s.role === "thumbnail");

  const canLead =
    depictsRealObject(nature) ||
    // A concept render may lead a page about a thing that does not exist yet;
    // the disclosure layer is what makes that honest, and it already exists.
    (nature === "concept_render" && !target.isModelSpecific);

  if (!canLead) {
    withheld.push(
      nature === "graphic"
        ? "A diagram explains rather than depicts, so it is offered for the gallery rather than the lead."
        : `${NATURE_LABELS[nature]} is not suitable as a lead image here.`
    );
  }

  if (canLead && heroTaken?.humanSelected) {
    withheld.push("Hero withheld: a human already chose the lead image for this page.");
  } else if (canLead && heroTaken) {
    withheld.push("Hero withheld: the slot is occupied; propose a replacement explicitly rather than silently.");
  } else if (canLead) {
    proposed.push("hero");
  }

  if (canLead && thumbTaken?.humanSelected) {
    withheld.push("Thumbnail withheld: a human already chose the card image.");
  } else if (canLead && !thumbTaken) {
    proposed.push("thumbnail");
  }

  // Gallery is additive and collides with nothing, so it is offered whenever
  // the asset is usable at all.
  proposed.push("gallery");

  return finish(asset, target, specificity, nature, score, reasons, withheld, proposed);
}

function finish(
  asset: MatchAsset,
  target: MatchTarget,
  specificity: MatchSpecificity,
  nature: AssetNature,
  score: number,
  reasons: string[],
  withheld: string[],
  proposedSlots: MediaRole[]
): MediaMatch {
  const strength: MatchStrength =
    score >= 55 && specificity === "exact_model"
      ? "high"
      : score >= MIN_SCORE
        ? "medium"
        : "low";
  return { assetId: asset.id, target, specificity, strength, score, nature, proposedSlots, reasons, withheld };
}

// ---------------------------------------------------------------------------
// Both directions
// ---------------------------------------------------------------------------

/** Where could this image go? Best first. */
export function matchesForAsset(
  asset: MatchAsset,
  targets: readonly MatchTarget[],
  options: { limit?: number; minScore?: number } = {}
): MediaMatch[] {
  const min = options.minScore ?? MIN_SCORE;
  return targets
    .map((t) => scoreMatch(asset, t))
    .filter((m) => m.score >= min && m.proposedSlots.length > 0)
    .sort((a, b) => b.score - a.score || a.target.title.localeCompare(b.target.title))
    .slice(0, options.limit ?? 5);
}

/** What could illustrate this page? Best first. */
export function matchesForTarget(
  target: MatchTarget,
  assets: readonly MatchAsset[],
  options: { limit?: number; minScore?: number } = {}
): MediaMatch[] {
  const min = options.minScore ?? MIN_SCORE;
  return assets
    .map((a) => scoreMatch(a, target))
    .filter((m) => m.score >= min && m.proposedSlots.length > 0)
    .sort((a, b) => b.score - a.score || a.assetId.localeCompare(b.assetId))
    .slice(0, options.limit ?? 5);
}

/**
 * Alt text proposed from what is genuinely known.
 *
 * Describes the PICTURE, never the specification. "Concept render of a
 * futuristic smartphone" is honest; "Official iPhone 18 showing the new 2nm
 * design" invents a fact, a status and a part. Returns null rather than
 * guessing when there is nothing to describe — an empty alt is a smaller
 * problem than a confident wrong one.
 */
export function proposeAltText(asset: MatchAsset, match: MediaMatch | null): string | null {
  const nature = classifyNature(asset);
  const vocab = assetVocabulary(asset);
  const subject =
    match && match.specificity === "exact_model"
      ? match.target.title
      : [...vocab.fromFilename].filter((t) => t.length > 2).slice(0, 4).join(" ");
  if (!subject.trim()) return null;

  switch (nature) {
    case "owner_photograph":
      return `TechCarvalho photograph of ${subject}.`;
    case "concept_render":
      // Never "of the X" — it does not depict a real object.
      return `Concept render illustrating ${subject}. Not a photograph of a real product.`;
    case "official_photograph":
      return `Manufacturer image of ${subject}.`;
    case "licensed_photograph":
      return `Licensed photograph of ${subject}.`;
    case "screenshot":
      return `Screenshot showing ${subject}.`;
    case "graphic":
      return `TechCarvalho graphic explaining ${subject}.`;
    default:
      return null;
  }
}
