import { NextResponse, type NextRequest } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { checkCronAuth, newCounters, recordJobRun, isFlagEnabled, safeFetchText } from "@/lib/engine/cron";
import { parseFeed, classifyDiscoveryType, classifyClaimStatus } from "@/lib/engine/feed-parser";
import { buildDedupeKey } from "@/lib/engine/dedupe";

const JOB = "engine_discover";

// Discovery pass. Polls approved, active sources that are due a check and
// records deduplicated CANDIDATES. It cannot create or publish content — the
// only writes it makes are through engine_upsert_discovery (candidates +
// evidence) and engine_record_source_check (health).
//
// Safety properties (requirement 10):
// - Idempotent: deduped by fingerprint, so re-running creates nothing new.
// - Rate-limited: engine_due_sources() only returns sources past their
//   check_frequency_hours, capped at 25 per run.
// - Observable: every run appends to engine_job_runs.
// - Safe on source failure: safeFetchText never throws; a dead or reformatted
//   source records a failure and the run continues with the others.
// - Inexpensive: bounded fetches, bounded payloads, no AI calls.
export async function GET(request: NextRequest) {
  const unauthorized = checkCronAuth(request);
  if (unauthorized) return unauthorized;

  const supabase = await createClient();
  const counters = newCounters();

  // Fails closed: if the flag can't be read, nothing runs.
  if (!(await isFlagEnabled(supabase, "discovery"))) {
    await recordJobRun(supabase, JOB, "skipped", counters, { reason: "discovery_disabled" });
    return NextResponse.json({ ok: true, status: "skipped", reason: "discovery disabled" });
  }

  const { data: sources, error: sourcesError } = await supabase.rpc("engine_due_sources");
  if (sourcesError) {
    await recordJobRun(supabase, JOB, "failed", counters, {}, sourcesError.message);
    return NextResponse.json({ ok: false, error: sourcesError.message }, { status: 500 });
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
      // Reachable but unparseable — most often a feed that moved and now
      // serves HTML. Recorded as a failure so it surfaces in source health
      // rather than looking like "this source simply had no news".
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

      const { data: result, error } = await supabase.rpc("engine_upsert_discovery", {
        p_dedupe_key: dedupeKey,
        p_title: item.title,
        p_summary: item.summary,
        p_discovery_type: discoveryType,
        p_category_slug: source.categories[0] ?? null,
        p_claim_status: claimStatus,
        // Confidence is intentionally left at the floor here. The real value is
        // computed from accumulated evidence by src/lib/engine/confidence.ts —
        // a single sighting must never assert its own credibility.
        p_confidence: 0,
        p_source_url: item.link,
        p_publisher: source.organisation,
        p_trust_level: source.trust_level,
      });

      if (error) {
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

  return NextResponse.json({
    ok: status !== "failed",
    status,
    sourcesExamined: counters.examined,
    candidatesCreated: counters.created,
    duplicatesSkipped: counters.deduped,
    failures: counters.failed,
  });
}
