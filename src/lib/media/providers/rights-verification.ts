// Rights verification — a stage that runs AFTER discovery, on primary evidence.
//
// WHAT THIS MODULE IS ALLOWED TO CONCLUDE
// ---------------------------------------
// It concludes things about EVIDENCE. It never concludes that something may be
// published, and it structurally cannot: `RightsAssessment.mayPublish` is typed
// `false`, so no future edit can make it true without changing the type and
// every test that asserts on it.
//
// The strongest thing it can say is `evidence_complete`: the licence was read
// from the source's own declaration, the creator is named, the file and page
// URLs resolve, and nothing at source contradicts any of it. That earns the
// asset a place in the private archive with `rights_status='pending_verification'`.
// A human moves it to 'verified'. That is not ceremony — docs/product-media-strategy.md
// §2.1 quotes Commons' own position that the Foundation "does not provide any
// warranty regarding the copyright status or correctness of licensing terms",
// and `scripts/import-test-media.ts` records rejecting File:Canon_EOS_5D.jpg
// because its EXIF said "all rights reserved" under a CC badge. A licence tag
// is a claim. This module checks the claim against the other evidence; it does
// not become the claim's guarantor.
//
// WHY CONFLICT IS WORSE THAN ABSENCE
// ----------------------------------
// Missing evidence means we do not know. Conflicting evidence means one of two
// statements at source is false and we cannot tell which — so the file is not
// merely unverified, it is a known-bad record. Both block; they are reported
// differently because they need different human action.
//
// Pure. No network. Every input was fetched by a provider and is inspected here.

import { licenceUrl, requiresAttribution } from "../licence-links.ts";
import type { ProvenanceRecord, RightsAssessment, RightsFinding } from "./types.ts";
import { ENGINE_MAX_RIGHTS_STATUS } from "./types.ts";

/**
 * Licence terms this site cannot rely on, whatever else is true.
 *
 * TechCarvalho carries affiliate links, so it is a commercial use — an NC
 * licence is not a "probably fine". ND forbids adapted material, and the media
 * pipeline resizes; a pure downscale is conventionally not an adaptation, but
 * an ND file is one pipeline change away from being a breach and there is no
 * shortage of CC BY / CC BY-SA alternatives.
 */
const PROHIBITIVE_LICENCE_PATTERNS: [RegExp, string][] = [
  [/\bnon[\s-]?commercial\b|\bcc[\s-]?by[\s-]?nc\b|(^|[\s-])nc([\s-]|$)/i, "NonCommercial — this site carries affiliate links and is a commercial use."],
  [/\bno[\s-]?deriv|\bcc[\s-]?by[\s-]?nd\b|(^|[\s-])nd([\s-]|$)/i, "NoDerivatives — the media pipeline resizes, and an ND file leaves no margin."],
  [/\ball rights reserved\b/i, "Explicit all-rights-reserved assertion."],
  [/\bfair[\s-]?use\b/i, "Fair use is a defence, not a licence, and is not a basis for republication here."],
  [/\bcopyright(ed)?\b(?!\s*(holder|notice))/i, "A bare copyright assertion is not a grant of reuse rights."],
];

/** Normalise licence strings so "CC BY-SA 4.0" and "cc-by-sa-4.0" compare equal. */
function normaliseLicence(value: string | null): string | null {
  if (!value) return null;
  return value
    .trim()
    .toLowerCase()
    .replace(/^\{\{|\}\}$/g, "")
    .replace(/[_]+/g, "-")
    .replace(/\s+/g, " ")
    .replace(/^cc-/, "cc ")
    .replace(/-(\d)/g, " $1")
    .replace(/\s+/g, " ")
    .trim();
}

/** Do two independently-read licence strings say the same thing? */
export function licencesAgree(a: string | null, b: string | null): boolean {
  const na = normaliseLicence(a);
  const nb = normaliseLicence(b);
  if (!na || !nb) return false;
  if (na === nb) return true;
  // Compare on the canonical deed each resolves to, which absorbs spelling.
  const ua = licenceUrl(a);
  const ub = licenceUrl(b);
  if (ua && ub) return ua === ub;
  return false;
}

/**
 * Platforms whose content is licensed by its uploader, not by the platform.
 *
 * Named in the brief as the standing rule: "Google/Bing Images, Pinterest,
 * Reddit, retailer listings, YouTube frames and social posts are not reusable-
 * image libraries." A file sourced from one of these carries a licence
 * somebody re-asserted second-hand.
 */
const THIRD_PARTY_PLATFORMS: [RegExp, string][] = [
  [/youtube\.com|youtu\.be/i, "YouTube"],
  [/vimeo\.com/i, "Vimeo"],
  [/twitch\.tv/i, "Twitch"],
  [/tiktok\.com/i, "TikTok"],
  [/(twitter|x)\.com\/[a-z0-9_]+\/status/i, "X/Twitter"],
  [/instagram\.com/i, "Instagram"],
  [/facebook\.com/i, "Facebook"],
  [/reddit\.com/i, "Reddit"],
  [/pinterest\./i, "Pinterest"],
  [/threads\.net/i, "Threads"],
  [/bilibili\.com/i, "Bilibili"],
  [/weibo\.com/i, "Weibo"],
  [/amazon\.[a-z.]+\/|ebay\.|aliexpress\./i, "a retailer listing"],
  [/images\.google\.|bing\.com\/images/i, "an image search engine"],
];

export function thirdPartyPlatform(text: string | null | undefined): string | null {
  if (!text) return null;
  for (const [pattern, label] of THIRD_PARTY_PLATFORMS) {
    if (pattern.test(text)) return label;
  }
  return null;
}

export function prohibitiveLicenceReason(license: string | null): string | null {
  if (!license) return null;
  for (const [pattern, reason] of PROHIBITIVE_LICENCE_PATTERNS) {
    if (pattern.test(license)) return reason;
  }
  return null;
}

// ---------------------------------------------------------------------------
// Re-verification: has the source changed since we acquired?
// ---------------------------------------------------------------------------

/**
 * Words Commons decorates an author field with that carry no identity.
 *
 * A stored credit is normally a HUMAN-TIDIED version of the raw field:
 * "See-ming Lee" for `See-ming Lee from Hong Kong SAR, China`,
 * "Ashley Pomeroy" for `Ashley Pomeroy ( talk ) at en.wikipedia`. That tidying
 * is correct — the credit line renders a name, not a location and a wiki link.
 */
const CREDIT_NOISE = new Set([
  "user", "talk", "at", "from", "the", "and", "of", "by", "photo", "photograph",
  "en", "de", "fr", "wikipedia", "wikimedia", "commons", "org", "com", "net",
  "http", "https", "www", "flickr", "own", "work",
]);

function creditTokens(value: string): Set<string> {
  const folded = value
    .normalize("NFD")
    .replace(new RegExp("[\\u0300-\\u036f]", "g"), "")
    .toLowerCase()
    .replace(/https?:\/\/\S+/g, " ");
  return new Set(
    folded
      .split(/[^a-z0-9]+/)
      .filter((t) => t.length > 0 && !CREDIT_NOISE.has(t))
  );
}

function isSubset(a: Set<string>, b: Set<string>): boolean {
  for (const t of a) if (!b.has(t)) return false;
  return true;
}

export type CreditComparison = "same" | "name_form" | "different";

/**
 * Are two credit strings naming the same person?
 *
 * Strict string equality is the obvious implementation and it is wrong, which
 * a live re-verification run proved immediately: all ten "changes" it found on
 * the published library were of this shape —
 *
 *   "CEphoto / Uwe Aranas"                vs "CEphoto, Uwe Aranas"
 *   "Mlogic (Yan Li)"                     vs "Mlogic"
 *   "Kārlis Dambrāns"                     vs "Kārlis Dambrāns from Latvia"
 *   "Gode Nehler"                         vs "GodeNehler"
 *   "François Leblond (User:François de Dijon)" vs "François de Dijon"
 *
 * — not one of which is a different photographer, and all ten of which the
 * first implementation reported as INVALIDATED. Ten false alarms is not a
 * cautious system, it is a system whose warnings nobody will read the day a
 * real one appears.
 */
export function compareCredits(recorded: string, current: string): CreditComparison {
  const a = creditTokens(recorded);
  const b = creditTokens(current);
  if (a.size === 0 || b.size === 0) return a.size === b.size ? "same" : "name_form";

  const ja = [...a].sort().join("");
  const jb = [...b].sort().join("");
  // Concatenated comparison catches "Gode Nehler" vs "GodeNehler", where the
  // token sets differ but the letters do not.
  if (ja === jb) return "same";

  if (isSubset(a, b) || isSubset(b, a)) return "name_form";
  return "different";
}

export type RecordedRights = {
  license: string | null;
  creator: string | null;
  source_url: string | null;
  /** Hash recorded at acquisition, e.g. "sha1:abc…". */
  contentHash: string | null;
};

export type DriftFinding = {
  field: "licence" | "creator" | "source_page" | "content";
  was: string | null;
  now: string | null;
  severity: "blocker" | "warning";
  message: string;
};

export type DriftReport = {
  changed: boolean;
  /** True when the change means the asset must stop being treated as verified. */
  invalidatesVerification: boolean;
  findings: DriftFinding[];
  narrative: string;
};

/**
 * Compare what we recorded at acquisition against what the source says now.
 *
 * This is the case the project has no answer for otherwise: an uploader
 * changes a licence template, or the file page is deleted, weeks after we
 * archived the image and rendered a credit citing terms that no longer exist.
 * A published asset whose licence has changed is not a stale cache entry, it
 * is a live compliance problem, so a licence change is a BLOCKER and the
 * caller must unpublish rather than merely re-check later.
 *
 * A DISAPPEARED source page is handled by the caller: `current === null`.
 * The private archive is never deleted in response — it is the evidence that
 * the licence existed when we relied on it, and destroying it would leave us
 * unable to show what we saw. See docs/product-media-strategy.md on the
 * private original being "the permanent archive/evidence record".
 */
export function detectRightsDrift(recorded: RecordedRights, current: ProvenanceRecord | null): DriftReport {
  if (current === null) {
    return {
      changed: true,
      invalidatesVerification: true,
      findings: [
        {
          field: "source_page",
          was: recorded.source_url,
          now: null,
          severity: "blocker",
          message:
            "The source page no longer resolves. The licence's required link to the material is now dead, so a " +
            "published credit line points at nothing. Treat as unverified and unpublish; do NOT delete the private " +
            "archive copy, which is the only remaining evidence of what the page said when we relied on it.",
        },
      ],
      narrative:
        "Source page disappeared after acquisition. Verification is invalidated: not because the licence was " +
        "necessarily revoked, but because it can no longer be shown, and an unprovable licence is an unverified one.",
    };
  }

  const findings: DriftFinding[] = [];
  const currentLicence = current.licenceDeclared ?? current.licenceMetadata;

  if (recorded.license && currentLicence && !licencesAgree(recorded.license, currentLicence)) {
    findings.push({
      field: "licence",
      was: recorded.license,
      now: currentLicence,
      severity: "blocker",
      message:
        `Licence at source changed from "${recorded.license}" to "${currentLicence}". Any rendered credit now states ` +
        "terms the source no longer grants. Unpublish and re-verify before this appears on a page again.",
    });
  }
  if (recorded.license && !currentLicence) {
    findings.push({
      field: "licence",
      was: recorded.license,
      now: null,
      severity: "blocker",
      message: `The licence declaration we relied on ("${recorded.license}") is no longer readable at source.`,
    });
  }
  if (recorded.creator && current.creator) {
    const comparison = compareCredits(recorded.creator, current.creator);
    if (comparison === "different") {
      findings.push({
        field: "creator",
        was: recorded.creator,
        now: current.creator,
        severity: "blocker",
        message:
          `Attributed creator changed from "${recorded.creator}" to "${current.creator}" — a different person, not a ` +
          "different spelling. Crediting the wrong person breaches the one condition an attribution licence imposes.",
      });
    } else if (comparison === "name_form") {
      findings.push({
        field: "creator",
        was: recorded.creator,
        now: current.creator,
        severity: "warning",
        message:
          `The stored credit "${recorded.creator}" and the source's current author field "${current.creator}" are ` +
          "different forms of the same name — typically a human tidying a location or a wiki link out of the rendered " +
          "credit. Not a compliance problem; worth a glance if the stored form has drifted a long way from the source.",
      });
    }
  }
  if (recorded.contentHash && current.contentHash && recorded.contentHash !== current.contentHash) {
    findings.push({
      field: "content",
      was: recorded.contentHash,
      now: current.contentHash,
      severity: "warning",
      message:
        "The file at source has been replaced or re-encoded since acquisition. Our archived copy is still the one we " +
        "verified, so this is not itself a rights problem — but the source page may now describe a different image.",
    });
  }

  const invalidates = findings.some((f) => f.severity === "blocker");
  return {
    changed: findings.length > 0,
    invalidatesVerification: invalidates,
    findings,
    narrative:
      findings.length === 0
        ? "Source still matches what was recorded at acquisition: same licence, same creator, same bytes."
        : invalidates
          ? `Verification INVALIDATED: ${findings.filter((f) => f.severity === "blocker").map((f) => f.field).join(", ")} changed at source. ` +
            "Fails closed — the asset reverts to unverified and must not remain published."
          : `Non-blocking change at source (${findings.map((f) => f.field).join(", ")}). Recorded for review.`,
  };
}

/**
 * Evaluate one provenance record.
 *
 * Ordered so the most consequential answer wins: restriction, then conflict,
 * then absence. Findings accumulate regardless, because an editor fixing this
 * needs the whole list, not the first problem.
 */
export function verifyRights(provenance: ProvenanceRecord): RightsAssessment {
  const findings: RightsFinding[] = [];
  const block = (code: string, message: string) => findings.push({ severity: "blocker", code, message });
  const warn = (code: string, message: string) => findings.push({ severity: "warning", code, message });

  // --- Positively restricted ----------------------------------------------
  let restricted = false;
  for (const candidateLicence of [provenance.licenceDeclared, provenance.licenceMetadata]) {
    const reason = prohibitiveLicenceReason(candidateLicence);
    if (reason) {
      restricted = true;
      block("licence_prohibitive", `Licence "${candidateLicence}" cannot be relied on: ${reason}`);
    }
  }

  // --- Conflicts recorded by the provider at fetch time --------------------
  const hasConflicts = provenance.conflicts.length > 0;
  for (const c of provenance.conflicts) {
    block("provenance_conflict", `Source contradicts its own licence declaration: ${c}`);
  }

  // --- Two independent licence reads must agree ----------------------------
  let licenceDisagreement = false;
  if (provenance.licenceDeclared && provenance.licenceMetadata) {
    if (!licencesAgree(provenance.licenceDeclared, provenance.licenceMetadata)) {
      licenceDisagreement = true;
      block(
        "licence_metadata_mismatch",
        `The source page declares "${provenance.licenceDeclared}" but the structured metadata reports ` +
          `"${provenance.licenceMetadata}". One of the two is wrong and there is no way to tell which from here.`
      );
    }
  } else if (!provenance.licenceDeclared && provenance.licenceMetadata) {
    // BLOCKER, not a warning. This module's entire claim is that it reads the
    // PRIMARY declaration rather than a rendered badge; accepting a licence it
    // could only read from generated metadata abandons that claim for the
    // candidates where it matters most.
    //
    // The first live run proved it. Searching for the Ryzen 7 9800X3D returned
    // video frame-grabs tagged "CC BY 3.0" with the licence present ONLY in
    // extmetadata — the same ZMASLO/Geekerwan files docs/product-media-strategy.md
    // §6 records a human reviewer rejecting, because that CC claim rests on a
    // YouTube channel's licence toggle re-asserted by a third-party uploader.
    // The engine accepted them. It no longer does.
    //
    // This will also refuse legitimate files whose licence template this module
    // does not yet recognise. That is the correct trade: the fix is to add the
    // template pattern, which is visible and reviewable, rather than to trust
    // a badge, which is neither.
    block(
      "licence_not_in_primary_source",
      `Licence "${provenance.licenceMetadata}" appears only in generated metadata; no licence declaration could be ` +
        "read from the source's own markup. A rendered badge is a second-hand claim — the Openverse failure mode, " +
        "and the shape of every re-asserted video-frame licence."
    );
  }

  // --- Re-asserted third-party licences ------------------------------------
  // A Commons upload whose SOURCE is a video platform or a social post is not
  // own work: the uploader is re-asserting a licence someone else set, and
  // often set on a whole channel rather than on this frame. Commons has a
  // review process for exactly this, and an unreviewed one is an unverified
  // claim about a third party's intentions.
  const sourceEvidence = provenance.evidence
    .filter((e) => e.kind === "source_field" || e.kind === "licence_template")
    .map((e) => e.detail)
    .join(" ");
  const platform = thirdPartyPlatform(`${sourceEvidence} ${provenance.sourcePageUrl ?? ""}`);
  if (platform) {
    const reviewed = /license\s*review[^.]*confirmed|reviewed\s*=\s*(true|confirmed)|\{\{\s*(youtube|flickr|vimeo)review[^}]*confirmed/i.test(
      sourceEvidence
    );
    if (!reviewed) {
      block(
        "third_party_relicence_unreviewed",
        `The file's stated source is ${platform}, so this is not own work — the uploader is re-asserting a licence ` +
          "somebody else applied, frequently to an entire channel rather than to this frame, and no confirmed licence " +
          "review was found. Video platforms and social posts are not reusable-image libraries."
      );
    } else {
      warn(
        "third_party_relicence_reviewed",
        `Source is ${platform} and a licence review appears to have confirmed it. Still a re-asserted third-party ` +
          "licence: a human should read the review before this is relied on."
      );
    }
  }

  // --- Required evidence ---------------------------------------------------
  const effectiveLicence = provenance.licenceDeclared ?? provenance.licenceMetadata;
  const recognised = licenceUrl(effectiveLicence) !== null;

  if (!effectiveLicence) {
    block("licence_absent", "No licence could be read from the source at all.");
  } else if (!recognised) {
    block(
      "licence_unrecognised",
      `Licence "${effectiveLicence}" is not one whose exact terms this project has established. ` +
        "Guessing terms from a licence name is how a NonCommercial file gets published on a commercial site."
    );
  }

  if (!provenance.sourcePageUrl) {
    block("source_page_absent", "No source page URL. The licence grant cannot be shown, and the licence's required link to the material cannot be rendered.");
  }
  if (!provenance.originalFileUrl) {
    block("original_file_absent", "No direct URL to the original file, so what was licensed cannot be identified.");
  }

  const attributionNeeded =
    provenance.attributionRequired ?? (effectiveLicence ? requiresAttribution(effectiveLicence) : true);
  if (attributionNeeded && !provenance.creator && !provenance.attributionText) {
    block(
      "creator_absent",
      "The licence requires attribution and there is no named creator or attribution text to attribute with. " +
        "This is the 'Commons licence but missing required creator' case: a complete-looking licence field with " +
        "nothing to satisfy its one condition."
    );
  }
  if (attributionNeeded && provenance.creator && !provenance.attributionText) {
    warn(
      "attribution_text_absent",
      "A creator is named but no ready-made credit line was determinable at source; one must be composed before publication."
    );
  }

  // --- Evidence-origin checks ----------------------------------------------
  const kinds = new Set(provenance.evidence.map((e) => e.kind));
  if (!kinds.has("licence_template") && !kinds.has("licence_metadata")) {
    block(
      "no_primary_licence_evidence",
      "No primary licence evidence was captured. Rights cannot rest on the fact that a search result looked licensed."
    );
  }
  if (!kinds.has("exif_copyright") && !kinds.has("exif_artist")) {
    warn(
      "exif_not_inspected",
      "Embedded rights metadata was not inspected. File:Canon_EOS_5D.jpg carried a CC badge on the page and " +
        "'all rights reserved' in EXIF; only reading both caught it."
    );
  }
  if (!provenance.contentHash) {
    warn("no_content_hash", "No content hash recorded, so a later change to the file at source cannot be detected.");
  }

  // --- Verdict -------------------------------------------------------------
  const blockers = findings.filter((f) => f.severity === "blocker");

  let evidenceClass: RightsAssessment["evidenceClass"];
  if (restricted) evidenceClass = "restricted";
  else if (hasConflicts || licenceDisagreement) evidenceClass = "evidence_conflicting";
  else if (blockers.length > 0) evidenceClass = "evidence_incomplete";
  else evidenceClass = "evidence_complete";

  const mayAcquire = evidenceClass === "evidence_complete";

  const writableRightsStatus: RightsAssessment["writableRightsStatus"] =
    evidenceClass === "restricted"
      ? "restricted"
      : evidenceClass === "evidence_complete"
        ? ENGINE_MAX_RIGHTS_STATUS
        : null;

  const narrative =
    evidenceClass === "evidence_complete"
      ? `Primary evidence is complete and self-consistent: licence "${effectiveLicence}" read from ${provenance.licenceDeclared ? "the source page's own declaration" : "structured metadata"}` +
        `${provenance.licenceDeclared && provenance.licenceMetadata ? " and corroborated by structured metadata" : ""}, ` +
        `creator ${provenance.creator ? `"${provenance.creator}"` : "not required"}, source page and original file both resolved, ` +
        `no contradicting assertion at source. This earns archival with rights_status='${ENGINE_MAX_RIGHTS_STATUS}' — ` +
        "NOT publication. Commons itself disclaims any warranty on its licence tags, so a human confirms at the source page before anything goes live."
      : evidenceClass === "restricted"
        ? `Positively established as not reusable here: ${blockers.map((b) => b.message).join(" ")} No acquisition, no archival, no publication.`
        : evidenceClass === "evidence_conflicting"
          ? `Evidence at source contradicts itself, which is worse than missing evidence because one of the statements is false and we cannot tell which. ${blockers.map((b) => b.message).join(" ")}`
          : `Required evidence could not be established: ${blockers.map((b) => b.code).join(", ")}. Uncertainty is not permission — this is rights_uncertain and it does not publish.`;

  return {
    evidenceClass,
    // Deliberately never 'rights_verified'. The DB row this produces will carry
    // rights_status='pending_verification', and classifyRights() in
    // provenance.ts correctly reads that as uncertain until a human moves it.
    rightsClass: evidenceClass === "restricted" ? "rights_restricted" : "rights_uncertain",
    writableRightsStatus,
    mayAcquire,
    mayPublish: false,
    findings,
    narrative,
  };
}
