// Candidate ranking, with the reasoning kept.
//
// THE RULE: NEVER TAKE THE FIRST RESULT BECAUSE IT WAS FIRST
// ----------------------------------------------------------
// Provider result order encodes the provider's relevance model, not this
// site's needs. On Commons the top hit for a camera is routinely a street
// photograph TAKEN WITH it; the top hit for a console has been a YouTube
// frame-grab whose CC claim rests on a channel-wide licence toggle. Both sort
// first. Both are wrong.
//
// So every surviving candidate is scored on ten independent criteria and the
// winner has to beat the runner-up on stated ground. `whyItWon` names the
// criteria that actually decided it and the margin on each — an audit trail a
// human can disagree with, rather than a number.
//
// SCORES NEVER RESCUE A GATE
// --------------------------
// Ranking runs on candidates that have ALREADY passed entity matching and
// rights verification. A high score cannot promote a rejected candidate, and
// nothing here can raise `mayAcquire`. This module chooses among things that
// are already acceptable; it does not decide acceptability.
//
// Pure. No network.

import type { CandidateDescriptor } from "./entity-match.ts";
import type { EntityMatchAssessment } from "./entity-match.ts";
import type { ProvenanceRecord, RightsAssessment, ProviderApproval } from "./types.ts";

export type RankingCriterion =
  | "subject_match"
  | "photographic"
  | "resolution"
  | "aspect_ratio"
  | "crop_suitability"
  | "clean_of_overlay"
  | "licence_confidence"
  | "provenance_completeness"
  | "provider_quality"
  | "composition"
  | "site_duplication";

export type CriterionScore = {
  criterion: RankingCriterion;
  /** 0-1. */
  score: number;
  weight: number;
  rationale: string;
};

export type RankableCandidate = {
  key: string;
  descriptor: CandidateDescriptor;
  provenance: ProvenanceRecord;
  entityMatch: EntityMatchAssessment;
  rights: RightsAssessment;
  approval: ProviderApproval;
};

export type RankingContext = {
  /** Content hashes already present in the media library. */
  existingContentHashes: Set<string>;
  /** Source page URLs already used anywhere on the site. */
  existingSourceUrls: Set<string>;
  /** Minimum long-edge pixels a hero needs to be usable. */
  minLongEdge: number;
  /** Ideal hero aspect ratio (width / height). */
  targetAspect: number;
};

export const DEFAULT_RANKING_CONTEXT: Omit<RankingContext, "existingContentHashes" | "existingSourceUrls"> = {
  // Below this a hero visibly softens on a 2x display at typical column width.
  minLongEdge: 1200,
  // Landscape 3:2 — what most product photography actually is, and what the
  // product lead-media component lays out for.
  targetAspect: 1.5,
};

export type RankedCandidate = {
  candidate: RankableCandidate;
  scores: CriterionScore[];
  /** Weighted total, 0-1. Reported alongside the components, never alone. */
  total: number;
};

export type RankingResult = {
  ranked: RankedCandidate[];
  winner: RankedCandidate | null;
  /** Why the winner beat the runner-up, criterion by criterion. */
  whyItWon: string;
};

const WEIGHTS: Record<RankingCriterion, number> = {
  subject_match: 3,
  photographic: 2.5,
  licence_confidence: 2,
  provenance_completeness: 2,
  resolution: 1.5,
  clean_of_overlay: 1.5,
  site_duplication: 1.5,
  crop_suitability: 1,
  aspect_ratio: 1,
  composition: 1,
  provider_quality: 1,
};

/** Words in a title/description that mean the frame carries imposed text. */
const OVERLAY_TOKENS = [
  "watermark", "watermarked", "logo overlay", "caption", "annotated",
  "infographic", "banner", "advertisement", "poster", "collage", "montage",
  "comparison", "thumbnail",
];

/** Words that indicate a clean, isolated product shot. */
const CLEAN_COMPOSITION_TOKENS = [
  "white background", "studio", "isolated", "cut out", "cutout",
  "product photo", "product photograph", "front view", "three-quarter",
  "against a white", "plain background",
];

/** Words that indicate the product is incidental to the frame. */
const BUSY_COMPOSITION_TOKENS = [
  "crowd", "trade show", "booth", "exhibition", "in hand", "street",
  "shelf", "store", "unboxing table", "desk setup", "in use",
];

function haystackOf(c: RankableCandidate): string {
  return [
    c.descriptor.title,
    c.descriptor.fileName ?? "",
    c.descriptor.descriptionText ?? "",
    ...c.descriptor.categories,
  ]
    .join(" ")
    .toLowerCase();
}

function scoreOne(c: RankableCandidate, ctx: RankingContext): CriterionScore[] {
  const out: CriterionScore[] = [];
  const push = (criterion: RankingCriterion, score: number, rationale: string) =>
    out.push({ criterion, score: Math.max(0, Math.min(1, score)), weight: WEIGHTS[criterion], rationale });

  const hay = haystackOf(c);
  const p = c.provenance;

  // --- Exact subject match -------------------------------------------------
  push(
    "subject_match",
    c.entityMatch.confidence,
    `Entity match confidence ${c.entityMatch.confidence.toFixed(2)} (${c.entityMatch.verdict}). ${c.entityMatch.reason}`
  );

  // --- Photograph vs illustration -----------------------------------------
  const mime = (p.mimeType ?? c.descriptor.mimeType ?? "").toLowerCase();
  const isVector = mime.includes("svg") || mime.includes("pdf");
  const hasCameraExif = Boolean(c.descriptor.exifCameraModel) ||
    p.evidence.some((e) => e.kind === "exif_artist" || e.kind === "exif_copyright");
  const looksRendered = /\brender\b|\bcgi\b|\bmockup\b|\b3d model\b|\bconcept art\b|\billustration\b|\bdiagram\b/.test(hay);
  let photographic: number;
  let photoWhy: string;
  if (isVector) {
    photographic = 0;
    photoWhy = `${mime} is a vector format — a drawing of the product, never a photograph of it.`;
  } else if (looksRendered) {
    photographic = 0.15;
    photoWhy =
      "Described as a render/illustration/mockup. A press render can be indistinguishable from a photograph to a " +
      "reader, which is precisely why it must not sit in a slot that implies documentary evidence.";
  } else if (mime === "image/png" && !hasCameraExif) {
    // The GoPro colourway PNGs: clean CC tag, "own work" claim, 1920px PNG,
    // no camera EXIF. The shape of a press render, not of a photograph.
    photographic = 0.3;
    photoWhy =
      "PNG with no camera EXIF. That is the shape of a manufacturer press render, not of a photograph somebody took — " +
      "the reason two clean-tagged 'own work' GoPro files were rejected in the 2026-08 batch.";
  } else if (hasCameraExif) {
    photographic = 1;
    photoWhy = "JPEG carrying camera EXIF: consistent with an actual photograph of the object.";
  } else {
    photographic = 0.6;
    photoWhy = "Raster photo-format file, but no camera EXIF was captured to corroborate that it is a photograph.";
  }
  push("photographic", photographic, photoWhy);

  // --- Resolution ----------------------------------------------------------
  const longEdge = Math.max(p.width ?? 0, p.height ?? 0);
  if (longEdge === 0) {
    push("resolution", 0, "Dimensions unknown. An unmeasured file cannot be shown to be usable at hero size.");
  } else if (longEdge < ctx.minLongEdge) {
    push(
      "resolution",
      Math.max(0, longEdge / ctx.minLongEdge) * 0.4,
      `Long edge ${longEdge}px is below the ${ctx.minLongEdge}px minimum for a hero. Upscaling is not an option: ` +
        "an enlarged low-resolution photo looks like a stolen thumbnail even when it is properly licensed."
    );
  } else {
    push("resolution", Math.min(1, 0.6 + (longEdge - ctx.minLongEdge) / 4000), `Long edge ${longEdge}px clears the ${ctx.minLongEdge}px minimum.`);
  }

  // --- Aspect ratio --------------------------------------------------------
  if (p.width && p.height) {
    const aspect = p.width / p.height;
    const delta = Math.abs(aspect - ctx.targetAspect) / ctx.targetAspect;
    push(
      "aspect_ratio",
      Math.max(0, 1 - delta),
      `Aspect ${aspect.toFixed(2)} against a ${ctx.targetAspect.toFixed(2)} target (${(delta * 100).toFixed(0)}% off).`
    );
  } else {
    push("aspect_ratio", 0, "Aspect ratio unknown.");
  }

  // --- Crop suitability ----------------------------------------------------
  // CC BY-SA requires reusers to "indicate if changes were made". Cropping is
  // a change; resizing conventionally is not. A candidate that fits without
  // cropping avoids incurring a disclosure obligation at all, so it is
  // genuinely preferable, not merely convenient.
  if (p.width && p.height) {
    const aspect = p.width / p.height;
    const needsCrop = Math.abs(aspect - ctx.targetAspect) / ctx.targetAspect > 0.25;
    const portrait = aspect < 1;
    push(
      "crop_suitability",
      portrait ? 0.2 : needsCrop ? 0.55 : 1,
      portrait
        ? "Portrait orientation: fitting a landscape hero means cropping heavily, which is an adaptation requiring a 'changes were made' disclosure under CC BY-SA."
        : needsCrop
          ? "Usable but off-target enough to want a crop, which incurs a changes-were-made disclosure."
          : "Fits the hero shape without cropping, so no adaptation and no disclosure obligation."
    );
  } else {
    push("crop_suitability", 0, "Cannot assess cropping without dimensions.");
  }

  // --- Intrusive text / watermarks ----------------------------------------
  const overlayHit = OVERLAY_TOKENS.find((t) => hay.includes(t));
  push(
    "clean_of_overlay",
    overlayHit ? 0.1 : 1,
    overlayHit
      ? `Description suggests imposed text or a composite ("${overlayHit}"). Someone else's caption baked into our hero is both ugly and a provenance muddle.`
      : "Nothing in the description suggests a watermark, caption or composite."
  );

  // --- Licence confidence --------------------------------------------------
  const corroborated = Boolean(p.licenceDeclared && p.licenceMetadata);
  const recognised = Boolean(p.licenceUrl);
  let licenceScore = 0;
  let licenceWhy = "";
  if (c.rights.evidenceClass !== "evidence_complete") {
    licenceScore = 0;
    licenceWhy = `Rights evidence is ${c.rights.evidenceClass}; ranking cannot compensate for that.`;
  } else if (corroborated && recognised) {
    licenceScore = 1;
    licenceWhy = `Licence "${p.licenceDeclared}" read from the source's own declaration AND corroborated by structured metadata, and its exact terms are established.`;
  } else if (recognised) {
    licenceScore = 0.7;
    licenceWhy = `Licence "${p.licenceDeclared ?? p.licenceMetadata}" recognised, but read from only one place.`;
  } else {
    licenceScore = 0.2;
    licenceWhy = "Licence string is not one whose exact terms this project has established.";
  }
  // An attribution-free licence carries one fewer condition to breach.
  if (licenceScore > 0 && p.attributionRequired === false) {
    licenceScore = Math.min(1, licenceScore + 0.05);
    licenceWhy += " No attribution condition to satisfy, so one fewer way to fall out of compliance.";
  }
  push("licence_confidence", licenceScore, licenceWhy);

  // --- Provenance completeness --------------------------------------------
  const wanted: ProvenanceRecord["evidence"][number]["kind"][] = [
    "licence_template", "licence_metadata", "author_field", "source_field",
    "permission_field", "exif_copyright", "content_hash",
  ];
  const have = new Set(p.evidence.map((e) => e.kind));
  const got = wanted.filter((k) => have.has(k));
  push(
    "provenance_completeness",
    got.length / wanted.length,
    `${got.length} of ${wanted.length} evidence kinds captured (${got.join(", ") || "none"}).`
  );

  // --- Provider quality ----------------------------------------------------
  push(
    "provider_quality",
    c.approval.exposesPrimaryEvidence ? 1 : 0.3,
    c.approval.exposesPrimaryEvidence
      ? `${c.approval.label} exposes per-asset primary evidence (the uploader's own declaration), so a claim can be checked rather than trusted.`
      : `${c.approval.label} exposes only a rendered licence badge with no route to the evidence underneath.`
  );

  // --- Composition ---------------------------------------------------------
  const clean = CLEAN_COMPOSITION_TOKENS.some((t) => hay.includes(t));
  const busy = BUSY_COMPOSITION_TOKENS.some((t) => hay.includes(t));
  push(
    "composition",
    clean ? 1 : busy ? 0.3 : 0.6,
    clean
      ? "Described as an isolated/studio shot — the product is the subject of the frame."
      : busy
        ? "Described as an in-situ or event shot; the product competes with its surroundings."
        : "No compositional information available either way."
  );

  // --- Duplication across the site ----------------------------------------
  const dupHash = p.contentHash ? ctx.existingContentHashes.has(p.contentHash) : false;
  const dupUrl = p.sourcePageUrl ? ctx.existingSourceUrls.has(p.sourcePageUrl) : false;
  push(
    "site_duplication",
    dupHash ? 0 : dupUrl ? 0.15 : 1,
    dupHash
      ? "Byte-identical to an asset already in the library. Publishing the same photograph twice makes two pages look like one."
      : dupUrl
        ? "The same source page is already used elsewhere on the site."
        : "Not already present in the library."
  );

  return out;
}

function weightedTotal(scores: CriterionScore[]): number {
  const wsum = scores.reduce((a, s) => a + s.weight, 0);
  if (wsum === 0) return 0;
  return scores.reduce((a, s) => a + s.score * s.weight, 0) / wsum;
}

/**
 * Rank, and explain.
 *
 * The explanation is the deliverable. A ranking that cannot say why the winner
 * won is indistinguishable from taking the first result, which is the failure
 * this module exists to prevent.
 */
export function rankCandidates(candidates: RankableCandidate[], ctx: RankingContext): RankingResult {
  if (candidates.length === 0) {
    return { ranked: [], winner: null, whyItWon: "No candidates survived the gates, so there was nothing to rank." };
  }

  const ranked: RankedCandidate[] = candidates
    .map((candidate) => {
      const scores = scoreOne(candidate, ctx);
      return { candidate, scores, total: weightedTotal(scores) };
    })
    // Explicitly NOT provider order. Every tiebreak is a stated property of the
    // candidate, and the chain ends in a lexicographic comparison so the result
    // is deterministic rather than dependent on the order results arrived in.
    //
    // This matters more than it sounds: a real run on a set of eight sibling
    // frames from one photo session produced EIGHT identical totals, and
    // without the last two rules the "winner" would simply have been whichever
    // one Commons happened to list first — the exact failure this module exists
    // to prevent, reintroduced through the sort.
    .sort((a, b) => {
      if (b.total !== a.total) return b.total - a.total;
      const am = a.candidate.entityMatch.confidence;
      const bm = b.candidate.entityMatch.confidence;
      if (bm !== am) return bm - am;
      const ae = a.candidate.provenance.evidence.length;
      const be = b.candidate.provenance.evidence.length;
      if (be !== ae) return be - ae;
      // More pixels is a real, if small, advantage between otherwise
      // indistinguishable frames.
      const ap = (a.candidate.provenance.width ?? 0) * (a.candidate.provenance.height ?? 0);
      const bp = (b.candidate.provenance.width ?? 0) * (b.candidate.provenance.height ?? 0);
      if (bp !== ap) return bp - ap;
      return a.candidate.key.localeCompare(b.candidate.key);
    });

  const winner = ranked[0];
  const runnerUp = ranked[1];

  if (!runnerUp) {
    const weakest = [...winner.scores].sort((a, b) => a.score - b.score)[0];
    return {
      ranked,
      winner,
      whyItWon:
        `"${winner.candidate.descriptor.title}" was the only candidate to clear every gate, so it wins by default ` +
        `rather than by comparison (total ${winner.total.toFixed(3)}). Its weakest criterion is ${weakest.criterion} ` +
        `at ${weakest.score.toFixed(2)}: ${weakest.rationale} Winning uncontested is not evidence of quality — ` +
        "record it as the only option, not the best one.",
    };
  }

  const byCriterion = new Map(runnerUp.scores.map((s) => [s.criterion, s]));
  const deltas = winner.scores
    .map((s) => {
      const other = byCriterion.get(s.criterion);
      return { criterion: s.criterion, delta: (s.score - (other?.score ?? 0)) * s.weight, mine: s, theirs: other };
    })
    .sort((a, b) => Math.abs(b.delta) - Math.abs(a.delta));

  const decisive = deltas.filter((d) => Math.abs(d.delta) > 0.001).slice(0, 3);
  const lost = deltas.filter((d) => d.delta < -0.001).slice(0, 2);

  // A dead heat is a real outcome and saying "it did not lose on any criterion"
  // would dress up an arbitrary pick as a judgement. Name the tiebreak instead.
  if (decisive.length === 0) {
    const tied = ranked.filter((r) => Math.abs(r.total - winner.total) <= 0.001);
    const wp = (winner.candidate.provenance.width ?? 0) * (winner.candidate.provenance.height ?? 0);
    const rp = (runnerUp.candidate.provenance.width ?? 0) * (runnerUp.candidate.provenance.height ?? 0);
    const tiebreak =
      wp !== rp
        ? `higher pixel count (${winner.candidate.provenance.width}x${winner.candidate.provenance.height} vs ${runnerUp.candidate.provenance.width}x${runnerUp.candidate.provenance.height})`
        : `a stable lexicographic comparison of the candidate key, because nothing about the candidates themselves separates them`;
    return {
      ranked,
      winner,
      whyItWon:
        `DEAD HEAT: ${tied.length} candidates scored ${winner.total.toFixed(3)} on every criterion — typically sibling ` +
        `frames from one photo session. "${winner.candidate.descriptor.title}" was selected on ${tiebreak}, NOT because ` +
        "it was returned first. There is no quality argument for this one over the others, and a human choosing a " +
        "different frame from the same set would be equally right — the choice between them is editorial (which angle " +
        "shows the product best), which is exactly the judgement this module cannot make.",
    };
  }

  const whyItWon =
    `"${winner.candidate.descriptor.title}" (${winner.total.toFixed(3)}) beat "${runnerUp.candidate.descriptor.title}" ` +
    `(${runnerUp.total.toFixed(3)}) by ${(winner.total - runnerUp.total).toFixed(3)} across ${ranked.length} ranked candidates. ` +
    `Decisive criteria: ` +
    decisive
      .map(
        (d) =>
          `${d.criterion} ${d.mine.score.toFixed(2)} vs ${(d.theirs?.score ?? 0).toFixed(2)} ` +
          `(weighted ${d.delta >= 0 ? "+" : ""}${d.delta.toFixed(3)}) — ${d.mine.rationale}`
      )
      .join(" | ") +
    (lost.length > 0
      ? ` It LOST on ${lost.map((d) => `${d.criterion} (${d.mine.score.toFixed(2)} vs ${(d.theirs?.score ?? 0).toFixed(2)})`).join(", ")}, and won anyway on the criteria above.`
      : " It did not lose on any criterion.");

  return { ranked, winner, whyItWon };
}
