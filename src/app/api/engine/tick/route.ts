import { NextResponse, type NextRequest } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { checkCronAuth, newCounters, recordJobRun, isFlagEnabled } from "@/lib/engine/cron";
import { runDiscovery } from "@/lib/engine/jobs/discovery";
import { runOpportunityScoring } from "@/lib/engine/jobs/opportunity-job";
import { runFreshness } from "@/lib/engine/jobs/freshness-job";

const JOB = "engine_tick";

// Single scheduled entry point that runs the whole engine pass in order:
//   discover -> score opportunities -> check freshness
//
// Consolidated into one cron deliberately. Vercel's Hobby plan allows only two
// cron jobs, and this project already spends one on the nightly analytics
// rollup — four separate engine crons would exceed that and block deployment
// entirely. One tick is also a better fit for the pipeline: opportunity
// scoring wants to run *after* discovery in the same pass, not on an
// independent schedule that might interleave arbitrarily.
//
// Each stage is independently flag-gated and independently failure-isolated:
// a stage that is switched off, or that throws, does not prevent the others
// from running. The per-stage routes (/api/engine/discover, /opportunities,
// /freshness) still exist and remain individually callable for manual
// operation and debugging.
export async function GET(request: NextRequest) {
  const unauthorized = checkCronAuth(request);
  if (unauthorized) return unauthorized;

  const supabase = await createClient();

  // Master switch first: if the engine is off, do nothing at all and say so.
  // Every underlying RPC re-checks this too, so this is a fast path rather
  // than the actual security boundary.
  if (!(await isFlagEnabled(supabase, "discovery")) &&
      !(await isFlagEnabled(supabase, "opportunity")) &&
      !(await isFlagEnabled(supabase, "freshness"))) {
    await recordJobRun(supabase, JOB, "skipped", newCounters(), { reason: "all_stages_disabled_or_master_off" });
    return NextResponse.json({ ok: true, status: "skipped", reason: "engine disabled" });
  }

  const stages: Record<string, unknown> = {};
  let anyFailed = false;

  for (const [name, run] of [
    ["discovery", runDiscovery],
    ["opportunities", runOpportunityScoring],
    ["freshness", runFreshness],
  ] as const) {
    try {
      stages[name] = await run(supabase);
    } catch (e) {
      // One stage blowing up must not abort the pass — the others still have
      // useful work to do, and the failure is recorded rather than swallowed.
      anyFailed = true;
      stages[name] = { status: "error", error: e instanceof Error ? e.message : String(e) };
    }
  }

  await recordJobRun(supabase, JOB, anyFailed ? "partial" : "success", newCounters(), stages);
  return NextResponse.json({ ok: !anyFailed, status: anyFailed ? "partial" : "success", stages });
}
