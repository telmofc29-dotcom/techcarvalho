// PER-STAGE OPERATING MODES — MANUAL / ASSISTED / AUTOMATIC.
//
// WHAT EACH MODE ACTUALLY DOES
// ----------------------------
// These are enforced, not labels. The tick reads them and behaves differently.
//
//   MANUAL     The stage does not run on the scheduled tick at all. It runs
//              only when a human asks for it. Use when you want the engine to
//              stop touching an area entirely without disabling the whole
//              engine.
//
//   ASSISTED   The stage runs and produces work, but anything it produces that
//              needs a judgement waits for a human. This is the default
//              everywhere, and it is what the engine has always done.
//
//   AUTOMATIC  The stage runs AND its mechanical follow-up decisions are taken
//              without asking. Only decisions that are genuinely mechanical
//              qualify — see AUTOMATIC_CAPABILITY below, which is the whole
//              safety argument of this file.
//
// WHY AUTOMATIC IS NOT AVAILABLE EVERYWHERE
// -----------------------------------------
// The obvious implementation — "AUTOMATIC means skip the human" — is wrong,
// because for most stages the human is not a rubber stamp standing between the
// engine and an outcome it already computed. They are supplying a judgement the
// engine genuinely cannot make: whether TechCarvalho should cover a story,
// whether a third party's licence permits republication, whether an ageing page
// should be rewritten or retired.
//
// So AUTOMATIC is declared per stage as a CAPABILITY rather than accepted as a
// setting. Where no safe mechanical decision exists, selecting AUTOMATIC is
// refused and reported — it does not silently degrade to ASSISTED, because a
// setting that appears to be on and does nothing is exactly the "display-only"
// failure this replaces.
//
// WHAT NO MODE CAN EVER DO
// ------------------------
// Publish. `engine_assemble_draft` is SECURITY DEFINER and hard-wires
// `status='draft'`; `engine_assemble_product` hard-wires `is_published=false`.
// There is no publishing RPC for the engine to call in any mode. AUTOMATIC on
// every stage simultaneously still cannot put a page in front of a reader.
// That boundary is structural and is not represented here, because it is not a
// setting that could be got wrong.
//
// PURE. No `server-only`, no Supabase.

import { ENGINE_STAGE_NAMES, type EngineStageName } from "./stages.ts";

export type StageMode = "MANUAL" | "ASSISTED" | "AUTOMATIC";

export const STAGE_MODES: readonly StageMode[] = ["MANUAL", "ASSISTED", "AUTOMATIC"] as const;

export const STAGE_MODE_LABELS: Record<StageMode, string> = {
  MANUAL: "Manual",
  ASSISTED: "Assisted",
  AUTOMATIC: "Automatic",
};

export const STAGE_MODE_DESCRIPTIONS: Record<StageMode, string> = {
  MANUAL: "Does not run on the nightly tick. Runs only when you ask for it.",
  ASSISTED: "Runs and prepares the work. Anything needing a judgement waits for you.",
  AUTOMATIC: "Runs and takes the mechanical follow-up decisions without asking.",
};

// ---------------------------------------------------------------------------
// What AUTOMATIC would mean, per stage
// ---------------------------------------------------------------------------

/**
 * The mechanical decision a stage takes for itself under AUTOMATIC, or `null`
 * when there is none and AUTOMATIC is therefore refused.
 *
 * Typed as a TOTAL record over EngineStageName: adding a stage without deciding
 * this question fails to COMPILE. That is deliberate — the default answer for a
 * new stage must be an explicit one, and "nobody thought about it" must not be
 * able to arrive in production as an enabled automation.
 */
export const AUTOMATIC_CAPABILITY: Record<EngineStageName, string | null> = {
  // Already fully mechanical: they read sources and classify. There is no human
  // decision inside them to skip, so AUTOMATIC is meaningful only as a label —
  // and a label is what this file exists to refuse.
  discovery: null,
  relevance: null,
  search_intelligence: null,
  opportunities: null,
  trends: null,
  shadow_evaluation: null,

  // Genuinely automatable, and safely.
  briefs:
    "Briefs that fail the evidence gate are filed to the research backlog without " +
    "appearing in your queue, instead of waiting for you to dismiss them one by one.",
  media_acquisition:
    "Candidates whose rights are ALREADY established (confirmed usable, no human review " +
    "flag) are accepted. Anything unproven still stops and asks — rights are never guessed.",
  internal_links:
    "Suggested internal links between published pages are applied, rather than queued as " +
    "suggestions.",
  hero_media:
    "A published page with no hero image is given one from assets already cleared and " +
    "published. Never from anything unpublished or unverified.",

  // NOT automatable. Each of these is a real editorial or legal judgement, and
  // the reason is stated so the refusal is arguable rather than arbitrary.
  update_proposals: null,
  product_assembly: null,
  draft_assembly: null,
  freshness: null,
};

/** Why AUTOMATIC is refused, for the stages that refuse it. */
export const AUTOMATIC_REFUSAL: Partial<Record<EngineStageName, string>> = {
  discovery: "Already fully automatic — there is no human decision inside this stage.",
  relevance: "Already fully automatic — there is no human decision inside this stage.",
  search_intelligence: "Already fully automatic — it only aggregates first-party signals.",
  opportunities: "Already fully automatic — it only scores, and refuses to score without data.",
  trends: "Already fully automatic — it only measures.",
  shadow_evaluation: "Already fully automatic — it decides nothing, it only records evidence.",
  update_proposals:
    "Whether a change warrants rewriting a published page is an editorial judgement, not a " +
    "mechanical one.",
  product_assembly:
    "Creating a product means deciding what it IS. Specifications are never inferred, so there " +
    "is nothing safe to decide automatically.",
  draft_assembly:
    "Assembly consumes only briefs a human approved, and that approval is the editorial decision " +
    "itself. Automating it would mean deciding what TechCarvalho covers without being asked.",
  freshness:
    "Whether an ageing page should be updated, rewritten or retired depends on why it aged. " +
    "Only a human can tell those apart.",
};

export function automaticIsAvailable(stage: EngineStageName): boolean {
  return AUTOMATIC_CAPABILITY[stage] !== null;
}

// ---------------------------------------------------------------------------
// Defaults
// ---------------------------------------------------------------------------

/**
 * ASSISTED everywhere.
 *
 * The owner's instruction was explicit — default conservatively to ASSISTED —
 * and this is also the mode that matches what the engine already did, so
 * applying the migration changes no behaviour until somebody deliberately
 * changes a setting. A migration that silently alters how a running system
 * behaves is a bad migration regardless of which direction it moves.
 */
export const DEFAULT_STAGE_MODE: StageMode = "ASSISTED";

export const DEFAULT_STAGE_MODES: Record<EngineStageName, StageMode> = Object.fromEntries(
  ENGINE_STAGE_NAMES.map((s) => [s, DEFAULT_STAGE_MODE])
) as Record<EngineStageName, StageMode>;

// ---------------------------------------------------------------------------
// Resolution
// ---------------------------------------------------------------------------

export type StageModeResolution = {
  stage: EngineStageName;
  mode: StageMode;
  /** The mode that was asked for, when it differs from what was granted. */
  requested: StageMode | null;
  /** Set when `requested` was refused. */
  refusedBecause: string | null;
};

/**
 * Resolve one stage's effective mode from whatever is stored.
 *
 * Fails closed in every direction:
 *   - unknown/garbage stored value        -> ASSISTED
 *   - AUTOMATIC where it is unavailable   -> ASSISTED, with the reason recorded
 *   - nothing stored at all               -> ASSISTED
 *
 * Never fails closed to MANUAL, which would look like the engine breaking, and
 * never fails open to AUTOMATIC.
 */
export function resolveStageMode(
  stage: EngineStageName,
  stored: unknown
): StageModeResolution {
  const asMode = isStageMode(stored) ? stored : null;

  if (asMode === null) {
    return { stage, mode: DEFAULT_STAGE_MODE, requested: null, refusedBecause: null };
  }

  if (asMode === "AUTOMATIC" && !automaticIsAvailable(stage)) {
    return {
      stage,
      mode: DEFAULT_STAGE_MODE,
      requested: "AUTOMATIC",
      refusedBecause:
        AUTOMATIC_REFUSAL[stage] ?? "Automatic mode is not available for this stage.",
    };
  }

  return { stage, mode: asMode, requested: asMode, refusedBecause: null };
}

export function isStageMode(value: unknown): value is StageMode {
  return value === "MANUAL" || value === "ASSISTED" || value === "AUTOMATIC";
}

/**
 * Resolve every stage at once from a stored map.
 *
 * Accepts `null`/malformed input and returns a complete, valid map — the tick
 * must never be unable to decide whether to run a stage because a settings row
 * was shaped unexpectedly.
 */
export function resolveAllStageModes(
  stored: unknown
): Record<EngineStageName, StageModeResolution> {
  const source =
    stored && typeof stored === "object" && !Array.isArray(stored)
      ? (stored as Record<string, unknown>)
      : {};
  return Object.fromEntries(
    ENGINE_STAGE_NAMES.map((s) => [s, resolveStageMode(s, source[s])])
  ) as Record<EngineStageName, StageModeResolution>;
}

// ---------------------------------------------------------------------------
// The question the tick asks
// ---------------------------------------------------------------------------

/**
 * Whether the scheduled tick should run this stage.
 *
 * MANUAL is the only mode that stops a stage. This is the enforcement point
 * that makes modes real rather than decorative, and it is deliberately the
 * simplest possible rule so that "why did this not run?" always has a
 * one-sentence answer.
 */
export function tickShouldRun(mode: StageMode): boolean {
  return mode !== "MANUAL";
}

/** Whether a stage may take its own mechanical follow-up decision. */
export function mayDecideUnattended(stage: EngineStageName, mode: StageMode): boolean {
  return mode === "AUTOMATIC" && automaticIsAvailable(stage);
}

/**
 * A one-line summary for the settings UI.
 *
 * Written for someone deciding what to set, so it names the CONSEQUENCE rather
 * than restating the mode.
 */
export function describeStageMode(stage: EngineStageName, mode: StageMode): string {
  if (mode === "MANUAL") return "Will not run on the nightly tick.";
  if (mode === "ASSISTED") return "Runs nightly. Anything needing a judgement waits for you.";
  const capability = AUTOMATIC_CAPABILITY[stage];
  return capability
    ? `Runs nightly. ${capability}`
    : `Automatic is not available here — ${AUTOMATIC_REFUSAL[stage] ?? "no safe mechanical decision exists."}`;
}
