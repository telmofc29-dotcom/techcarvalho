import "server-only";
import type { createClient } from "@/lib/supabase/server";
import { newCounters, recordJobRun, isFlagEnabled } from "@/lib/engine/cron";
import { buildBrief } from "@/lib/engine/brief-builder";
import { classifyPromotional } from "@/lib/engine/promotional";
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

  if (!(await isFlagEnabled(supabase, "research"))) {
    await recordJobRun(supabase, JOB, "skipped", counters, { reason: "research_disabled" });
    return { status: "skipped", ...counters };
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

  const created: string[] = [];
  // Counted separately rather than as `failed` — declining to reprint a press
  // release is the pipeline working, not an error.
  const promotional: string[] = [];

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
    if (evErr) {
      counters.failed++;
      continue;
    }

    const evidence = ((ev ?? []) as {
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

    const { data: result, error: createErr } = await supabase.rpc("engine_create_brief", {
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
    });

    if (createErr) counters.failed++;
    else if (result === "created") {
      counters.created++;
      created.push(brief.proposedTitle.slice(0, 60));
    } else counters.deduped++;
  }

  const status =
    counters.failed === 0 ? "success" : counters.created + counters.deduped > 0 ? "partial" : "failed";
  await recordJobRun(supabase, JOB, status, counters, { created, promotional });
  return { status, ...counters, detail: { created, promotional } };
}
