import "server-only";
import type { createClient } from "@/lib/supabase/server";
import { newCounters, recordJobRun, readFlag } from "@/lib/engine/cron";
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

  const opportunityFlag = await readFlag(supabase, "opportunity");
  if (!opportunityFlag.enabled) {
    // An UNREADABLE flag is a failure, not a deliberate skip. Recording it as
    // 'skipped' used to hide it twice over: the reason said the flag was off
    // when it had never been read, and silent-success.ts filters skipped runs
    // out entirely, so one denied RPC switched the engine off and still
    // produced a clean detector report.
    const status = opportunityFlag.readable ? "skipped" : "failed";
    await recordJobRun(
      supabase,
      JOB,
      status,
      counters,
      { reason: opportunityFlag.reason },
      opportunityFlag.error
    );
    return { status, ...counters, detail: { reason: opportunityFlag.reason } };
  }

  const { data, error } = await supabase.rpc("engine_aggregate_searches", { p_days: 90 });
  if (error) {
    await recordJobRun(supabase, JOB, "failed", counters, {}, error.message);
    return { status: "failed", ...counters, detail: { error: error.message } };
  }

  // This pass used to hardcode "success" and coerce a non-number to 0. So a
  // null return — the shape of an RPC that is missing, unauthorised, or whose
  // internal flag check quietly bailed — recorded a run with 0 examined, 0
  // created and status 'success', indistinguishable from a site on which
  // nobody had searched. engine_aggregate_searches is declared `returns
  // integer`; anything else is the function not answering.
  if (typeof data !== "number") {
    const detail = {
      distinctQueries: 0,
      returned: data === null ? "null" : typeof data,
      note:
        "engine_aggregate_searches is declared `returns integer` and did not return one. That is " +
        "not 'no searches to aggregate' — it is the RPC failing to answer in its own declared " +
        "shape, and it is recorded as a failure rather than as a quiet day.",
    };
    await recordJobRun(
      supabase, JOB, "failed", counters, detail,
      "engine_aggregate_searches returned a non-integer"
    );
    return { status: "failed", ...counters, detail };
  }

  counters.examined = data;
  // Rows upserted, which for this RPC is the same number as distinct queries.
  counters.created = data;
  const detail = { distinctQueries: data };
  await recordJobRun(supabase, JOB, "success", counters, detail);
  return { status: "success", ...counters, detail };
}
