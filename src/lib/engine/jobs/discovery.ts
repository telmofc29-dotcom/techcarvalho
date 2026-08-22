import "server-only";
import type { createClient } from "@/lib/supabase/server";
import { newCounters, recordJobRun, readFlag, safeFetchText } from "@/lib/engine/cron";
import {
  createPostconditionLog,
  statusFromPostconditions,
  worstStatus,
} from "@/lib/engine/postconditions";
import { postconditionDetail, writeCountsFrom } from "@/lib/engine/silent-success";
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
  const log = createPostconditionLog(counters);

  // engine_record_source_check is `returns void`. Source health is what the
  // source_failures circuit breaker reads, so a health write that silently does
  // nothing would leave that breaker permanently looking at a healthy registry
  // no matter how many sources had died. It cannot be verified from here, so it
  // is declared blind and counted rather than assumed.
  // engine_record_source_check is `returns void` in deployed production, so
  // nothing in the response shows whether the source's health row was actually
  // updated. Source health feeds the source_failures breaker, so an unnoticed
  // no-op here blinds that breaker too. The migration below gives it a return
  // value; until it is applied these calls record as blind rather than as
  // either success or failure.
  const SOURCE_CHECK_MIGRATION =
    "supabase/migrations_pending/20260822_silent_success_telemetry.sql";
  // 'no_matching_source' is NOT benign. It means the row we just listed is gone,
  // which is exactly the silent no-op that would leave the breaker reading a
  // permanently healthy registry.
  const SOURCE_CHECK_ACCEPTED = ["ok"] as const;

  for (const source of dueSources) {
    counters.examined++;
    const body = await safeFetchText(source.url);

    if (body === null) {
      counters.failed++;
      perSource[source.organisation] = "fetch_failed";
      await log.pendingRpc({
        operation: "engine_record_source_check(failure)",
        subject: source.organisation,
        migration: SOURCE_CHECK_MIGRATION,
        accepted: SOURCE_CHECK_ACCEPTED,
        run: () =>
          supabase.rpc("engine_record_source_check", {
            p_source_id: source.id,
            p_success: false,
            p_error: "Fetch failed or returned a non-OK status",
          }),
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
      await log.pendingRpc({
        operation: "engine_record_source_check(failure)",
        subject: source.organisation,
        migration: SOURCE_CHECK_MIGRATION,
        accepted: SOURCE_CHECK_ACCEPTED,
        run: () =>
          supabase.rpc("engine_record_source_check", {
            p_source_id: source.id,
            p_success: false,
            p_error: "Reachable but no parseable feed items (format may have changed)",
          }),
      });
      continue;
    }

    const before = { created: counters.created, deduped: counters.deduped };
    for (const item of items) {
      const discoveryType = classifyDiscoveryType(item.title, item.summary);
      const claimStatus = classifyClaimStatus(item.title, item.summary, source.trust_level);
      const dedupeKey = buildDedupeKey({
        title: item.title,
        discoveryType,
        entityKey: source.categories[0] ?? null,
      });

      // 'created' and 'deduped' were the only two statuses this loop handled.
      // engine_upsert_discovery also answers 'rejected_invalid' — for a
      // discovery_type or claim_status outside its guard list — and that answer
      // matched NEITHER branch, so the item was neither created, nor deduped,
      // nor failed. It simply evaporated, and the run reported success. A whole
      // source could stop producing anything the moment its feed started
      // yielding a type the RPC does not accept.
      await log.rpc({
        operation: "engine_upsert_discovery",
        subject: `${source.organisation}: ${item.title.slice(0, 60)}`,
        run: () =>
          supabase.rpc("engine_upsert_discovery", {
            p_dedupe_key: dedupeKey,
            p_title: item.title,
            p_summary: item.summary,
            p_discovery_type: discoveryType,
            p_category_slug: source.categories[0] ?? null,
            p_claim_status: claimStatus,
            // Confidence stays at the floor here. The real value is computed
            // from accumulated evidence by src/lib/engine/confidence.ts — a
            // single sighting must never assert its own credibility.
            p_confidence: 0,
            p_source_url: item.link,
            p_publisher: source.organisation,
            p_trust_level: source.trust_level,
          }),
        accepted: ["created"],
        // A re-poll legitimately dedupes every item; that is the job working.
        benign: ["deduped"],
      });
    }

    const created = counters.created - before.created;
    const deduped = counters.deduped - before.deduped;
    perSource[source.organisation] = `created:${created} deduped:${deduped}`;

    await log.pendingRpc({
      operation: "engine_record_source_check(success)",
      subject: source.organisation,
      migration: SOURCE_CHECK_MIGRATION,
      accepted: SOURCE_CHECK_ACCEPTED,
      run: () =>
        supabase.rpc("engine_record_source_check", {
          p_source_id: source.id,
          p_success: true,
          p_error: null,
        }),
    });
  }

  // "Some sources failed" is only a FAILED run if nothing useful happened at
  // all. Deduping counts as useful work: on a re-poll every item is expected
  // to dedupe and created will legitimately be 0, so keying success off
  // `created` alone mislabels a healthy run as failed.
  const didUsefulWork = counters.created > 0 || counters.deduped > 0;
  const jobView =
    counters.failed === 0 ? "success" : didUsefulWork ? "partial" : "failed";
  const postconditions = log.summarise();
  const status = worstStatus(jobView, statusFromPostconditions(postconditions));

  const detail = { sources: perSource, postconditions: postconditionDetail(postconditions) };
  await recordJobRun(supabase, JOB, status, counters, detail, undefined, writeCountsFrom(postconditions));
  return { status, ...counters, detail };
}
