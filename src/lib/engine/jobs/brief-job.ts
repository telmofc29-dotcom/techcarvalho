import "server-only";
import type { createClient } from "@/lib/supabase/server";
import { newCounters, recordJobRun, readFlag } from "@/lib/engine/cron";
import {
  createPostconditionLog,
  statusFromPostconditions,
  worstStatus,
} from "@/lib/engine/postconditions";
import { postconditionDetail, writeCountsFrom } from "@/lib/engine/silent-success";
import { buildBrief } from "@/lib/engine/brief-builder";
import { classifyPromotional } from "@/lib/engine/promotional";
import { concludeEmptyQueue } from "./reader-liveness";
import type { StageResult } from "./discovery";
import type { ClaimStatus, TrustLevel } from "@/lib/engine/types";
import type { ContentAngle } from "@/lib/engine/relevance";

type Client = Awaited<ReturnType<typeof createClient>>;
const JOB = "engine_briefs";

// Brief-generation pass — the stage that was missing at the end of Phase 3.
//
// Turns a RELEVANT discovery plus its evidence into a structured brief: the
// question to answer, what is actually verified, what is merely claimed, the
// sources, a suggested structure, and the media requirement. It produces no
// prose and cannot publish. Every brief enters review_state='pending' for a
// human decision.
//
// Gated on the `research` flag specifically, so brief generation can be turned
// off independently of discovery.
export async function runBriefGeneration(supabase: Client): Promise<StageResult> {
  const counters = newCounters();

  const researchFlag = await readFlag(supabase, "research");
  if (!researchFlag.enabled) {
    // An UNREADABLE flag is a failure, not a deliberate skip. Recording it as
    // 'skipped' used to hide it twice over: the reason said the flag was off
    // when it had never been read, and silent-success.ts filters skipped runs
    // out entirely, so one denied RPC switched the engine off and still
    // produced a clean detector report.
    const status = researchFlag.readable ? "skipped" : "failed";
    await recordJobRun(
      supabase,
      JOB,
      status,
      counters,
      { reason: researchFlag.reason },
      researchFlag.error
    );
    return { status, ...counters, detail: { reason: researchFlag.reason } };
  }

  const { data, error } = await supabase.rpc("engine_briefable_discoveries", { p_limit: 15 });
  if (error) {
    await recordJobRun(supabase, JOB, "failed", counters, {}, error.message);
    return { status: "failed", ...counters, detail: { error: error.message } };
  }

  const rows = (data ?? []) as {
    id: string;
    title: string;
    summary: string | null;
    discovery_type: string;
    category_slug: string | null;
    claim_status: string;
    suggested_angle: string | null;
    sighting_count: number;
  }[];

  // An empty discovery queue used to fall through the loop and record success
  // with every counter at zero — the identical row a silently-denied read
  // produces. NOTHING_TO_DO has to be earned; see queue-read.ts.
  if (rows.length === 0) {
    const outcome = await concludeEmptyQueue(supabase, {
      stage: JOB,
      source: "engine_briefable_discoveries",
      kind: "security_definer_rpc",
      rowsReturned: 0,
      eligible: 0,
      reason: "no_briefable_discoveries",
    });
    await recordJobRun(supabase, JOB, outcome.status, counters, outcome.detail, outcome.error ?? undefined);
    return { status: outcome.status, ...counters, detail: outcome.detail };
  }

  const created: string[] = [];
  // Counted separately rather than as `failed` — declining to reprint a press
  // release is the pipeline working, not an error.
  const promotional: string[] = [];
  const log = createPostconditionLog(counters);

  for (const row of rows) {
    counters.examined++;

    // Discovery sources are manufacturer newsrooms, which is right for primary
    // evidence but means the feed carries marketing alongside news. Without
    // this check the review queue fills with vendor headlines waiting to be
    // reprinted — which is exactly what it did: all 16 briefs the engine first
    // produced were press releases.
    //
    // Relevance cannot catch this. "Intel Gamer Days 2026" is genuinely
    // consumer-gaming relevant AND promotional; those are different axes.
    const promo = classifyPromotional(row.title, row.summary);
    if (promo.isPromotional) {
      promotional.push(`${row.title.slice(0, 55)} [${promo.matched.join(", ")}]`);
      counters.deduped++;
      continue;
    }

    // Carry provenance forward: the brief is built from the SAME evidence rows
    // the confidence score was computed from, not from a re-reading of the
    // headline.
    const { data: ev, error: evErr } = await supabase.rpc("engine_evidence_for", {
      p_discovery_id: row.id,
    });
    // A null with no error is not "this discovery has no evidence" — the RPC
    // returns a TABLE, so an empty result is []. Null means it did not answer,
    // and a brief built on it would present an evidence vacuum as a finding.
    if (evErr || ev === null) {
      counters.failed++;
      continue;
    }

    const evidence = (ev as {
      url: string;
      publisher: string | null;
      claim_status: string;
      trust_level: string;
      originates_from_url: string | null;
    }[]).map((e) => ({
      url: e.url,
      publisher: e.publisher,
      claim_status: e.claim_status as ClaimStatus,
      trust_level: e.trust_level as TrustLevel,
      originates_from_url: e.originates_from_url,
    }));

    const brief = buildBrief({
      title: row.title,
      summary: row.summary,
      discoveryType: row.discovery_type,
      categorySlug: row.category_slug,
      claimStatus: row.claim_status as ClaimStatus,
      suggestedAngle: (row.suggested_angle as ContentAngle | null) ?? null,
      sightingCount: row.sighting_count,
      evidence,
    });

    // The old `else counters.deduped++` swallowed 'rejected_invalid' as though
    // it were the partial unique index doing its job. A content type or brief
    // kind this builder emits but engine_create_brief's guard list does not
    // accept would have shown up as a run full of harmless duplicates.
    const result = await log.rpc({
      operation: "engine_create_brief",
      subject: `discovery/${row.id}: ${brief.proposedTitle.slice(0, 50)}`,
      run: () =>
        supabase.rpc("engine_create_brief", {
          p_discovery_id: row.id,
          p_title: brief.proposedTitle,
          p_rationale: brief.rationale,
          p_primary_question: brief.primaryQuestion,
          p_supporting_questions: brief.supportingQuestions,
          p_verified_facts: brief.verifiedFacts,
          p_uncertainties: brief.uncertainties,
          p_source_urls: brief.sourceUrls,
          p_suggested_structure: brief.suggestedStructure,
          p_brief_kind: brief.briefKind,
          p_freshness: brief.freshnessSensitivity,
          p_category_slug: row.category_slug,
          p_content_type: brief.contentType,
          p_priority: brief.priority,
          p_media_note: brief.mediaRequirementNote,
        }),
      accepted: ["created"],
      benign: ["deduped"],
    });

    if (result.data === "created") created.push(brief.proposedTitle.slice(0, 60));
  }

  const jobView =
    counters.failed === 0 ? "success" : counters.created + counters.deduped > 0 ? "partial" : "failed";
  const postconditions = log.summarise();
  const status = worstStatus(jobView, statusFromPostconditions(postconditions));

  const detail = { created, promotional, postconditions: postconditionDetail(postconditions) };
  await recordJobRun(supabase, JOB, status, counters, detail, undefined, writeCountsFrom(postconditions));
  return { status, ...counters, detail };
}
