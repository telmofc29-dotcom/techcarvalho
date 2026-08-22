// The SHADOW pipeline: the complete autonomous decision process, publishing nothing.
//
// WHAT THIS RUNS
// --------------
// Fifteen stages, in the order the real editorial pipeline runs them:
//
//   discovery -> relevance -> opportunity -> research -> entity resolution
//     -> evidence -> brief -> draft/product assembly -> media acquisition
//     -> media rights -> SEO/internal linking -> freshness
//     -> adversarial review -> publication gate -> final decision
//
// Every stage that a candidate reaches actually executes. There is no
// short-circuit that skips the expensive end of the pipeline, because the
// expensive end is the part worth having evidence about — a runner that stopped
// at "relevance: rejected" for most candidates would produce a large number of
// decisions and almost no information.
//
// WHY IT IS PURE
// --------------
// Every input arrives already fetched. The pipeline neither reads nor writes,
// which is what makes it unit-testable and what makes it structurally incapable
// of publishing: there is no client in scope for it to publish WITH. The job
// module does the I/O and hands the results in; see jobs/shadow-job.ts.
//
// FAIL-CLOSED, AND HONEST ABOUT IT
// --------------------------------
// Two things shadow genuinely cannot verify, and it says so rather than
// assuming:
//
//  - RENDERED MEDIA CREDIT. `creditRenderVerified` is always false. Proving a
//    credit renders requires rendering the page, and shadow creates no page. On
//    2026-08-22 three CC BY photographs went live with complete database
//    provenance and no credit on the page; the lesson was that data
//    completeness is not compliance, so shadow does not get to claim
//    compliance it did not observe.
//  - FULL PAGE RENDER. What shadow can check is that the assembled artifact is
//    structurally renderable — see `verifyStructurallyRenderable`. That is a
//    real check on a real artifact, and it is recorded as exactly that, with a
//    standing caution that it is narrower than rendering the published page.
//
// Deterministic. No AI provider, no network, no clock (a `now` is supplied), no
// `server-only`.

import type { ClaimStatus, TrustLevel, EngineSourceType } from "./types.ts";
import type { MediaRightsStatus as DbMediaRightsStatus, MediaSourceType } from "@/lib/types/database";
import { classifyRelevance } from "./relevance.ts";
import { computeOpportunityScore, type OpportunityInputs } from "./opportunity.ts";
import { classifySource, qualifiesAsNews, reconcileConflict } from "./source-quality.ts";
import { resolveEntity, proposeSlug } from "./entity-resolution.ts";
import { assessClaimCoverage, type Claim, type EvidenceRecord } from "./claim-coverage.ts";
import { buildBrief } from "./brief-builder.ts";
import { assembleDraft, findUnfinishedAssemblyMarkers, proposeSeo } from "./draft-assembly.ts";
import { detectProductAnnouncement } from "./product-signals.ts";
import { suggestLinksFor, type LinkCandidate } from "./link-suggestions.ts";
import { titleSimilarity } from "./dedupe.ts";
import { findCannibalisationMatches, type ContentSignal } from "../admin/cannibalisation.ts";
import { evaluatePublishEligibility } from "../media/rights.ts";
import { requiresAttribution } from "../media/licence-links.ts";
import { reviewProposedPublication, type ReviewInput, type MediaCandidate, type ClaimConflict } from "./reviewer.ts";
import { evaluatePublicationGate, type GateInput, type GateVerdict } from "./publication-gate.ts";
import {
  decideShadowOutcome,
  SHADOW_STAGES,
  type ShadowDecision,
  type ShadowReason,
  type ShadowStage,
  type ShadowStageRecord,
  type ShadowStageStatus,
} from "./shadow-decision.ts";
import {
  classifyDimensions,
  shadowCandidateIdentity,
  type DimensionSignals,
  type ShadowDimension,
} from "./shadow-composition.ts";

// ---------------------------------------------------------------------------
// Input
// ---------------------------------------------------------------------------

/** One evidence row, plus the registry facts about where it came from. */
export type ShadowEvidence = {
  id: string;
  url: string;
  publisher: string | null;
  organisation: string | null;
  excerpt: string | null;
  claimStatus: ClaimStatus;
  trustLevel: TrustLevel;
  originatesFromUrl: string | null;
  retrievedAt: string | null;
  sourceType: EngineSourceType | null;
  /** Registry permissions for the source this row came from. */
  registry: {
    discoveryPermitted: boolean;
    mediaRepublicationPermitted: boolean;
    mediaRightsStatus: string | null;
    attributionRequired: boolean;
    editorialUseOnly: boolean;
    registrationRequired: boolean;
    organisation: string | null;
  } | null;
};

export type ShadowMediaCandidate = {
  id: string;
  label: string | null;
  rightsStatus: DbMediaRightsStatus | null;
  owned: boolean;
  sourceType: MediaSourceType | null;
  licence: string | null;
  attributionText: string | null;
  sourceUrl: string | null;
  /** True when the asset is a generated illustration presented without a label. */
  generatedUnlabelled: boolean;
  registry: MediaCandidate["registry"];
};

export type ShadowCandidate = {
  kind: "discovery";
  id: string;
  /** The engine's own dedupe key — the basis of candidate identity. */
  dedupeKey: string;
  title: string;
  summary: string | null;
  discoveryType: string;
  categorySlug: string | null;
  claimStatus: ClaimStatus;
  state: string;
  sightingCount: number;
  firstSeenAt: string;
  /** A human has already overridden the relevance verdict on this record. */
  relevanceOverriddenByAdmin: boolean;
  evidence: ShadowEvidence[];
  mediaCandidates: ShadowMediaCandidate[];
  /** Known disagreements between sources, when the caller has detected any. */
  conflicts: ClaimConflict[];
};

export type ShadowContext = {
  /** ISO timestamp used as "now", so a run is reproducible. */
  now: string;
  /** Already-published TechCarvalho content, for duplication and linking. */
  existingContent: ContentSignal[];
  /** Every product and content record, for entity resolution. */
  existingEntities: { kind: "product" | "content"; id: string; name: string; slug: string; isPublished: boolean }[];
  /** Published items that can legitimately be linked to. */
  linkCandidates: LinkCandidate[];
  /** Slugs already taken, so a proposed slug is checked rather than assumed. */
  takenSlugs: Set<string>;
  /** Manufacturers the catalogue already knows. The engine never invents one. */
  manufacturers: { slug: string; name: string }[];
  /** Demand signals, where the caller has them. Null means genuinely unknown. */
  opportunityInputs: OpportunityInputs | null;
  /** Whether a piece of this kind needs a hero image before publication. */
  requiresHeroMedia: boolean;
};

// ---------------------------------------------------------------------------
// Output
// ---------------------------------------------------------------------------

export type ShadowRecord = {
  /** Stable, version-free identity. The deduplication key. */
  identity: string;
  candidateId: string;
  candidateKind: ShadowCandidate["kind"];
  title: string;
  /** The publisher the candidate came from, for family clustering. */
  publisher: string | null;
  decidedAt: string;
  /** YYYY-MM-DD, for the distinct-days readiness criterion. */
  day: string;
  decision: ShadowDecision;
  dimensions: ShadowDimension[];
  /** Scored dimensions from the gate, when it ran. Never aggregated. */
  gate: GateVerdict | null;
  /** What the engine WOULD have created. Recorded, never written anywhere. */
  proposal: {
    contentType: string;
    proposedSlug: string;
    metaTitle: string;
    metaDescription: string | null;
    wordCountEstimate: number;
    productShell: { name: string; slug: string; manufacturerSlug: string } | null;
  } | null;
};

// ---------------------------------------------------------------------------
// Stage bookkeeping
// ---------------------------------------------------------------------------

// Plain class fields and `#private` rather than TypeScript's `private` and
// parameter properties: `npm test` runs node --test in strip-only mode, which
// refuses TS-only runtime syntax.
class StageLog {
  #records = new Map<ShadowStage, ShadowStageRecord>();
  reasons: ShadowReason[] = [];

  record(stage: ShadowStage, status: ShadowStageStatus, summary: string, detail: string[] = []): void {
    this.#records.set(stage, { stage, status, summary, detail });
  }

  reason(stage: ShadowStage, code: string, severity: ShadowReason["severity"], message: string, detail: string[] = []): void {
    this.reasons.push({ code, stage, severity, message, detail });
  }

  /** Every stage in canonical order; anything never recorded is `not_reached`. */
  all(): ShadowStageRecord[] {
    return SHADOW_STAGES.map(
      (stage) =>
        this.#records.get(stage) ?? {
          stage,
          status: "not_reached" as ShadowStageStatus,
          summary: "Not reached — an earlier stage stopped this candidate.",
          detail: [],
        }
    );
  }
}

/** A stage stopped the candidate. Thrown internally, caught by the runner. */
class StopPipeline extends Error {
  stage: ShadowStage;
  constructor(stage: ShadowStage) {
    super(`stopped at ${stage}`);
    this.name = "StopPipeline";
    this.stage = stage;
  }
}

// ---------------------------------------------------------------------------
// Small deterministic checks
// ---------------------------------------------------------------------------

/** A URL that does not parse cannot be cited. No network involved. */
export function isCitableUrl(url: string): boolean {
  try {
    const parsed = new URL(url);
    return (parsed.protocol === "http:" || parsed.protocol === "https:") && parsed.hostname.includes(".");
  } catch {
    return false;
  }
}

/**
 * Whether the assembled artifact is structurally renderable.
 *
 * NARROWER THAN IT SOUNDS, deliberately. This checks the thing shadow actually
 * has: that the body is non-empty, that every HTML comment it opened is closed
 * (an unclosed `<!--` swallows the rest of the page), that heading levels do not
 * jump, and that the fields the article route requires are present. It does NOT
 * render the published page, because shadow creates no page to render, and the
 * caller records a standing caution saying so.
 */
export function verifyStructurallyRenderable(input: {
  body: string;
  metaTitle: string;
  slug: string;
}): { ok: boolean; problems: string[] } {
  const problems: string[] = [];
  if (input.body.trim().length === 0) problems.push("The body is empty.");
  const opens = (input.body.match(/<!--/g) ?? []).length;
  const closes = (input.body.match(/-->/g) ?? []).length;
  if (opens !== closes) problems.push(`Unbalanced HTML comment markers (${opens} open, ${closes} close) — everything after an unclosed comment disappears from the page.`);
  if (!input.metaTitle.trim()) problems.push("No title, so the page has nothing to render as its heading.");
  if (!/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(input.slug)) problems.push(`Slug "${input.slug}" is not a valid URL segment.`);

  let previousLevel = 0;
  for (const line of input.body.split("\n")) {
    const match = /^(#{1,6})\s+\S/.exec(line);
    if (!match) continue;
    const level = match[1].length;
    if (previousLevel > 0 && level > previousLevel + 1) {
      problems.push(`Heading level jumps from h${previousLevel} to h${level}, which breaks the document outline.`);
      break;
    }
    previousLevel = level;
  }

  return { ok: problems.length === 0, problems };
}

/** Headings with nothing but an editor placeholder beneath them. */
export function findEmptySections(body: string): string[] {
  const lines = body.split("\n");
  const empty: string[] = [];
  for (let i = 0; i < lines.length; i++) {
    const heading = /^#{2,6}\s+(.*\S)/.exec(lines[i]);
    if (!heading) continue;
    let j = i + 1;
    let prose = "";
    while (j < lines.length && !/^#{1,6}\s+/.test(lines[j])) {
      prose += lines[j].trim() + " ";
      j++;
    }
    const stripped = prose.replace(/_\[[^\]]*\]_/g, "").trim();
    if (stripped.length === 0) empty.push(heading[1]);
  }
  return empty;
}

function daysBetween(fromIso: string | null, nowIso: string): number | null {
  if (!fromIso) return null;
  const from = Date.parse(fromIso);
  const now = Date.parse(nowIso);
  if (Number.isNaN(from) || Number.isNaN(now)) return null;
  return Math.max(0, Math.round((now - from) / 86_400_000));
}

// ---------------------------------------------------------------------------
// The pipeline
// ---------------------------------------------------------------------------

/**
 * Run the complete decision process for one candidate and return its record.
 *
 * NEVER THROWS. A stage that throws is caught, recorded as `error`, and turns
 * the record into a FAILURE with no outcome — see shadow-decision.ts for why a
 * crash must not be laundered into a decision.
 */
export function runShadowPipeline(candidate: ShadowCandidate, context: ShadowContext): ShadowRecord {
  const log = new StageLog();
  let gate: GateVerdict | null = null;
  let review: ReturnType<typeof reviewProposedPublication> | undefined;
  let proposal: ShadowRecord["proposal"] = null;
  let dimensions: ShadowDimension[] = [];
  let crashed: { stage: ShadowStage; error: string } | null = null;

  const primaryPublisher =
    candidate.evidence.find((e) => e.publisher)?.publisher ??
    candidate.evidence.find((e) => e.organisation)?.organisation ??
    null;

  // Signals accumulate as stages establish them, so classifyDimensions reads
  // observations rather than guesses.
  const signals: DimensionSignals = {
    title: candidate.title,
    summary: candidate.summary,
    discoveryType: candidate.discoveryType,
    categorySlug: candidate.categorySlug,
    claimStatus: candidate.claimStatus,
    suggestedAngle: null,
    freshnessSensitivity: null,
    evidenceCount: candidate.evidence.length,
    distinctPublishers: new Set(
      candidate.evidence.map((e) => (e.organisation ?? e.publisher ?? e.url).toLowerCase())
    ).size,
    derivativeSources: candidate.evidence.filter((e) => e.originatesFromUrl).length,
    conflictCount: candidate.conflicts.length,
    entityDecision: null,
    mediaStageRan: false,
    mediaCandidateCount: candidate.mediaCandidates.length,
    mediaClearedCount: 0,
    requiresHeroMedia: context.requiresHeroMedia,
    isProductRecord: false,
  };

  try {
    // --- 1. Discovery ----------------------------------------------------
    // Was this found through a source we are actually permitted to discover
    // from? A source we may not read is not made acceptable by the fact that
    // we already read it.
    const permitted = candidate.evidence.filter((e) => e.registry?.discoveryPermitted !== false);
    if (candidate.evidence.length === 0) {
      log.record("discovery", "fail_closed", "No evidence rows at all — the candidate has no traceable origin.");
      log.reason("discovery", "no_origin", "blocker", "A discovery with no evidence row has no traceable origin and cannot be verified against anything.");
      throw new StopPipeline("discovery");
    }
    if (permitted.length === 0) {
      log.record("discovery", "fail_closed", `All ${candidate.evidence.length} source(s) are marked not permitted for discovery.`,
        candidate.evidence.map((e) => e.url));
      log.reason("discovery", "source_not_permitted", "blocker",
        "Every source behind this candidate is registered as not permitted for discovery. Permission is a property of the source, not of how useful the story looks.",
        candidate.evidence.map((e) => e.url));
      throw new StopPipeline("discovery");
    }
    log.record("discovery", "passed",
      `Origin traceable to ${permitted.length} permitted source(s) across ${signals.distinctPublishers} publisher(s); seen ${candidate.sightingCount} time(s).`,
      permitted.map((e) => e.url));

    // --- 2. Relevance ----------------------------------------------------
    const relevance = classifyRelevance({ title: candidate.title, summary: candidate.summary });
    signals.suggestedAngle = relevance.suggestedAngle;
    if (relevance.verdict === "rejected") {
      log.record("relevance", "fail_closed",
        `Not relevant to this publication (score ${relevance.score}): ${relevance.explanation}`,
        [...relevance.negativeSignals]);
      log.reason("relevance", "not_relevant", "blocker", relevance.explanation, relevance.negativeSignals);
      throw new StopPipeline("relevance");
    }
    if (relevance.verdict === "uncertain") {
      log.record("relevance", "needs_human",
        `Relevance is uncertain (score ${relevance.score}, accept threshold 5): ${relevance.explanation}`,
        [...relevance.positiveSignals, ...relevance.negativeSignals]);
      log.reason("relevance", "relevance_uncertain", "serious", relevance.explanation,
        [...relevance.positiveSignals, ...relevance.negativeSignals]);
      throw new StopPipeline("relevance");
    }
    log.record("relevance", "passed", `Relevant (score ${relevance.score}, angle "${relevance.suggestedAngle ?? "none"}").`,
      relevance.positiveSignals);

    // --- 3. Opportunity ---------------------------------------------------
    // Never fail-closed: opportunity answers "is this worth writing", which is
    // an editorial priority question, not a safety one. Recording a null score
    // as a caution keeps "no demand data" distinguishable from "no demand".
    if (context.opportunityInputs) {
      const opportunity = computeOpportunityScore(context.opportunityInputs);
      log.record("opportunity", "passed",
        opportunity.score === null
          ? `No score: ${opportunity.explanation}`
          : `Opportunity score ${opportunity.score.toFixed(1)}. ${opportunity.explanation}`,
        Object.entries(opportunity.components).map(([k, v]) => `${k}=${v}`));
      if (opportunity.score === null) {
        log.reason("opportunity", "no_demand_signal", "caution",
          "No measured demand signal for this subject, so the value of covering it is unknown rather than low.", [opportunity.explanation]);
      }
    } else {
      log.record("opportunity", "passed",
        "No demand inputs available for this subject. Recorded as unknown rather than assumed to be zero.");
      log.reason("opportunity", "no_demand_signal", "caution",
        "No demand inputs were available for this subject, so opportunity is unknown. An unknown is not a zero and must not be reported as one.");
    }

    // --- 4. Research ------------------------------------------------------
    const classifications = candidate.evidence.map((e) => ({
      evidenceId: e.id,
      url: e.url,
      classification: classifySource({
        url: e.url,
        publisher: e.publisher,
        organisation: e.organisation,
        sourceType: e.sourceType,
        trustLevel: e.trustLevel,
        originatesFromUrl: e.originatesFromUrl,
      }),
    }));
    const news = qualifiesAsNews(classifications.map((c) => c.classification));
    const uncitable = candidate.evidence.filter((e) => !isCitableUrl(e.url)).map((e) => e.url);
    log.record("research", "passed",
      `${classifications.length} source(s) classified; ${classifications.filter((c) => c.classification.independent).length} independent. ${news.reason}`,
      classifications.map((c) => `${c.url} -> ${c.classification.sourceClass}`));
    if (!news.qualifies) {
      log.reason("research", "vendor_only_sourcing", "serious", news.reason,
        classifications.map((c) => `${c.evidenceId}: ${c.classification.sourceClass}`));
    }
    if (uncitable.length) {
      log.reason("research", "uncitable_source_url", "blocker",
        `${uncitable.length} evidence URL(s) are not resolvable as citations.`, uncitable);
    }

    // --- 5. Entity resolution --------------------------------------------
    const productSignal = detectProductAnnouncement(candidate.title, candidate.summary, context.manufacturers);
    const entityName = productSignal?.productName ?? candidate.title;
    const resolution = resolveEntity(
      entityName,
      context.existingEntities.map((e) => ({ kind: e.kind, id: e.id, name: e.name }))
    );
    signals.entityDecision = resolution.decision;
    signals.isProductRecord = productSignal !== null;
    log.record("entity_resolution",
      resolution.decision === "ambiguous" ? "passed" : "passed",
      `Resolution "${resolution.decision}" for "${entityName}" (score ${resolution.score.toFixed(2)}). ${resolution.explanation}`,
      resolution.matchedName ? [`matched: ${resolution.matchedName}`] : []);
    if (resolution.decision === "ambiguous") {
      log.reason("entity_resolution", "unresolved_entity", "blocker",
        `Entity "${entityName}" is ambiguous against "${resolution.matchedName ?? "unknown"}" (score ${resolution.score.toFixed(2)}). Publishing risks a duplicate record or a successor labelled as its predecessor.`,
        [resolution.explanation]);
    }

    // --- 6. Evidence ------------------------------------------------------
    // The brief is built first because the brief IS the set of claims the
    // engine proposes to make. Extracting claims from anywhere else would be
    // checking a different article from the one that would be published.
    const briefEvidence = candidate.evidence.map((e) => ({
      url: e.url,
      publisher: e.publisher,
      claim_status: e.claimStatus,
      trust_level: e.trustLevel,
      originates_from_url: e.originatesFromUrl,
    }));
    const brief = buildBrief({
      title: candidate.title,
      summary: candidate.summary,
      discoveryType: candidate.discoveryType,
      categorySlug: candidate.categorySlug,
      claimStatus: candidate.claimStatus,
      suggestedAngle: relevance.suggestedAngle,
      sightingCount: candidate.sightingCount,
      evidence: briefEvidence,
    });
    signals.freshnessSensitivity = brief.freshnessSensitivity;

    const evidenceRecords: EvidenceRecord[] = candidate.evidence.map((e) => ({
      id: e.id,
      url: e.url,
      publisher: e.publisher,
      organisation: e.organisation,
      excerpt: e.excerpt,
      claimStatus: e.claimStatus,
      trustLevel: e.trustLevel,
      originatesFromUrl: e.originatesFromUrl,
      retrievedAt: e.retrievedAt,
      sourceType: e.sourceType,
    }));
    const allEvidenceIds = evidenceRecords.map((e) => e.id);

    const claims: Claim[] = [
      {
        id: "headline",
        text: candidate.title,
        evidenceIds: allEvidenceIds,
        statedAsFact: false,
      },
      ...brief.verifiedFacts.map((text, i) => ({
        id: `verified-${i + 1}`,
        text,
        evidenceIds: allEvidenceIds,
        statedAsFact: true,
      })),
      ...brief.uncertainties.map((text, i) => ({
        id: `uncertain-${i + 1}`,
        text,
        evidenceIds: allEvidenceIds,
        statedAsFact: false,
      })),
    ];

    const coverage = assessClaimCoverage({ claims, evidence: evidenceRecords, now: context.now });
    log.record("evidence", "passed",
      `${coverage.supportedCount} of ${coverage.claimCount} claim(s) traced to evidence (${(coverage.coverageRatio * 100).toFixed(0)}%); ${coverage.fabricatedValueCount} figure(s) attested by no source excerpt.`,
      coverage.unsupportedClaims.map((c) => `${c.claimId}: ${c.explanation}`));
    if (coverage.fabricatedValueCount > 0) {
      log.reason("evidence", "value_not_in_any_source", "blocker",
        `${coverage.fabricatedValueCount} figure(s) appear in the proposed text but in no source excerpt.`,
        coverage.claims.flatMap((c) => c.unattestedValues.map((v) => `${c.claimId}: ${v.raw}`)));
    }

    // --- 7. Brief ---------------------------------------------------------
    log.record("brief", "passed",
      `Brief built: kind "${brief.briefKind}", content type "${brief.contentType}", freshness "${brief.freshnessSensitivity}", priority ${brief.priority}. ${brief.verifiedFacts.length} verified fact(s), ${brief.uncertainties.length} uncertainty/ies.`,
      [brief.primaryQuestion, ...brief.uncertainties]);

    // --- 8. Draft / product assembly --------------------------------------
    const matchedProducts = context.existingEntities.filter(
      (e) => e.kind === "product" && titleSimilarity(e.name, entityName) >= 0.4
    );
    const relatedContent = context.existingContent
      .filter((c) => titleSimilarity(c.title, candidate.title) >= 0.3)
      .slice(0, 3)
      .map((c) => ({ title: c.title, slug: c.id }));
    const draft = assembleDraft({
      title: candidate.title,
      contentType: brief.contentType,
      categorySlug: candidate.categorySlug,
      primaryQuestion: brief.primaryQuestion,
      supportingQuestions: brief.supportingQuestions,
      verifiedFacts: brief.verifiedFacts,
      uncertainties: brief.uncertainties,
      sourceUrls: brief.sourceUrls,
      suggestedStructure: brief.suggestedStructure,
      briefKind: brief.briefKind,
      freshnessSensitivity: brief.freshnessSensitivity,
      rationale: brief.rationale,
      relatedContent,
      relatedProducts: matchedProducts.slice(0, 3).map((p) => ({ name: p.name, slug: p.slug, isPublished: p.isPublished })),
    });
    const slug = proposeSlug(candidate.title, context.takenSlugs);
    const seo = proposeSeo({ title: candidate.title, primaryQuestion: brief.primaryQuestion });

    const productShell =
      productSignal && resolution.decision !== "matched_existing"
        ? {
            name: productSignal.productName,
            slug: proposeSlug(productSignal.productName, context.takenSlugs),
            manufacturerSlug: productSignal.manufacturerSlug,
          }
        : null;

    proposal = {
      contentType: brief.contentType,
      proposedSlug: slug,
      metaTitle: seo.metaTitle,
      metaDescription: seo.metaDescription,
      wordCountEstimate: draft.wordCountEstimate,
      productShell,
    };

    const markers = findUnfinishedAssemblyMarkers(draft.body);
    log.record("assembly", "passed",
      `Assembled a ${draft.wordCountEstimate}-word draft body` +
        (productShell ? ` and an unpublished product shell proposal for "${productShell.name}"` : "") +
        `. ${markers.length} scaffolding marker(s) remain, as every engine-assembled body does — the engine writes structure and quoted evidence, never finished prose.`,
      markers);
    if (slug === "") {
      log.reason("assembly", "unusable_slug", "blocker",
        "No usable URL slug can be derived from this title, so the record has nowhere to live.", [candidate.title]);
    }

    // --- 9. Media acquisition ---------------------------------------------
    const media: MediaCandidate[] = candidate.mediaCandidates.map((m) => ({
      id: m.id,
      label: m.label,
      rightsStatus: m.rightsStatus ?? undefined,
      owned: m.owned,
      sourceType: m.sourceType,
      licence: m.licence,
      attributionText: m.attributionText,
      sourceUrl: m.sourceUrl,
      registry: m.registry,
    }));
    log.record("media_acquisition", "passed",
      media.length === 0
        ? "No media candidates were acquired for this record."
        : `${media.length} media candidate(s) acquired.`,
      media.map((m) => `${m.id}: ${m.sourceUrl ?? "no source url"}`));
    if (media.length === 0 && context.requiresHeroMedia) {
      log.reason("media_acquisition", "no_media_acquired", "blocker",
        "This record requires a hero image before publication and media acquisition produced no candidate at all.");
    }

    // --- 10. Media rights -------------------------------------------------
    const cleared: ShadowMediaCandidate[] = [];
    const provenanceBlockers: string[] = [];
    let requiresCredit = false;
    let misleadingGenerated = false;

    for (const asset of candidate.mediaCandidates) {
      const problems: string[] = [];
      const eligibility = evaluatePublishEligibility({
        rights_status: asset.rightsStatus ?? undefined,
        owned: asset.owned,
        source_type: asset.sourceType,
      });
      if (!eligibility.allowed) problems.push(eligibility.reason);

      const registry = asset.registry;
      if (registry?.mediaRepublicationPermitted === false) {
        problems.push(`${registry.organisation ?? "the source"} is not cleared for image republication — permission to read facts is never permission to republish pictures.`);
      }
      const registryRights = registry?.mediaRightsStatus;
      if (registryRights === "prohibited" || registryRights === "no_source_found") {
        problems.push(`source media rights are "${registryRights}"`);
      } else if (
        registryRights === "unclear_manual_review" ||
        registryRights === "requires_registration" ||
        registryRights === "unverified"
      ) {
        problems.push(`source media rights are "${registryRights}" — unresolved, which is not the same as permitted`);
      }
      if (registry?.attributionRequired && !asset.attributionText) {
        problems.push("the source requires attribution and no attribution text is recorded — an unmet licence condition is an unlicensed use");
      }
      if (asset.licence && requiresAttribution(asset.licence)) {
        requiresCredit = true;
        if (!asset.attributionText) problems.push(`licence "${asset.licence}" requires attribution and none is recorded`);
      }
      if (registry?.attributionRequired) requiresCredit = true;
      if (asset.generatedUnlabelled) misleadingGenerated = true;

      if (problems.length === 0) cleared.push(asset);
      else provenanceBlockers.push(`${asset.label ?? asset.id}: ${problems.join("; ")}`);
    }
    signals.mediaClearedCount = cleared.length;
    signals.mediaStageRan = true;

    // Shadow creates no page, so it cannot observe a credit rendering. This is
    // false unconditionally and on purpose — see the module header.
    const creditRenderVerified = false;
    if (requiresCredit) {
      log.reason("media_rights", "credit_render_unproven", "blocker",
        "A licence here requires a rendered credit, and SHADOW creates no page, so it cannot have observed one rendering. Data completeness is not compliance — that is the 2026-08-22 escape.",
        candidate.mediaCandidates.filter((m) => m.licence).map((m) => `${m.id}: ${m.licence}`));
    }
    log.record("media_rights", "passed",
      `${cleared.length} of ${candidate.mediaCandidates.length} asset(s) would clear the rights check.` +
        (requiresCredit ? " At least one requires a rendered credit, which shadow cannot verify." : ""),
      provenanceBlockers);

    // --- 11. SEO and internal linking -------------------------------------
    const self: LinkCandidate = {
      id: candidate.id,
      title: candidate.title,
      categoryId: candidate.categorySlug,
      type: brief.contentType,
    };
    const suggestions = suggestLinksFor(self, context.linkCandidates, new Set<string>());
    const publishedIds = new Set(context.existingEntities.filter((e) => e.isPublished).map((e) => e.id));
    // The assembler refuses to link an unpublished record; this verifies that
    // rather than trusting it.
    const brokenInternalLinks = suggestions.filter((s) => !publishedIds.has(s.toId)).map((s) => `${s.toTitle} (${s.toId})`);
    const invalidExternalLinks = brief.sourceUrls.filter((u) => !isCitableUrl(u));
    const renderable = verifyStructurallyRenderable({ body: draft.body, metaTitle: seo.metaTitle, slug });
    log.record("seo_internal_linking", "passed",
      `${suggestions.length} internal link(s) suggested, ${brokenInternalLinks.length} of which would not resolve. Meta title ${seo.metaTitle ? "present" : "missing"}, meta description ${seo.metaDescription ? "present" : "missing"}.`,
      [...suggestions.map((s) => `${s.toTitle} (${s.score.toFixed(2)}): ${s.reason}`), ...renderable.problems]);
    log.reason("seo_internal_linking", "render_verified_structurally_only", "caution",
      "Renderability was checked on the assembled artifact (body non-empty, HTML comments balanced, heading outline intact, slug valid) — not by rendering the published page, which shadow never creates.",
      renderable.problems);

    // --- 12. Freshness ----------------------------------------------------
    const evidenceAges = candidate.evidence
      .map((e) => daysBetween(e.retrievedAt, context.now))
      .filter((d): d is number => d !== null);
    const freshestAgeDays = evidenceAges.length ? Math.min(...evidenceAges) : null;
    const oldestAgeDays = evidenceAges.length ? Math.max(...evidenceAges) : null;
    log.record("freshness", "passed",
      freshestAgeDays === null
        ? `Evidence age is unknown for all ${candidate.evidence.length} source(s), so decay cannot be assessed.`
        : `Freshest evidence is ${freshestAgeDays} day(s) old against a "${brief.freshnessSensitivity}" sensitivity.`,
      candidate.evidence.map((e) => `${e.url}: retrieved ${e.retrievedAt ?? "unknown"}`));
    if (freshestAgeDays === null) {
      log.reason("freshness", "evidence_age_unknown", "serious",
        "No evidence row records when it was retrieved, so there is no way to tell whether any of this is still true.");
    }

    // --- 13. Adversarial review -------------------------------------------
    const reviewInput: ReviewInput = {
      now: context.now,
      title: candidate.title,
      body: draft.body,
      contentType: brief.contentType,
      freshnessSensitivity: brief.freshnessSensitivity,
      primaryQuery: candidate.title,
      intentFingerprint: `${brief.contentType}:${candidate.categorySlug ?? "none"}`,
      sourceHeadline: candidate.title,
      claims,
      evidence: evidenceRecords,
      media,
      existingContent: context.existingContent,
      conflicts: candidate.conflicts,
      requiresHeroMedia: context.requiresHeroMedia,
      firstPartyTestingPerformed: false,
      // The generating stages' own opinion, passed in so the reviewer can
      // report disagreement. Quarantined inside the reviewer — no check reads it.
      generator: {
        verdict: "ready",
        confidence: null,
        note: `Assembled from ${candidate.evidence.length} evidence row(s) with priority ${brief.priority}.`,
      },
    };
    review = reviewProposedPublication(reviewInput);
    log.record("adversarial_review", "passed",
      `Reviewer verdict "${review.verdict}": ${review.severityCounts.blocker} blocking, ${review.severityCounts.serious} serious, ${review.severityCounts.caution} caution. ${review.sevenDay.explanation}`,
      review.findings.map((f) => `${f.severity}/${f.code}: ${f.message}`));

    // --- 14. Publication gate ---------------------------------------------
    const nearest = context.existingContent
      .map((c) => ({ slug: c.id, similarity: titleSimilarity(candidate.title, c.title) }))
      .sort((a, b) => b.similarity - a.similarity)[0];
    const cannibalisation = findCannibalisationMatches(
      { title: candidate.title, primary_query: candidate.title, intent_fingerprint: `${brief.contentType}:${candidate.categorySlug ?? "none"}` },
      context.existingContent
    );

    const conflictReconciliations = candidate.conflicts.map((c) =>
      reconcileConflict({
        claimKey: c.claimKey,
        domain: c.domain,
        assertions: c.assertions.map((a) => ({
          sourceId: a.evidenceId,
          value: a.value,
          classification:
            classifications.find((cl) => cl.evidenceId === a.evidenceId)?.classification ??
            classifySource({ originatesFromUrl: null }),
        })),
      })
    );
    const unresolvedConflicts = conflictReconciliations.filter((r) => r.outcome === "needs_human_review");

    const gateInput: GateInput = {
      kind: productShell ? "product" : "article",
      identifier: slug || candidate.id,
      evidence: {
        totalClaims: coverage.claimCount,
        supportedClaims: coverage.supportedCount,
        unsupportedClaims: coverage.unsupportedClaims.map((c) => c.text),
        unsupportedHighRisk: coverage.highRiskUnsupported.map((c) => c.text),
        brokenCitations: invalidExternalLinks,
        mismatches: coverage.claims
          .filter((c) => c.supportingEvidenceIds.length > 0 && c.unattestedValues.length > 0)
          .map((c) => `${c.claimId}: ${c.unattestedValues.map((v) => v.raw).join(", ")} appear in no cited excerpt`),
      },
      sources: {
        total: candidate.evidence.length,
        distinctPublishers: signals.distinctPublishers,
        primaryCount: candidate.evidence.filter((e) => e.trustLevel === "primary" && !e.originatesFromUrl).length,
        independentCount: classifications.filter((c) => c.classification.independent).length,
        isVendorPressRelease:
          classifications.length > 0 &&
          classifications.every((c) => c.classification.sourceClass === "vendor_press_release"),
        oldestEvidenceDays: oldestAgeDays,
      },
      freshness: {
        sensitivity: brief.freshnessSensitivity,
        evidenceAgeDays: freshestAgeDays,
      },
      entity: {
        decision: resolution.decision,
        matchedName: resolution.matchedName,
      },
      duplication: {
        nearestSimilarity: nearest?.similarity ?? 0,
        nearestSlug: nearest?.slug ?? null,
        cannibalisesSlug: cannibalisation.find((m) => m.reason !== "very similar title")?.id ?? null,
      },
      media: {
        hasHero: cleared.length > 0,
        provenanceBlockers,
        requiresCredit,
        creditRenderVerified,
        misleadingGenerated,
      },
      technical: {
        brokenInternalLinks,
        invalidExternalLinks,
        hasSeoTitle: seo.metaTitle.trim().length > 0,
        hasSeoDescription: (seo.metaDescription ?? "").trim().length > 0,
        // Structured data is only valid when it is backed by real data: a
        // headline, a resolvable URL and a known content type. Nothing here
        // fabricates a rating, a price or an author.
        structuredDataValid: seo.metaTitle.trim().length > 0 && slug !== "" && brief.contentType.length > 0,
        emptySections: findEmptySections(draft.body),
        placeholderMarkers: markers,
        buildRenderOk: renderable.ok,
      },
    };
    gate = evaluatePublicationGate(gateInput);
    log.record("publication_gate",
      gate.publishable ? "passed" : "fail_closed",
      gate.summary,
      gate.blockers.map((b) => `${b.code}: ${b.message}`));

    for (const r of unresolvedConflicts) {
      log.reason("publication_gate", "unresolved_source_conflict", "blocker", r.explanation, r.distinctValues);
    }

    // --- 15. Final decision ----------------------------------------------
    log.record("final_decision", "passed",
      "All stages ran. Outcome recorded; nothing published — SHADOW has no publishing call to make.");
  } catch (e) {
    if (e instanceof StopPipeline) {
      // A stage decided. Not an error.
    } else {
      const stage = firstUnrecordedStage(log);
      crashed = { stage, error: e instanceof Error ? `${e.name}: ${e.message}` : String(e) };
      log.record(stage, "error", crashed.error);
      gate = null;
      review = undefined;
    }
  }

  const decision = decideShadowOutcome({
    stages: log.all(),
    gate: gate ?? undefined,
    review,
    earlyReasons: log.reasons,
  });

  dimensions = classifyDimensions(signals);

  const decidedAt = context.now;
  return {
    identity: shadowCandidateIdentity({ kind: candidate.kind, key: candidate.dedupeKey || candidate.id }),
    candidateId: candidate.id,
    candidateKind: candidate.kind,
    title: candidate.title,
    publisher: primaryPublisher,
    decidedAt,
    day: decidedAt.slice(0, 10),
    decision,
    dimensions,
    gate,
    proposal: decision.kind === "failure" ? null : proposal,
  };
}

/** The first stage with no record yet — where an unexpected throw came from. */
function firstUnrecordedStage(log: StageLog): ShadowStage {
  const records = log.all();
  const pending = records.find((r) => r.status === "not_reached");
  return pending?.stage ?? "final_decision";
}
