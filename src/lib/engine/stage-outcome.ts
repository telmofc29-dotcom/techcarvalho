// STAGE OUTCOME — what an engine stage ACTUALLY ended in, for any stage.
//
// WHY THIS FILE EXISTS
// --------------------
// Four bugs have shipped in this repo with one shape in common: the system
// failed CLOSED, and failing closed looked exactly like having nothing to do.
//
//   1. A DELETE against analytics_events reported "0 rows deleted" with no
//      error. RLS denies by returning zero rows, so the statement ran, matched
//      nothing, and reported success.
//   2. `engine_upsert_update_proposal` answered 'rejected_invalid' to every
//      `stale_content` call. The freshness job discarded the return value and
//      recorded `status: success`. The bridge never worked once.
//   3. `informationField()` in wikimedia-commons.ts mis-read `|other versions=`
//      as `permission=`, refused four correctly-licensed CC BY-SA photographs
//      as `rights_conflicting`, and summarised itself as "candidates were found
//      and every one was rejected" — the same sentence a genuinely unusable
//      shelf produces.
//   4. A discovery pass examined 23 items, declined all 23, incremented no
//      counter, and recorded `examined:23 created:0 deduped:0 failed:0
//      status:success`.
//
// None of these threw. None produced a red row anywhere. Every one of them was
// found by a human reading source code, which is not a detection strategy — it
// is a description of luck.
//
// WHAT THIS MODULE IS
// -------------------
// The generalisation of `src/lib/media/providers/outcome.ts` (which does this
// for ONE stage, media search, in that stage's own vocabulary) to EVERY engine
// stage in one shared vocabulary. Ten mutually-exclusive classes, an eleventh
// explicit UNCLASSIFIED for "the evidence cannot say", and a rule that makes
// the benign class unreachable by accident.
//
// THE ONE-WAY DOOR
// ----------------
// NOTHING_TO_DO is never a fallback. It is reachable only through a rule that
// demands POSITIVE proof that the input queue was read, by a reader that is
// demonstrably alive, and was empty. Every other road out of "we did nothing"
// ends at UNCLASSIFIED, and UNCLASSIFIED is an incident.
//
// That asymmetry is the entire design. A classifier whose default is "all
// clear" reproduces the bugs above by construction, however many classes it
// has, because all four of them WERE the default branch of somebody's if-chain.
//
// PURE. No `server-only`, no Supabase, no clock, no network. Every rule here is
// decidable from plain values a caller hands in, which is what makes the
// historical incidents reconstructable as unit tests — see stage-outcome.test.ts.

import type { PostconditionSummary } from "./postconditions.ts";

// ---------------------------------------------------------------------------
// The taxonomy
// ---------------------------------------------------------------------------

export const STAGE_OUTCOME_CLASSES = [
  "NOTHING_TO_DO",
  "WORK_SUCCEEDED",
  "WORK_REJECTED",
  "WORK_DEDUPLICATED",
  "NO_OP_MUTATION",
  "PROVIDER_FAILURE",
  "PARSER_FAILURE",
  "PERMISSION_FAILURE",
  "STATE_TRANSITION_FAILURE",
  "CIRCUIT_BREAKER_HALT",
] as const;

export type StageOutcomeClass = (typeof STAGE_OUTCOME_CLASSES)[number];

/**
 * The eleventh answer, deliberately OUTSIDE the ten.
 *
 * It is not a class of outcome; it is the classifier declining to invent one.
 * Kept separate so that "we could not tell" can never be rendered, counted or
 * charted as a kind of success — the exact collapse that made incidents #1 and
 * #4 invisible.
 */
export type StageVerdictClass = StageOutcomeClass | "UNCLASSIFIED";

/**
 * What each class ASSERTS. Written as data because these sentences are the
 * contract: a class means this and nothing looser.
 */
export const STAGE_OUTCOME_MEANINGS: Record<StageVerdictClass, string> = {
  NOTHING_TO_DO:
    "The stage's input queue was read by a reader proven to be alive, and it was genuinely empty. POSITIVELY " +
    "established — zero rows on their own never reach this class, because under RLS a denied read and an empty " +
    "table are the same bytes.",
  WORK_SUCCEEDED:
    "The stage did work and the work was verified: at least one item was created and at least one mutation's " +
    "postcondition was demonstrably observed to hold afterwards. A call that merely returned no error is not this.",
  WORK_REJECTED:
    "Candidates were examined and deliberately declined ON THEIR MERITS, by a judgement the stage is supposed to " +
    "make. A legitimate outcome — but see the uniformity detector: N identical declines is one judgement made N " +
    "times, not N judgements.",
  WORK_DEDUPLICATED:
    "The work was already present and was correctly skipped. Legitimate, and the only benign class reachable with " +
    "nothing created.",
  NO_OP_MUTATION:
    "A write returned no error and DEMONSTRABLY changed nothing — its postcondition was checked afterwards and " +
    "does not hold. The cause is not attributable to a denial from here. Always an incident.",
  PROVIDER_FAILURE:
    "An upstream source could not be reached, was never called, or answered uselessly (rate limit, 5xx, empty " +
    "non-answer). THE WORK DID NOT HAPPEN. This is not a finding that there was nothing to do.",
  PARSER_FAILURE:
    "A response arrived and we could not read it, or read it into something implausible. THIS IS A DEFECT IN US, " +
    "not a fact about the world, and it must never be reported as an empty shelf. Always an incident.",
  PERMISSION_FAILURE:
    "The stage was denied by RLS or by a missing grant — including the SILENT form, where the statement ran, " +
    "matched zero rows and returned no error at all. Always an incident.",
  STATE_TRANSITION_FAILURE:
    "A downstream state change was requested and read back afterwards, and it had not taken effect. The stage " +
    "believes it advanced something that did not move. Always an incident.",
  CIRCUIT_BREAKER_HALT:
    "A safety mechanism deliberately stopped the stage. Nothing is wrong with the stage; the halt is the system " +
    "working. Recorded so that a halt is never mistaken for an idle queue.",
  UNCLASSIFIED:
    "The evidence does not distinguish between the classes above. TREATED AS A PROBLEM. This is the answer that " +
    "exists so 'we cannot tell' has somewhere to go other than NOTHING_TO_DO.",
};

/** Terse label for a summary table or an admin row. */
export const STAGE_OUTCOME_HEADLINES: Record<StageVerdictClass, string> = {
  NOTHING_TO_DO: "queue proven empty",
  WORK_SUCCEEDED: "work done and verified",
  WORK_REJECTED: "candidates declined on their merits",
  WORK_DEDUPLICATED: "already present, correctly skipped",
  NO_OP_MUTATION: "A WRITE CLAIMED SUCCESS AND CHANGED NOTHING",
  PROVIDER_FAILURE: "the work did not happen — upstream",
  PARSER_FAILURE: "WE COULD NOT READ THE ANSWER — investigate",
  PERMISSION_FAILURE: "DENIED — possibly silently",
  STATE_TRANSITION_FAILURE: "A STATE CHANGE DID NOT TAKE",
  CIRCUIT_BREAKER_HALT: "deliberately halted by a safety mechanism",
  UNCLASSIFIED: "EVIDENCE INSUFFICIENT — cannot say what happened",
};

/**
 * Classes that mean THE ENGINE IS BROKEN OR BLIND, as opposed to "the world is
 * like this". A run containing one of these is not a finding about the
 * catalogue and must never be filed as one.
 */
export function isEngineFault(cls: StageVerdictClass): boolean {
  return (
    cls === "NO_OP_MUTATION" ||
    cls === "PARSER_FAILURE" ||
    cls === "PERMISSION_FAILURE" ||
    cls === "STATE_TRANSITION_FAILURE" ||
    cls === "UNCLASSIFIED"
  );
}

/** Classes in which the stage did what it exists to do, or legitimately did not. */
export function isBenign(cls: StageVerdictClass): boolean {
  return (
    cls === "NOTHING_TO_DO" ||
    cls === "WORK_SUCCEEDED" ||
    cls === "WORK_REJECTED" ||
    cls === "WORK_DEDUPLICATED"
  );
}

/**
 * Classes that ALWAYS raise an incident, no matter how small the numbers.
 *
 * Not "a low rate is acceptable". Each of these means the stage's own report of
 * what it did is unreliable, and every other number the engine publishes is
 * computed from that report. One of them invalidates the evidence base, not
 * just the item it happened to.
 */
export const ALWAYS_INCIDENT: readonly StageVerdictClass[] = [
  "NO_OP_MUTATION",
  "PARSER_FAILURE",
  "PERMISSION_FAILURE",
  "STATE_TRANSITION_FAILURE",
  // Not in the brief's list, but it would be incoherent to demand that
  // "we cannot tell" be treated as a problem and then not report it.
  "UNCLASSIFIED",
];

// ---------------------------------------------------------------------------
// Why UNCLASSIFIED, when it happens
// ---------------------------------------------------------------------------

export type AmbiguityCode =
  /** Items were examined that ended in no recorded disposition at all. Incident #4. */
  | "unaccounted_items"
  /** The counters and the per-item outcomes describe different runs. */
  | "counter_disagreement"
  /** Nothing happened, and the emptiness of the queue was never established. */
  | "emptiness_unproven"
  /** Creations are claimed but every write behind them is structurally unobservable. */
  | "creations_unobservable"
  /** A mutation could neither be confirmed nor denied, and it is the only news. */
  | "mutation_unverifiable"
  /** No evidence was supplied at all — the stage reported nothing about itself. */
  | "no_evidence";

export const AMBIGUITY_MEANINGS: Record<AmbiguityCode, string> = {
  unaccounted_items:
    "The stage examined items that ended in no recorded disposition. A pass cannot look at work and then have had " +
    "no relationship to it; the items went somewhere the counters do not describe.",
  counter_disagreement:
    "The counters the stage reported and the per-item outcomes it recorded do not describe the same run. One of " +
    "them is wrong and there is no way to tell which from here.",
  emptiness_unproven:
    "The stage did nothing and never established that there was nothing to do. Under RLS an unauthorised read " +
    "returns zero rows with no error, so an unproven empty queue is indistinguishable from a denied one.",
  creations_unobservable:
    "The stage claims it created rows, but every write it made goes through a path whose effect cannot be observed " +
    "from the response. It would report these exact numbers whether the writes landed or were denied.",
  mutation_unverifiable:
    "A mutation returned no error and nothing came back that could confirm or deny its postcondition. 'I could not " +
    "tell' is not 'it worked'.",
  no_evidence:
    "The stage supplied no counters, no postconditions, no provider episodes and no input probe. A stage that " +
    "reports nothing about itself has not demonstrated that it ran.",
};

// ---------------------------------------------------------------------------
// The evidence a caller supplies
// ---------------------------------------------------------------------------

/**
 * The dispositions a stage can give an item.
 *
 * `rejected` is a separate member from `failed` on purpose. `engine_job_runs`
 * has four columns — examined/created/deduped/failed — with nowhere to put a
 * deliberate decline, which is why six call sites folded 'rejected_invalid'
 * into `deduped` (incident #2) and why 23 declines incremented nothing at all
 * (incident #4). A taxonomy that cannot NAME a rejection guarantees that
 * rejections get filed as something benign.
 */
export type ItemDisposition = "created" | "deduplicated" | "rejected" | "failed";

export type StageCounters = {
  examined: number;
  created: number;
  deduplicated: number;
  /** Deliberately declined on their merits. */
  rejected: number;
  /** Errored — an actual failure, not a judgement. */
  failed: number;
};

export function countersOf(p: Partial<StageCounters>): StageCounters {
  return {
    examined: p.examined ?? 0,
    created: p.created ?? 0,
    deduplicated: p.deduplicated ?? 0,
    rejected: p.rejected ?? 0,
    failed: p.failed ?? 0,
  };
}

/**
 * How solidly the claim "there was no work" is established.
 *
 * This tri-state is what makes NOTHING_TO_DO earnable rather than default.
 * It is modelled on ProviderAttestation in media/providers/types.ts, for the
 * same reason: a reader that never read anything and a shelf that is genuinely
 * empty produce identical output unless the reader can prove it was awake.
 */
export type EmptinessProof =
  /** The input read errored, or was never made. Proves nothing whatsoever. */
  | "none"
  /**
   * Zero rows came back with no error, from a read that RLS could deny by
   * returning exactly this. The weakest possible evidence, and on its own it is
   * NOT enough — this is the literal signature of the 2026-08 grants incident.
   */
  | "zero_rows_only"
  /**
   * Zero ELIGIBLE rows, but the read demonstrably returned something: a total
   * count, rows that were then filtered out in application code, or a control
   * row known to exist. The reader is provably alive.
   */
  | "reader_alive"
  /** An independent source that RLS cannot silence confirms the queue is empty. */
  | "corroborated";

export type InputProbe = {
  /** The query or RPC that was asked for work, by name. */
  source: string;
  /** Rows the stage considered eligible to work on. */
  available: number;
  proof: EmptinessProof;
  /**
   * Whether this read runs under RLS as a role that could be denied silently.
   * Engine jobs run as `anon` (a Vercel Cron request carries no cookies), so
   * for engine tables this is true and the caller should say so.
   */
  deniableUnderRls: boolean;
  /** What corroborated the emptiness, when `proof` is 'reader_alive'/'corroborated'. */
  corroboration?: string | null;
};

/** What one upstream source did during this pass. */
export type ProviderEpisode = {
  provider: string;
  /** False when no request was issued at all. An unsearched source is not an empty one. */
  called: boolean;
  status:
    | "ok"
    /** Answered, understood, and has nothing. */
    | "empty"
    /** Could not be reached: DNS, connection, timeout. */
    | "unreachable"
    /** Answered with a non-answer: 429, 5xx, a captcha page. */
    | "rate_limited"
    /** A response arrived and could not be parsed. Reads as PARSER, not PROVIDER. */
    | "malformed"
    /** Answered 200 with something structurally fine and semantically worthless. */
    | "useless";
  detail?: string;
  /** Responses the reader claims to have read and parsed. null = it cannot say. */
  responsesParsed?: number | null;
  responsesFailed?: number | null;
};

/** A reader reporting that it parsed something into a value it does not believe. */
export type ParseAnomaly = { where: string; detail: string };

/** One item's fate, when the stage records per-item outcomes. */
export type ItemOutcome = {
  disposition: ItemDisposition;
  /** The stable reason code. Uniformity is measured on THIS, not on prose. */
  reasonCode: string;
  /**
   * Whether this reason was DERIVED FROM PARSING an external response — i.e.
   * whether a bug in our own reader could have produced it.
   *
   * The distinction is load-bearing. Sixty candidates refused as the wrong
   * product is the normal shape of a broad search. Sixty candidates refused
   * because of one field this code read out of someone else's markup is not a
   * fact about the world.
   */
  derivedFromParsing?: boolean;
  subject?: string;
};

/** One checked write, at the resolution where PERMISSION and NO_OP separate. */
export type MutationEvidence = {
  operation: string;
  subject?: string;
  /** Whether the postcondition was checked afterwards, and what it showed. */
  postcondition:
    /** Checked, and it demonstrably holds. */
    | "held"
    /** Checked, and it demonstrably does NOT hold. The silent no-op. */
    | "failed"
    /** Nothing came back that could confirm or deny. Not a pass. */
    | "unknown"
    /** Structurally unobservable — a `returns void` RPC. An admission, not a pass. */
    | "unobservable";
  /** The error, when the call errored at all. */
  error?: { code?: string | null; message?: string } | null;
  /** Rows the statement reported affecting. null = it could not report. */
  rowsAffected?: number | null;
  /**
   * True when this write goes through a path RLS can deny by returning zero
   * rows and no error. Set it for every engine table write made as `anon`.
   */
  rlsDeniable?: boolean;
};

/** A downstream state change the stage requested and then read back. */
export type StateTransition = {
  subject: string;
  field: string;
  expected: string;
  /** What the read-back actually showed. null = the read-back itself failed. */
  observed: string | null;
};

export type BreakerHalt = {
  breaker: string;
  reason: string;
  /** Capabilities the halt suspended, for the incident text. */
  suspended?: readonly string[];
};

/**
 * Everything the classifier is allowed to look at.
 *
 * Every field beyond `stage` and `counters` is optional, because instrumenting
 * a stage is incremental and a classifier that only works on fully-instrumented
 * stages protects exactly the code that never needed protecting. Missing
 * evidence never improves the verdict — at worst it produces UNCLASSIFIED,
 * which is an incident, which is the pressure that gets the evidence added.
 */
export type StageEvidence = {
  stage: string;
  counters: StageCounters;
  /** How the stage established that its queue was (or was not) empty. */
  inputProbe?: InputProbe | null;
  /** The coarse per-pass summary from postconditions.ts. */
  postconditions?: PostconditionSummary | null;
  /** The sharp per-mutation evidence, when the stage carries it. */
  mutations?: readonly MutationEvidence[];
  itemOutcomes?: readonly ItemOutcome[];
  providers?: readonly ProviderEpisode[];
  parseAnomalies?: readonly ParseAnomaly[];
  stateTransitions?: readonly StateTransition[];
  breakerHalt?: BreakerHalt | null;
  /** Errors the stage caught that are not attached to a specific mutation. */
  errors?: readonly { operation: string; code?: string | null; message?: string }[];
};

// ---------------------------------------------------------------------------
// Error-code families
// ---------------------------------------------------------------------------

/**
 * SQLSTATE / PostgREST codes that mean WE WERE NOT ALLOWED.
 *
 * The object-missing codes (42P01, 42883, PGRST202, PGRST205) are deliberately
 * in here alongside the outright privilege ones. Under Supabase a revoked grant
 * makes a function or table INVISIBLE rather than forbidden, so "could not find
 * the function in the schema cache" is what a permission problem usually looks
 * like from the client. Filing those as "unknown" is how a missing grant spent
 * weeks looking like a code bug.
 */
export const PERMISSION_ERROR_CODES: ReadonlySet<string> = new Set([
  "42501", // insufficient_privilege
  "28000", // invalid_authorization_specification
  "28P01", // invalid_password
  "42P01", // undefined_table — under RLS/grants, usually "invisible", not "absent"
  "42883", // undefined_function — ditto
  "PGRST301", // JWT problem
  "PGRST302", // anonymous access disabled
  "PGRST202", // function not found in schema cache
  "PGRST205", // table not found in schema cache
]);

const PERMISSION_MESSAGE_RE =
  /permission denied|row[- ]level security|not authori[sz]ed|insufficient privilege|jwt|schema cache/i;

const PROVIDER_ERROR_CODES: ReadonlySet<string> = new Set([
  "ECONNREFUSED",
  "ECONNRESET",
  "ETIMEDOUT",
  "ENOTFOUND",
  "EAI_AGAIN",
  "429",
  "500",
  "502",
  "503",
  "504",
]);

const PROVIDER_MESSAGE_RE = /fetch failed|network|timed? ?out|rate limit|too many requests|socket hang up/i;

const PARSER_MESSAGE_RE = /unexpected token|json|syntaxerror|malformed|could not parse|unparse/i;

export type ErrorFamily = "permission" | "provider" | "parser" | "unknown";

/**
 * Which family an error belongs to, from its code and message.
 *
 * Order matters: permission is checked first because a permission error is the
 * one that most often arrives wearing another family's clothes, and it is
 * always ours to fix.
 */
export function errorFamily(err: { code?: string | null; message?: string } | null | undefined): ErrorFamily {
  if (!err) return "unknown";
  const code = (err.code ?? "").trim();
  const message = err.message ?? "";
  if (code && PERMISSION_ERROR_CODES.has(code)) return "permission";
  if (PERMISSION_MESSAGE_RE.test(message)) return "permission";
  if (code && PROVIDER_ERROR_CODES.has(code)) return "provider";
  if (PROVIDER_MESSAGE_RE.test(message)) return "provider";
  if (PARSER_MESSAGE_RE.test(message)) return "parser";
  return "unknown";
}

// ---------------------------------------------------------------------------
// Suspicious uniformity
// ---------------------------------------------------------------------------

/**
 * How many identically-ending items it takes before uniformity is suspicious.
 *
 * FOUR. The justification is empirical rather than statistical, and it is the
 * only kind available here:
 *
 *   * FOUR is the size of the smallest real incident. The Commons regression
 *     refused exactly four correctly-licensed photographs in one category
 *     before anybody noticed. A threshold of five would have missed the only
 *     incident of this class we have ever actually caught, which is a decisive
 *     argument against five.
 *   * THREE and below is ordinary coincidence. Two frame grabs from the same
 *     video, a pair of near-duplicate feed items from one syndicated wire, a
 *     product family whose three members are all out of scope — these produce
 *     runs of two and three identical outcomes constantly, and firing on them
 *     would train people to ignore this detector, which is worse than not
 *     having it.
 *   * The incident-#4 discovery pass was 23 items, clearing this threshold five
 *     times over, so nothing is lost at the large end by setting it low.
 *
 * It is a HEURISTIC and it is allowed to be wrong in the direction of "look at
 * this". Being wrong in the other direction is what cost four photographs and
 * 23 discoveries.
 */
export const UNIFORM_OUTCOME_MIN_ITEMS = 4;

export type UniformityStrength =
  /** All N ended in the same non-success class, for differing reasons. */
  | "same_class"
  /** All N ended in the same class for the SAME reason code. */
  | "same_reason"
  /** All N, same reason code, and the reason is one our own parser derives. */
  | "same_parser_derived_reason";

export type UniformitySuspicion = {
  strength: UniformityStrength;
  items: number;
  disposition: ItemDisposition;
  /** The single reason code, when there is one. */
  reasonCode: string | null;
  detail: string;
};

/**
 * Is a clean-looking sweep of identical outcomes actually one bug repeated?
 *
 * N items examined and every single one ending the same non-success way is not
 * N independent judgements; past a certain N it is one judgement, made once, in
 * code, and applied N times. That is the difference between a stage doing its
 * job and a stage having a bug that fails closed.
 *
 * Returns null when there is nothing suspicious — including whenever ANY item
 * succeeded, because one survivor proves the discriminator can discriminate.
 */
export function detectUniformity(items: readonly ItemOutcome[]): UniformitySuspicion | null {
  if (items.length < UNIFORM_OUTCOME_MIN_ITEMS) return null;
  if (items.some((i) => i.disposition === "created")) return null;

  const dispositions = new Set(items.map((i) => i.disposition));
  if (dispositions.size !== 1) return null;
  const disposition = items[0].disposition;

  const reasons = new Set(items.map((i) => i.reasonCode));
  const reasonCode = reasons.size === 1 ? items[0].reasonCode : null;
  const allParserDerived = reasonCode !== null && items.every((i) => i.derivedFromParsing === true);

  const strength: UniformityStrength = allParserDerived
    ? "same_parser_derived_reason"
    : reasonCode !== null
      ? "same_reason"
      : "same_class";

  const detail =
    strength === "same_parser_derived_reason"
      ? `All ${items.length} items ended as '${disposition}' for the SAME reason ('${reasonCode}'), and that reason ` +
        `is DERIVED FROM PARSING an external response. A field our own code reads out of someone else's markup ` +
        `deciding every case identically is the signature of a broken reader, not of a uniformly unusable shelf. ` +
        `This is precisely what the \`|other versions=\` regression looked like from the outside, so it is treated ` +
        `as PARSER_FAILURE until a human has read the per-item reasons.`
      : strength === "same_reason"
        ? `All ${items.length} items ended as '${disposition}' for the SAME reason ('${reasonCode}'), and not one ` +
          `survived. ${items.length} identical verdicts is one rule applied ${items.length} times, not ` +
          `${items.length} independent judgements — a guard list that no longer matches a CHECK constraint, or an ` +
          `input field that changed shape, produces exactly this and produces it silently.`
        : `All ${items.length} items ended as '${disposition}' — different reasons, but not one survivor. A stage ` +
          `whose discriminator never once discriminates in favour of anything has not been shown to be capable of ` +
          `doing so.`;

  return { strength, items: items.length, disposition, reasonCode, detail };
}

// ---------------------------------------------------------------------------
// The verdict
// ---------------------------------------------------------------------------

export type StageVerdict = {
  stage: string;
  outcome: StageVerdictClass;
  headline: string;
  /** The written reason. Never empty, for any class. */
  reason: string;
  /** The reason, broken into the individual establishments that produced it. */
  because: string[];
  /** Set only when `outcome` is UNCLASSIFIED. */
  ambiguity: AmbiguityCode | null;
  uniformity: UniformitySuspicion | null;
  /** True iff the classifier declined to name a class. */
  ambiguous: boolean;
  observed: Record<string, number | string | boolean | null>;
};

/**
 * Decide which class a completed stage pass ended in.
 *
 * THE DECISION TABLE, written out rather than left to be reconstructed from the
 * ifs. Rules are tried in this order and the FIRST that matches wins:
 *
 *   1. PERMISSION_FAILURE       any denial evidence — an error in the permission
 *                               family, OR the silent form: a checked write that
 *                               returned no error, affected zero rows, whose
 *                               postcondition fails, on an RLS-deniable path.
 *                               First because a denial is the failure most often
 *                               wearing another class's clothes, and because it
 *                               is always ours and always actionable today.
 *   2. STATE_TRANSITION_FAILURE a transition was read back and had not taken.
 *                               Above parser/provider because a read-back that
 *                               disagrees is direct evidence, not inference.
 *   3. NO_OP_MUTATION           a checked write's postcondition demonstrably
 *                               fails with no denial attributable. Rule 1 has
 *                               already claimed the deniable ones.
 *   4. PARSER_FAILURE           a malformed response, a reader-reported
 *                               implausibility, or uniform parser-derived
 *                               refusals. ABOVE provider, deliberately: a defect
 *                               in us is actionable today, and a defect hiding
 *                               behind an outage is how the Commons bug lived.
 *   5. PROVIDER_FAILURE         a source was unreachable, never called, rate
 *                               limited, or answered uselessly.
 *   6. CIRCUIT_BREAKER_HALT     a declared halt. Below the faults so that a real
 *                               fault is never masked by a halt that happened to
 *                               be open at the same time.
 *   7. UNCLASSIFIED             counters that do not add up, or per-item
 *                               outcomes that disagree with the counters.
 *                               Checked BEFORE any benign class, because a stage
 *                               that has lost track of its own items has not
 *                               earned a benign verdict. Incident #4 lands here.
 *   8. WORK_SUCCEEDED           created > 0 and verified. If every write behind
 *                               those creations is unobservable, this becomes
 *                               UNCLASSIFIED instead — an unprovable claim of
 *                               success is not a success.
 *   9. WORK_REJECTED            rejections, none created. Above deduplication
 *                               because a decline is the more informative fact.
 *  10. WORK_DEDUPLICATED        deduplications only.
 *  11. NOTHING_TO_DO            ONLY via a positive emptiness proof. Requires an
 *                               input probe, zero available, zero examined, and
 *                               either a reader proven alive or a read that RLS
 *                               cannot silence.
 *  12. UNCLASSIFIED             everything else. The default branch is the
 *                               incident, not the all-clear.
 */
export function classifyStageOutcome(evidence: StageEvidence): StageVerdict {
  const c = evidence.counters;
  const because: string[] = [];
  const items = evidence.itemOutcomes ?? [];
  const uniformity = detectUniformity(items);
  const mutations = evidence.mutations ?? [];
  const providers = evidence.providers ?? [];
  const anomalies = evidence.parseAnomalies ?? [];
  const errors = evidence.errors ?? [];
  const post = evidence.postconditions ?? null;

  let ambiguity: AmbiguityCode | null = null;

  const outcome = ((): StageVerdictClass => {
    // --- 1. Denied, loudly or silently ------------------------------------
    const permissionErrors = [
      ...errors.filter((e) => errorFamily(e) === "permission"),
      ...mutations
        .filter((m) => m.error && errorFamily(m.error) === "permission")
        .map((m) => ({ operation: m.operation, code: m.error?.code, message: m.error?.message })),
    ];
    const silentDenials = mutations.filter(
      (m) =>
        !m.error &&
        m.postcondition === "failed" &&
        m.rlsDeniable === true &&
        (m.rowsAffected === 0 || m.rowsAffected === undefined || m.rowsAffected === null)
    );

    if (permissionErrors.length > 0) {
      because.push(
        `${permissionErrors.length} operation(s) were refused with a permission-family code: ` +
          permissionErrors.map((e) => `${e.operation} (${e.code ?? "no code"})`).join(", ") +
          ". A missing grant and a deleted object are the same message under Supabase, so both are read as denial."
      );
      return "PERMISSION_FAILURE";
    }
    if (silentDenials.length > 0) {
      because.push(
        `${silentDenials.length} write(s) returned NO ERROR, affected zero rows, and their postconditions do not ` +
          `hold: ${silentDenials.map((m) => `${m.operation}${m.subject ? ` [${m.subject}]` : ""}`).join(", ")}. ` +
          `The caller declared these paths RLS-deniable, and this is exactly what RLS denial looks like — the ` +
          `statement ran, matched nothing, and raised nothing. It is the analytics_events DELETE shape.`
      );
      because.push(
        "Classified as PERMISSION_FAILURE rather than NO_OP_MUTATION because a denial is attributable: there is a " +
          "policy to read and a grant to check, which is a shorter path to a fix than a general no-op."
      );
      return "PERMISSION_FAILURE";
    }

    // --- 2. A state change that did not take -------------------------------
    const didNotTake = (evidence.stateTransitions ?? []).filter(
      (t) => t.observed !== null && t.observed !== t.expected
    );
    if (didNotTake.length > 0) {
      because.push(
        `${didNotTake.length} state transition(s) were requested and read back afterwards, and had NOT taken ` +
          `effect: ` +
          didNotTake
            .map((t) => `${t.subject}.${t.field} expected '${t.expected}', observed '${t.observed}'`)
            .join("; ") +
          ". The stage believes it advanced something that did not move."
      );
      return "STATE_TRANSITION_FAILURE";
    }

    // --- 3. A write that reported success and changed nothing ---------------
    const checkedNoOps = mutations.filter((m) => !m.error && m.postcondition === "failed");
    if (checkedNoOps.length > 0) {
      because.push(
        `${checkedNoOps.length} write(s) returned no error and DEMONSTRABLY changed nothing — their postconditions ` +
          `were checked afterwards and do not hold: ` +
          checkedNoOps.map((m) => `${m.operation}${m.subject ? ` [${m.subject}]` : ""}`).join(", ") +
          ". No denial is attributable from here, so the cause is open."
      );
      return "NO_OP_MUTATION";
    }
    // Coarse resolution: the postcondition summary counted silent no-ops but the
    // per-mutation evidence was not supplied. Still an incident; just less
    // precise about which class of cause.
    if (post && post.silentNoOps > 0) {
      because.push(
        `The pass's postcondition summary counted ${post.silentNoOps} silent no-op(s) — mutations that returned no ` +
          `error and whose postconditions do not hold. ` +
          (post.silentNoOpDetails.length > 0 ? post.silentNoOpDetails.join(" ") : "")
      );
      because.push(
        "Per-mutation evidence was not supplied, so this cannot be narrowed to PERMISSION_FAILURE. Pass `mutations` " +
          "with `rlsDeniable` set to separate a denial from an unattributed no-op."
      );
      return "NO_OP_MUTATION";
    }

    // --- 4. We could not read what came back --------------------------------
    const malformed = providers.filter((p) => p.called && p.status === "malformed");
    const parserErrors = errors.filter((e) => errorFamily(e) === "parser");
    if (malformed.length > 0 || anomalies.length > 0 || parserErrors.length > 0) {
      for (const p of malformed) {
        because.push(`${p.provider} returned a response we could not parse${p.detail ? `: ${p.detail}` : "."}`);
      }
      for (const a of anomalies) {
        because.push(`A reader parsed a response into something implausible — ${a.where}: ${a.detail}`);
      }
      for (const e of parserErrors) {
        because.push(`${e.operation} failed while parsing: ${e.message ?? "(no message)"}`);
      }
      because.push("A response we misread is a defect in US, and is never reported as an empty shelf.");
      return "PARSER_FAILURE";
    }
    if (uniformity?.strength === "same_parser_derived_reason") {
      because.push(uniformity.detail);
      return "PARSER_FAILURE";
    }

    // --- 5. The work did not happen upstream --------------------------------
    const notCalled = providers.filter((p) => !p.called);
    const nonAnswers = providers.filter(
      (p) => p.called && (p.status === "unreachable" || p.status === "rate_limited" || p.status === "useless")
    );
    const providerErrors = errors.filter((e) => errorFamily(e) === "provider");
    if (nonAnswers.length > 0 || providerErrors.length > 0 || (providers.length > 0 && notCalled.length === providers.length)) {
      for (const p of nonAnswers) {
        because.push(`${p.provider} returned a non-answer (${p.status}${p.detail ? `: ${p.detail}` : ""}).`);
      }
      for (const e of providerErrors) {
        because.push(`${e.operation} could not reach its source: ${e.message ?? e.code ?? "(no detail)"}`);
      }
      if (providers.length > 0 && notCalled.length === providers.length) {
        because.push(
          `Every source offered to this stage was never called (${notCalled.map((p) => p.provider).join(", ")}). ` +
            "An unqueried source is not a source that came back empty."
        );
      }
      because.push("THE WORK DID NOT HAPPEN. This is not a finding that there was nothing to do.");
      return "PROVIDER_FAILURE";
    }

    // --- 6. Deliberately halted ---------------------------------------------
    if (evidence.breakerHalt) {
      because.push(
        `The '${evidence.breakerHalt.breaker}' circuit breaker halted this stage: ${evidence.breakerHalt.reason}` +
          (evidence.breakerHalt.suspended?.length
            ? ` Capabilities suspended: ${evidence.breakerHalt.suspended.join(", ")}.`
            : "")
      );
      because.push(
        "Recorded as its own class so a halt is never read as an idle queue. Nothing is wrong with the stage; the " +
          "halt is the safety mechanism working."
      );
      return "CIRCUIT_BREAKER_HALT";
    }

    // --- 7. The counters do not describe the run ----------------------------
    const disposed = c.created + c.deduplicated + c.rejected + c.failed;
    if (c.examined > disposed) {
      ambiguity = "unaccounted_items";
      because.push(
        `${c.examined} item(s) were examined and only ${disposed} ended in a recorded disposition ` +
          `(created ${c.created}, deduplicated ${c.deduplicated}, rejected ${c.rejected}, failed ${c.failed}). ` +
          `${c.examined - disposed} item(s) went somewhere the counters do not describe.`
      );
      because.push(
        "A pass cannot look at work and then have had no relationship to it. This is the discovery-pass shape: " +
          "23 examined, every counter zero, status success. It is NOT recorded as an empty or successful run."
      );
      return "UNCLASSIFIED";
    }
    if (items.length > 0) {
      const byDisposition = tallyDispositions(items);
      const mismatch =
        byDisposition.created !== c.created ||
        byDisposition.deduplicated !== c.deduplicated ||
        byDisposition.rejected !== c.rejected ||
        byDisposition.failed !== c.failed;
      if (mismatch) {
        ambiguity = "counter_disagreement";
        because.push(
          `The counters and the per-item outcomes describe different runs. Counters: created ${c.created}, ` +
            `deduplicated ${c.deduplicated}, rejected ${c.rejected}, failed ${c.failed}. Items: created ` +
            `${byDisposition.created}, deduplicated ${byDisposition.deduplicated}, rejected ` +
            `${byDisposition.rejected}, failed ${byDisposition.failed}.`
        );
        because.push(
          "One of the two is wrong and nothing here can say which. Counting a rejection as a duplicate is the " +
            "exact mis-tally that made a whole stage a no-op for weeks."
        );
        return "UNCLASSIFIED";
      }
    }

    // --- 8. Work was done, and shown to have been done ----------------------
    if (c.created > 0) {
      if (post && post.verified === 0 && post.blind > 0) {
        ambiguity = "creations_unobservable";
        because.push(
          `${c.created} creation(s) are claimed, but not one write was verified and ${post.blind} of them go ` +
            `through a path whose effect cannot be observed from the response ` +
            `(${post.blindOperations.join(", ")}).`
        );
        because.push(
          "The stage would report these exact numbers whether the writes landed or were denied, so the claim of " +
            "success is unfalsifiable. Change the RPC to return a status string or a row id — no amount of " +
            "caller-side checking can observe an unobservable write."
        );
        return "UNCLASSIFIED";
      }
      because.push(
        `${c.created} item(s) were created out of ${c.examined} examined` +
          (post ? `, with ${post.verified} mutation(s) verified against their postconditions afterwards.` : ".")
      );
      if (!post) {
        because.push(
          "No postcondition summary was supplied, so the creation count is the stage's own word. Wire " +
            "createPostconditionLog() to make this verifiable rather than asserted."
        );
      }
      return "WORK_SUCCEEDED";
    }

    // --- 9. Declined on their merits ----------------------------------------
    if (c.rejected > 0) {
      because.push(
        `${c.rejected} candidate(s) out of ${c.examined} examined were deliberately declined on their merits, and ` +
          `none was created.`
      );
      if (uniformity) because.push(uniformity.detail);
      else if (items.length === 0) {
        because.push(
          "No per-item reasons were recorded, so the uniformity check could not run. A stage that declines without " +
            "recording WHY cannot distinguish N judgements from one bug repeated N times."
        );
      }
      return "WORK_REJECTED";
    }

    // --- 10. Already present ------------------------------------------------
    if (c.deduplicated > 0) {
      because.push(
        `${c.deduplicated} item(s) out of ${c.examined} examined were already present and were correctly skipped, ` +
          `and nothing was rejected or failed.`
      );
      if (uniformity) because.push(uniformity.detail);
      return "WORK_DEDUPLICATED";
    }

    // --- 11. Nothing to do, POSITIVELY established --------------------------
    const probe = evidence.inputProbe ?? null;
    if (c.examined === 0 && c.failed === 0) {
      if (!probe) {
        // A stage that reported literally nothing about itself gets the more
        // specific complaint, because the fix differs: one needs a stronger
        // emptiness proof, the other needs any instrumentation at all.
        const silent =
          c.created === 0 &&
          c.deduplicated === 0 &&
          c.rejected === 0 &&
          !post &&
          mutations.length === 0 &&
          providers.length === 0 &&
          items.length === 0;
        ambiguity = silent ? "no_evidence" : "emptiness_unproven";
        because.push(
          silent
            ? "The stage supplied no counters, no input probe, no postconditions, no mutations and no provider " +
              "episodes. It has not demonstrated that it ran at all."
            : "The stage examined nothing and supplied no input probe, so there is no evidence that its queue was " +
              "ever read. An unread queue and an empty one are the same numbers."
        );
        return "UNCLASSIFIED";
      }
      if (probe.available > 0) {
        ambiguity = "unaccounted_items";
        because.push(
          `${probe.source} offered ${probe.available} eligible item(s) and the stage examined NONE of them. Work ` +
            `was available and was not picked up.`
        );
        return "UNCLASSIFIED";
      }
      if (probe.proof === "none") {
        ambiguity = "emptiness_unproven";
        because.push(
          `${probe.source} could not establish anything: the input read errored or was never made. Zero examined ` +
            `items therefore prove nothing at all.`
        );
        return "UNCLASSIFIED";
      }
      if (probe.proof === "zero_rows_only" && probe.deniableUnderRls) {
        ambiguity = "emptiness_unproven";
        because.push(
          `${probe.source} returned zero rows with no error, and the caller declared this read deniable under RLS. ` +
            `An unauthorised read returns exactly these bytes, so an empty queue and a denied one are ` +
            `indistinguishable from here.`
        );
        because.push(
          "NOT recorded as NOTHING_TO_DO. Supply a reader-alive proof (a total count, a control row, rows filtered " +
            "in application code) or corroborate the emptiness from a source RLS cannot silence."
        );
        return "UNCLASSIFIED";
      }
      because.push(
        probe.proof === "zero_rows_only"
          ? `${probe.source} returned zero eligible rows, and the caller declared this read NOT deniable under RLS, ` +
            `so zero rows is a fact about the queue rather than about our permissions.`
          : `${probe.source} returned zero eligible rows and the reader is provably alive` +
            (probe.corroboration ? `: ${probe.corroboration}` : ".")
      );
      because.push(
        "POSITIVELY established: the queue was read, the reader demonstrated it was awake, and there was genuinely " +
          "no work. This is the only route to NOTHING_TO_DO."
      );
      return "NOTHING_TO_DO";
    }

    // --- 12. The default branch is the incident -----------------------------
    if (post && post.unverifiable > 0) {
      ambiguity = "mutation_unverifiable";
      because.push(
        `${post.unverifiable} mutation(s) returned no error and nothing came back that could confirm or deny their ` +
          `postconditions. 'I could not tell' is not 'it worked'.`
      );
      return "UNCLASSIFIED";
    }
    if (c.failed > 0) {
      // Failures with no error evidence attached: the stage says items failed
      // and supplied nothing to say why. That is not a class, it is a gap.
      ambiguity = "counter_disagreement";
      because.push(
        `${c.failed} item(s) are recorded as failed out of ${c.examined} examined, and no error, mutation or ` +
          `provider evidence was supplied to say what failed or why.`
      );
      return "UNCLASSIFIED";
    }
    ambiguity = "emptiness_unproven";
    because.push(
      `No rule in this classifier matched the evidence (examined ${c.examined}, created ${c.created}, deduplicated ` +
        `${c.deduplicated}, rejected ${c.rejected}, failed ${c.failed}). That is a gap in this classifier, not a ` +
        `finding about the stage — and a gap is reported rather than resolved in favour of 'nothing to do'.`
    );
    return "UNCLASSIFIED";
  })();

  return {
    stage: evidence.stage,
    outcome,
    headline: STAGE_OUTCOME_HEADLINES[outcome],
    reason: because.join(" "),
    because,
    ambiguity: outcome === "UNCLASSIFIED" ? (ambiguity ?? "no_evidence") : null,
    uniformity,
    ambiguous: outcome === "UNCLASSIFIED",
    observed: {
      examined: c.examined,
      created: c.created,
      deduplicated: c.deduplicated,
      rejected: c.rejected,
      failed: c.failed,
      itemOutcomes: items.length,
      providers: providers.length,
      mutations: mutations.length,
      inputProbe: evidence.inputProbe?.source ?? null,
      emptinessProof: evidence.inputProbe?.proof ?? null,
      uniformity: uniformity?.strength ?? null,
      silentNoOps: post ? post.silentNoOps : null,
      blindWrites: post ? post.blind : null,
      verifiedWrites: post ? post.verified : null,
    },
  };
}

function tallyDispositions(items: readonly ItemOutcome[]): Record<ItemDisposition, number> {
  const t: Record<ItemDisposition, number> = { created: 0, deduplicated: 0, rejected: 0, failed: 0 };
  for (const i of items) t[i.disposition]++;
  return t;
}

// ---------------------------------------------------------------------------
// Incidents — the observable consequence
// ---------------------------------------------------------------------------

export type IncidentSeverity = "info" | "warning" | "critical";

export type StageIncident = {
  stage: string;
  outcome: StageVerdictClass;
  severity: IncidentSeverity;
  /** One line, for a list an admin scans. */
  headline: string;
  /** WHY IT MATTERS — the consequence of leaving it alone. */
  whyItMatters: string;
  /** WHAT TO LOOK AT, concretely enough to start without asking anyone. */
  whereToLook: string[];
  observed: Record<string, number | string | boolean | null>;
};

/**
 * Turn a verdict into an incident, for the classes that warrant one.
 *
 * Returns null ONLY for a benign class with nothing suspicious about it. The
 * four always-incident classes and UNCLASSIFIED can never return null — that is
 * asserted in the tests rather than left as a comment, because "must always" in
 * prose is how the previous four bugs were prevented.
 */
export function incidentFor(verdict: StageVerdict): StageIncident | null {
  const base = { stage: verdict.stage, outcome: verdict.outcome, observed: verdict.observed };

  switch (verdict.outcome) {
    case "PERMISSION_FAILURE":
      return {
        ...base,
        severity: "critical",
        headline: `${verdict.stage}: denied by RLS or a missing grant`,
        whyItMatters:
          "A denial that returns zero rows and no error is indistinguishable from an empty result, so this stage " +
          "will keep reporting healthy runs while doing nothing. Everything downstream of it is starving and " +
          "nothing will say so.",
        whereToLook: [
          "Call the RPC or statement by hand as `anon` (engine jobs carry no cookies) and read what comes back.",
          "Check the table's RLS policies and the grants on the function — a revoked grant makes an object " +
            "INVISIBLE under Supabase, not forbidden, so it reports as 'not found in schema cache'.",
          "Confirm the function still exists at the exact signature the caller uses; a changed argument list " +
            "produces the same message.",
        ],
      };

    case "NO_OP_MUTATION":
      return {
        ...base,
        severity: "critical",
        headline: `${verdict.stage}: a write claimed success and changed nothing`,
        whyItMatters:
          "The stage's own report of what it did is now known to be wrong, and every readiness, health and " +
          "coverage number the engine publishes is computed FROM that report. One of these invalidates the " +
          "evidence base, not just the row it happened to.",
        whereToLook: [
          "The postcondition detail for this pass — it names the operation and the subject row, not just a count.",
          "Whether the mutation's target row exists and matches the filter the statement used.",
          "Whether the job computes its own status instead of deriving it from statusFromPostconditions().",
        ],
      };

    case "PARSER_FAILURE":
      return {
        ...base,
        severity: "critical",
        headline: `${verdict.stage}: we could not read the answer`,
        whyItMatters:
          "This is a defect in our own reader, not a finding about the world. Left alone it produces confident, " +
          "wrong, negative results — 'nothing found' rows that are later read as evidence that somebody looked. " +
          "The Commons regression refused four correctly-licensed photographs this way and read as an empty shelf.",
        whereToLook: [
          "The raw response body for the failing items, next to the field the reader claims to have extracted.",
          "The per-item reason codes: if they are all identical, the discriminator is not discriminating.",
          "Recent changes to the source's markup or API shape — an added field shifts a greedy pattern.",
        ],
      };

    case "STATE_TRANSITION_FAILURE":
      return {
        ...base,
        severity: "critical",
        headline: `${verdict.stage}: a state change did not take effect`,
        whyItMatters:
          "The stage believes it advanced something that did not move. Whatever consumes that state will never " +
          "see the work, both stages will report success, and the pipeline will look busy while nothing crosses " +
          "the join.",
        whereToLook: [
          "The read-back values recorded in the verdict — expected versus observed, per subject.",
          "Whether the UPDATE's WHERE clause still matches the row after an earlier stage changed it.",
          "Whether an RLS policy permits the SELECT but not the UPDATE, which produces a silent zero-row update.",
        ],
      };

    case "UNCLASSIFIED":
      return {
        ...base,
        severity: "critical",
        headline: `${verdict.stage}: evidence insufficient — cannot say what happened`,
        whyItMatters:
          verdict.ambiguity !== null
            ? AMBIGUITY_MEANINGS[verdict.ambiguity] +
              " Reported rather than resolved in favour of 'nothing to do', because resolving it that way is " +
              "exactly how the previous four incidents stayed invisible."
            : "The classifier could not name an outcome, and an unnameable outcome is a gap in observability " +
              "rather than a clean run.",
        whereToLook: [
          "The verdict's `because` list — it names which establishment was missing.",
          "Whether the stage supplies an InputProbe with an EmptinessProof stronger than 'zero_rows_only'.",
          "Whether every item the stage examines ends in a counted disposition.",
        ],
      };

    case "PROVIDER_FAILURE":
      return {
        ...base,
        severity: "warning",
        headline: `${verdict.stage}: the work did not happen — upstream did not answer`,
        whyItMatters:
          "The stage produced no finding about the world, only a finding about the network. If this is recorded " +
          "as 'nothing found' anywhere downstream, later passes will read it as evidence that the question was " +
          "already asked and answered.",
        whereToLook: [
          "Which providers were called, and which were never called at all.",
          "Rate-limit headers and the retry/backoff schedule for the failing source.",
          "Whether anything downstream persisted a negative result from this pass.",
        ],
      };

    case "CIRCUIT_BREAKER_HALT":
      return {
        ...base,
        severity: "info",
        headline: `${verdict.stage}: deliberately halted by a safety mechanism`,
        whyItMatters:
          "Nothing is wrong with the stage. It is recorded so that a halt is never mistaken for an idle queue, " +
          "and so the backlog accumulating behind the halt is visible while it lasts.",
        whereToLook: [
          "The breaker's own condition and what has to change for it to close.",
          "The size of the backlog the halt is accumulating.",
        ],
      };

    case "WORK_REJECTED":
    case "WORK_DEDUPLICATED":
    case "WORK_SUCCEEDED":
    case "NOTHING_TO_DO": {
      if (!verdict.uniformity) return null;
      const u = verdict.uniformity;
      return {
        ...base,
        severity: u.strength === "same_class" ? "info" : "warning",
        headline:
          `${verdict.stage}: all ${u.items} items ended the same way ('${u.disposition}'` +
          (u.reasonCode ? `, '${u.reasonCode}'` : "") +
          ") — suspicious uniformity",
        whyItMatters:
          `${u.items} identical outcomes is one rule applied ${u.items} times, not ${u.items} independent ` +
          "judgements. The class itself is legitimate, which is precisely why this needs saying out loud: a " +
          "systemic bug that fails closed produces a run that looks exactly like diligent work.",
        whereToLook: [
          "The per-item reason codes and the input each was judged on — pick two by hand and check the verdict.",
          "Whether the discriminator has EVER produced a different answer in recent passes.",
          `The threshold is UNIFORM_OUTCOME_MIN_ITEMS = ${UNIFORM_OUTCOME_MIN_ITEMS}; this run had ${u.items}.`,
        ],
      };
    }
  }
}

/** Incidents across a whole pass of several stages, worst first. */
export function incidentsFor(verdicts: readonly StageVerdict[]): StageIncident[] {
  const rank: Record<IncidentSeverity, number> = { critical: 0, warning: 1, info: 2 };
  return verdicts
    .map(incidentFor)
    .filter((i): i is StageIncident => i !== null)
    .sort((a, b) => rank[a.severity] - rank[b.severity]);
}

/**
 * Whether a set of verdicts contains anything that must stop a claim of health.
 *
 * Deliberately NOT "are there zero incidents" — an info-severity uniformity
 * note should not fail a run. Critical means the stage's report of itself is
 * untrustworthy.
 */
export function hasBlockingIncident(verdicts: readonly StageVerdict[]): boolean {
  return incidentsFor(verdicts).some((i) => i.severity === "critical");
}

// ---------------------------------------------------------------------------
// Bridges
// ---------------------------------------------------------------------------

/**
 * Render an incident in the shape health.ts's HealthFinding already has, so
 * these appear wherever health findings appear rather than requiring a second
 * dashboard nobody opens.
 *
 * Structural rather than an import: health.ts owns its own `kind` union and is
 * under active edit by another workstream, so this depends on its SHAPE and not
 * on its identity. The precise stage-outcome class is preserved in `observed`.
 */
export function incidentAsFinding(incident: StageIncident): {
  job: string;
  severity: "info" | "warning" | "critical";
  why: string;
  action: string;
  observed: Record<string, number | string | boolean | null>;
} {
  return {
    job: incident.stage,
    severity: incident.severity,
    why: `[STAGE_OUTCOME/${incident.outcome}] ${incident.headline}. ${incident.whyItMatters}`,
    action: incident.whereToLook.join(" "),
    observed: { ...incident.observed, stageOutcomeClass: incident.outcome },
  };
}

/**
 * The media-search taxonomy in src/lib/media/providers/outcome.ts, mapped onto
 * this one.
 *
 * That module came first and is deliberately richer inside its own domain
 * (RIGHTS_UNCERTAIN and PROVENANCE_INCOMPLETE are both "declined on the merits"
 * here, and the difference between them matters enormously to a media editor
 * and not at all to a stage-health dashboard). This function exists so a media
 * pass can report into the shared vocabulary WITHOUT this module importing that
 * one — it takes the state as a plain string, so the two files stay independent
 * and neither becomes a dependency of the other's tests.
 */
export function fromSearchOutcomeState(state: string): StageOutcomeClass | "UNCLASSIFIED" {
  switch (state) {
    case "USABLE_CANDIDATE_FOUND":
      return "WORK_SUCCEEDED";
    case "NO_RESULTS":
      // Safe to map to the benign class because that module's NO_RESULTS is
      // itself positively established — it demands a provider attestation or an
      // explicit `no_results` status and never falls through to it.
      return "NOTHING_TO_DO";
    case "WRONG_ENTITY_RESULTS":
    case "RIGHTS_UNCERTAIN":
    case "PROVENANCE_INCOMPLETE":
      return "WORK_REJECTED";
    case "PROVIDER_PARSE_FAILURE":
      return "PARSER_FAILURE";
    case "PROVIDER_OUTAGE":
      return "PROVIDER_FAILURE";
    default:
      // An unknown state from a module that may have grown a new one. Not
      // silently benign.
      return "UNCLASSIFIED";
  }
}
