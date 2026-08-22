// Which stages PRODUCE and which merely ASSESS.
//
// WHY THIS IS ITS OWN MODULE
// --------------------------
// It used to live inside silent-success.ts, and health.ts could not import it
// without a cycle (silent-success.ts imports HealthFinding from health.ts). So
// health.ts simply did not have it — and the two files, which implement the
// SAME detector, drifted:
//
//   silent-success.ts detector #5 honoured the role.
//   silent-success.ts detector #1 did not.
//   health.ts's equivalent of detector #1 did not, and could not.
//
// The consequence was live and expensive. engine_internal_links sets
// examined = every published article, finds zero orphans — its goal — and
// reports success. That row fired a CRITICAL success_no_effect in BOTH files,
// opened the silent_success breaker, and halted creation, media_acquisition and
// publication. The engine stopped writing articles because the site was in good
// shape, and started again only when it got worse.
//
// A shared definition in a module both can import is what stops that recurring.
// Pure data and one lookup; no imports, no I/O.

export type StageRole = "producer" | "assessor";

export type StageEffect = {
  job: string;
  role: StageRole;
  /** Stages that consume what this one produces, by job name. */
  feeds: readonly string[];
  /** What a row created by this stage IS, for the message text. */
  produces: string;
};

export const STAGE_EFFECTS: readonly StageEffect[] = [
  { job: "engine_discover", role: "producer", feeds: ["engine_relevance"], produces: "a candidate discovery" },
  { job: "engine_relevance", role: "producer", feeds: ["engine_briefs", "engine_update_proposals", "engine_product_assembly"], produces: "a relevance verdict" },
  { job: "engine_update_proposals", role: "assessor", feeds: [], produces: "an update proposal against an existing page" },
  { job: "engine_product_assembly", role: "assessor", feeds: [], produces: "an unpublished product shell" },
  { job: "engine_briefs", role: "producer", feeds: ["engine_draft_assembly"], produces: "a research brief" },
  // Assembly consumes only HUMAN-APPROVED briefs, so it is legitimately idle
  // whenever nobody has approved one. Judging it as a producer would flag the
  // editor's inbox as an engine fault.
  { job: "engine_draft_assembly", role: "assessor", feeds: [], produces: "a draft article" },
  { job: "engine_search_intelligence", role: "producer", feeds: ["engine_opportunities", "engine_trends"], produces: "an aggregated search row" },
  { job: "engine_opportunities", role: "producer", feeds: [], produces: "an opportunity score" },
  { job: "engine_trends", role: "producer", feeds: [], produces: "a trend measurement" },
  { job: "engine_media_acquisition", role: "assessor", feeds: [], produces: "a media candidate" },
  { job: "engine_freshness", role: "assessor", feeds: [], produces: "a freshness review" },
  { job: "engine_internal_links", role: "assessor", feeds: [], produces: "an orphan report" },
  { job: "engine_hero_media", role: "assessor", feeds: [], produces: "a weak-hero requirement" },
];

export function stageEffectOf(job: string): StageEffect | null {
  return STAGE_EFFECTS.find((s) => s.job === job) ?? null;
}
