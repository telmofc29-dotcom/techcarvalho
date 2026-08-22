import { NextResponse, type NextRequest } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { checkCronAuth, newCounters, recordJobRun } from "@/lib/engine/cron";
import { runDiscovery } from "@/lib/engine/jobs/discovery";
import { runRelevance } from "@/lib/engine/jobs/relevance-job";
import { runBriefGeneration } from "@/lib/engine/jobs/brief-job";
import { runOpportunityScoring } from "@/lib/engine/jobs/opportunity-job";
import { runSearchIntelligence } from "@/lib/engine/jobs/search-job";
import { runFreshness } from "@/lib/engine/jobs/freshness-job";
import { runTrends } from "@/lib/engine/jobs/trend-job";
import { runMediaAcquisition } from "@/lib/engine/jobs/media-acquisition-job";
import { runUpdateProposals } from "@/lib/engine/jobs/update-job";
import { runDraftAssembly } from "@/lib/engine/jobs/draft-job";
import { runProductAssembly } from "@/lib/engine/jobs/product-job";
import { runInternalLinks } from "@/lib/engine/jobs/link-job";

const JOB = "engine_tick";

// The single orchestrated engine pass. ONE Vercel Cron entry drives every
// engine capability, in pipeline order:
//
//   discover -> relevance -> update proposals -> product assembly -> brief
//     -> draft assembly -> search intelligence -> opportunity -> trends
//     -> media acquisition -> freshness -> internal links
//
// That order is the editorial pipeline made literal: find something, decide if
// it matters, check whether we already cover it (and update rather than
// duplicate if so), then plan, assemble, measure and finally audit the shape of
// the site itself.
//
// This is the deliberate answer to the Hobby-plan two-cron limit: capabilities
// are added as stages here, never as new cron entries, so the architecture
// scales to many jobs without needing one schedule per capability.
//
// Each stage is independently flag-gated (so any can be disabled without
// touching the others) and independently failure-isolated in its own try/catch
// (so one throwing stage cannot abort the pass). Every stage writes its own
// engine_job_runs row, and the tick writes a summary row — failures are
// recorded rather than swallowed.
//
// Stages run in dependency order on purpose: relevance must see the
// discoveries this pass created, and briefs must see this pass's relevance
// verdicts. Running them on independent schedules would introduce a lag of a
// full cycle between each stage.
const STAGES = [
  ["discovery", runDiscovery],
  ["relevance", runRelevance],
  // Update proposals run BEFORE briefs so a discovery describing a change to
  // something already covered is recorded against the existing page. An editor
  // then decides update-vs-new-article with both options visible.
  ["update_proposals", runUpdateProposals],
  // Product assembly runs after update proposals for the same reason: a
  // discovery about a product we already have becomes an update, not a second
  // product row. It creates unpublished shells only — no specs, no pricing.
  ["product_assembly", runProductAssembly],
  ["briefs", runBriefGeneration],
  // Assembly turns HUMAN-APPROVED briefs into drafts. It runs after brief
  // generation but only ever consumes briefs approved in an earlier pass —
  // nothing generated in this same tick can reach it, because approval is a
  // human action.
  ["draft_assembly", runDraftAssembly],
  ["search_intelligence", runSearchIntelligence],
  ["opportunities", runOpportunityScoring],
  // Trends run after search/opportunity so they see this pass's aggregates.
  ["trends", runTrends],
  // Media acquisition runs late: it proposes routes to unblock inventory but
  // cannot ingest or approve anything itself.
  ["media_acquisition", runMediaAcquisition],
  ["freshness", runFreshness],
  // Orphan detection runs last: it judges the state of the site AFTER
  // everything else in this pass has had its effect.
  ["internal_links", runInternalLinks],
] as const;

export async function GET(request: NextRequest) {
  const unauthorized = checkCronAuth(request);
  if (unauthorized) return unauthorized;

  const supabase = await createClient();
  const startedAt = Date.now();
  const stages: Record<string, unknown> = {};
  let anyFailed = false;
  let anySkipped = false;

  for (const [name, run] of STAGES) {
    try {
      const result = await run(supabase);
      stages[name] = result;
      if (result.status === "failed") anyFailed = true;
      if (result.status === "skipped") anySkipped = true;
    } catch (e) {
      anyFailed = true;
      stages[name] = { status: "error", error: e instanceof Error ? e.message : String(e) };
    }
  }

  const durationMs = Date.now() - startedAt;
  const status = anyFailed ? "partial" : anySkipped ? "success" : "success";
  await recordJobRun(supabase, JOB, status, newCounters(), { stages, durationMs });

  return NextResponse.json({ ok: !anyFailed, status, durationMs, stages });
}
