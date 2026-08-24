import "server-only";

// THE RESEARCH STAGE — the missing second step of DISCOVER -> RESEARCH -> DECIDE.
//
// The engine had fourteen stages and none of them researched anything.
// `research_enabled` was a flag that gated OTHER stages while performing no
// research itself, so a discovery arrived with one evidence row from one
// publisher and stayed that way forever. This is the stage that goes and looks.
//
// HOW IT RESEARCHES WITHOUT A SEARCH API
// --------------------------------------
// It fetches the editorial registry's feeds, indexes them in memory, and
// searches that corpus for the discovery's subject. Twenty-three publications'
// recent output is a real corpus and this is a real search over it — just one
// the project owns rather than rents. Cost: zero.
//
// The honest limit, recorded in every run: it can only find what is inside
// those feeds' recent windows. "We found nothing" and "we could not have found
// it" are different facts and the run detail distinguishes them.
//
// WHAT IT WRITES
// --------------
// Only `engine_discovery_evidence`, and only through `engine_add_evidence`
// (supabase/migrations_pending/20260824_research_evidence.sql). Until that
// migration is applied the stage still RUNS and still reports what it found —
// it simply cannot persist, and says so rather than reporting a clean pass.
// A stage that silently does nothing is the thing this whole phase exists to
// remove.
//
// Crucially it records `originates_from_url` when an article credits another
// outlet, so "The Verge, citing Bloomberg" is stored AS derivative. That is
// what makes confidence.ts's existing independence model work on real data
// instead of on rows that all claim to be original.

import { createClient } from "@/lib/supabase/server";
import { recordJobRun, newCounters } from "../cron.ts";
import { buildCorpus } from "../research/feed-index.ts";
import { researchDiscovery } from "../research/research-pipeline.ts";
import { subjectDomainsForText, categoryForText } from "../research/entity-model.ts";
import type { StageResult } from "./discovery.ts";

const JOB = "engine_research";

/**
 * How many discoveries one pass will research.
 *
 * Deliberately small. Each one costs a set of feed fetches, and the owner's
 * instruction was explicit: research should improve quality, not generate
 * thousands more records. Working the backlog slowly and well beats sweeping it.
 */
export const RESEARCH_BATCH = 8;

type DiscoveryRow = {
  id: string;
  title: string;
  summary: string | null;
  category_slug: string | null;
  claim_status: string;
  relevance_verdict: string | null;
};

export async function runResearch(
  supabase: Awaited<ReturnType<typeof createClient>>
): Promise<StageResult> {
  const counters = newCounters();

  // Candidates: judged relevant, and not already carrying corroboration.
  // Ordered newest-first because research decays — a three-week-old story has
  // usually fallen out of every feed window this stage can see.
  const { data, error } = await supabase
    .from("engine_discoveries")
    .select("id, title, summary, category_slug, claim_status, relevance_verdict")
    .eq("relevance_verdict", "relevant")
    .order("first_seen_at", { ascending: false })
    .limit(RESEARCH_BATCH * 4);

  if (error) {
    await recordJobRun(supabase, JOB, "failed", counters, { reason: "queue_read_failed", error: error.message });
    return { status: "failed", ...counters, detail: { error: error.message } };
  }

  const candidates = ((data ?? []) as unknown as DiscoveryRow[]).slice(0, RESEARCH_BATCH);
  if (candidates.length === 0) {
    // The queue read succeeded and returned rows to filter, or genuinely none.
    // Either way this is reported as an examined-zero pass rather than silence.
    await recordJobRun(supabase, JOB, "success", counters, {
      reason: "no_relevant_discoveries",
      examined: 0,
    });
    return { status: "success", ...counters, detail: { examined: 0 } };
  }

  // One corpus per category, reused across discoveries sharing it — fetching
  // the same twenty-three feeds once per discovery would be both slow and rude.
  const corpusCache = new Map<string, Awaited<ReturnType<typeof buildCorpus>>>();
  const findings: Record<string, unknown>[] = [];
  let attached = 0;
  let persistFailed = 0;
  let rpcMissing = false;

  for (const d of candidates) {
    counters.examined++;
    const category = d.category_slug ?? categoryForText(`${d.title} ${d.summary ?? ""}`);
    const key = category ?? "__all__";
    if (!corpusCache.has(key)) corpusCache.set(key, await buildCorpus(category));
    const corpus = corpusCache.get(key)!;

    const result = researchDiscovery({
      title: d.title,
      summary: d.summary,
      subjectDomains: subjectDomainsForText(`${d.title} ${d.summary ?? ""}`),
      corpus: corpus.items,
      sourcesAttempted: corpus.attempted,
      sourcesRead: corpus.read,
      sourcesFailed: corpus.failed,
    });

    for (const match of result.matches) {
      if (!match.item.link) continue;
      // Lineage already decided whether this article is an independent voice or
      // a repeat. Recording the upstream citation is what lets the existing
      // confidence model refuse it corroboration credit later.
      const node = result.lineage.nodes.find((n) => n.url === match.item.link);
      const { data: outcome, error: rpcError } = await supabase.rpc("engine_add_evidence", {
        p_discovery_id: d.id,
        p_url: match.item.link,
        p_publisher: match.item.source.organisation,
        p_claim_status: d.claim_status,
        p_trust_level: "secondary",
        p_excerpt: (match.item.summary ?? match.item.title).slice(0, 2000),
        p_originates_from_url: node?.role === "derived" ? (node.attributedOrigin ?? null) : null,
        p_origin_examined: true,
      });

      if (rpcError) {
        // PGRST202 == the function does not exist, i.e. the migration is not
        // applied. Named explicitly so this reads as "not deployed yet" rather
        // than as a broken stage.
        if (/PGRST202|could not find the function/i.test(rpcError.message)) rpcMissing = true;
        else persistFailed++;
        continue;
      }
      if (outcome === "created") {
        attached++;
        counters.created++;
      }
    }

    findings.push({
      discovery: d.title.slice(0, 90),
      subject: result.subject?.organisation.name ?? null,
      queries: result.queries.filter((q) => q.kind === "identifying").map((q) => q.query),
      matches: result.matches.length,
      independentOrigins: result.lineage.independentOrigins,
      claims: result.claimBreakdown,
      framing: result.decision.framing,
      articleEligible: result.decision.articleEligible,
      productEligible: result.decision.productEligible,
    });
  }

  const anyCorpus = [...corpusCache.values()];
  const detail: Record<string, unknown> = {
    examined: counters.examined,
    evidenceAttached: attached,
    sourcesRead: [...new Set(anyCorpus.flatMap((c) => c.read))].length,
    sourcesFailed: anyCorpus.flatMap((c) => c.failed).slice(0, 12),
    findings,
    // Stated on every run so an empty result is never mistaken for a complete search.
    limitation:
      "Only stories present in the registry's recent feed windows can be found. A story older " +
      "than those windows is invisible to this stage.",
  };

  if (rpcMissing) {
    detail.blocked =
      "engine_add_evidence is not deployed (supabase/migrations_pending/20260824_research_evidence.sql). " +
      "Research ran and found the corroboration reported above, but could NOT persist it.";
    await recordJobRun(supabase, JOB, "partial", counters, detail);
    return { status: "partial", ...counters, detail };
  }

  const status = persistFailed > 0 ? "partial" : "success";
  if (persistFailed > 0) detail.persistFailures = persistFailed;
  await recordJobRun(supabase, JOB, status, counters, detail);
  return { status, ...counters, detail };
}
