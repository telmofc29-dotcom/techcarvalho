// Mapping between raw engine rows and the shadow pipeline's inputs.
//
// Pure on purpose, and separate from the job on purpose. The cron path
// (jobs/shadow-job.ts, `anon` + SECURITY DEFINER RPCs) and the operator script
// (scripts/run-shadow-evaluation.ts, an authenticated admin reading tables
// directly) reach the same rows by different routes. If each did its own
// mapping, the production run would be exercising different code from the one
// the cron will eventually run, and the evidence gathered would be evidence
// about the script rather than about the engine.
//
// Deterministic. No I/O, no clock, no `server-only`.

import type { ClaimStatus, TrustLevel, EngineSourceType } from "./types.ts";
import type { MediaRightsStatus as DbMediaRightsStatus, MediaSourceType } from "@/lib/types/database";
import { extractClaimValues } from "./claim-coverage.ts";
import type { ClaimConflict } from "./reviewer.ts";
import type { ClaimDomain } from "./source-quality.ts";
import type { LinkCandidate } from "./link-suggestions.ts";
import type { ContentSignal } from "../admin/cannibalisation.ts";
import type { ShadowCandidate, ShadowContext, ShadowEvidence, ShadowMediaCandidate, ShadowRecord } from "./shadow-pipeline.ts";

// ---------------------------------------------------------------------------
// Raw row shapes, as the RPCs return them
// ---------------------------------------------------------------------------

export type RawCandidateRow = {
  id: string;
  dedupe_key: string | null;
  title: string;
  summary: string | null;
  discovery_type: string;
  category_slug: string | null;
  claim_status: string;
  state: string;
  sighting_count: number | null;
  first_seen_at: string;
  relevance_overridden_by_admin: boolean | null;
  product_id: string | null;
  content_id: string | null;
};

export type RawEvidenceRow = {
  id: string;
  url: string;
  publisher: string | null;
  organisation: string | null;
  excerpt: string | null;
  claim_status: string;
  trust_level: string;
  originates_from_url: string | null;
  retrieved_at: string | null;
  source_type: string | null;
  discovery_permitted: boolean | null;
  media_republication_permitted: boolean | null;
  media_rights_status: string | null;
  attribution_required: boolean | null;
  editorial_use_only: boolean | null;
  registration_required: boolean | null;
};

export type RawMediaRow = {
  id: string;
  source_organisation: string | null;
  source_url: string | null;
  asset_url: string | null;
  asset_type: string | null;
  potential_licence: string | null;
  attribution_required: boolean | null;
  attribution_text: string | null;
  rights_status: string | null;
  requires_human_review: boolean | null;
  state: string | null;
  registry_media_republication_permitted: boolean | null;
  registry_media_rights_status: string | null;
  registry_attribution_required: boolean | null;
  registry_editorial_use_only: boolean | null;
  registry_registration_required: boolean | null;
  registry_organisation: string | null;
};

export type RawContentSignalRow = {
  id: string;
  title: string;
  slug: string;
  primary_query: string | null;
  intent_fingerprint: string | null;
  content_type: string | null;
  category_id: string | null;
};

export type RawEntityRow = {
  kind: string;
  id: string;
  name: string;
  slug: string;
  is_published: boolean | null;
};

export type RawManufacturerRow = { kind: string; id: string; name: string; slug: string };

/** A row of the source registry, for the host fallback below. */
export type RawSourceRow = {
  id: string;
  url: string;
  organisation: string | null;
  source_type: string | null;
  discovery_permitted: boolean | null;
  media_republication_permitted: boolean | null;
  media_rights_status: string | null;
  attribution_required: boolean | null;
  editorial_use_only: boolean | null;
  registration_required: boolean | null;
};

// ---------------------------------------------------------------------------
// Provenance recovery
// ---------------------------------------------------------------------------

/** Registrable host, lower-cased, `www.` stripped. Null when unparseable. */
export function hostOf(url: string | null | undefined): string | null {
  if (!url) return null;
  try {
    return new URL(url).hostname.replace(/^www\./, "").toLowerCase();
  } catch {
    return null;
  }
}

export type SourceIndex = Map<string, RawSourceRow>;

/**
 * Index the source registry by host.
 *
 * WHY THIS IS NEEDED, AND WHY IT IS NOT A BYPASS
 * ----------------------------------------------
 * `engine_upsert_discovery` inserts every evidence row with `source_id` NULL —
 * its signature has no p_source_id parameter at all, even though the discovery
 * job is iterating over `engine_due_sources` and therefore knows exactly which
 * source it polled. As of 2026-08-22 that is 118 of 118 evidence rows in
 * production with no link back to the registry that authorised them.
 *
 * So the foreign key is missing, but the FACT is not: the registry stores each
 * source's URL, and an article URL sharing that host came from that source.
 * Resolving by host is a join on a different key, not an assumption — and it
 * fails closed exactly where it should. A host with no registry row stays
 * unknown, and an unknown source is not a permitted one.
 *
 * When the FK is repaired this fallback simply stops being reached, because the
 * joined registry values arrive populated.
 *
 * EXACT HOST ONLY, and not subdomain-suffix matching. That is a deliberate
 * false-negative: in the 2026-08-22 production run it left 5 of 118 candidates
 * unresolved (4 on `science.nasa.gov` against a registry row for `nasa.gov`,
 * 1 on `displayport.org` against a row for `vesa.org`) and they were rejected
 * at the discovery stage. Suffix matching would fix those and simultaneously
 * make any tenant of a shared press-release host — `mynewsdesk.com` is already
 * in this registry — inherit the permissions of whichever company registered
 * first. Widening a permission rule to recover four rows is the wrong trade;
 * the right fix is the missing source_id, and after that neither case arises.
 */
export function buildSourceIndex(sources: readonly RawSourceRow[]): SourceIndex {
  const index: SourceIndex = new Map();
  for (const source of sources) {
    const host = hostOf(source.url);
    if (!host) continue;
    const existing = index.get(host);
    // Where two registry rows share a host, the more restrictive one wins.
    // Permission is the thing being decided; taking the permissive row would
    // make a duplicate registry entry into a way to grant access.
    if (
      !existing ||
      (existing.discovery_permitted === true && source.discovery_permitted !== true) ||
      (existing.media_republication_permitted === true && source.media_republication_permitted !== true)
    ) {
      index.set(host, source);
    }
  }
  return index;
}

// ---------------------------------------------------------------------------
// Narrowing
// ---------------------------------------------------------------------------

const CLAIM_STATUSES = new Set<string>([
  "rumour", "leak", "estimate", "unverified", "reported_secondary", "confirmed_primary",
]);
const TRUST_LEVELS = new Set<string>(["primary", "secondary", "community"]);
const SOURCE_TYPES = new Set<string>([
  "manufacturer_newsroom", "product_feed", "rss_atom", "official_docs",
  "public_api", "regulatory_dataset", "trusted_editorial", "other_approved",
]);
const DB_RIGHTS_STATUSES = new Set<string>(["unknown", "pending_verification", "verified", "restricted"]);

/**
 * An unrecognised claim status becomes 'unverified', never the value it looked
 * closest to. Guessing upwards here would upgrade a rumour into a report.
 */
function toClaimStatus(value: string | null | undefined): ClaimStatus {
  return value && CLAIM_STATUSES.has(value) ? (value as ClaimStatus) : "unverified";
}

/** Unknown trust becomes 'community' — the weakest, never the strongest. */
function toTrustLevel(value: string | null | undefined): TrustLevel {
  return value && TRUST_LEVELS.has(value) ? (value as TrustLevel) : "community";
}

function toSourceType(value: string | null | undefined): EngineSourceType | null {
  return value && SOURCE_TYPES.has(value) ? (value as EngineSourceType) : null;
}

/**
 * An engine media candidate's rights status mapped onto the media_assets
 * vocabulary that `evaluatePublishEligibility` speaks.
 *
 * Only 'confirmed_usable' maps to 'verified'. 'prohibited' maps to
 * 'restricted', which always blocks. Everything else — including
 * 'requires_registration' and 'unclear_manual_review' — maps to 'unknown',
 * because unresolved is not the same as permitted and must not be rounded up
 * to it.
 */
export function toDbRightsStatus(value: string | null | undefined): DbMediaRightsStatus {
  if (!value) return "unknown";
  if (DB_RIGHTS_STATUSES.has(value)) return value as DbMediaRightsStatus;
  switch (value) {
    case "confirmed_usable":
      return "verified";
    case "prohibited":
    case "no_source_found":
      return "restricted";
    default:
      return "unknown";
  }
}

/**
 * The engine records where an image came from as an organisation, not as a
 * media_assets source_type. Anything acquired from a third-party newsroom is
 * treated as 'manufacturer' imagery — the category the reviewer treats with the
 * most suspicion — rather than as something more permissive.
 */
function toMediaSourceType(row: RawMediaRow): MediaSourceType | null {
  if (row.registry_organisation || row.source_organisation) return "manufacturer";
  return null;
}

// ---------------------------------------------------------------------------
// Source conflicts
// ---------------------------------------------------------------------------

const KIND_TO_DOMAIN: Record<string, ClaimDomain> = {
  money: "vendor_own_price",
  date: "vendor_own_release_date",
  measurement: "vendor_own_specification",
  percent: "independent_performance",
};

/**
 * Genuine disagreements between sources, detected from their excerpts.
 *
 * Two sources asserting different canonical values of the same KIND (a price, a
 * date, a measurement) is the detectable form of "the sources disagree". It is
 * conservative in one important direction: with no excerpts recorded, it finds
 * nothing, and reports nothing rather than inventing agreement. That is not the
 * same as there being no disagreement, and the sparse-source dimension is what
 * makes the difference visible.
 */
export function detectSourceConflicts(evidence: readonly ShadowEvidence[]): ClaimConflict[] {
  const byKind = new Map<string, Map<string, { evidenceId: string; value: string }>>();

  for (const e of evidence) {
    if (!e.excerpt) continue;
    for (const value of extractClaimValues(e.excerpt)) {
      const bucket = byKind.get(value.kind) ?? new Map();
      // One assertion per source per kind: a source repeating the same figure
      // twice is not two sources.
      if (!bucket.has(e.id)) bucket.set(e.id, { evidenceId: e.id, value: value.canonical });
      byKind.set(value.kind, bucket);
    }
  }

  const conflicts: ClaimConflict[] = [];
  for (const [kind, bucket] of byKind) {
    const assertions = [...bucket.values()];
    const distinct = new Set(assertions.map((a) => a.value));
    if (assertions.length >= 2 && distinct.size >= 2) {
      conflicts.push({
        claimKey: `${kind} value asserted by sources`,
        domain: KIND_TO_DOMAIN[kind] ?? "independent_significance",
        assertions,
      });
    }
  }
  return conflicts;
}

// ---------------------------------------------------------------------------
// Builders
// ---------------------------------------------------------------------------

export function buildShadowCandidate(
  row: RawCandidateRow,
  evidenceRows: readonly RawEvidenceRow[],
  mediaRows: readonly RawMediaRow[],
  /** Host-keyed registry, used only where the source FK is missing. */
  sourceIndex: SourceIndex = new Map()
): ShadowCandidate {
  const evidence: ShadowEvidence[] = evidenceRows.map((e) => {
    // Prefer the joined registry. Fall back to the host index only when the
    // join produced nothing at all — see buildSourceIndex for why that happens
    // and why resolving by host is a join rather than an assumption.
    const joined = e.discovery_permitted !== null || e.media_rights_status !== null;
    const fallback = joined ? undefined : sourceIndex.get(hostOf(e.url) ?? "");
    return {
      id: e.id,
      url: e.url,
      publisher: e.publisher,
      organisation: e.organisation ?? fallback?.organisation ?? null,
      excerpt: e.excerpt,
      claimStatus: toClaimStatus(e.claim_status),
      trustLevel: toTrustLevel(e.trust_level),
      originatesFromUrl: e.originates_from_url,
      retrievedAt: e.retrieved_at,
      sourceType: toSourceType(e.source_type ?? fallback?.source_type),
      registry: {
        // No registry row, joined or resolved, means the source is unknown —
        // and an unknown source is not a permitted one. Defaulting any of these
        // to true would let an unregistered feed become a discovery route by
        // omission.
        discoveryPermitted: (e.discovery_permitted ?? fallback?.discovery_permitted) === true,
        mediaRepublicationPermitted:
          (e.media_republication_permitted ?? fallback?.media_republication_permitted) === true,
        mediaRightsStatus: e.media_rights_status ?? fallback?.media_rights_status ?? null,
        attributionRequired: (e.attribution_required ?? fallback?.attribution_required) === true,
        editorialUseOnly: (e.editorial_use_only ?? fallback?.editorial_use_only) === true,
        registrationRequired: (e.registration_required ?? fallback?.registration_required) === true,
        organisation: e.organisation ?? fallback?.organisation ?? null,
      },
    };
  });

  const mediaCandidates: ShadowMediaCandidate[] = mediaRows.map((m) => ({
    id: m.id,
    label: m.asset_url ?? m.source_url,
    rightsStatus: toDbRightsStatus(m.rights_status),
    // The engine never acquires anything TechCarvalho owns; ownership is a
    // human fact recorded against a media_assets row, not something an
    // acquisition candidate can assert about itself.
    owned: false,
    sourceType: toMediaSourceType(m),
    licence: m.potential_licence,
    attributionText: m.attribution_text,
    sourceUrl: m.source_url,
    generatedUnlabelled: false,
    registry: {
      organisation: m.registry_organisation ?? m.source_organisation,
      mediaRepublicationPermitted: m.registry_media_republication_permitted === true,
      mediaRightsStatus: (m.registry_media_rights_status ?? "unverified") as never,
      editorialUseOnly: m.registry_editorial_use_only === true,
      attributionRequired: m.registry_attribution_required === true || m.attribution_required === true,
      registrationRequired: m.registry_registration_required === true,
    },
  }));

  return {
    kind: "discovery",
    id: row.id,
    dedupeKey: row.dedupe_key ?? row.id,
    title: row.title,
    summary: row.summary,
    discoveryType: row.discovery_type,
    categorySlug: row.category_slug,
    claimStatus: toClaimStatus(row.claim_status),
    state: row.state,
    sightingCount: row.sighting_count ?? 0,
    firstSeenAt: row.first_seen_at,
    relevanceOverriddenByAdmin: row.relevance_overridden_by_admin === true,
    evidence,
    mediaCandidates,
    conflicts: detectSourceConflicts(evidence),
  };
}

export function buildShadowContext(input: {
  now: string;
  contentSignals: readonly RawContentSignalRow[];
  entities: readonly RawEntityRow[];
  reference: readonly RawManufacturerRow[];
}): ShadowContext {
  const existingContent: ContentSignal[] = input.contentSignals.map((c) => ({
    id: c.id,
    title: c.title,
    primary_query: c.primary_query,
    intent_fingerprint: c.intent_fingerprint,
  }));

  const existingEntities = input.entities
    .filter((e): e is RawEntityRow & { kind: "product" | "content" } => e.kind === "product" || e.kind === "content")
    .map((e) => ({
      kind: e.kind,
      id: e.id,
      name: e.name,
      slug: e.slug,
      isPublished: e.is_published === true,
    }));

  const linkCandidates: LinkCandidate[] = input.contentSignals.map((c) => ({
    id: c.id,
    title: c.title,
    categoryId: c.category_id,
    type: c.content_type ?? "guide",
  }));

  return {
    now: input.now,
    existingContent,
    existingEntities,
    linkCandidates,
    takenSlugs: new Set(input.entities.map((e) => e.slug).filter(Boolean)),
    manufacturers: input.reference.filter((r) => r.kind === "manufacturer").map((r) => ({ slug: r.slug, name: r.name })),
    // Not available through the shadow read path: opportunity inputs are
    // per-subject analytics aggregates and the shadow runner evaluates whole
    // discoveries. Null means UNKNOWN and is recorded as such — never as zero
    // demand, which would be a fabricated measurement.
    opportunityInputs: null,
    // The standing media-first rule: no public record ships without a hero
    // image, so every candidate is evaluated as though it needs one.
    requiresHeroMedia: true,
  };
}

// ---------------------------------------------------------------------------
// Serialisation for the write RPC
// ---------------------------------------------------------------------------

export type ShadowDecisionPayload = {
  p_candidate_identity: string;
  p_candidate_kind: string;
  p_discovery_id: string | null;
  p_title: string;
  p_publisher: string | null;
  p_record_kind: string;
  p_outcome: string | null;
  p_terminal_stage: string;
  p_reached_gate: boolean;
  p_stages: unknown;
  p_gate: unknown;
  p_proposal: unknown;
  p_failed_stage: string | null;
  p_failure_error: string | null;
  p_explanation: string;
  p_dimensions: string[];
  p_reasons: unknown;
};

export function serialiseDecision(record: ShadowRecord): ShadowDecisionPayload {
  const d = record.decision;
  return {
    p_candidate_identity: record.identity,
    p_candidate_kind: record.candidateKind,
    p_discovery_id: record.candidateKind === "discovery" ? record.candidateId : null,
    p_title: record.title,
    p_publisher: record.publisher,
    p_record_kind: d.kind,
    p_outcome: d.outcome,
    p_terminal_stage: d.terminalStage,
    p_reached_gate: d.reachedGate,
    p_stages: d.stages,
    p_gate: record.gate,
    p_proposal: record.proposal,
    p_failed_stage: d.failedStage,
    p_failure_error: d.failureError,
    p_explanation: d.explanation,
    p_dimensions: record.dimensions,
    p_reasons: d.reasons,
  };
}
