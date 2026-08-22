// Media provider contracts — the shared shape every source plugs into.
//
// THE BOUNDARY THIS FILE EXISTS TO MAKE STRUCTURAL
// ------------------------------------------------
// **Finding an image is not permission to publish it.** That sentence has been
// written in three documents in this project and violated by tooling anyway,
// because nothing in the type system stopped a downloader from filling in a
// licence field it had inferred from a search-result badge.
//
// So discovery and rights verification are DIFFERENT TYPES here, produced by
// DIFFERENT STAGES, and the compiler will not let one stand in for the other:
//
//   DiscoveredCandidate   what a search returned. Carries NO rights fields at
//                         all — not even an optimistic one. A provider that
//                         wanted to assert a licence at discovery time has
//                         nowhere to put it.
//   ProvenanceRecord      what resolving the item's own source page produced:
//                         primary evidence, fetched from the authority, with
//                         each piece labelled by where it came from.
//   RightsAssessment      what a deterministic evaluation of that evidence
//                         concluded. Still not permission — see below.
//
// "APPROVED PROVIDER" MEANS THE ENGINE MAY SEARCH IT
// ---------------------------------------------------
// It never means assets from it are approved. Wikimedia Commons is approved
// for search and roughly one in four of its candidates fails verification
// here. The approval is on the *act of searching*, not on the *output*.
//
// WHAT THE ENGINE MAY NEVER WRITE
// -------------------------------
// `media_assets.rights_status = 'verified'` clears `evaluatePublishEligibility`
// and is therefore a publication permission. No code path in this directory
// produces it. The engine writes ENGINE_MAX_RIGHTS_STATUS ('pending_verification')
// at best, and a human moves it further. See rights-verification.ts.

import type { RightsClass } from "../provenance.ts";

/**
 * The strongest `media_assets.rights_status` any autonomous code path may
 * write. Deliberately a constant rather than a comment: a future edit that
 * tries to widen it has to change a value that tests assert on.
 */
export const ENGINE_MAX_RIGHTS_STATUS = "pending_verification" as const;

// ---------------------------------------------------------------------------
// Provider identity and approval
// ---------------------------------------------------------------------------

export type ProviderId =
  | "wikimedia_commons"
  /** Present so the registry is demonstrably not Commons-shaped. Not enabled. */
  | "openverse"
  | "pexels"
  | "unsplash"
  | "flickr";

/**
 * Why a provider is or is not searchable, recorded as data.
 *
 * `approvedForSearch` gates only whether the engine may issue requests. Every
 * candidate it returns still traverses the full pipeline.
 */
export type ProviderApproval = {
  id: ProviderId;
  label: string;
  /** May the engine issue search requests to this provider at all? */
  approvedForSearch: boolean;
  /**
   * Does this provider expose PER-ASSET primary evidence (the actual licence
   * declaration made by the uploader, the creator, the source page)?
   *
   * A provider that only hands back a rendered licence badge cannot support
   * rights verification, whatever its badge says — the Openverse finding in
   * docs/product-media-strategy.md §6. Such a provider may still be approved
   * for DISCOVERY, with every candidate capped at rights_uncertain.
   */
  exposesPrimaryEvidence: boolean;
  /** Minimum spacing between requests, ms. */
  requestSpacingMs: number;
  /** Terms of service / reuse policy consulted. */
  termsUrl: string | null;
  /** Free text: what was actually established about this provider, and when. */
  rationale: string;
};

// ---------------------------------------------------------------------------
// Stage 1: discovery
// ---------------------------------------------------------------------------

/** How a query was constructed — recorded so a miss can be diagnosed. */
export type QueryStrategy =
  /** Enumerate a curated category in full. The method that works on Commons. */
  | "category_enumeration"
  /** Free-text file search. Known to surface photos TAKEN WITH a camera. */
  | "text_search"
  /** Search the wikitext body rather than the title. */
  | "insource_search"
  /** Title-restricted search. */
  | "intitle_search"
  /** Find the category itself, before enumerating it. */
  | "category_lookup";

export type ProviderQuery = {
  strategy: QueryStrategy;
  /** The literal string sent to the provider. */
  value: string;
  /** Why this query was generated from the subject identity. */
  rationale: string;
  /**
   * Identity tokens this query is required to preserve. An expansion that
   * drops one of these is a different product and is rejected before it is
   * ever sent. See query-expansion.ts.
   */
  identityTokens: string[];
};

/**
 * A raw search hit. Deliberately rights-free.
 *
 * There is no `license`, no `creator`, no `rightsStatus` field. A provider
 * that "saw a licence" in its search response has nowhere to record it at this
 * stage and must resolve the item's own source page to say anything about
 * rights. That is the hard boundary expressed as a type.
 */
export type DiscoveredCandidate = {
  provider: ProviderId;
  /** Provider-native identifier, e.g. "File:GoPro Héro 13 Black - 01.jpg". */
  providerRef: string;
  /** Human-readable title as the provider presents it. */
  title: string;
  /** Which query found it, for diagnosis of both hits and misses. */
  foundBy: ProviderQuery;
  /** Free-text descriptors available at search time, used ONLY for entity matching. */
  descriptors: string[];
};

// ---------------------------------------------------------------------------
// Stage 2: provenance resolution
// ---------------------------------------------------------------------------

/**
 * One piece of primary evidence, with its origin.
 *
 * `origin` is the point: "the licence template in the raw wikitext" and "the
 * licence name in a search API's summary field" are not the same claim, and
 * collapsing them is how a badge becomes a permission.
 */
export type EvidenceItem = {
  kind:
    | "licence_template"
    | "licence_metadata"
    | "author_field"
    | "source_field"
    | "permission_field"
    | "exif_artist"
    | "exif_copyright"
    | "restriction_field"
    | "file_dimensions"
    | "mime_type"
    | "content_hash"
    | "category_membership";
  /** What was found, verbatim where practical. */
  detail: string;
  /** Where it was read from — an API endpoint, a raw wikitext fetch, EXIF. */
  origin: string;
};

/**
 * Everything resolving a candidate's own source page produced.
 *
 * Every field is nullable because a real fetch genuinely fails to establish
 * things, and a null here becomes a blocker downstream. Nothing is defaulted
 * to a permissive value.
 */
export type ProvenanceRecord = {
  provider: ProviderId;
  providerRef: string;

  /** Direct URL to the original, unmodified file. */
  originalFileUrl: string | null;
  /** URL of the human-readable page carrying the licence declaration. */
  sourcePageUrl: string | null;
  /** The file's own name at source, before any local renaming. */
  originalFileName: string | null;

  /** Named creator. Absent creator + attribution licence = fail closed. */
  creator: string | null;
  /** Where the creator claim can be checked, e.g. a user page. */
  creatorPageUrl: string | null;

  /** Licence as the source page's own template/tag declares it. */
  licenceDeclared: string | null;
  /** Licence as the provider's structured metadata reports it. */
  licenceMetadata: string | null;
  /** Canonical deed URL, resolved from the licence string we recognise. */
  licenceUrl: string | null;

  attributionRequired: boolean | null;
  /** Credit line to render, where the source determines one. */
  attributionText: string | null;

  /** When the bytes/metadata were fetched. */
  acquiredAt: string;
  /** When rights evaluation ran over this evidence. */
  verifiedAt: string | null;

  width: number | null;
  height: number | null;
  mimeType: string | null;
  byteSize: number | null;
  /** SHA-256 of the retrieved bytes, where the bytes were retrieved. */
  contentHash: string | null;

  /** Every primary-evidence item read, with its origin. */
  evidence: EvidenceItem[];

  /**
   * Assertions found at source that CONTRADICT the declared licence — an EXIF
   * "all rights reserved", a non-empty permission field, a restriction tag.
   * Any entry here is a hard block.
   */
  conflicts: string[];
};

// ---------------------------------------------------------------------------
// Stage 3: rights assessment (see rights-verification.ts)
// ---------------------------------------------------------------------------

export type RightsFinding = {
  severity: "blocker" | "warning";
  code: string;
  message: string;
};

export type RightsAssessment = {
  /**
   * What the EVIDENCE supports. Not a permission — the difference matters
   * enough to keep the vocabulary separate from the DB's rights_status.
   */
  evidenceClass:
    /** Every required piece of primary evidence present and mutually consistent. */
    | "evidence_complete"
    /** Something required is missing. */
    | "evidence_incomplete"
    /** Two sources of evidence disagree. Worse than missing. */
    | "evidence_conflicting"
    /** Positively established as not reusable. */
    | "restricted";
  /** Mapped onto the project's existing vocabulary. */
  rightsClass: RightsClass;
  /**
   * The DB value the engine is permitted to write for this asset. Never
   * 'verified'. Null means "do not create a row at all".
   */
  writableRightsStatus: typeof ENGINE_MAX_RIGHTS_STATUS | "unknown" | "restricted" | null;
  /** May the engine download and archive the bytes? */
  mayAcquire: boolean;
  /** Always false from this module. Publication is a human act. */
  mayPublish: false;
  findings: RightsFinding[];
  /** One-paragraph account of what was established and what was not. */
  narrative: string;
};

// ---------------------------------------------------------------------------
// Provider interface
// ---------------------------------------------------------------------------

/**
 * How a provider call ended. `outage` and `malformed` are distinct from
 * `no_results` on purpose: the 2026-08 lesson in CLAUDE.md is that a failure
 * that looks identical to an empty result hides for weeks.
 */
export type ProviderOutcome =
  | { status: "ok" }
  | { status: "no_results" }
  | { status: "rate_limited"; detail: string }
  | { status: "outage"; detail: string }
  | { status: "malformed"; detail: string }
  | { status: "not_found"; detail: string };

export type SearchResult = {
  outcome: ProviderOutcome;
  candidates: DiscoveredCandidate[];
  /** Every query actually issued, in order, with what it returned. */
  queryLog: { query: ProviderQuery; hits: number; note: string }[];
};

export type ResolveResult =
  | { outcome: { status: "ok" }; provenance: ProvenanceRecord }
  | { outcome: Exclude<ProviderOutcome, { status: "ok" }>; provenance: null };

/**
 * The contract every source implements. Two methods, in pipeline order.
 *
 * Note what is absent: there is no `download()` on the provider. Acquisition
 * happens in the pipeline, after verification, and only for candidates that
 * cleared it — a provider cannot fetch bytes on its own initiative.
 */
export type MediaProvider = {
  approval: ProviderApproval;
  /** Stage 1. Returns rights-free hits. */
  search(queries: ProviderQuery[], limits: { maxCandidates: number }): Promise<SearchResult>;
  /** Stage 2. Resolves ONE candidate's own source page into primary evidence. */
  resolve(candidate: DiscoveredCandidate): Promise<ResolveResult>;
};
