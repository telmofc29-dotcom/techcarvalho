// The shadow decision: one explicit outcome per candidate, or an honest failure.
//
// WHAT A SHADOW DECISION IS
// -------------------------
// SHADOW runs the complete autonomous decision process and publishes nothing.
// The record it leaves behind is the evidence on which autonomy would later be
// granted, which means the record has to be harder to produce than the
// publication would have been. Two rules make that true:
//
//  1. EXACTLY ONE OUTCOME PER CANDIDATE. WOULD_PUBLISH, WOULD_REJECT or
//     HUMAN_REVIEW_REQUIRED. Not a score, not a ranking, not "mostly fine".
//     A decision that cannot be stated in one word has not been made.
//
//  2. A CRASH IS NOT A DECISION. If a stage throws, the candidate produces a
//     FAILURE record with no outcome at all. This is the rule that stops the
//     easiest possible cheat: wrapping every stage in a try/catch, calling the
//     caught case "HUMAN_REVIEW_REQUIRED", and banking 500 crashes as 500
//     decisions. A crashed pipeline has demonstrated nothing except that it
//     crashed, and it is counted separately for exactly that reason.
//
// STRUCTURAL INABILITY TO PUBLISH
// -------------------------------
// Nothing in this module, or anywhere in the shadow path, can publish. There is
// no code path from a WOULD_PUBLISH outcome to a write against `content_items`
// or `products` — the outcome is a string in a log table. `SHADOW_MAY_PUBLISH`
// below is a documented constant rather than a switch: flipping it changes
// nothing, because there is no publishing call for it to guard. That is the
// same argument modes.ts makes about the engine as a whole, and it holds here
// for the same reason: the capability does not exist to be enabled.
//
// Deterministic and pure. No I/O, no clock, no `server-only`.

import type { GateVerdict, Blocker } from "./publication-gate.ts";
import type { ReviewResult, ReviewFinding } from "./reviewer.ts";

// ---------------------------------------------------------------------------
// Stages
// ---------------------------------------------------------------------------

/**
 * The complete autonomous decision process, in order.
 *
 * Every stage runs for every candidate that reaches it. A candidate that fails
 * closed at an early stage still has a full record of the stages that DID run,
 * so "we never got that far" is distinguishable from "that check passed".
 */
export const SHADOW_STAGES = [
  "discovery",
  "relevance",
  "opportunity",
  "research",
  "entity_resolution",
  "evidence",
  "brief",
  "assembly",
  "media_acquisition",
  "media_rights",
  "seo_internal_linking",
  "freshness",
  "adversarial_review",
  "publication_gate",
  "final_decision",
] as const;

export type ShadowStage = (typeof SHADOW_STAGES)[number];

/** The stage from which a decision counts as having done the expensive work. */
export const GATE_STAGE: ShadowStage = "publication_gate";

export type ShadowStageStatus =
  /** Ran, and found no reason to stop. */
  | "passed"
  /** Ran, and concluded the candidate goes no further. A real decision. */
  | "fail_closed"
  /** Ran, and concluded a person has to decide. Also a real decision. */
  | "needs_human"
  /** Never reached, because an earlier stage stopped the candidate. */
  | "not_reached"
  /** Threw. Not a decision — see the module header. */
  | "error";

export type ShadowStageRecord = {
  stage: ShadowStage;
  status: ShadowStageStatus;
  /** What this stage concluded, in words an editor can act on. */
  summary: string;
  /** Concrete pointers: urls, ids, claim texts, codes. Never a vague gesture. */
  detail: string[];
};

// ---------------------------------------------------------------------------
// Outcome
// ---------------------------------------------------------------------------

export type ShadowOutcome = "WOULD_PUBLISH" | "WOULD_REJECT" | "HUMAN_REVIEW_REQUIRED";

export type ShadowRecordKind =
  /** A decision was reached. Countable as readiness evidence. */
  | "decision"
  /** A stage threw. Countable only as a failure. */
  | "failure";

export type ShadowReason = {
  /** Machine code, so reasons can be counted rather than read one by one. */
  code: string;
  /** Which stage produced it. */
  stage: ShadowStage;
  severity: "blocker" | "serious" | "caution" | "note";
  message: string;
  detail: string[];
};

export type ShadowDecision = {
  kind: ShadowRecordKind;
  /** Null if and only if kind === "failure". */
  outcome: ShadowOutcome | null;
  /** The stage at which the process stopped. For a completed run, "final_decision". */
  terminalStage: ShadowStage;
  /** Whether the publication gate was actually reached and run. */
  reachedGate: boolean;
  stages: ShadowStageRecord[];
  reasons: ShadowReason[];
  /** Hard blockers, extracted for counting. A subset of `reasons`. */
  blockers: ShadowReason[];
  /** Set only for kind === "failure". */
  failedStage: ShadowStage | null;
  failureError: string | null;
  explanation: string;
};

/**
 * Whether SHADOW may publish. Always false, and there is no code that reads it
 * as permission — it exists so the answer is written down somewhere greppable.
 * See the module header for why a constant is not the mechanism.
 */
export const SHADOW_MAY_PUBLISH = false as const;

// ---------------------------------------------------------------------------
// Reason construction
// ---------------------------------------------------------------------------

export function reasonFromGateBlocker(blocker: Blocker): ShadowReason {
  return {
    code: blocker.code,
    stage: "publication_gate",
    severity: "blocker",
    message: blocker.message,
    detail: blocker.evidence ? [blocker.evidence] : [],
  };
}

export function reasonFromFinding(finding: ReviewFinding): ShadowReason {
  return {
    code: finding.code,
    stage: "adversarial_review",
    severity: finding.severity,
    message: finding.message,
    detail: finding.detail,
  };
}

/** Gate blockers that mean "could not determine", not "is disqualified". */
const UNDETERMINED_BLOCKER_CODES = new Set(["check_unavailable"]);

// ---------------------------------------------------------------------------
// The decision
// ---------------------------------------------------------------------------

export type DecisionInput = {
  stages: ShadowStageRecord[];
  /** Undefined when the candidate failed closed before the gate. */
  gate?: GateVerdict;
  /** Undefined when the candidate failed closed before the reviewer. */
  review?: ReviewResult;
  /** Reasons gathered by stages before the reviewer and gate. */
  earlyReasons: ShadowReason[];
};

/**
 * Turn a completed (or curtailed) pipeline run into exactly one outcome.
 *
 * PRECEDENCE, and why it is this way round:
 *
 *   WOULD_REJECT  >  HUMAN_REVIEW_REQUIRED  >  WOULD_PUBLISH
 *
 * A definite disqualifier is a definite answer, so it outranks uncertainty —
 * sending a piece with an unlicensed image to a human queue as though the
 * question were open would waste the reviewer's time and, worse, imply the
 * engine could not tell. Uncertainty outranks approval for the obvious reason:
 * "no check objected" and "every check ran and passed" are different, and only
 * the second is grounds for publishing.
 *
 * A blocker that means "this check could not be run" produces
 * HUMAN_REVIEW_REQUIRED rather than WOULD_REJECT. It is still fail-closed —
 * nothing publishes — but recording it as a rejection would attribute to the
 * candidate a fault that belongs to the infrastructure, and would quietly
 * inflate the rejection rate with outages.
 */
export function decideShadowOutcome(input: DecisionInput): ShadowDecision {
  const { stages, gate, review, earlyReasons } = input;

  // --- A crash is not a decision -----------------------------------------
  const errored = stages.find((s) => s.status === "error");
  if (errored) {
    return {
      kind: "failure",
      outcome: null,
      terminalStage: errored.stage,
      reachedGate: false,
      stages,
      reasons: earlyReasons,
      blockers: earlyReasons.filter((r) => r.severity === "blocker"),
      failedStage: errored.stage,
      failureError: errored.summary,
      explanation:
        `NO DECISION — the ${errored.stage} stage failed with an error, so this candidate was never actually evaluated. ` +
        `A crashed pipeline demonstrates nothing about the engine's judgement and is counted as a failure, not as a decision. ` +
        `Error: ${errored.summary}`,
    };
  }

  const reasons: ShadowReason[] = [...earlyReasons];
  if (review) for (const f of review.findings) reasons.push(reasonFromFinding(f));
  if (gate) for (const b of gate.blockers) reasons.push(reasonFromGateBlocker(b));

  const blockers = reasons.filter((r) => r.severity === "blocker");
  const reachedGate = gate !== undefined;

  // --- Fail-closed before the gate ---------------------------------------
  // A candidate the pipeline stopped early is a legitimate decision, provided
  // the stopping stage actually decided something rather than crashing.
  const stopped = stages.find((s) => s.status === "fail_closed");
  const humanStop = stages.find((s) => s.status === "needs_human");

  if (!reachedGate) {
    if (stopped) {
      return {
        kind: "decision",
        outcome: "WOULD_REJECT",
        terminalStage: stopped.stage,
        reachedGate: false,
        stages,
        reasons,
        blockers,
        failedStage: null,
        failureError: null,
        explanation:
          `WOULD_REJECT at the ${stopped.stage} stage: ${stopped.summary} ` +
          `This is a fail-closed decision taken before the expensive stages ran, which is a real decision but a cheap one — ` +
          `it exercises ${stages.filter((s) => s.status !== "not_reached").length} of ${SHADOW_STAGES.length} stages.`,
      };
    }
    if (humanStop) {
      return {
        kind: "decision",
        outcome: "HUMAN_REVIEW_REQUIRED",
        terminalStage: humanStop.stage,
        reachedGate: false,
        stages,
        reasons,
        blockers,
        failedStage: null,
        failureError: null,
        explanation:
          `HUMAN_REVIEW_REQUIRED at the ${humanStop.stage} stage: ${humanStop.summary} ` +
          `The engine could not resolve this itself and stopped rather than guessing.`,
      };
    }
    // Neither stopped nor reached the gate, and nothing errored. That is an
    // orchestration bug, and the fail-closed reading is that no decision was
    // reached — never a pass.
    return {
      kind: "failure",
      outcome: null,
      terminalStage: stages[stages.length - 1]?.stage ?? "discovery",
      reachedGate: false,
      stages,
      reasons,
      blockers,
      failedStage: null,
      failureError:
        "The pipeline neither reached the publication gate nor recorded a stage that stopped the candidate. " +
        "That is an orchestration defect, not a verdict, so no decision is recorded.",
      explanation:
        "NO DECISION — the pipeline ended without reaching the publication gate and without any stage having decided to stop. " +
        "Recording an outcome here would be inventing one.",
    };
  }

  // --- The gate ran -------------------------------------------------------
  const gateBlockers = gate.blockers;
  const disqualifying = gateBlockers.filter((b) => !UNDETERMINED_BLOCKER_CODES.has(b.code));
  const undetermined = gateBlockers.filter((b) => UNDETERMINED_BLOCKER_CODES.has(b.code));
  const reviewRejects = review?.verdict === "reject";
  const reviewHolds = review?.verdict === "hold_for_human" || review?.verdict === "revise";
  const sevenDayFails = review ? !review.sevenDay.wouldPublishUnattended : false;

  let outcome: ShadowOutcome;
  let why: string;

  if (disqualifying.length > 0 || reviewRejects) {
    outcome = "WOULD_REJECT";
    const codes = [...new Set([...disqualifying.map((b) => b.code), ...(review?.blockers ?? []).map((f) => f.code)])];
    why =
      `${disqualifying.length} disqualifying gate blocker(s)` +
      (reviewRejects ? ` and an adversarial-review REJECT verdict` : "") +
      `: ${codes.join(", ")}.`;
  } else if (undetermined.length > 0) {
    outcome = "HUMAN_REVIEW_REQUIRED";
    why =
      `Nothing disqualified this, but ${undetermined.length} check(s) could not be run ` +
      `(${gate.unavailableChecks.join(", ")}). A check that did not run is not a check that passed, so this stops here.`;
  } else if (reviewHolds || sevenDayFails) {
    outcome = "HUMAN_REVIEW_REQUIRED";
    why =
      (reviewHolds ? `The adversarial reviewer returned "${review?.verdict}". ` : "") +
      (sevenDayFails ? `It also fails the seven-day question: ${review?.sevenDay.explanation}` : "");
  } else if (!review) {
    // The gate cleared it but the adversarial reviewer never ran. One check
    // agreeing with itself is not two opinions.
    outcome = "HUMAN_REVIEW_REQUIRED";
    why =
      "The publication gate found no blockers, but the adversarial review did not run. " +
      "A single clean check is not corroboration, so this cannot be recorded as WOULD_PUBLISH.";
  } else {
    outcome = "WOULD_PUBLISH";
    why =
      `Every stage ran. The gate found no hard blockers across ${gate.dimensions.length} scored dimension(s), ` +
      `the independent adversarial reviewer returned "no_objection", and the piece passes the seven-day question. ` +
      `Nothing was published: SHADOW records the decision and stops.`;
  }

  return {
    kind: "decision",
    outcome,
    terminalStage: "final_decision",
    reachedGate: true,
    stages,
    reasons,
    blockers,
    failedStage: null,
    failureError: null,
    explanation: `${outcome} — ${why}`,
  };
}

// ---------------------------------------------------------------------------
// Aggregation
// ---------------------------------------------------------------------------

export type ShadowOutcomeSplit = Record<ShadowOutcome, number>;

export type ShadowRunTally = {
  candidates: number;
  decisions: number;
  failures: number;
  outcomes: ShadowOutcomeSplit;
  reachedGate: number;
  /** Per-stage count of how often that stage was the terminal one. */
  terminalStages: Record<string, number>;
  /** Per-code count across every reason recorded. */
  reasonCodes: Record<string, number>;
};

export function tallyShadowRun(decisions: readonly ShadowDecision[]): ShadowRunTally {
  const outcomes: ShadowOutcomeSplit = {
    WOULD_PUBLISH: 0,
    WOULD_REJECT: 0,
    HUMAN_REVIEW_REQUIRED: 0,
  };
  const terminalStages: Record<string, number> = {};
  const reasonCodes: Record<string, number> = {};
  let decisionCount = 0;
  let failureCount = 0;
  let reachedGate = 0;

  for (const d of decisions) {
    if (d.kind === "decision" && d.outcome) {
      decisionCount++;
      outcomes[d.outcome]++;
    } else {
      failureCount++;
    }
    if (d.reachedGate) reachedGate++;
    terminalStages[d.terminalStage] = (terminalStages[d.terminalStage] ?? 0) + 1;
    for (const r of d.reasons) reasonCodes[r.code] = (reasonCodes[r.code] ?? 0) + 1;
  }

  return {
    candidates: decisions.length,
    decisions: decisionCount,
    failures: failureCount,
    outcomes,
    reachedGate,
    terminalStages,
    reasonCodes,
  };
}
