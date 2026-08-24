// Stage name -> the engine_job_runs job name it records under.
//
// WHY THIS IS ITS OWN MODULE RATHER THAN A CONST IN route.ts
// ----------------------------------------------------------
// The tick route reasons in STAGE names; the guard reasons in JOB names
// (capability, budget and health telemetry are all keyed by job). The mapping
// between them is therefore load-bearing safety configuration, and it had
// already drifted: shadow-job.ts recorded under "engine_shadow" while the route
// mapped the stage to "engine_shadow_evaluation" — a third string that existed
// nowhere else. capabilityOf() returned null, and the stage ran with no
// circuit-breaker check and no concurrency-lease check at all.
//
// route.ts imports `server-only` (transitively, through every job it pulls in),
// which throws outside Next.js — so nothing in that file can be unit tested. A
// map that cannot be tested is a map that drifts. Lifting it here, where there
// is no server-only import, means stages.test.ts can assert that every stage
// resolves to a registered job, and a future stage added without a
// concurrency.ts entry fails the test run instead of silently losing its gate
// in production.
//
// Pure data. No imports, no I/O.

/**
 * Every stage the engine tick runs, by name.
 *
 * This list is the SINGLE SOURCE OF TRUTH for what a stage is. route.ts pairs
 * each name with its runner function and is typed against this list, so a stage
 * added to the route without an entry here is a COMPILE error rather than a
 * runtime surprise.
 *
 * That ordering matters. The runtime already fails closed — an unmapped stage
 * is halted by route.ts and an unregistered job is refused by guard.gateFor().
 * But a stage that silently halts on every tick is a stage that never runs, and
 * "it fails closed" is a poor consolation for a capability that quietly stopped
 * existing. Catching it at build time is the difference between a bug that
 * cannot ship and a bug that ships and hides.
 */
export const ENGINE_STAGE_NAMES = [
  "discovery",
  "relevance",
  "research",
  "update_proposals",
  "product_assembly",
  "briefs",
  "draft_assembly",
  "search_intelligence",
  "opportunities",
  "trends",
  "media_acquisition",
  "freshness",
  "internal_links",
  "hero_media",
  "spotlight",
  "shadow_evaluation",
] as const;

export type EngineStageName = (typeof ENGINE_STAGE_NAMES)[number];

/**
 * Typed as a TOTAL map over EngineStageName, not Record<string, string>.
 *
 * With `Record<string, string>` a missing stage simply produced `undefined` at
 * runtime. As a total record, omitting one fails to compile — which is what
 * makes the invariant structural rather than a convention somebody has to
 * remember.
 */
export const STAGE_JOB_NAMES: Record<EngineStageName, string> = {
  discovery: "engine_discover",
  relevance: "engine_relevance",
  research: "engine_research",
  update_proposals: "engine_update_proposals",
  product_assembly: "engine_product_assembly",
  briefs: "engine_briefs",
  draft_assembly: "engine_draft_assembly",
  search_intelligence: "engine_search_intelligence",
  opportunities: "engine_opportunities",
  trends: "engine_trends",
  media_acquisition: "engine_media_acquisition",
  freshness: "engine_freshness",
  internal_links: "engine_internal_links",
  hero_media: "engine_hero_media",
  spotlight: "engine_spotlight",
  // "engine_shadow", NOT "engine_shadow_evaluation" — see the note above.
  shadow_evaluation: "engine_shadow",
};
