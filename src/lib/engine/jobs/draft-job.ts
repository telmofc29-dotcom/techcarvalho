import "server-only";
import type { createClient } from "@/lib/supabase/server";
import { newCounters, recordJobRun, readFlag } from "@/lib/engine/cron";
import {
  createPostconditionLog,
  isRowId,
  statusFromPostconditions,
  worstStatus,
} from "@/lib/engine/postconditions";
import { postconditionDetail, writeCountsFrom } from "@/lib/engine/silent-success";
import { assembleDraft, proposeSeo } from "@/lib/engine/draft-assembly";
import { resolveEntity, proposeSlug } from "@/lib/engine/entity-resolution";
import { proposedChanges } from "@/lib/engine/update-signals";
import { concludeEmptyQueue } from "./reader-liveness";
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
    // WAS: `recordJobRun(..., "success", ..., { reason: "no_approved_briefs" })`.
    //
    // An empty inbox is the NORMAL state for this stage — it consumes only
    // human-approved briefs — which is exactly what made the row so dangerous:
    // the one shape a denial produces is the one shape nobody would ever look
    // at twice. `{ data: [], error: null }` from a denied read and an editor who
    // has approved nothing wrote the identical run.
    //
    // The control read is made only on this path, so a pass with work to do pays
    // nothing for it. It excludes a blanket loss of grants. What it cannot
    // exclude is stated in the probe's own corroboration text and is real for
    // THIS RPC specifically: engine_assemblable_briefs opens with
    // `if not engine_flag_enabled('research') then return; end if;`, so a
    // research flag that reads false inside the function returns zero rows with
    // no error. The job checked that flag itself moments ago, which narrows it,
    // but does not close it — see supabase/migrations_pending/.
    const outcome = await concludeEmptyQueue(supabase, {
      stage: JOB,
      source: "engine_assemblable_briefs",
      kind: "security_definer_rpc",
      rowsReturned: 0,
      eligible: 0,
      reason: "no_approved_briefs",
    });
    await recordJobRun(supabase, JOB, outcome.status, counters, outcome.detail, outcome.error ?? undefined);
    return { status: outcome.status, ...counters, detail: outcome.detail };
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
  const log = createPostconditionLog(counters);

  for (const brief of briefs) {
    counters.examined++;

    // --- Entity resolution: is this already covered? ---
    const resolution = resolveEntity(brief.proposed_title, entities);

    // Log every decision, including the ones that changed nothing — "why
    // didn't this create an article?" needs an auditable answer. That audit
    // trail is only worth having if it is actually being written, and this RPC
    // is `returns void`, so nothing in the response can say whether it was.
    await log.pendingCreatedId({
      operation: "engine_record_entity_resolution",
      subject: brief.proposed_title.slice(0, 50),
      migration: "supabase/migrations/20260822_silent_success_telemetry.sql",
      // 'rejected_invalid' is the only non-creating answer, and it is NOT
      // benign: it means the decision enum drifted, which would erase the
      // explanation for every decision while every run still reported success.
      run: () =>
        supabase.rpc("engine_record_entity_resolution", {
          p_discovery_id: brief.discovery_id,
          p_candidate_name: brief.proposed_title,
          p_normalised: resolution.normalised,
          p_product_id: resolution.matchedKind === "product" ? resolution.matchedId : null,
          p_content_id: resolution.matchedKind === "content" ? resolution.matchedId : null,
          p_score: resolution.score,
          p_decision: resolution.decision,
          p_explanation: resolution.explanation,
        }),
    });

    // An existing article already covers this. Propose an update to it rather
    // than publishing a second page about the same thing — the difference
    // between a maintained publication and one that accumulates duplicates.
    if (resolution.decision === "matched_existing" && resolution.matchedKind === "content") {
      // THE INCIDENT #2 SHAPE, STILL LIVE UNTIL NOW. This call's return value
      // AND its error were both discarded, and the job then unconditionally
      // counted a dedupe. So the brief was consumed — marked as "already
      // covered, proposal raised instead" — whether or not any proposal was
      // actually raised. If this RPC rejected the call, the brief's topic was
      // dropped and no proposal existed anywhere; the run reported success and
      // the counters showed a healthy deduplication.
      const proposal = await log.rpc({
        operation: "engine_upsert_update_proposal",
        subject: `content/${resolution.matchedName} <- ${brief.proposed_title.slice(0, 40)}`,
        run: () =>
          supabase.rpc("engine_upsert_update_proposal", {
            p_content_id: resolution.matchedId,
            p_product_id: null,
            p_discovery_id: brief.discovery_id,
            p_reason: "newer_evidence",
            p_summary: `New evidence relating to an existing article. ${resolution.explanation}`,
            // Same builder the update-proposal job uses, so both producers
            // write the verified/unverified prefixes the admin review UI reads
            // back. A hand-rolled variant here would render as "unclassified".
            p_changes: proposedChanges({
              verifiedFacts: brief.verified_facts ?? [],
              uncertainties: brief.uncertainties ?? [],
            }),
            p_evidence: brief.source_urls ?? [],
            p_confidence: (brief.verified_facts ?? []).length > 0 ? 0.7 : 0.4,
          }),
        accepted: ["created"],
        benign: ["refreshed"],
      });

      // Only claim the brief was absorbed into an existing page if a proposal
      // demonstrably exists on that page. Otherwise it is a failure, already
      // counted by the log, and the brief is left for the next pass rather
      // than being quietly retired against a proposal that was never written.
      if (proposal.ok) deduplicated.push(brief.proposed_title.slice(0, 60));
      continue;
    }

    // Ambiguous means a human decides. Assembling would risk a duplicate;
    // skipping silently would lose the brief. The resolution row above is the
    // record, and the brief stays approved-but-unassembled for review.
    if (resolution.decision === "ambiguous") {
      heldForReview.push(`${brief.proposed_title.slice(0, 50)} ~ ${resolution.matchedName}`);
      counters.deduped++;
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

    // The previous branch chain handled 'duplicate_slug' and 'rejected_invalid'
    // by name and then treated EVERYTHING ELSE as a created row id — including
    // `null`. A null result (a missing overload, a revoked grant) fell straight
    // through to `String(result)`, pushing the literal string "null" into the
    // entity list as a content id, incrementing `created`, and reporting an
    // article that does not exist. `createdId` inverts that: only an actual
    // uuid counts as a creation, and null is 'unverifiable', never success.
    //
    // The rejection statuses named below come from the least-privilege draft in
    // supabase/migrations_pending/20260822_engine_rpc_least_privilege.sql. They
    // are legitimate non-work — the brief was not approved, or was already
    // assembled — rather than errors, so they are benign; but they are named
    // explicitly, so a status nobody anticipated still fails.
    const result = await log.createdId({
      operation: "engine_assemble_draft",
      subject: `brief/${brief.id} slug=${slug}`,
      run: () =>
        supabase.rpc("engine_assemble_draft", {
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
        }),
      benign: [
        "duplicate_slug",
        "rejected_already_assembled",
        "rejected_brief_not_approved",
        "rejected_brief_closed",
      ],
    });

    const contentId = result.data;
    if (!isRowId(contentId)) {
      if (contentId === "duplicate_slug") deduplicated.push(brief.proposed_title.slice(0, 60));
      continue;
    }

    // Keep the in-memory view current so two briefs in the same pass cannot
    // claim the same slug or link to each other as if already published.
    takenSlugs.add(slug);
    // is_published: false — it is a draft, so a later brief in this same pass
    // will name it rather than link to it.
    entities.push({
      kind: "content", id: contentId, name: brief.proposed_title, slug, is_published: false,
    });
    assembled.push(brief.proposed_title.slice(0, 60));
  }

  const jobView =
    counters.failed === 0
      ? "success"
      : counters.created + counters.deduped > 0
        ? "partial"
        : "failed";
  const postconditions = log.summarise();
  const status = worstStatus(jobView, statusFromPostconditions(postconditions));

  const detail = {
    assembled,
    deduplicated,
    heldForReview,
    postconditions: postconditionDetail(postconditions),
  };
  await recordJobRun(supabase, JOB, status, counters, detail, undefined, writeCountsFrom(postconditions));
  return { status, ...counters, detail };
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
