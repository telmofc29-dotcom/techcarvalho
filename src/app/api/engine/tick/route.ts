import { NextResponse, type NextRequest } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { checkCronAuth, newCounters, recordJobRun } from "@/lib/engine/cron";
import { beginRun, buildGuard, completeRun, loadTelemetry } from "@/lib/engine/guard";
import { idempotencyKeyFor } from "@/lib/engine/concurrency";
import { STAGE_JOB_NAMES, ENGINE_STAGE_NAMES, type EngineStageName } from "@/lib/engine/stages";
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
import { runHeroMediaAudit } from "@/lib/engine/jobs/hero-media-job";
import { runShadowEvaluation } from "@/lib/engine/jobs/shadow-job";
import type { StageResult } from "@/lib/engine/jobs/discovery";

type EngineClient = Awaited<ReturnType<typeof createClient>>;

const JOB = "engine_tick";

// The single orchestrated engine pass. ONE Vercel Cron entry drives every
// engine capability, in pipeline order:
//
//   discover -> relevance -> update proposals -> product assembly -> brief
//     -> draft assembly -> search intelligence -> opportunity -> trends
//     -> media acquisition -> freshness -> internal links -> hero media
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
// TYPED AGAINST ENGINE_STAGE_NAMES.
//
// A stage added here whose name is not in src/lib/engine/stages.ts now fails to
// COMPILE. Previously it compiled, halted on every tick (route.ts refuses an
// unmapped stage) and looked like a stage that simply never had anything to do.
// Fail-closed is the right runtime behaviour, but a capability that silently
// stops existing is not something to discover from a halted row.
const STAGES: readonly (readonly [EngineStageName, (c: EngineClient) => Promise<StageResult>])[] = [
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
  // Hero-media quality. Runs alongside orphan detection because both ask
  // the same kind of question: is a page that is technically published
  // actually serving a reader properly?
  ["hero_media", runHeroMediaAudit],
  // Shadow evaluation runs LAST, and deliberately so. It runs the complete
  // autonomous decision process — including the stages above — over real
  // candidates and publishes nothing, so it must see the state of the site
  // after this pass has had its effect. Running it first would have it deciding
  // against a stale picture of what already exists.
  //
  // It is also the only stage whose output is evidence rather than work: every
  // decision it records is a row in the ledger that READINESS is measured
  // against. It cannot publish — see src/lib/engine/jobs/shadow-job.ts.
  ["shadow_evaluation", runShadowEvaluation],
] as const;

// Stage -> job-name mapping lives in src/lib/engine/stages.ts so it can be
// unit tested: this file transitively imports `server-only`, which throws
// outside Next.js, and an untestable safety map is one that drifts. It already
// had — see that file's header.

export async function GET(request: NextRequest) {
  const unauthorized = checkCronAuth(request);
  if (unauthorized) return unauthorized;

  const supabase = await createClient();
  const now = new Date();
  const startedAt = Date.now();

  // --- 1. Claim the run lease -----------------------------------------------
  // Everything below this point assumes it is the only worker in this window.
  // Two cron invocations landing together — a retry, a manual trigger racing
  // the schedule — is the scenario that produces two workers acting on one
  // opportunity, and the lease is what makes that impossible rather than
  // unlikely.
  const lease = await beginRun(supabase, JOB, idempotencyKeyFor(JOB, now));
  if (!lease.decision.proceed) {
    await recordJobRun(supabase, JOB, "skipped", newCounters(), {
      reason: lease.outcome,
      why: lease.decision.why,
    });
    return NextResponse.json(
      { ok: true, status: "skipped", reason: lease.outcome, why: lease.decision.why },
      { status: 200 }
    );
  }

  // --- 2. Load telemetry and build the guard --------------------------------
  // This is the layer that circuit-breaker.ts, health.ts, budgets.ts and
  // silent-success.ts were all written for, and which nothing was calling: the
  // tick ran every stage unconditionally, so an open breaker halted nothing and
  // a critical health finding stopped nothing. A safety layer with no consumer
  // is indistinguishable from no safety layer.
  const telemetry = await loadTelemetry(supabase);
  const guard = buildGuard({ telemetry, lease, now });

  const stages: Record<string, unknown> = {};
  let anyFailed = false;
  let anySkipped = false;
  let anyHalted = false;
  let anyRan = false;
  // A stage that partly succeeded. Previously untracked entirely, so a pass
  // containing a partial stage could still report a clean success.
  let anyPartial = false;

  for (const [name, run] of STAGES) {
    const jobName = STAGE_JOB_NAMES[name];
    // An unmapped stage is not quietly waved through. A stage nobody can gate
    // is exactly the thing this file must not have.
    if (!jobName) {
      anyHalted = true;
      stages[name] = {
        status: "halted",
        why:
          `Stage '${name}' has no entry in STAGE_JOB_NAMES, so no circuit breaker, budget or ` +
          `concurrency rule could be applied to it. An ungateable stage does not run.`,
      };
      continue;
    }

    const gate = guard.gateFor(jobName);
    if (!gate.allow) {
      anyHalted = true;
      stages[name] = { status: "halted", job: jobName, why: gate.why };
      continue;
    }

    try {
      const result = await run(supabase);
      stages[name] = result;
      // `anyRan = true` used to be set HERE, before result.status was read —
      // so a stage that returned 'skipped' still counted as having run, and the
      // expression below then resolved to "success". A tick in which every
      // single stage was skipped reported success, which is precisely what the
      // comment under it says must not happen.
      //
      // anyRan now means a stage actually DID something.
      if (result.status === "failed") anyFailed = true;
      else if (result.status === "skipped") anySkipped = true;
      else if (result.status === "partial") {
        anyPartial = true;
        anyRan = true;
      } else anyRan = true;
    } catch (e) {
      anyFailed = true;
      stages[name] = { status: "error", error: e instanceof Error ? e.message : String(e) };
    }
  }

  const durationMs = Date.now() - startedAt;

  // A pass in which every stage was halted or skipped is NOT a success. That
  // mapping — `anySkipped ? "success" : "success"`, which could not return
  // anything but success — is the tick's own version of the failure class this
  // whole layer exists to catch.
  // anySkipped and anyPartial were both computed and then never consulted here.
  // A value that is measured and discarded is worse than one never measured: it
  // looks like the case is handled.
  const status: "success" | "partial" | "failed" | "skipped" =
    // Something broke and nothing worked.
    anyFailed && !anyRan ? "failed"
    // Something broke, or a safety mechanism stopped a stage, or a stage only
    // partly succeeded. Any of those is a partial pass, never a clean one.
    : anyFailed || anyHalted || anyPartial ? "partial"
    // Nothing ran at all. Distinguish "deliberately disabled" from "broken":
    // every stage declining because its flag is off is legitimately 'skipped',
    // and calling it 'failed' would cry wolf every tick while flags are off.
    : !anyRan ? (anySkipped ? "skipped" : "failed")
    // Some stages ran and some were skipped — real work happened, but the pass
    // was not complete, so it is not reported as one.
    : anySkipped ? "partial"
    : "success";

  const detail = {
    stages,
    durationMs,
    anyHalted,
    anySkipped,
    anyPartial,
    anyRan,
    guard: guard.detail(),
  };

  if (lease.runId) {
    await completeRun(supabase, lease.runId, status, newCounters(), detail);
  } else {
    await recordJobRun(supabase, JOB, status, newCounters(), detail);
  }

  return NextResponse.json({
    ok: !anyFailed && !anyHalted,
    status,
    durationMs,
    lease: { outcome: lease.outcome, why: lease.decision.why },
    breakers: guard.breakers.summary,
    silentSuccess: guard.silentSuccess.summary,
    stages,
  });
}
