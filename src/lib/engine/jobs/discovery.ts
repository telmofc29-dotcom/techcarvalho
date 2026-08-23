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
import { extractUpstreamAttribution } from "@/lib/engine/independence";
import { logQueryError } from "@/lib/log/query-error";
import { concludeEmptyQueue } from "./reader-liveness";

type Client = Awaited<ReturnType<typeof createClient>>;

const JOB = "engine_discover";

const PROVENANCE_MIGRATION =
  "supabase/migrations_pending/20260823_engine_evidence_provenance.sql";

/** The excerpt column is text; this matches the summary truncation width. */
const EXCERPT_MAX = 4000;

type UpsertArgs = {
  p_dedupe_key: string;
  p_title: string;
  p_summary: string | null;
  p_discovery_type: string;
  p_category_slug: string | null;
  p_claim_status: string;
  p_confidence: number;
  p_source_url: string | null;
  p_publisher: string;
  p_trust_level: string;
};

type ProvenanceArgs = {
  p_source_id: string;
  p_excerpt: string | null;
  p_originates_from_url: string | null;
  p_origin_examined: boolean;
};

// Whether the 14-argument signature is known to be absent. Latched per pass so
// one PGRST202 does not cost every remaining item an extra round trip, and
// reset per pass so applying the migration takes effect on the next run without
// a redeploy.
type LadderState = { provenanceAbsent: boolean; downgraded: number };

/**
 * Call engine_upsert_discovery, newest signature first.
 *
 * WHY A LADDER RATHER THAN JUST CALLING THE NEW SIGNATURE: migrations in this
 * project are applied BY HAND, out of band from a deploy, so there is always a
 * window in which the code and the database disagree about which signature
 * exists. If this shipped assuming the 14-argument function, then during that
 * window every call would answer PGRST202 and discovery — the head of the whole
 * pipeline — would record NOTHING, starving every stage downstream. Losing
 * three provenance columns is a far better outcome than losing the sighting.
 *
 * Same pattern, and same reasoning, as recordJobRun's ladder in cron.ts.
 *
 * The downgrade is LOGGED and counted. "provenance is missing because the
 * migration is not applied" must never be mistaken for "this source had no
 * provenance to record".
 */
async function upsertDiscovery(
  supabase: Client,
  state: LadderState,
  base: UpsertArgs,
  provenance: ProvenanceArgs
): Promise<{ data: string | null; error: { message: string } | null }> {
  if (!state.provenanceAbsent) {
    const full = await supabase.rpc("engine_upsert_discovery", {
      ...base,
      ...provenance,
    });
    if (!full.error || full.error.code !== "PGRST202") {
      return { data: full.data as string | null, error: full.error };
    }
    state.provenanceAbsent = true;
  }

  const legacy = await supabase.rpc("engine_upsert_discovery", base);
  if (!legacy.error) {
    state.downgraded++;
    if (state.downgraded === 1) {
      logQueryError(
        `engine_upsert_discovery — sighting recorded WITHOUT provenance. The 14-argument ` +
          `signature does not exist yet, so source_id, excerpt and originates_from_url are ` +
          `NULL for every row this pass writes. That is UNRECORDED, not "this source has no ` +
          `provenance": confidence.ts will read every one of these rows as an unexamined ` +
          `voice. Apply ${PROVENANCE_MIGRATION}`,
        { message: "evidence_provenance_signature_absent" }
      );
    }
  }
  return { data: legacy.data as string | null, error: legacy.error };
}

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

  // No source is due. Legitimate and common — engine_due_sources filters on
  // next_check_at — and until now it fell through the loop and recorded success
  // with every counter at zero, which is the identical row a silently-denied
  // read produces. Discovery is the head of the whole pipeline, so a denial here
  // starves every stage downstream while all of them report success. See
  // queue-read.ts for what the control read does and does not establish.
  if (dueSources.length === 0) {
    const outcome = await concludeEmptyQueue(supabase, {
      stage: JOB,
      source: "engine_due_sources",
      kind: "security_definer_rpc",
      rowsReturned: 0,
      eligible: 0,
      reason: "no_sources_due",
    });
    await recordJobRun(supabase, JOB, outcome.status, counters, outcome.detail,
      outcome.error ?? undefined,
      undefined,
      // The stage classifies ITSELF. Without this the two columns added by
      // 20260823b are written NULL on every run, and a NULL there means
      // UNMEASURED — so the engine would have gained an observability surface
      // that observes nothing.
      { stageOutcome: outcome.verdict.outcome, ambiguity: outcome.verdict.ambiguity }
    );
    return { status: outcome.status, ...counters, detail: outcome.detail };
  }

  const perSource: Record<string, string> = {};
  const log = createPostconditionLog(counters);
  const ladder: LadderState = { provenanceAbsent: false, downgraded: 0 };
  // Counted so the run's own detail records how much provenance it recovered
  // versus how much it looked for and did not find. Those are different facts.
  let originsFound = 0;
  let originsExamined = 0;

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
    "supabase/migrations/20260822_silent_success_telemetry.sql";
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
      // PROVENANCE. Every value below was already in hand on this line and was
      // previously discarded, because engine_upsert_discovery had no parameter
      // for any of it (118 of 118 evidence rows in production carry NULL for
      // all three). See the migration header for what that cost.
      //
      // source_id is the source we ACTUALLY polled — not a host match, not an
      // inference. It is the only one of the three that is always available.
      //
      // originates_from_url is recovered ONLY from an explicit citation in the
      // item's own summary ("via ...", "Source: ..."). It is null far more
      // often than not, and that is correct: this job does not fetch the
      // article body, so in most cases there is genuinely nothing to read. A
      // guessed upstream would be fabricated provenance, and this project's
      // standing rule is that a record which cannot be reconstructed says
      // LESS, not more.
      //
      // originExamined records whether that search actually happened — which
      // needs a summary to search. With no summary, nothing was examined, and
      // independence.ts must treat the row as unknown rather than original.
      const originatesFrom = extractUpstreamAttribution(item.summary, item.link);
      const originExamined = item.summary !== null && item.summary.length > 0;
      if (originExamined) originsExamined++;
      if (originatesFrom) originsFound++;

      await log.rpc({
        operation: "engine_upsert_discovery",
        subject: `${source.organisation}: ${item.title.slice(0, 60)}`,
        run: () =>
          upsertDiscovery(
            supabase,
            ladder,
            {
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
            },
            {
              p_source_id: source.id,
              p_excerpt: item.summary ? item.summary.slice(0, EXCERPT_MAX) : null,
              p_originates_from_url: originatesFrom,
              p_origin_examined: originExamined,
            }
          ),
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

  const detail = {
    sources: perSource,
    postconditions: postconditionDetail(postconditions),
    // Reported separately on purpose. "0 upstream citations found" after
    // examining 40 items and "0 found because the migration is not applied and
    // nothing was written" produce the same NULLs in the table and are opposite
    // facts — the distinction this whole codebase keeps having to relearn.
    provenance: {
      origins_examined: originsExamined,
      origins_found: originsFound,
      provenance_columns_written: !ladder.provenanceAbsent,
      downgraded_writes: ladder.downgraded,
    },
  };
  await recordJobRun(supabase, JOB, status, counters, detail, undefined, writeCountsFrom(postconditions));
  return { status, ...counters, detail };
}
