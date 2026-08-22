// Media provenance invariant — the pre-publication rights gate.
//
// THE PRODUCTION ESCAPE THIS ENCODES (2026-08-22)
// -----------------------------------------------
// During the media upgrade, three CC BY / CC BY-SA photographs went live on
// article pages with no credit rendered at all: no creator, no licence link,
// no source link. The licence conditions were unmet on a live public page.
//
// The subtle and important part: **every mandatory database field was
// populated.** creator, licence, source_url and attribution text were all
// present and correct. A data-completeness check would have passed cleanly
// while the site was out of compliance, because the failure was that the
// article hero component never rendered them.
//
// So this module enforces two separate things, and the second is the one that
// actually escaped:
//
//   1. The provenance data required to use the licence genuinely exists and is
//      internally consistent.
//   2. The asset DECLARES whether it needs a rendered credit, so the
//      publication gate can require proof that the surface emits one.
//
// A licence string is a label somebody typed. It is not evidence. Nothing here
// grants rights, and no asset graduates to `rights_verified` because an
// ingestion script assigned it a licence.

import { licenceUrl, requiresAttribution } from "./licence-links.ts";

/**
 * How much we actually know about our right to publish an asset.
 *
 * Deliberately five states rather than the single `verified` the database has
 * used for everything. As of 2026-08-22 all 104 published assets carried
 * `rights_status = 'verified'`, including 65 graphics TechCarvalho generated
 * itself — which conflates "we made this" with "we checked someone else's
 * licence". Those are different claims carrying different risks.
 */
export type RightsClass =
  /** Externally sourced, and the provenance needed to rely on the licence is
   *  present, consistent, and was confirmed by a human. */
  | "rights_verified"
  /** Externally sourced, but something required is missing, inconsistent, or
   *  unconfirmed. NOT publishable — uncertainty is not permission. */
  | "rights_uncertain"
  /** Known to be restricted. Never publishable, whatever else is true. */
  | "rights_restricted"
  /** TechCarvalho generated it. We own it; there is no external licence. */
  | "generated_original"
  /** TechCarvalho photographed it. Owned outright. */
  | "owned_original";

export type ProvenanceAsset = {
  source_type: string | null;
  rights_status: string | null;
  license: string | null;
  creator: string | null;
  attribution: string | null;
  attribution_required: boolean | null;
  source_url: string | null;
  owned: boolean | null;
  ai_generated: boolean | null;
};

/** Licences whose exact terms this project has established. */
function isRecognisedLicence(license: string | null | undefined): boolean {
  return licenceUrl(license) !== null;
}

function isWellFormedUrl(value: string | null | undefined): boolean {
  if (!value) return false;
  try {
    const u = new URL(value);
    return u.protocol === "https:" || u.protocol === "http:";
  } catch {
    return false;
  }
}

const ORIGINAL_SOURCE_TYPES = new Set(["tc_graphic"]);
const OWNED_SOURCE_TYPES = new Set(["staff_photograph"]);

/**
 * Classify what we actually know, from evidence rather than from the label.
 *
 * `rights_status = 'verified'` is treated as a NECESSARY human signal, never a
 * sufficient one. An asset carrying that flag but no source URL is
 * `rights_uncertain`: the flag records that somebody clicked "verified", and
 * the missing URL records that the evidence is not there.
 */
export function classifyRights(asset: ProvenanceAsset): RightsClass {
  const source = (asset.source_type ?? "").toLowerCase();
  const status = (asset.rights_status ?? "").toLowerCase();

  // Restricted wins over everything, mirroring evaluatePublishEligibility()
  // in rights.ts where `restricted` always blocks.
  if (status === "restricted") return "rights_restricted";

  if (OWNED_SOURCE_TYPES.has(source)) return "owned_original";
  if (ORIGINAL_SOURCE_TYPES.has(source) && asset.owned === true) return "generated_original";

  // Everything else is somebody else's work, and needs real provenance.
  if (status !== "verified") return "rights_uncertain";
  if (!isWellFormedUrl(asset.source_url)) return "rights_uncertain";
  if (!isRecognisedLicence(asset.license)) return "rights_uncertain";

  // A licence requiring attribution requires the material to attribute WITH.
  // Missing creator means the credit cannot render correctly even though the
  // licence says it must.
  if (requiresAttribution(asset.license)) {
    if (!asset.creator && !asset.attribution) return "rights_uncertain";
  }

  return "rights_verified";
}

export type ProvenanceSeverity = "blocker" | "warning";

export type ProvenanceFinding = {
  severity: ProvenanceSeverity;
  code: string;
  message: string;
};

/**
 * Whether a rendered credit line is a licence CONDITION for this asset.
 *
 * The publication gate uses this to require proof that the display surface
 * actually emits the credit — the check that would have caught the 2026-08-22
 * escape, where the data was complete and the page was not.
 */
export function requiresRenderedCredit(asset: ProvenanceAsset): boolean {
  const cls = classifyRights(asset);
  if (cls === "generated_original" || cls === "owned_original") return false;
  return requiresAttribution(asset.license) || asset.attribution_required === true;
}

/**
 * Full provenance evaluation.
 *
 * Fails CLOSED: anything unresolved is a blocker, not a warning. "We are not
 * sure whether we may publish this" and "we may not publish this" have the
 * same correct outcome.
 */
export function evaluateProvenance(asset: ProvenanceAsset): {
  rightsClass: RightsClass;
  publishable: boolean;
  requiresCredit: boolean;
  findings: ProvenanceFinding[];
} {
  const findings: ProvenanceFinding[] = [];
  const rightsClass = classifyRights(asset);
  const block = (code: string, message: string) =>
    findings.push({ severity: "blocker", code, message });
  const warn = (code: string, message: string) =>
    findings.push({ severity: "warning", code, message });

  if (rightsClass === "rights_restricted") {
    block("rights_restricted", "Asset is marked restricted. It must never be published.");
  }

  if (rightsClass === "rights_uncertain") {
    // Say WHICH part is missing — "uncertain" alone is not actionable.
    if ((asset.rights_status ?? "").toLowerCase() !== "verified") {
      block("rights_unverified", `rights_status is '${asset.rights_status ?? "null"}', not 'verified'. A human must confirm the licence at its source.`);
    }
    if (!isWellFormedUrl(asset.source_url)) {
      block("provenance_no_source_url", "No usable source URL. The licence cannot be shown to have been granted, and the required link to the material cannot be rendered.");
    }
    if (!isRecognisedLicence(asset.license)) {
      block("provenance_unrecognised_licence", `Licence '${asset.license ?? "null"}' is not one whose terms this project has established. A licence string is a label, not evidence.`);
    }
    if (requiresAttribution(asset.license) && !asset.creator && !asset.attribution) {
      block("provenance_no_creator", "Licence requires attribution but there is no creator or attribution text to attribute with.");
    }
  }

  // --- Internal consistency. Each is a contradiction meaning one of the two
  // --- fields is wrong, and we cannot tell which. ---

  if (asset.license && !requiresAttribution(asset.license) && asset.attribution_required === true) {
    warn(
      "provenance_inconsistent_attribution",
      `Licence '${asset.license}' requires no attribution, but attribution_required is true. One of the two is wrong.`
    );
  }

  if (asset.license && requiresAttribution(asset.license) && asset.attribution_required === false) {
    block(
      "provenance_attribution_disabled",
      `Licence '${asset.license}' REQUIRES attribution, but attribution_required is false — so no credit would render. This is the 2026-08-22 escape class.`
    );
  }

  if (asset.owned === true && rightsClass !== "generated_original" && rightsClass !== "owned_original" && isWellFormedUrl(asset.source_url)) {
    warn(
      "provenance_owned_but_external",
      "Marked owned, but carries an external source URL. Ownership and external sourcing are contradictory claims."
    );
  }

  if (rightsClass === "generated_original" && isWellFormedUrl(asset.source_url)) {
    warn(
      "provenance_generated_but_sourced",
      "Classified as an original TechCarvalho graphic but carries an external source URL."
    );
  }

  // An original graphic must never be presented as documentary evidence of
  // what something looks like. An editorial rule with legal edges.
  if (rightsClass === "generated_original" && asset.ai_generated === true) {
    warn(
      "generated_ai_imagery",
      "AI-generated. Acceptable as clearly-labelled illustration; must never be presented as a photograph, screenshot or official render."
    );
  }

  const publishable = !findings.some((f) => f.severity === "blocker");
  return { rightsClass, publishable, requiresCredit: requiresRenderedCredit(asset), findings };
}
