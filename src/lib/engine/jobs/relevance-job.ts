import "server-only";
import type { createClient } from "@/lib/supabase/server";
import { newCounters, recordJobRun, isFlagEnabled } from "@/lib/engine/cron";
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

  if (!(await isFlagEnabled(supabase, "discovery"))) {
    await recordJobRun(supabase, JOB, "skipped", counters, { reason: "discovery_disabled" });
    return { status: "skipped", ...counters };
  }

  const { data, error } = await supabase.rpc("engine_unclassified_discoveries", { p_limit: 200 });
  if (error) {
    await recordJobRun(supabase, JOB, "failed", counters, {}, error.message);
    return { status: "failed", ...counters, detail: { error: error.message } };
  }

  const rows = (data ?? []) as { id: string; title: string; summary: string | null }[];
  const tally = { relevant: 0, rejected: 0, uncertain: 0 };

  for (const row of rows) {
    counters.examined++;
    const result = classifyRelevance({ title: row.title, summary: row.summary });
    tally[result.verdict]++;

    const { error: setErr } = await supabase.rpc("engine_set_relevance", {
      p_id: row.id,
      p_verdict: result.verdict,
      p_score: result.score,
      p_explanation: result.explanation,
      p_angle: result.suggestedAngle,
    });
    if (setErr) counters.failed++;
    else counters.created++;
  }

  const status =
    counters.failed === 0 ? "success" : counters.created > 0 ? "partial" : "failed";
  await recordJobRun(supabase, JOB, status, counters, tally);
  return { status, ...counters, detail: tally };
}
