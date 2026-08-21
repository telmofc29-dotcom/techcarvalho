import "server-only";
import type { createClient } from "@/lib/supabase/server";
import { newCounters, recordJobRun, isFlagEnabled } from "@/lib/engine/cron";
import type { StageResult } from "./discovery";

type Client = Awaited<ReturnType<typeof createClient>>;
const JOB = "engine_search_intelligence";

// Aggregates on-site searches into search_intelligence.
//
// Privacy posture: the aggregation RPC groups by query text only. No visitor
// id, session id, or IP is carried across — the resulting table cannot be
// joined back to a person. It records what was searched, how often, whether it
// returned nothing, and whether anyone clicked. That is exactly enough to find
// unmet demand and nothing more.
//
// Zero-result searches are the highest-value signal the site can produce: a
// literal record of someone wanting something TechCarvalho does not have.
export async function runSearchIntelligence(supabase: Client): Promise<StageResult> {
  const counters = newCounters();

  if (!(await isFlagEnabled(supabase, "opportunity"))) {
    await recordJobRun(supabase, JOB, "skipped", counters, { reason: "opportunity_disabled" });
    return { status: "skipped", ...counters };
  }

  const { data, error } = await supabase.rpc("engine_aggregate_searches", { p_days: 90 });
  if (error) {
    await recordJobRun(supabase, JOB, "failed", counters, {}, error.message);
    return { status: "failed", ...counters, detail: { error: error.message } };
  }

  counters.examined = typeof data === "number" ? data : 0;
  counters.created = counters.examined;
  await recordJobRun(supabase, JOB, "success", counters, { distinctQueries: counters.examined });
  return { status: "success", ...counters, detail: { distinctQueries: counters.examined } };
}
