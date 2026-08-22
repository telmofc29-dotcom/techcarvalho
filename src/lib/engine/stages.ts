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

export const STAGE_JOB_NAMES: Record<string, string> = {
  discovery: "engine_discover",
  relevance: "engine_relevance",
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
  // "engine_shadow", NOT "engine_shadow_evaluation" — see the note above.
  shadow_evaluation: "engine_shadow",
};
