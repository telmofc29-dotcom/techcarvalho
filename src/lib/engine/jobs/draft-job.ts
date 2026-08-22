import "server-only";
import type { createClient } from "@/lib/supabase/server";
import { newCounters, recordJobRun, isFlagEnabled } from "@/lib/engine/cron";
import { assembleDraft, proposeSeo } from "@/lib/engine/draft-assembly";
import { resolveEntity, proposeSlug } from "@/lib/engine/entity-resolution";
import { proposedChanges } from "@/lib/engine/update-signals";
import type { StageResult } from "./discovery";

type Client = Awaited<ReturnType<typeof createClient>>;
const JOB = "engine_draft_assembly";

// Draft assembly — the stage that closes the brief -> draft gap.
//
// Two gates stand in front of everything here, and neither is bypassable:
//
//   1. A HUMAN must have approved the brief (review_state='approved'). The
//      engine never assembles a draft for a topic nobody signed off on.
//   2. The resulting row is created with status='draft' by a function that has
//      no parameter capable of publishing. Human review remains the final
//      publication gate.
//
// Entity resolution runs before assembly so a slightly reworded headline about
// a topic already covered produces an UPDATE PROPOSAL against the existing
// page rather than a second near-duplicate article.
export async function runDraftAssembly(supabase: Client): Promise<StageResult> {
  const counters = newCounters();

  if (!(await isFlagEnabled(supabase, "research"))) {
    await recordJobRun(supabase, JOB, "skipped", counters, { reason: "research_disabled" });
    return { status: "skipped", ...counters };
  }

  const { data, error } = await supabase.rpc("engine_assemblable_briefs", { p_limit: 10 });
  if (error) {
    await recordJobRun(supabase, JOB, "failed", counters, {}, error.message);
    return { status: "failed", ...counters, detail: { error: error.message } };
  }

  const briefs = (data ?? []) as {
    id: string;
    discovery_id: string | null;
    proposed_title: string;
    proposed_slug: string | null;
    content_type: string;
    search_intent: string | null;
    primary_query: string | null;
    category_slug: string | null;
    rationale: string;
    primary_question: string | null;
    supporting_questions: string[] | null;
    verified_facts: string[] | null;
    uncertainties: string[] | null;
    source_urls: string[] | null;
    suggested_structure: string[] | null;
    brief_kind: string | null;
    freshness_sensitivity: string | null;
  }[];

  if (briefs.length === 0) {
    await recordJobRun(supabase, JOB, "success", counters, { reason: "no_approved_briefs" });
    return { status: "success", ...counters };
  }

  // One scan of existing entities serves every brief in this pass — both for
  // duplicate detection and for proposing internal links.
  const { data: entityRows, error: entityError } = await supabase.rpc("engine_existing_entities");
  if (entityError) {
    await recordJobRun(supabase, JOB, "failed", counters, {}, entityError.message);
    return { status: "failed", ...counters, detail: { error: entityError.message } };
  }
  const entities = (entityRows ?? []) as {
    kind: "product" | "content";
    id: string;
    name: string;
    slug: string;
    is_published: boolean;
  }[];
  const takenSlugs = new Set(entities.map((e) => e.slug));

  const assembled: string[] = [];
  const deduplicated: string[] = [];
  // Not a JobCounters field (that shape is fixed by engine_record_job_run), so
  // it travels in the detail payload — "held for a human" must stay visible
  // rather than looking like nothing happened.
  const heldForReview: string[] = [];

  for (const brief of briefs) {
    counters.examined++;

    // --- Entity resolution: is this already covered? ---
    const resolution = resolveEntity(brief.proposed_title, entities);

    // Log every decision, including the ones that changed nothing — "why
    // didn't this create an article?" needs an auditable answer.
    await supabase.rpc("engine_record_entity_resolution", {
      p_discovery_id: brief.discovery_id,
      p_candidate_name: brief.proposed_title,
      p_normalised: resolution.normalised,
      p_product_id: resolution.matchedKind === "product" ? resolution.matchedId : null,
      p_content_id: resolution.matchedKind === "content" ? resolution.matchedId : null,
      p_score: resolution.score,
      p_decision: resolution.decision,
      p_explanation: resolution.explanation,
    });

    // An existing article already covers this. Propose an update to it rather
    // than publishing a second page about the same thing — the difference
    // between a maintained publication and one that accumulates duplicates.
    if (resolution.decision === "matched_existing" && resolution.matchedKind === "content") {
      await supabase.rpc("engine_upsert_update_proposal", {
        p_content_id: resolution.matchedId,
        p_product_id: null,
        p_discovery_id: brief.discovery_id,
        p_reason: "newer_evidence",
        p_summary: `New evidence relating to an existing article. ${resolution.explanation}`,
        // Same builder the update-proposal job uses, so both producers write
        // the verified/unverified prefixes the admin review UI reads back.
        // A hand-rolled variant here would render as "unclassified" there.
        p_changes: proposedChanges({
          verifiedFacts: brief.verified_facts ?? [],
          uncertainties: brief.uncertainties ?? [],
        }),
        p_evidence: brief.source_urls ?? [],
        p_confidence: (brief.verified_facts ?? []).length > 0 ? 0.7 : 0.4,
      });
      counters.deduped++;
      deduplicated.push(brief.proposed_title.slice(0, 60));
      continue;
    }

    // Ambiguous means a human decides. Assembling would risk a duplicate;
    // skipping silently would lose the brief. The resolution row above is the
    // record, and the brief stays approved-but-unassembled for review.
    if (resolution.decision === "ambiguous") {
      heldForReview.push(`${brief.proposed_title.slice(0, 50)} ~ ${resolution.matchedName}`);
      continue;
    }

    // --- Internal links from real, existing records ---
    // Only PUBLISHED content is offered as a link target; an unpublished
    // article is not a usable link and suggesting it invites a broken one.
    const relatedContent = entities
      .filter((e) => e.kind === "content" && e.is_published && shareTerms(e.name, brief.proposed_title))
      .slice(0, 4)
      .map((e) => ({ title: e.name, slug: e.slug }));

    // Products are offered either way — 38 of them are legitimately blocked on
    // media — but the draft names an unpublished one instead of linking it.
    const productMatches = entities
      .filter((e) => e.kind === "product" && shareTerms(e.name, brief.proposed_title))
      .slice(0, 4);

    const draft = assembleDraft({
      title: brief.proposed_title,
      contentType: brief.content_type,
      categorySlug: brief.category_slug,
      primaryQuestion: brief.primary_question,
      supportingQuestions: brief.supporting_questions ?? [],
      verifiedFacts: brief.verified_facts ?? [],
      uncertainties: brief.uncertainties ?? [],
      sourceUrls: brief.source_urls ?? [],
      suggestedStructure: brief.suggested_structure ?? [],
      briefKind: brief.brief_kind,
      freshnessSensitivity: brief.freshness_sensitivity,
      rationale: brief.rationale,
      relatedContent,
      relatedProducts: productMatches.map((p) => ({
        name: p.name,
        slug: p.slug,
        isPublished: p.is_published,
      })),
    });

    const seo = proposeSeo({ title: brief.proposed_title, primaryQuestion: brief.primary_question });
    const slug = brief.proposed_slug && !takenSlugs.has(brief.proposed_slug)
      ? brief.proposed_slug
      : proposeSlug(brief.proposed_title, takenSlugs);

    if (!slug) {
      counters.failed++;
      continue;
    }

    const { data: result, error: assembleError } = await supabase.rpc("engine_assemble_draft", {
      p_brief_id: brief.id,
      p_title: brief.proposed_title,
      p_slug: slug,
      p_body: draft.body,
      p_content_type: brief.content_type,
      p_category_slug: brief.category_slug,
      p_search_intent: brief.search_intent,
      p_primary_query: brief.primary_query,
      p_source_urls: brief.source_urls ?? [],
      p_meta_title: seo.metaTitle,
      p_meta_description: seo.metaDescription,
    });

    if (assembleError) {
      counters.failed++;
      continue;
    }
    if (result === "duplicate_slug") {
      counters.deduped++;
      deduplicated.push(brief.proposed_title.slice(0, 60));
      continue;
    }
    if (result === "rejected_invalid") {
      counters.failed++;
      continue;
    }

    // Keep the in-memory view current so two briefs in the same pass cannot
    // claim the same slug or link to each other as if already published.
    takenSlugs.add(slug);
    // is_published: false — it is a draft, so a later brief in this same pass
    // will name it rather than link to it.
    entities.push({
      kind: "content", id: String(result), name: brief.proposed_title, slug, is_published: false,
    });
    counters.created++;
    assembled.push(brief.proposed_title.slice(0, 60));
  }

  const status =
    counters.failed === 0
      ? "success"
      : counters.created + counters.deduped > 0
        ? "partial"
        : "failed";
  await recordJobRun(supabase, JOB, status, counters, { assembled, deduplicated, heldForReview });
  return { status, ...counters, detail: { assembled, deduplicated, heldForReview } };
}

/**
 * Cheap topical overlap for internal-link suggestions. Deliberately not the
 * entity-resolution matcher — that one answers "is this the same thing?", this
 * answers the much looser "would a reader find this related?".
 */
const LINK_STOPWORDS = new Set([
  "the", "a", "an", "and", "or", "for", "with", "your", "you", "is", "are",
  "to", "of", "in", "on", "how", "what", "why", "best", "vs", "versus", "new",
]);

function shareTerms(a: string, b: string): boolean {
  const terms = (s: string) =>
    new Set(
      s.toLowerCase().replace(/[^a-z0-9\s]/g, " ").split(/\s+/)
        .filter((t) => t.length > 2 && !LINK_STOPWORDS.has(t))
    );
  const ta = terms(a);
  const tb = terms(b);
  let shared = 0;
  for (const t of ta) if (tb.has(t)) shared++;
  return shared >= 2;
}
