// THE APPROVAL PACKAGE — everything one approval will do, on one screen.
//
// WHY
// ---
// Publishing one piece of engine-originated coverage took the owner roughly a
// dozen actions across five pages: approve the brief, wait a day for the tick to
// assemble it, find the draft, decide the media rights, associate the asset,
// publish the asset, edit the draft, publish the draft, then pin it. Each step
// is individually reasonable and collectively absurd — none of them is a
// decision, they are all mechanics attached to ONE decision, which is "should
// TechCarvalho cover this".
//
// So the package states the whole consequence up front and asks once.
//
// PREVIEW AND EXECUTION SHARE THIS MODULE
// ---------------------------------------
// The lines rendered on screen are computed from the same inputs the executor
// acts on. That is deliberate: a preview assembled by different code from the
// thing it previews is a lie waiting to happen — it drifts silently, and the
// first person to notice is the owner who approved something else. `canBuild`
// and `blockers` are computed here and re-checked server-side by the action.
//
// WHAT A MARKER MEANS
// -------------------
//   ok            already true; nothing will change
//   will_create   does not exist yet; approving creates it
//   warn          proceeding is safe, but a human should know
//   blocked       approving cannot proceed until this is resolved
//
// The distinction between `ok` and `will_create` carries most of the value.
// "Apple exists" and "iPhone 18 will be created" look similar on screen and are
// opposite facts, and an owner who cannot tell them apart cannot consent to
// anything. Nothing in this module ever reports a thing as existing because it
// is ABOUT to exist.
//
// PURE. No `server-only`, no Supabase, no clock.

import type { BriefQualityVerdict } from "./brief-quality.ts";

export type PackageMarker = "ok" | "will_create" | "warn" | "blocked";

export type PackageLine = {
  marker: PackageMarker;
  text: string;
  /** Optional expansion shown under the line — never required to understand it. */
  detail?: string;
};

export type PackageSection = {
  title: string;
  lines: PackageLine[];
};

export type ApprovalPackage = {
  briefId: string;
  title: string;
  contentType: string | null;
  quality: BriefQualityVerdict;
  sections: PackageSection[];
  /** False when any line is `blocked`. Re-checked server-side before any write. */
  canBuild: boolean;
  /** Plain-language blockers, for the disabled-button explanation. */
  blockers: string[];
  /** What the owner still has to do AFTER building. Never hidden. */
  afterBuild: string[];
};

export type PackageInput = {
  briefId: string;
  title: string;
  contentType: string | null;
  categorySlug: string | null;
  quality: BriefQualityVerdict;
  primaryQuestion: string | null;
  verifiedFacts: readonly string[];
  uncertainties: readonly string[];
  sourceUrls: readonly string[];
  /** The slug that will be used. Null when one could not be derived. */
  proposedSlug: string | null;
  slugTaken: boolean;
  metaTitle: string | null;
  metaDescription: string | null;
  /** Products the brief names that already exist in the catalogue. */
  existingProducts: readonly { name: string; slug: string; isPublished: boolean }[];
  /** Product slugs the brief names that do NOT exist. */
  missingProductSlugs: readonly string[];
  /** Published content this could cannibalise, if the corpus was readable. */
  cannibalisationMatch: { title: string; similarity: number } | null;
  /** False when the published corpus could not be read — suppresses any clearance claim. */
  corpusKnown: boolean;
  /** Media already associated with the eventual article, if any. */
  mediaReady: boolean;
  /** Media candidates found but whose rights are unresolved. */
  mediaNeedsRightsReview: number;
  /** True when the brief has already produced a draft. */
  alreadyAssembled: boolean;
};

export function buildApprovalPackage(input: PackageInput): ApprovalPackage {
  const sections: PackageSection[] = [
    researchSection(input),
    databaseSection(input),
    contentSection(input),
    mediaSection(input),
    seoSection(input),
  ];

  const blockers: string[] = [];
  for (const s of sections) {
    for (const l of s.lines) {
      if (l.marker === "blocked") blockers.push(l.text);
    }
  }

  return {
    briefId: input.briefId,
    title: input.title,
    contentType: input.contentType,
    quality: input.quality,
    sections,
    canBuild: blockers.length === 0,
    blockers,
    afterBuild: afterBuildSteps(input),
  };
}

// ---------------------------------------------------------------------------
// Sections
// ---------------------------------------------------------------------------

function researchSection(input: PackageInput): PackageSection {
  const q = input.quality;
  const lines: PackageLine[] = [
    {
      marker: "ok",
      text: `${q.sourceCount} sources across ${q.independentDomains} independent publishers`,
    },
    { marker: "ok", text: `${q.factCount} verified facts` },
  ];

  // Uncertainties are reported as a STRENGTH, and the wording matters: they are
  // proof that confirmed and unconfirmed material were kept apart, which is
  // exactly what stops a draft from asserting a rumour. An owner reading
  // "3 rumours" as a defect would approve the wrong things.
  if (q.uncertaintyCount > 0) {
    lines.push({
      marker: "ok",
      text: `${q.uncertaintyCount} unconfirmed claims kept separate from the facts`,
      detail:
        "These stay attributed in the draft. Nothing here will be stated as established fact.",
    });
  } else {
    lines.push({
      marker: "warn",
      text: "No open questions recorded",
      detail:
        "For an unreleased or fast-moving subject this usually means the research was not " +
        "adversarial enough, rather than that everything is settled.",
    });
  }

  if (q.readsAsPromotional) {
    lines.push({
      marker: "warn",
      text: "Proposed headline reads as vendor marketing",
      detail: "Reframe it around the reader's question before publishing.",
    });
  }

  return { title: "Research", lines };
}

function databaseSection(input: PackageInput): PackageSection {
  const lines: PackageLine[] = [];

  for (const p of input.existingProducts) {
    lines.push({
      marker: "ok",
      text: `${p.name} already exists${p.isPublished ? "" : " (unpublished)"}`,
    });
  }

  // Named but absent. Reported as a warning rather than a creation, because
  // this package does not create products: a product needs specs, and specs
  // must never be invented to fill a shell.
  for (const slug of input.missingProductSlugs) {
    lines.push({
      marker: "warn",
      text: `No product record for "${slug}"`,
      detail:
        "The article will name it without linking. Creating a product is a separate decision — " +
        "an empty product page is worse than no product page, and specifications are never guessed.",
    });
  }

  if (lines.length === 0) {
    lines.push({
      marker: "ok",
      text: "No product records are required for this piece",
    });
  }

  return { title: "Database", lines };
}

function contentSection(input: PackageInput): PackageSection {
  const lines: PackageLine[] = [];

  if (input.alreadyAssembled) {
    lines.push({
      marker: "blocked",
      text: "This brief has already produced a draft",
      detail: "Approving again would create a second article for the same brief.",
    });
  } else {
    lines.push({
      marker: "will_create",
      text: `"${input.title}" will be created as a DRAFT`,
      detail: input.contentType ? `Type: ${input.contentType}` : undefined,
    });
  }

  if (!input.proposedSlug) {
    lines.push({
      marker: "blocked",
      text: "No usable slug could be derived from the title",
    });
  } else if (input.slugTaken) {
    lines.push({
      marker: "warn",
      text: `Slug "${input.proposedSlug}" is taken; a suffixed one will be used`,
    });
  } else {
    lines.push({ marker: "ok", text: `Slug: /${input.proposedSlug}` });
  }

  // The cannibalisation claim is only ever made when the corpus was actually
  // read. "No conflict found" computed against an unknown corpus is a false
  // clearance, and a false clearance on THIS check is how a site ends up
  // competing with itself.
  if (!input.corpusKnown) {
    lines.push({
      marker: "warn",
      text: "Existing content could NOT be checked",
      detail: "The published-content read failed, so no duplication clearance is claimed here.",
    });
  } else if (input.cannibalisationMatch) {
    lines.push({
      marker: "blocked",
      text: `Overlaps existing content: "${input.cannibalisationMatch.title}"`,
      detail: "Update the existing page instead of publishing a second one competing with it.",
    });
  } else {
    lines.push({ marker: "ok", text: "Checked against published content — no overlap found" });
  }

  return { title: "Content", lines };
}

function mediaSection(input: PackageInput): PackageSection {
  const lines: PackageLine[] = [];

  if (input.mediaReady) {
    lines.push({ marker: "ok", text: "A suitable published asset is already available" });
  } else if (input.mediaNeedsRightsReview > 0) {
    // NOT a blocker. A draft without an image is a normal, publishable-later
    // state; guessing the rights to avoid an empty slot is the one thing that
    // must never happen. So this proceeds and says plainly what is outstanding.
    lines.push({
      marker: "warn",
      text: `${input.mediaNeedsRightsReview} candidate(s) found, rights unresolved`,
      detail:
        "The engine will not assume rights it cannot prove. The draft is created without an image " +
        "and the rights decision stays yours.",
    });
  } else {
    lines.push({
      marker: "warn",
      text: "No media yet",
      detail: "A media requirement will be recorded so this is not silently forgotten.",
    });
  }

  return { title: "Media", lines };
}

function seoSection(input: PackageInput): PackageSection {
  const lines: PackageLine[] = [];

  lines.push(
    input.metaTitle
      ? { marker: "ok", text: `Meta title: ${input.metaTitle}` }
      : { marker: "warn", text: "No meta title derived" }
  );

  // A missing description is reported honestly rather than filled in. The
  // generator only derives one from the brief's own primary question — it will
  // not write a sales pitch for an article nobody has written yet.
  lines.push(
    input.metaDescription
      ? { marker: "ok", text: `Meta description: ${input.metaDescription}` }
      : {
          marker: "warn",
          text: "No meta description — the brief records no primary question",
          detail: "One will not be invented. Add it when you edit the draft.",
        }
  );

  lines.push({
    marker: "ok",
    text: `${input.sourceUrls.length} source links carried into the draft`,
  });

  return { title: "SEO", lines };
}

/**
 * What still needs the owner after the build.
 *
 * Stated up front, because the single most damaging thing this feature could do
 * is imply that approving publishes. It does not, and it structurally cannot —
 * the assembly RPC hard-wires `status = 'draft'`.
 */
function afterBuildSteps(input: PackageInput): string[] {
  const steps = [
    "Edit the assembled draft — it is structure and quoted evidence, not finished prose.",
    "Preview it, then publish. Publishing stays a separate, deliberate action.",
  ];
  if (!input.mediaReady) {
    steps.splice(1, 0, "Decide the media: choose an asset or clear the rights on a candidate.");
  }
  return steps;
}

// ---------------------------------------------------------------------------
// Presentation helpers
// ---------------------------------------------------------------------------

export const MARKER_SYMBOL: Record<PackageMarker, string> = {
  ok: "✓",
  will_create: "+",
  warn: "!",
  blocked: "×",
};

export const MARKER_LABEL: Record<PackageMarker, string> = {
  ok: "Already true",
  will_create: "Will be created",
  warn: "Proceed, but know this",
  blocked: "Blocks approval",
};
