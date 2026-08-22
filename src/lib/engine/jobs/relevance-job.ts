import "server-only";
import type { createClient } from "@/lib/supabase/server";
import { newCounters, recordJobRun, readFlag } from "@/lib/engine/cron";
import {
  createPostconditionLog,
  statusFromPostconditions,
  worstStatus,
} from "@/lib/engine/postconditions";
import { postconditionDetail, writeCountsFrom } from "@/lib/engine/silent-success";
import { classifyRelevance } from "@/lib/engine/relevance";
import type { StageResult } from "./discovery";

type Client = Awaited<ReturnType<typeof createClient>>;
const JOB = "engine_relevance";

// Relevance pass: sits between discovery/evidence and opportunity/brief.
//
// Nothing is deleted. A rejected discovery is marked with its verdict, score
// and explanation and parked in state 'rejected' — still fully inspectable in
// the admin UI, and overridable by an admin (engine_set_relevance refuses to
// overwrite a human decision).
export async function runRelevance(supabase: Client): Promise<StageResult> {
  const counters = newCounters();

  const discoveryFlag = await readFlag(supabase, "discovery");
  if (!discoveryFlag.enabled) {
    // An UNREADABLE flag is a failure, not a deliberate skip. Recording it as
    // 'skipped' used to hide it twice over: the reason said the flag was off
    // when it had never been read, and silent-success.ts filters skipped runs
    // out entirely, so one denied RPC switched the engine off and still
    // produced a clean detector report.
    const status = discoveryFlag.readable ? "skipped" : "failed";
    await recordJobRun(
      supabase,
      JOB,
      status,
      counters,
      { reason: discoveryFlag.reason },
      discoveryFlag.error
    );
    return { status, ...counters, detail: { reason: discoveryFlag.reason } };
  }

  const { data, error } = await supabase.rpc("engine_unclassified_discoveries", { p_limit: 200 });
  if (error) {
    await recordJobRun(supabase, JOB, "failed", counters, {}, error.message);
    return { status: "failed", ...counters, detail: { error: error.message } };
  }

  const rows = (data ?? []) as { id: string; title: string; summary: string | null }[];
  const tally = { relevant: 0, rejected: 0, uncertain: 0 };
  const log = createPostconditionLog(counters);

  for (const row of rows) {
    counters.examined++;
    const result = classifyRelevance({ title: row.title, summary: row.summary });
    tally[result.verdict]++;

    // engine_set_relevance returns a status string and this job used to throw
    // it away, counting `created++` on the strength of `error` being null. That
    // is the second incident's exact shape: the function was answering, and
    // nobody was listening. An unrecognised verdict comes back
    // 'rejected_invalid' and is now a failure rather than a phantom write.
    //
    // KNOWN LIMIT, recorded rather than papered over: the RPC returns 'ok'
    // unconditionally after its UPDATE, without checking FOUND. So 'ok' means
    // "the statement ran", not "a row changed" — a discovery that is
    // admin-overridden, deleted, or invisible under RLS also yields 'ok'. That
    // is a silent no-op living inside the function, and no amount of checking
    // out here can see it. The fix is drafted in
    // supabase/migrations_pending/20260822_silent_success_telemetry.sql, which
    // makes it return 'updated' / 'no_matching_row' / 'human_override'; those
    // are listed below already so applying it needs no change here.
    await log.rpc({
      operation: "engine_set_relevance",
      subject: `discovery/${row.id} verdict=${result.verdict}`,
      run: () =>
        supabase.rpc("engine_set_relevance", {
          p_id: row.id,
          p_verdict: result.verdict,
          p_score: result.score,
          p_explanation: result.explanation,
          p_angle: result.suggestedAngle,
        }),
      accepted: ["ok", "updated"],
      // A discovery an admin has already ruled on is legitimately left alone —
      // the RPC refusing to overwrite a human decision is the feature working.
      benign: ["human_override"],
    });
  }

  const jobView =
    counters.failed === 0 ? "success" : counters.created > 0 ? "partial" : "failed";
  const postconditions = log.summarise();
  const status = worstStatus(jobView, statusFromPostconditions(postconditions));

  const detail = { ...tally, postconditions: postconditionDetail(postconditions) };
  await recordJobRun(supabase, JOB, status, counters, detail, undefined, writeCountsFrom(postconditions));
  return { status, ...counters, detail };
}
