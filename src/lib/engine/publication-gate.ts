// The publication safety gate.
//
// THE RULE THIS EXISTS TO ENFORCE
// -------------------------------
// Nothing publishes because generation completed successfully. "The job did
// not throw" is not evidence that the output is fit to publish, and treating
// it as such is how autonomous systems ship confident nonsense.
//
// TWO KINDS OF CHECK, AND THEY DO NOT MIX
// ---------------------------------------
// HARD BLOCKERS are absolute. One blocker means NO PUBLICATION regardless of
// how high everything else scores. They are not weighted, not averaged, and
// cannot be outvoted — a beautifully written article with an unlicensed image
// is not 90% publishable, it is unpublishable.
//
// SCORED CHECKS express quality where there is a genuine spectrum, and are
// reported PER DIMENSION. They never rescue a blocker, and there is
// deliberately no single headline percentage: an aggregate is where
// uncertainty goes to hide.
//
// FAILS CLOSED
// ------------
// An input the gate could not obtain is a blocker, not a pass. If the media
// validator is unavailable the answer is "do not publish", never "publish
// without checking media". A subsystem being down must never cause a check to
// be skipped.
//
// Deterministic. No AI provider, no network. The gate takes already-computed
// inputs rather than fetching them, so it is fully unit-testable and so a
// caller cannot accidentally let a failed fetch look like a clean result.

export type BlockerCode =
  // Evidence and truth
  | "unsupported_claims"
  | "missing_required_evidence"
  | "broken_citation"
  | "source_evidence_mismatch"
  | "stale_information"
  | "invented_specifics"
  | "low_source_diversity"
  | "vendor_press_release"
  // Identity and duplication
  | "unresolved_entity"
  | "duplicate_content"
  | "intent_cannibalisation"
  // Media
  | "missing_hero_media"
  | "media_provenance_incomplete"
  | "media_credit_not_rendered"
  | "misleading_generated_imagery"
  // Technical
  | "broken_internal_link"
  | "invalid_external_link"
  | "missing_seo_metadata"
  | "malformed_structured_data"
  | "incomplete_sections"
  | "placeholder_text"
  | "build_render_failed"
  // Meta
  | "check_unavailable";

export type ScoredDimension =
  | "entity_identity"
  | "factual_accuracy"
  | "source_quality"
  | "freshness"
  | "media_rights"
  | "search_intent"
  | "uniqueness"
  | "editorial_quality"
  | "technical_validity";

export type Blocker = {
  code: BlockerCode;
  /** What is wrong, in words an editor can act on. */
  message: string;
  /** Where to look: a slug, URL, claim, or asset id. */
  evidence?: string;
};

export type DimensionScore = {
  dimension: ScoredDimension;
  /** 0-1. Never aggregated into a single headline number. */
  score: number;
  /** Why this score. Required — an unexplained number is not a judgement. */
  rationale: string;
};

/**
 * Everything the gate needs, pre-computed by the caller.
 *
 * Each field may be `undefined`, meaning "this check could not be run". That
 * is treated as a BLOCKER, not a pass — see `check_unavailable`. Making
 * unavailability explicit in the type is what stops a caller silently omitting
 * a check it failed to compute.
 */
export type GateInput = {
  kind: "article" | "product" | "update";
  identifier: string;

  evidence?: {
    totalClaims: number;
    supportedClaims: number;
    unsupportedClaims: string[];
    /** High-risk: price, release date, specification, compatibility, legal. */
    unsupportedHighRisk: string[];
    brokenCitations: string[];
    /** A claim whose cited source does not actually say it. */
    mismatches: string[];
  };

  sources?: {
    total: number;
    distinctPublishers: number;
    primaryCount: number;
    /** Sources not tracing back to one common origin. */
    independentCount: number;
    isVendorPressRelease: boolean;
    oldestEvidenceDays: number | null;
  };

  freshness?: {
    sensitivity: "breaking" | "time_sensitive" | "evergreen";
    evidenceAgeDays: number | null;
  };

  entity?: {
    decision: "matched_existing" | "new_entity" | "ambiguous" | "ignored";
    matchedName: string | null;
  };

  duplication?: {
    /** 0-1 similarity to the closest existing published piece. */
    nearestSimilarity: number;
    nearestSlug: string | null;
    cannibalisesSlug: string | null;
  };

  media?: {
    hasHero: boolean;
    /** From evaluateProvenance(): blocker codes on the hero asset. */
    provenanceBlockers: string[];
    requiresCredit: boolean;
    /** Whether the rendering surface was PROVEN to emit that credit.
     *  The 2026-08-22 escape: data complete, page non-compliant. */
    creditRenderVerified: boolean;
    misleadingGenerated: boolean;
  };

  technical?: {
    brokenInternalLinks: string[];
    invalidExternalLinks: string[];
    hasSeoTitle: boolean;
    hasSeoDescription: boolean;
    structuredDataValid: boolean;
    /** Headings present with no body written under them. */
    emptySections: string[];
    /** Editor scaffolding still in the body. */
    placeholderMarkers: string[];
    buildRenderOk: boolean;
  };
};

export type GateVerdict = {
  /** The only field that decides publication. */
  publishable: boolean;
  blockers: Blocker[];
  dimensions: DimensionScore[];
  unavailableChecks: string[];
  summary: string;
};

/** Minimum independent publishers before a claim set counts as corroborated. */
export const MIN_SOURCE_DIVERSITY = 2;
/** Similarity above which a proposed piece duplicates an existing one. */
export const DUPLICATE_THRESHOLD = 0.6;
/** Evidence older than this cannot support a breaking claim. */
export const BREAKING_EVIDENCE_MAX_DAYS = 3;
/** ...or a time-sensitive one. */
export const TIME_SENSITIVE_EVIDENCE_MAX_DAYS = 30;

export function evaluatePublicationGate(input: GateInput): GateVerdict {
  const blockers: Blocker[] = [];
  const dimensions: DimensionScore[] = [];
  const unavailable: string[] = [];

  const block = (code: BlockerCode, message: string, evidence?: string) =>
    blockers.push({ code, message, evidence });
  const score = (dimension: ScoredDimension, s: number, rationale: string) =>
    dimensions.push({ dimension, score: Math.max(0, Math.min(1, s)), rationale });

  // Any check that could not run is itself a blocker. This is the "one broken
  // subsystem must never skip validation" rule made structural.
  const requireCheck = (name: string, present: boolean) => {
    if (!present) {
      unavailable.push(name);
      block("check_unavailable", `The ${name} check could not be run, so this cannot be cleared for publication. A subsystem being unavailable means stop, not proceed.`, name);
      return false;
    }
    return true;
  };

  // --- Evidence -----------------------------------------------------------
  if (requireCheck("evidence coverage", input.evidence !== undefined)) {
    const e = input.evidence!;
    const coverage = e.totalClaims > 0 ? e.supportedClaims / e.totalClaims : 0;

    if (e.unsupportedHighRisk.length > 0) {
      block("invented_specifics", `${e.unsupportedHighRisk.length} high-risk claim(s) — price, date, specification, compatibility or legal — have no supporting evidence. These are the claims a reader acts on.`, e.unsupportedHighRisk.slice(0, 3).join(" | "));
    }
    if (e.unsupportedClaims.length > 0) {
      block("unsupported_claims", `${e.unsupportedClaims.length} factual claim(s) trace to no evidence record.`, e.unsupportedClaims.slice(0, 3).join(" | "));
    }
    if (e.totalClaims === 0) {
      block("missing_required_evidence", "No claims were extracted at all, so evidence coverage cannot be established. An article with nothing checkable is not ready.");
    }
    if (e.brokenCitations.length > 0) {
      block("broken_citation", `${e.brokenCitations.length} citation(s) do not resolve.`, e.brokenCitations.slice(0, 3).join(" | "));
    }
    if (e.mismatches.length > 0) {
      block("source_evidence_mismatch", `${e.mismatches.length} claim(s) cite a source that does not support them. Misrepresenting a source is worse than having none.`, e.mismatches.slice(0, 3).join(" | "));
    }
    score("factual_accuracy", coverage, `${e.supportedClaims} of ${e.totalClaims} claims traced to evidence.`);
  }

  // --- Sources ------------------------------------------------------------
  if (requireCheck("source quality", input.sources !== undefined)) {
    const s = input.sources!;
    if (s.isVendorPressRelease) {
      block("vendor_press_release", "This is a vendor announcement reprinted as independent editorial. The underlying event may be real; reprinting the vendor's framing is not reporting it.");
    }
    if (s.independentCount < MIN_SOURCE_DIVERSITY && s.primaryCount === 0) {
      block("low_source_diversity", `Only ${s.independentCount} genuinely independent source(s) and no primary source. Repetition across outlets sharing an origin is not corroboration.`);
    }
    const diversity = s.total > 0 ? Math.min(s.independentCount / MIN_SOURCE_DIVERSITY, 1) : 0;
    score("source_quality", diversity, `${s.independentCount} independent of ${s.total} total; ${s.primaryCount} primary.`);
  }

  // --- Freshness ----------------------------------------------------------
  if (requireCheck("freshness", input.freshness !== undefined)) {
    const f = input.freshness!;
    const age = f.evidenceAgeDays;
    const limit =
      f.sensitivity === "breaking" ? BREAKING_EVIDENCE_MAX_DAYS
      : f.sensitivity === "time_sensitive" ? TIME_SENSITIVE_EVIDENCE_MAX_DAYS
      : null;

    if (limit !== null && age !== null && age > limit) {
      block("stale_information", `Evidence is ${age} days old but this is ${f.sensitivity} material, where anything over ${limit} days may already be wrong.`);
    }
    const freshScore = limit === null ? 1 : age === null ? 0 : Math.max(0, 1 - age / (limit * 2));
    score("freshness", freshScore, limit === null ? "Evergreen; no decay limit applied." : `Evidence ${age ?? "unknown"} days old against a ${limit}-day limit.`);
  }

  // --- Entity -------------------------------------------------------------
  if (requireCheck("entity resolution", input.entity !== undefined)) {
    const e = input.entity!;
    if (e.decision === "ambiguous") {
      block("unresolved_entity", `Entity is ambiguous against existing record "${e.matchedName ?? "unknown"}". Publishing risks creating a duplicate or mislabelling a successor.`);
    }
    score("entity_identity", e.decision === "ambiguous" ? 0 : 1, `Resolution: ${e.decision}.`);
  }

  // --- Duplication --------------------------------------------------------
  if (requireCheck("duplication", input.duplication !== undefined)) {
    const d = input.duplication!;
    if (d.nearestSimilarity >= DUPLICATE_THRESHOLD) {
      block("duplicate_content", `Substantially overlaps existing published content (${d.nearestSimilarity.toFixed(2)}). Update that page instead of publishing a second one.`, d.nearestSlug ?? undefined);
    }
    if (d.cannibalisesSlug) {
      block("intent_cannibalisation", "An existing page already targets this search intent. Two pages competing for one query makes both weaker.", d.cannibalisesSlug);
    }
    score("uniqueness", 1 - Math.min(d.nearestSimilarity, 1), `Closest existing piece scores ${d.nearestSimilarity.toFixed(2)}.`);
  }

  // --- Media --------------------------------------------------------------
  if (requireCheck("media validation", input.media !== undefined)) {
    const m = input.media!;
    if (!m.hasHero) {
      block("missing_hero_media", "No hero image. Media is part of the definition of done for a public record.");
    }
    if (m.provenanceBlockers.length > 0) {
      block("media_provenance_incomplete", `Hero media provenance is incomplete: ${m.provenanceBlockers.join(", ")}. A licence label is not evidence that the licence may be relied on.`);
    }
    // The 2026-08-22 escape, encoded permanently.
    if (m.requiresCredit && !m.creditRenderVerified) {
      block("media_credit_not_rendered", "The licence requires a rendered credit and it has NOT been verified to render. On 2026-08-22 three CC BY photographs went live with complete database provenance and no credit on the page — data completeness is not compliance.");
    }
    if (m.misleadingGenerated) {
      block("misleading_generated_imagery", "Generated imagery is presented as documentary. Illustration is fine when labelled; it must never look like a photograph or screenshot of the real thing.");
    }
    const mediaOk = m.hasHero && m.provenanceBlockers.length === 0 && (!m.requiresCredit || m.creditRenderVerified);
    score("media_rights", mediaOk ? 1 : 0, mediaOk ? "Hero present, provenance complete, credit verified." : "Media rights unresolved.");
  }

  // --- Technical ----------------------------------------------------------
  if (requireCheck("technical validation", input.technical !== undefined)) {
    const t = input.technical!;
    if (t.brokenInternalLinks.length > 0) {
      block("broken_internal_link", `${t.brokenInternalLinks.length} internal link(s) do not resolve.`, t.brokenInternalLinks.slice(0, 3).join(" | "));
    }
    if (t.invalidExternalLinks.length > 0) {
      block("invalid_external_link", `${t.invalidExternalLinks.length} external link(s) are invalid or unreachable.`, t.invalidExternalLinks.slice(0, 3).join(" | "));
    }
    if (!t.hasSeoTitle || !t.hasSeoDescription) {
      block("missing_seo_metadata", "SEO title or description is missing.");
    }
    if (!t.structuredDataValid) {
      block("malformed_structured_data", "Structured data is malformed. Invalid markup is worse than none.");
    }
    if (t.emptySections.length > 0) {
      block("incomplete_sections", `${t.emptySections.length} section heading(s) have no body written under them.`, t.emptySections.slice(0, 3).join(" | "));
    }
    if (t.placeholderMarkers.length > 0) {
      block("placeholder_text", `Editor scaffolding is still present: ${t.placeholderMarkers.slice(0, 3).join("; ")}.`);
    }
    if (!t.buildRenderOk) {
      block("build_render_failed", "The page does not build or render.");
    }
    const techIssues =
      t.brokenInternalLinks.length + t.invalidExternalLinks.length +
      t.emptySections.length + t.placeholderMarkers.length +
      (t.hasSeoTitle ? 0 : 1) + (t.hasSeoDescription ? 0 : 1) +
      (t.structuredDataValid ? 0 : 1) + (t.buildRenderOk ? 0 : 1);
    score("technical_validity", techIssues === 0 ? 1 : Math.max(0, 1 - techIssues / 8), `${techIssues} technical issue(s).`);
  }

  // Search intent is scored rather than blocked on its own — cannibalisation
  // above is the blocking form of the same concern.
  score(
    "search_intent",
    input.duplication?.cannibalisesSlug ? 0 : 1,
    input.duplication?.cannibalisesSlug ? "Competes with an existing page." : "No competing page identified."
  );
  // Editorial quality is genuinely a spectrum and never blocks by itself; the
  // concrete failures (placeholders, empty sections) are blockers above.
  const editorialIssues = (input.technical?.placeholderMarkers.length ?? 0) + (input.technical?.emptySections.length ?? 0);
  score("editorial_quality", editorialIssues === 0 ? 1 : 0, editorialIssues === 0 ? "No structural defects found." : `${editorialIssues} structural defect(s).`);

  const publishable = blockers.length === 0;
  return {
    publishable,
    blockers,
    dimensions,
    unavailableChecks: unavailable,
    summary: publishable
      ? `Cleared: ${dimensions.length} dimensions scored, no hard blockers.`
      : `BLOCKED by ${blockers.length} hard blocker(s): ${[...new Set(blockers.map((b) => b.code))].join(", ")}.`,
  };
}
