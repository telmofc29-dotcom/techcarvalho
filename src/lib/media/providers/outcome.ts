// The outcome taxonomy: what a media search ACTUALLY ended in.
//
// WHY THIS FILE EXISTS
// --------------------
// `informationField()` in wikimedia-commons.ts once mis-parsed `|other versions=`
// as the value of `permission=`. Every file in `Category:GoPro Hero 13 black`
// was therefore refused as `rights_conflicting`, and the run summary read:
//
//     "candidates were found and every one was rejected"
//
// which is EXACTLY what a genuinely unusable set of candidates reports. The bug
// failed closed, so nothing broke loudly; it was invisible for as long as
// nobody read the per-candidate reasons. Four correctly-licensed CC BY-SA 4.0
// photographs were refused by a regex.
//
// The lesson is not "fix that regex". It is that A SEARCH MUST DESCRIBE ITS OWN
// OUTCOME PRECISELY ENOUGH THAT A BROKEN READER CANNOT IMPERSONATE AN EMPTY
// SHELF. This module is that description: seven states, every terminal path in
// the pipeline mapped onto exactly one of them, and — the load-bearing part —
// NO_RESULTS is never a fallback. It has to be earned.
//
// THE ONE-WAY DOOR
// ----------------
// If this code cannot prove which state applies, the answer is
// PROVIDER_PARSE_FAILURE. Not NO_RESULTS, not "no acceptable candidate".
// Uncertainty about our own reading of a response is a defect in us, and the
// honest report of a defect in us is a report that someone will investigate,
// which is the only property that would have surfaced the original bug.
//
// Pure. No network, no database.

import type { CandidateEvaluation, RejectionCode } from "./pipeline.ts";
import type { ParseAnomaly, ProviderApproval, ProviderAttestation, ProviderOutcome } from "./types.ts";

// ---------------------------------------------------------------------------
// The taxonomy
// ---------------------------------------------------------------------------

export const SEARCH_OUTCOME_STATES = [
  "NO_RESULTS",
  "WRONG_ENTITY_RESULTS",
  "RIGHTS_UNCERTAIN",
  "PROVENANCE_INCOMPLETE",
  "PROVIDER_PARSE_FAILURE",
  "PROVIDER_OUTAGE",
  "USABLE_CANDIDATE_FOUND",
] as const;

export type SearchOutcomeState = (typeof SEARCH_OUTCOME_STATES)[number];

/**
 * What each state asserts. Written as data because these sentences are the
 * contract — a state means this and nothing looser.
 */
export const OUTCOME_MEANINGS: Record<SearchOutcomeState, string> = {
  NO_RESULTS:
    "The provider was reached, its answer was understood, and it genuinely has nothing. Positively established: " +
    "responses were parsed, zero candidates came back, and no reader reported an implausible result. Blocked on " +
    "photography, not on permission — worth a scheduled recheck.",
  WRONG_ENTITY_RESULTS:
    "Candidates were found and not one of them is the exact subject: a sibling model, a bare PCB, a video frame, a " +
    "3D mesh, a logo, or a generated depiction. The search worked; the material is not a photograph of this product.",
  RIGHTS_UNCERTAIN:
    "The right subject was found and its rights could not be established — no licence readable from the source's own " +
    "markup, two licence reads that disagree, a restriction, or a re-asserted third-party licence. Uncertainty is not " +
    "permission.",
  PROVENANCE_INCOMPLETE:
    "Rights looked adequate but a required provenance field is missing or unresolvable — no named creator under an " +
    "attribution licence, no source page, no original file URL. An unavailable check is a stop, never a skip.",
  PROVIDER_PARSE_FAILURE:
    "We got a response we could not parse, or parsed into something implausible. THIS IS A DEFECT IN US, not a " +
    "finding about the world, and it must never be reported as an empty shelf.",
  PROVIDER_OUTAGE:
    "The provider could not be reached, or returned a non-answer (rate limit, 5xx, network error), or no approved " +
    "provider was available at all. THE SEARCH DID NOT HAPPEN.",
  USABLE_CANDIDATE_FOUND:
    "At least one candidate cleared every automated check. Still not permission to publish: the row this produces " +
    "carries rights_status='pending_verification' and the publication gate refuses it until a human verifies at source.",
};

/** Terse label for a summary table. */
export const OUTCOME_HEADLINES: Record<SearchOutcomeState, string> = {
  NO_RESULTS: "provider answered, nothing exists",
  WRONG_ENTITY_RESULTS: "found things, none is this product",
  RIGHTS_UNCERTAIN: "right product, rights not establishable",
  PROVENANCE_INCOMPLETE: "rights ok, provenance fields missing",
  PROVIDER_PARSE_FAILURE: "WE COULD NOT READ THE ANSWER — investigate",
  PROVIDER_OUTAGE: "the search did not happen",
  USABLE_CANDIDATE_FOUND: "candidate cleared every automated check",
};

/**
 * Which states mean "the engine is broken or blind", as opposed to "the world
 * is like this". A run containing any of these is not a finding about the
 * catalogue and must not be filed as one.
 */
export function isEngineFault(state: SearchOutcomeState): boolean {
  return state === "PROVIDER_PARSE_FAILURE" || state === "PROVIDER_OUTAGE";
}

// ---------------------------------------------------------------------------
// Refusal families — which of the seven a per-candidate refusal argues for
// ---------------------------------------------------------------------------

export type RefusalFamily =
  /** Not this product, or not a photograph of it. */
  | "entity"
  /** Rights could not be established from the evidence. */
  | "rights"
  /** Rights were fine; a required provenance field was missing/unresolvable. */
  | "provenance"
  /** The provider did not answer. */
  | "outage"
  /** We could not read what the provider said. */
  | "parse";

/**
 * Rights-verification finding codes that mean THE LICENCE ITSELF is in doubt.
 * These argue for RIGHTS_UNCERTAIN.
 */
const LICENCE_DOUBT_CODES = new Set([
  "licence_absent",
  "licence_unrecognised",
  "licence_prohibitive",
  "licence_metadata_mismatch",
  "licence_not_in_primary_source",
  "no_primary_licence_evidence",
  "provenance_conflict",
  "third_party_relicence_unreviewed",
]);

/**
 * Finding codes that mean the licence read fine but a required FIELD is
 * missing. These argue for PROVENANCE_INCOMPLETE.
 */
const PROVENANCE_FIELD_CODES = new Set(["creator_absent", "source_page_absent", "original_file_absent"]);

/**
 * Map one refusal onto the family it argues for.
 *
 * `rights_incomplete` is the case that has to be split rather than lumped: a
 * file whose licence could not be read at all and a file whose licence is
 * impeccable but whose creator field is empty are different problems needing
 * different human action, and the taxonomy has a state for each.
 *
 * Note what is deliberately grouped under `entity`: `unsupported_media_type`,
 * `synthetic_imagery` and `quality_below_floor`. A .stl mesh of the right
 * processor, a diffusion-model render of the right console and a 320px thumbnail
 * are all "we found something, and it is not a photograph of this product".
 * They are not rights problems and not provenance problems, and the exact
 * rejection code is preserved in the outcome's evidence either way.
 */
export function refusalFamily(evaluation: CandidateEvaluation): RefusalFamily | null {
  const code = evaluation.rejection?.code;
  if (!code) return null;

  switch (code) {
    case "provider_outage":
      return "outage";
    case "provider_malformed":
      return "parse";
    case "entity_mismatch":
    case "entity_ambiguous":
    case "unsupported_media_type":
    case "synthetic_imagery":
    case "quality_below_floor":
      return "entity";
    case "rights_restricted":
    case "rights_conflicting":
    case "duplicate_licence_conflict":
      return "rights";
    case "provenance_unresolvable":
      return "provenance";
    case "rights_incomplete": {
      const blockers = (evaluation.rights?.findings ?? []).filter((f) => f.severity === "blocker").map((f) => f.code);
      if (blockers.some((c) => LICENCE_DOUBT_CODES.has(c))) return "rights";
      if (blockers.length > 0 && blockers.every((c) => PROVENANCE_FIELD_CODES.has(c))) return "provenance";
      // Incomplete for a reason neither set names. We cannot say which state
      // applies, and this file's rule for that is not to guess.
      return "parse";
    }
    case "duplicate_of_better":
      // Only ever produced when a better copy of the SAME file was accepted, so
      // it never decides an outcome on its own.
      return null;
    default: {
      // Exhaustiveness: a new RejectionCode with no mapping is an unclassifiable
      // terminal path, and an unclassifiable terminal path is a parse failure by
      // this module's own rule rather than a silent fall into "nothing found".
      const _never: never = code;
      void _never;
      return "parse";
    }
  }
}

// ---------------------------------------------------------------------------
// Plausibility: the check that would have caught the original bug on its own
// ---------------------------------------------------------------------------

/**
 * Refusal codes whose reason is DERIVED FROM PARSING provider markup.
 *
 * `entity_mismatch` is deliberately absent. Sixty candidates all refused as the
 * wrong product is the normal, correct shape of a PS5 Pro search and reports as
 * WRONG_ENTITY_RESULTS. Sixty candidates all refused because of one field this
 * code read out of wikitext is not a fact about the world.
 */
const PARSER_DERIVED_REFUSALS = new Set<RejectionCode>([
  "rights_conflicting",
  "rights_incomplete",
  "unsupported_media_type",
  "provenance_unresolvable",
]);

/**
 * How many uniformly-refused candidates it takes to be suspicious.
 *
 * Four, because four is what the real incident produced: every file in one
 * enumerated category refused for one parser-derived reason. Two or three
 * identical refusals is an ordinary coincidence — a pair of frame grabs from
 * one video, say. A whole category is not.
 */
export const UNIFORM_REFUSAL_MIN_CANDIDATES = 4;

export type PlausibilitySuspicion = {
  kind: "uniform_parser_refusal" | "parse_anomaly" | "unattested_empty_search";
  detail: string;
};

/**
 * Is a clean-looking sweep of refusals actually one bug repeated?
 *
 * The real test of this module: on 2026-08-22 eight files in
 * `Category:GoPro Hero 13 black` were refused `rights_conflicting`, every one
 * of them because `informationField()` had captured `|other versions=` as the
 * permission value. Eight identical parser-derived refusals and zero
 * survivors — this function returns a suspicion for exactly that shape, and the
 * classifier turns the suspicion into PROVIDER_PARSE_FAILURE.
 *
 * It is a HEURISTIC and it is allowed to be wrong in the direction of "look at
 * this". Being wrong the other way is what cost four photographs.
 */
export function assessRefusalPlausibility(evaluations: CandidateEvaluation[]): PlausibilitySuspicion[] {
  const suspicions: PlausibilitySuspicion[] = [];

  // Provider-level pseudo-evaluations (an unavailable provider) are not
  // candidates and must not dilute or trigger the uniformity test.
  const candidates = evaluations.filter(
    (e) => e.rejection?.code !== "provider_outage" && e.rejection?.code !== "provider_malformed"
  );
  if (candidates.length < UNIFORM_REFUSAL_MIN_CANDIDATES) return suspicions;
  if (candidates.some((e) => e.accepted)) return suspicions;

  const signatures = new Set(candidates.map(refusalSignature));
  if (signatures.size !== 1) return suspicions;

  const code = candidates[0].rejection!.code;
  if (!PARSER_DERIVED_REFUSALS.has(code)) return suspicions;

  suspicions.push({
    kind: "uniform_parser_refusal",
    detail:
      `All ${candidates.length} candidates were refused for the SAME parser-derived reason ` +
      `(${[...signatures][0]}), and not one survived. A field this code reads out of provider markup deciding every ` +
      "case identically is the signature of a broken reader, not of a uniformly unusable shelf — it is precisely what " +
      "the `|other versions=` regression looked like from the outside. Treated as PROVIDER_PARSE_FAILURE until the " +
      "per-candidate reasons are read by a human.",
  });
  return suspicions;
}

/** Rejection code plus the blocker codes underneath it, so "same reason" means it. */
function refusalSignature(e: CandidateEvaluation): string {
  const blockers = (e.rights?.findings ?? [])
    .filter((f) => f.severity === "blocker")
    .map((f) => f.code)
    .sort();
  return `${e.rejection?.code ?? "none"}${blockers.length ? `[${blockers.join("+")}]` : ""}`;
}

// ---------------------------------------------------------------------------
// Classification
// ---------------------------------------------------------------------------

/** What one provider did during one search, as the classifier needs to see it. */
export type ProviderEpisode = {
  approval: ProviderApproval;
  /** False when the provider was not approved for search and never called. */
  searched: boolean;
  /** What the provider's own search() reported. */
  outcome: ProviderOutcome;
  /** What it can prove about the responses behind that. Null = it cannot. */
  attestation: ProviderAttestation | null;
  /** Candidates it contributed. */
  candidates: number;
};

export type OutcomeEvidence = {
  providersOffered: number;
  providersSearched: number;
  responsesParsed: number;
  responsesFailed: number;
  parseAnomalies: ParseAnomaly[];
  candidates: number;
  accepted: number;
  refusalsByCode: Record<string, number>;
  refusalsByFamily: Record<RefusalFamily, number>;
};

export type SearchOutcome = {
  state: SearchOutcomeState;
  /** One line for a summary table. */
  headline: string;
  /** The POSITIVE establishment: why this state, and why not a neighbouring one. */
  because: string[];
  evidence: OutcomeEvidence;
  suspicions: PlausibilitySuspicion[];
};

export type OutcomeInput = {
  episodes: ProviderEpisode[];
  evaluations: CandidateEvaluation[];
};

/**
 * Decide which of the seven states a completed search ended in.
 *
 * The order of the rules is the whole design, so it is written out rather than
 * left to be reconstructed from the ifs:
 *
 *   1. Anything accepted            -> USABLE_CANDIDATE_FOUND
 *   2. Any evidence we misread      -> PROVIDER_PARSE_FAILURE   (beats outage:
 *                                      a bug in us is actionable today, and a
 *                                      bug hiding behind an outage is how the
 *                                      first one survived)
 *   3. Any provider did not answer  -> PROVIDER_OUTAGE
 *   4. Refusals look like one bug   -> PROVIDER_PARSE_FAILURE
 *   5. Candidates existed           -> the DEEPEST family reached:
 *                                      provenance > rights > entity
 *   6. No candidates, and the empty answer is ATTESTED -> NO_RESULTS
 *   7. Anything else                -> PROVIDER_PARSE_FAILURE
 *
 * Rule 7 is not decoration. NO_RESULTS is reachable only through rule 6, which
 * demands positive proof; every other road to "we found nothing" ends at a
 * report that someone has to look at.
 */
export function classifySearchOutcome(input: OutcomeInput): SearchOutcome {
  const evidence = summariseEvidence(input);
  const because: string[] = [];
  const suspicions = assessRefusalPlausibility(input.evaluations);

  const state = ((): SearchOutcomeState => {
    // --- 1. Something cleared every gate ---------------------------------
    if (evidence.accepted > 0) {
      because.push(
        `${evidence.accepted} of ${evidence.candidates} candidate(s) cleared entity matching, provenance resolution, ` +
          "rights verification, media type, synthetic-imagery detection and the quality floor."
      );
      because.push(
        "This is not permission: the proposed row carries rights_status='pending_verification' and the publication " +
          "gate refuses it until a human verifies at source."
      );
      return "USABLE_CANDIDATE_FOUND";
    }

    // --- 2. We could not read what came back ------------------------------
    const malformedEpisodes = input.episodes.filter((e) => e.searched && e.outcome.status === "malformed");
    const parseRefusals = evidence.refusalsByFamily.parse;
    if (malformedEpisodes.length > 0 || evidence.parseAnomalies.length > 0 || parseRefusals > 0) {
      if (malformedEpisodes.length > 0) {
        because.push(
          `${malformedEpisodes.length} provider response(s) could not be parsed: ` +
            malformedEpisodes.map((e) => `${e.approval.label} — ${detailOf(e.outcome)}`).join("; ")
        );
      }
      if (evidence.parseAnomalies.length > 0) {
        because.push(
          `${evidence.parseAnomalies.length} reader(s) parsed a response into something implausible: ` +
            evidence.parseAnomalies.map((a) => `${a.where} — ${a.detail}`).join("; ")
        );
      }
      if (parseRefusals > 0) {
        because.push(`${parseRefusals} candidate(s) were refused for a reason this taxonomy cannot classify.`);
      }
      because.push("A response we misread is a defect in us and is never reported as an empty shelf.");
      return "PROVIDER_PARSE_FAILURE";
    }

    // --- 3. The search did not happen -------------------------------------
    const searched = input.episodes.filter((e) => e.searched);
    const nonAnswers = searched.filter(
      (e) => e.outcome.status !== "ok" && e.outcome.status !== "no_results"
    );
    if (input.episodes.length === 0 || searched.length === 0 || nonAnswers.length > 0 || evidence.refusalsByFamily.outage > 0) {
      if (input.episodes.length === 0) {
        because.push("No provider was offered to the pipeline at all — nothing was searched.");
      } else if (searched.length === 0) {
        because.push(
          "Every provider offered is NOT approved for search, so no request was issued: " +
            input.episodes.map((e) => e.approval.label).join(", ") +
            ". An unsearched source is not a source that came back empty."
        );
      }
      for (const e of nonAnswers) {
        because.push(`${e.approval.label} returned a non-answer (${e.outcome.status}: ${detailOf(e.outcome)}).`);
      }
      if (evidence.refusalsByFamily.outage > 0) {
        because.push(
          `${evidence.refusalsByFamily.outage} candidate(s) could not be resolved because the provider stopped ` +
            "answering mid-search."
        );
      }
      because.push("THE SEARCH DID NOT HAPPEN. This is not a finding that no photograph exists.");
      return "PROVIDER_OUTAGE";
    }

    // --- 4. Every refusal is the same parser-derived refusal ---------------
    if (suspicions.length > 0) {
      for (const s of suspicions) because.push(s.detail);
      return "PROVIDER_PARSE_FAILURE";
    }

    // --- 5. Candidates existed; report the deepest stage any of them reached
    if (evidence.candidates > 0) {
      const f = evidence.refusalsByFamily;
      because.push(
        `${evidence.candidates} candidate(s) were examined and every one was refused ` +
          `(${formatCounts(evidence.refusalsByCode)}).`
      );
      if (f.provenance > 0) {
        because.push(
          `${f.provenance} reached provenance with adequate-looking rights and was refused for a missing or ` +
            "unresolvable provenance field, which is the furthest any candidate got."
        );
        return "PROVENANCE_INCOMPLETE";
      }
      if (f.rights > 0) {
        because.push(
          `${f.rights} candidate(s) were the right subject and their rights could not be established from the ` +
            "evidence at source. Uncertainty is not permission."
        );
        return "RIGHTS_UNCERTAIN";
      }
      if (f.entity > 0) {
        because.push(
          "No candidate got past identity: each was a different product, or not a photograph of this one. The search " +
            "worked and the material is unsuitable."
        );
        return "WRONG_ENTITY_RESULTS";
      }
      because.push(
        "Candidates were examined, none was accepted, and no refusal could be attributed to a stage. That is a gap " +
          "in this classifier, not a finding."
      );
      return "PROVIDER_PARSE_FAILURE";
    }

    // --- 6. Zero candidates, POSITIVELY established ------------------------
    const attested = searched.filter((e) => e.attestation !== null);
    const explicitEmpty = searched.filter((e) => e.outcome.status === "no_results");

    if (attested.length > 0) {
      if (evidence.responsesParsed === 0) {
        because.push(
          "The provider reported an empty result, but its own attestation records ZERO responses parsed. An empty " +
            "shelf and a reader that never read anything are indistinguishable from here."
        );
        return "PROVIDER_PARSE_FAILURE";
      }
      if (evidence.responsesFailed > 0) {
        because.push(
          `${evidence.responsesFailed} response(s) failed or arrived in an unrecognised shape during a search that ` +
            "returned nothing. A partial search that found nothing has not established that nothing exists."
        );
        return "PROVIDER_PARSE_FAILURE";
      }
      because.push(
        `${searched.map((e) => e.approval.label).join(", ")} answered; ${evidence.responsesParsed} response(s) were ` +
          "read and parsed, 0 failed, no reader reported an implausible value, and zero candidates came back."
      );
      because.push("Blocked on photography, not on permission — worth a scheduled recheck rather than a negotiation.");
      return "NO_RESULTS";
    }

    if (explicitEmpty.length === searched.length && explicitEmpty.length > 0) {
      // No attestation, but every provider used the DISTINCT `no_results`
      // status rather than a bare `ok` with an empty array. The type itself is
      // the provider asserting "I answered and I have nothing", which is a
      // weaker proof than an attestation and is accepted as such.
      because.push(
        `${explicitEmpty.map((e) => e.approval.label).join(", ")} explicitly reported no_results — the discriminated ` +
          "status that exists to be distinct from outage and malformed — and contributed zero candidates."
      );
      because.push(
        "Accepted without a response attestation, which is the weaker proof. A provider that can count what it parsed " +
          "should supply ProviderAttestation."
      );
      return "NO_RESULTS";
    }

    because.push(
      "A provider returned zero candidates while reporting success, and could not attest to a single response it " +
        "read and parsed. That is the exact shape of a silent reader failure, so it is NOT recorded as an empty shelf."
    );
    return "PROVIDER_PARSE_FAILURE";
  })();

  return { state, headline: OUTCOME_HEADLINES[state], because, evidence, suspicions };
}

function detailOf(outcome: ProviderOutcome): string {
  return "detail" in outcome ? outcome.detail : "(no detail given)";
}

function formatCounts(counts: Record<string, number>): string {
  const entries = Object.entries(counts);
  if (entries.length === 0) return "no refusals recorded";
  return entries.map(([k, n]) => `${k}×${n}`).join(", ");
}

function summariseEvidence(input: OutcomeInput): OutcomeEvidence {
  const refusalsByCode: Record<string, number> = {};
  const refusalsByFamily: Record<RefusalFamily, number> = {
    entity: 0,
    rights: 0,
    provenance: 0,
    outage: 0,
    parse: 0,
  };

  let candidates = 0;
  let accepted = 0;
  for (const e of input.evaluations) {
    const isProviderLevel = e.rejection?.code === "provider_outage" || e.rejection?.code === "provider_malformed";
    if (!isProviderLevel) candidates++;
    if (e.accepted) accepted++;
    if (e.rejection) {
      refusalsByCode[e.rejection.code] = (refusalsByCode[e.rejection.code] ?? 0) + 1;
      const family = refusalFamily(e);
      if (family) refusalsByFamily[family]++;
    }
  }

  const parseAnomalies: ParseAnomaly[] = [];
  let responsesParsed = 0;
  let responsesFailed = 0;
  for (const ep of input.episodes) {
    if (!ep.attestation) continue;
    responsesParsed += ep.attestation.responsesParsed;
    responsesFailed += ep.attestation.responsesFailed;
    parseAnomalies.push(...ep.attestation.parseAnomalies);
  }

  return {
    providersOffered: input.episodes.length,
    providersSearched: input.episodes.filter((e) => e.searched).length,
    responsesParsed,
    responsesFailed,
    parseAnomalies,
    candidates,
    accepted,
    refusalsByCode,
    refusalsByFamily,
  };
}

// ---------------------------------------------------------------------------
// Bridge to the legacy four-status vocabulary
// ---------------------------------------------------------------------------

/**
 * The seven states collapsed onto the four `PipelineStatus` values the engine
 * job and the admin surfaces already read.
 *
 * Both PROVIDER_PARSE_FAILURE and PROVIDER_OUTAGE map to `provider_unavailable`,
 * which is the status the engine job records NOWHERE as a candidate. That is
 * the behaviour we want for a suspected parse failure: a run whose reader may
 * be broken must not deposit "no source found" rows in the media requirements
 * surface, because those rows are read later as evidence that somebody looked.
 */
export function legacyStatusFor(state: SearchOutcomeState): "resolved" | "no_acceptable_candidate" | "no_results" | "provider_unavailable" {
  switch (state) {
    case "USABLE_CANDIDATE_FOUND":
      return "resolved";
    case "NO_RESULTS":
      return "no_results";
    case "PROVIDER_PARSE_FAILURE":
    case "PROVIDER_OUTAGE":
      return "provider_unavailable";
    case "WRONG_ENTITY_RESULTS":
    case "RIGHTS_UNCERTAIN":
    case "PROVENANCE_INCOMPLETE":
      return "no_acceptable_candidate";
  }
}
