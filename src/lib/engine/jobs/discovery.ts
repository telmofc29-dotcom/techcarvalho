import "server-only";
import type { createClient } from "@/lib/supabase/server";
import { newCounters, recordJobRun, isFlagEnabled, safeFetchText } from "@/lib/engine/cron";
import { parseFeed, classifyDiscoveryType, classifyClaimStatus } from "@/lib/engine/feed-parser";
import { buildDedupeKey } from "@/lib/engine/dedupe";

type Client = Awaited<ReturnType<typeof createClient>>;

const JOB = "engine_discover";

export type StageResult = {
  status: "success" | "partial" | "failed" | "skipped";
  examined: number;
  created: number;
  deduped: number;
  failed: number;
  detail?: Record<string, unknown>;
};

// Discovery pass. Polls approved, active sources that are due a check and
// records deduplicated CANDIDATES. It cannot create or publish content — its
// only writes are engine_upsert_discovery (candidate + evidence) and
// engine_record_source_check (health).
//
// Safety properties (Phase 3 requirement 10):
// - Idempotent: deduped by fingerprint, so re-running creates nothing new.
// - Rate-limited: engine_due_sources() only returns sources past their
//   check_frequency_hours, capped at 25 per pass.
// - Observable: appends to engine_job_runs.
// - Safe on source failure: safeFetchText never throws; a dead or reformatted
//   source records a failure and the pass continues with the others.
// - Inexpensive: bounded fetches, bounded payloads, zero AI calls.
export async function runDiscovery(supabase: Client): Promise<StageResult> {
  const counters = newCounters();

  if (!(await isFlagEnabled(supabase, "discovery"))) {
    await recordJobRun(supabase, JOB, "skipped", counters, { reason: "discovery_disabled" });
    return { status: "skipped", ...counters };
  }

  const { data: sources, error } = await supabase.rpc("engine_due_sources");
  if (error) {
    await recordJobRun(supabase, JOB, "failed", counters, {}, error.message);
    return { status: "failed", ...counters, detail: { error: error.message } };
  }

  const dueSources = (sources ?? []) as {
    id: string;
    organisation: string;
    url: string;
    source_type: string;
    trust_level: string;
    categories: string[];
  }[];

  const perSource: Record<string, string> = {};

  for (const source of dueSources) {
    counters.examined++;
    const body = await safeFetchText(source.url);

    if (body === null) {
      counters.failed++;
      perSource[source.organisation] = "fetch_failed";
      await supabase.rpc("engine_record_source_check", {
        p_source_id: source.id,
        p_success: false,
        p_error: "Fetch failed or returned a non-OK status",
      });
      continue;
    }

    const items = parseFeed(body);
    if (items.length === 0) {
      // Reachable but unparseable — usually a feed that moved and now serves
      // HTML. Recorded as a failure so it surfaces in source health rather
      // than looking like "this source simply had no news".
      counters.failed++;
      perSource[source.organisation] = "no_parseable_items";
      await supabase.rpc("engine_record_source_check", {
        p_source_id: source.id,
        p_success: false,
        p_error: "Reachable but no parseable feed items (format may have changed)",
      });
      continue;
    }

    let created = 0;
    let deduped = 0;
    for (const item of items) {
      const discoveryType = classifyDiscoveryType(item.title, item.summary);
      const claimStatus = classifyClaimStatus(item.title, item.summary, source.trust_level);
      const dedupeKey = buildDedupeKey({
        title: item.title,
        discoveryType,
        entityKey: source.categories[0] ?? null,
      });

      const { data: result, error: upsertError } = await supabase.rpc("engine_upsert_discovery", {
        p_dedupe_key: dedupeKey,
        p_title: item.title,
        p_summary: item.summary,
        p_discovery_type: discoveryType,
        p_category_slug: source.categories[0] ?? null,
        p_claim_status: claimStatus,
        // Confidence stays at the floor here. The real value is computed from
        // accumulated evidence by src/lib/engine/confidence.ts — a single
        // sighting must never assert its own credibility.
        p_confidence: 0,
        p_source_url: item.link,
        p_publisher: source.organisation,
        p_trust_level: source.trust_level,
      });

      if (upsertError) {
        counters.failed++;
        continue;
      }
      if (result === "created") created++;
      else if (result === "deduped") deduped++;
    }

    counters.created += created;
    counters.deduped += deduped;
    perSource[source.organisation] = `created:${created} deduped:${deduped}`;

    await supabase.rpc("engine_record_source_check", {
      p_source_id: source.id,
      p_success: true,
      p_error: null,
    });
  }

  const status = counters.failed > 0 ? (counters.created > 0 ? "partial" : "failed") : "success";
  await recordJobRun(supabase, JOB, status, counters, { sources: perSource });
  return { status, ...counters, detail: { sources: perSource } };
}
