"use server";

import { revalidatePath } from "next/cache";
import { requireAdmin } from "@/lib/dal";
import { createClient } from "@/lib/supabase/server";
import type {
  EngineSourceType,
  MediaRightsStatus,
  TrustLevel,
} from "@/lib/engine/types";
import type {
  EngineFreshnessState,
  EnginePipelineState,
  EngineUpdateProposalState,
} from "@/lib/types/database";
import { loadApprovalPackage } from "@/lib/engine/package-service";
import { assembleDraft, proposeSeo } from "@/lib/engine/draft-assembly";
import { proposeSlug } from "@/lib/engine/entity-resolution";
import { resolveAllStageModes } from "@/lib/engine/stage-modes";
import { ENGINE_STAGE_NAMES } from "@/lib/engine/stages";

type ReviewState = "pending" | "approved" | "rejected" | "snoozed" | "research_requested";
type RelevanceVerdict = "relevant" | "rejected" | "uncertain";

// Server Actions for the Growth Engine admin surfaces.
//
// Deliberately narrow: these actions can toggle engine switches, manage the
// source registry, and acknowledge/dismiss freshness reviews. Nothing here can
// publish content, flip products.is_published, promote content_items.status, or
// alter media rights — those stay in the existing editorial/media surfaces
// behind evaluateMediaReadiness().
//
// Plain Promise<void> to match this project's simple-form-action convention
// (see media/requirement-actions.ts and products/actions.ts): invalid input is
// ignored rather than surfaced inline.

const VALID_SOURCE_TYPES: EngineSourceType[] = [
  "manufacturer_newsroom",
  "product_feed",
  "rss_atom",
  "official_docs",
  "public_api",
  "regulatory_dataset",
  "trusted_editorial",
  "other_approved",
];

const VALID_TRUST_LEVELS: TrustLevel[] = ["primary", "secondary", "community"];

const VALID_MEDIA_RIGHTS: MediaRightsStatus[] = [
  "unverified",
  "confirmed_usable",
  "requires_registration",
  "unclear_manual_review",
  "no_source_found",
  "prohibited",
];

export async function updateEngineSettings(formData: FormData): Promise<void> {
  await requireAdmin();
  const supabase = await createClient();

  // Every switch defaults to OFF when its checkbox is absent from the form —
  // an unchecked HTML checkbox submits nothing, so "missing" must mean false
  // rather than "leave as-is", otherwise a switch could never be turned off.
  await supabase
    .from("engine_settings")
    .update({
      master_enabled: formData.get("master_enabled") === "on",
      discovery_enabled: formData.get("discovery_enabled") === "on",
      research_enabled: formData.get("research_enabled") === "on",
      freshness_enabled: formData.get("freshness_enabled") === "on",
      opportunity_scoring_enabled: formData.get("opportunity_scoring_enabled") === "on",
      autonomous_publishing_enabled: formData.get("autonomous_publishing_enabled") === "on",
      notes: String(formData.get("notes") ?? "").trim() || null,
      updated_at: new Date().toISOString(),
    })
    .eq("id", true);

  revalidatePath("/admin/engine");
}

/**
 * Rights-review attribution for a source row.
 *
 * `last_reviewed_at` is stamped only when a reviewer name is actually given —
 * an unnamed save leaves the previous review date alone rather than making the
 * terms look freshly checked when nobody checked them. Clearing the name clears
 * the date too, so the pair can never claim a review with no reviewer.
 */
function reviewFields(formData: FormData): { reviewed_by: string | null; last_reviewed_at: string | null } {
  const reviewedBy = String(formData.get("reviewed_by") ?? "").trim();
  if (!reviewedBy) return { reviewed_by: null, last_reviewed_at: null };
  return { reviewed_by: reviewedBy, last_reviewed_at: new Date().toISOString() };
}

export async function createEngineSource(formData: FormData): Promise<void> {
  await requireAdmin();

  const organisation = String(formData.get("organisation") ?? "").trim();
  const url = String(formData.get("url") ?? "").trim();
  const sourceType = String(formData.get("source_type") ?? "").trim();
  const trustLevel = String(formData.get("trust_level") ?? "secondary").trim();
  const mediaRights = String(formData.get("media_rights_status") ?? "unverified").trim();

  if (!organisation || !url) return;
  if (!VALID_SOURCE_TYPES.includes(sourceType as EngineSourceType)) return;
  if (!VALID_TRUST_LEVELS.includes(trustLevel as TrustLevel)) return;
  if (!VALID_MEDIA_RIGHTS.includes(mediaRights as MediaRightsStatus)) return;

  const categoriesRaw = String(formData.get("categories") ?? "").trim();
  const categories = categoriesRaw
    ? categoriesRaw.split(",").map((c) => c.trim()).filter(Boolean)
    : [];

  const frequency = Number(formData.get("check_frequency_hours") ?? 24);

  const supabase = await createClient();
  await supabase.from("engine_sources").insert({
    organisation,
    url,
    source_type: sourceType as EngineSourceType,
    trust_level: trustLevel as TrustLevel,
    categories,
    is_active: formData.get("is_active") === "on",
    // These three are independent on purpose — see the migration's Source
    // Registry header. Reading facts from a source never implies permission to
    // browse its image library, and browsing never implies permission to
    // republish what's in it. Each is read from its own checkbox; none is ever
    // derived from another.
    discovery_permitted: formData.get("discovery_permitted") === "on",
    media_browsing_permitted: formData.get("media_browsing_permitted") === "on",
    media_republication_permitted: formData.get("media_republication_permitted") === "on",
    media_rights_status: mediaRights as MediaRightsStatus,
    editorial_use_only: formData.get("editorial_use_only") === "on",
    registration_required: formData.get("registration_required") === "on",
    terms_url: String(formData.get("terms_url") ?? "").trim() || null,
    terms_notes: String(formData.get("terms_notes") ?? "").trim() || null,
    attribution_required: formData.get("attribution_required") === "on",
    attribution_text: String(formData.get("attribution_text") ?? "").trim() || null,
    check_frequency_hours: Number.isFinite(frequency) && frequency >= 1 ? Math.floor(frequency) : 24,
    ...reviewFields(formData),
  });

  revalidatePath("/admin/engine/sources");
}

export async function updateEngineSource(id: string, formData: FormData): Promise<void> {
  await requireAdmin();
  if (!id) return;

  const sourceType = String(formData.get("source_type") ?? "").trim();
  const trustLevel = String(formData.get("trust_level") ?? "secondary").trim();
  const mediaRights = String(formData.get("media_rights_status") ?? "unverified").trim();

  if (!VALID_SOURCE_TYPES.includes(sourceType as EngineSourceType)) return;
  if (!VALID_TRUST_LEVELS.includes(trustLevel as TrustLevel)) return;
  if (!VALID_MEDIA_RIGHTS.includes(mediaRights as MediaRightsStatus)) return;

  const categoriesRaw = String(formData.get("categories") ?? "").trim();
  const categories = categoriesRaw
    ? categoriesRaw.split(",").map((c) => c.trim()).filter(Boolean)
    : [];

  const frequency = Number(formData.get("check_frequency_hours") ?? 24);

  const supabase = await createClient();
  await supabase
    .from("engine_sources")
    .update({
      source_type: sourceType as EngineSourceType,
      trust_level: trustLevel as TrustLevel,
      categories,
      is_active: formData.get("is_active") === "on",
      discovery_permitted: formData.get("discovery_permitted") === "on",
      media_browsing_permitted: formData.get("media_browsing_permitted") === "on",
      media_republication_permitted: formData.get("media_republication_permitted") === "on",
      media_rights_status: mediaRights as MediaRightsStatus,
      editorial_use_only: formData.get("editorial_use_only") === "on",
      registration_required: formData.get("registration_required") === "on",
      terms_url: String(formData.get("terms_url") ?? "").trim() || null,
      terms_notes: String(formData.get("terms_notes") ?? "").trim() || null,
      attribution_required: formData.get("attribution_required") === "on",
      attribution_text: String(formData.get("attribution_text") ?? "").trim() || null,
      check_frequency_hours: Number.isFinite(frequency) && frequency >= 1 ? Math.floor(frequency) : 24,
      ...reviewFields(formData),
      updated_at: new Date().toISOString(),
    })
    .eq("id", id);

  revalidatePath("/admin/engine/sources");
}

export async function deleteEngineSource(formData: FormData): Promise<void> {
  await requireAdmin();
  const id = String(formData.get("id") ?? "");
  if (!id) return;

  const supabase = await createClient();
  await supabase.from("engine_sources").delete().eq("id", id);
  revalidatePath("/admin/engine/sources");
}

// Typed as the DB union (not string[]) so the allow-list and the column type
// cannot drift apart — adding a state here without adding it to the schema is
// now a compile error rather than a silent runtime rejection.
const VALID_FRESHNESS_STATES: EngineFreshnessState[] = ["open", "acknowledged", "actioned", "dismissed"];

export async function setFreshnessReviewState(formData: FormData): Promise<void> {
  await requireAdmin();
  const id = String(formData.get("id") ?? "");
  const state = String(formData.get("state") ?? "").trim() as EngineFreshnessState;
  if (!id || !VALID_FRESHNESS_STATES.includes(state)) return;

  const supabase = await createClient();
  await supabase.from("engine_freshness_reviews").update({ state }).eq("id", id);
  revalidatePath("/admin/engine/freshness");
}

const VALID_DISCOVERY_STATES: EnginePipelineState[] = [
  "discovered",
  "researched",
  "evidence_checked",
  "planned",
  "drafting",
  "media_check",
  "review_eligible",
  "blocked",
  "rejected",
  "error",
];

// Note the deliberate omission of "published" from the list above: an admin
// can move a candidate through triage from here, but marking something
// published is not a triage action — that happens as a consequence of a real
// content_items row being published through the editorial workflow.
export async function setDiscoveryState(formData: FormData): Promise<void> {
  await requireAdmin();
  const id = String(formData.get("id") ?? "");
  const state = String(formData.get("state") ?? "").trim() as EnginePipelineState;
  const reason = String(formData.get("state_reason") ?? "").trim();
  if (!id || !VALID_DISCOVERY_STATES.includes(state)) return;

  const supabase = await createClient();
  await supabase
    .from("engine_discoveries")
    .update({ state, state_reason: reason || null, updated_at: new Date().toISOString() })
    .eq("id", id);
  revalidatePath("/admin/engine/discoveries");
}

const VALID_REVIEW_STATES: ReviewState[] = [
  "pending",
  "approved",
  "rejected",
  "snoozed",
  "research_requested",
];

/**
 * Moves a brief through the human review queue.
 *
 * This is the ONLY thing it does. Approving a brief does not create a content
 * record, does not publish anything, and does not touch products or media —
 * approval means "a human agrees this is worth writing", and writing it stays
 * a separate, manual act through the normal editorial workflow.
 *
 * `snoozed_until` is only set for the snooze state, and cleared otherwise, so
 * a brief that was snoozed and later approved doesn't keep a stale wake-up
 * date hanging off it.
 */
export async function setBriefReviewState(formData: FormData): Promise<void> {
  await requireAdmin();
  const id = String(formData.get("id") ?? "");
  const reviewState = String(formData.get("review_state") ?? "").trim() as ReviewState;
  const note = String(formData.get("review_note") ?? "").trim();
  if (!id || !VALID_REVIEW_STATES.includes(reviewState)) return;

  let snoozedUntil: string | null = null;
  if (reviewState === "snoozed") {
    const days = Number(formData.get("snooze_days") ?? 7);
    const safeDays = Number.isFinite(days) && days >= 1 && days <= 365 ? Math.floor(days) : 7;
    snoozedUntil = new Date(Date.now() + safeDays * 86_400_000).toISOString();
  }

  const supabase = await createClient();

  // `state` (pipeline) and `review_state` (human decision) are separate
  // columns, and the partial unique index engine_briefs_one_live_per_discovery
  // is keyed on `state`. So a brief rejected here while `state` stayed
  // 'planned' would keep occupying that discovery's only live-brief slot —
  // permanently preventing the discovery from ever being re-briefed.
  //
  // Rejecting therefore also retires the pipeline state, which frees the slot.
  // Approving deliberately does NOT advance `state`: nothing should move
  // through the pipeline automatically just because a human said yes.
  await supabase
    .from("engine_briefs")
    .update({
      review_state: reviewState,
      review_note: note || null,
      snoozed_until: snoozedUntil,
      reviewed_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
      // Rejecting also retires the pipeline state (see comment above), which
      // is what frees the unique-index slot. Spread so the non-rejection path
      // leaves `state` untouched rather than writing it back unchanged.
      ...(reviewState === "rejected"
        ? { state: "rejected" as const, state_reason: note || "Rejected in review queue." }
        : {}),
    })
    .eq("id", id);

  // Three surfaces now show this row: the specialist page, the owner queue
  // that ranks it, and the dashboard tile that counts it. Revalidating only
  // the first would leave an owner who acted from Today looking at the item
  // they just actioned, which reads as the action having failed.
  revalidatePath("/admin/engine/briefs");
  revalidatePath("/admin/engine");
  revalidatePath("/admin");
}

const VALID_RELEVANCE_VERDICTS: RelevanceVerdict[] = ["relevant", "rejected", "uncertain"];

/**
 * Human override of a machine relevance verdict.
 *
 * Writes `relevance_overridden_by_admin = true`, which is load-bearing: the
 * engine_set_relevance RPC only updates rows where that flag is false, so once
 * a human has ruled on a discovery the scheduled classifier can never quietly
 * reverse them on a later pass.
 *
 * The explanation is rewritten to say a human decided, so the discoveries page
 * never shows a machine rationale next to a human verdict.
 */
export async function overrideDiscoveryRelevance(formData: FormData): Promise<void> {
  await requireAdmin();
  const id = String(formData.get("id") ?? "");
  const verdict = String(formData.get("relevance_verdict") ?? "").trim() as RelevanceVerdict;
  const note = String(formData.get("override_note") ?? "").trim();
  if (!id || !VALID_RELEVANCE_VERDICTS.includes(verdict)) return;

  const supabase = await createClient();
  await supabase
    .from("engine_discoveries")
    .update({
      relevance_verdict: verdict,
      relevance_overridden_by_admin: true,
      relevance_explanation: note
        ? `Overridden by an administrator: ${note}`
        : "Overridden by an administrator (no reason given).",
      // Keep pipeline state consistent with the new verdict, mirroring what
      // engine_set_relevance does for the machine path.
      state: verdict === "rejected" ? "rejected" : "discovered",
      updated_at: new Date().toISOString(),
    })
    .eq("id", id);

  revalidatePath("/admin/engine/discoveries");
}

// ---------------------------------------------------------------------------
// Phase 5 — media acquisition rights review
// ---------------------------------------------------------------------------

const VALID_CANDIDATE_DECISIONS = ["approved", "rejected"] as const;
type CandidateDecision = (typeof VALID_CANDIDATE_DECISIONS)[number];

/**
 * Human rights decision on a discovered media candidate.
 *
 * Deliberately limited to `approved` and `rejected`. Approving marks the
 * candidate as cleared for a human to ingest — it does NOT ingest the asset,
 * does not create a media_assets row, does not associate anything with a
 * product or article, and does not touch the source's
 * media_republication_permitted flag. "We may use this" and "we have used
 * this" are separate facts, and conflating them is exactly how an unlicensed
 * image ends up live.
 *
 * `ingested` and `associated` are reachable only by the flow that actually
 * performs those acts, never from this review queue.
 */
export async function decideMediaCandidate(formData: FormData): Promise<void> {
  await requireAdmin();
  const id = String(formData.get("id") ?? "");
  const decision = String(formData.get("decision") ?? "").trim() as CandidateDecision;
  const reason = String(formData.get("state_reason") ?? "").trim();
  if (!id || !VALID_CANDIDATE_DECISIONS.includes(decision)) return;

  // A rejection with no reason is unhelpful six months later, but an empty
  // note shouldn't block the decision — record a placeholder instead.
  const stateReason =
    reason ||
    (decision === "approved"
      ? "Approved for ingest by an administrator."
      : "Rejected by an administrator (no reason given).");

  const supabase = await createClient();
  await supabase
    .from("engine_media_candidates")
    .update({ state: decision, state_reason: stateReason, updated_at: new Date().toISOString() })
    .eq("id", id);

  revalidatePath("/admin/engine/media-acquisition");
}

// ---------------------------------------------------------------------------
// Phase 5 — homepage trending overrides
// ---------------------------------------------------------------------------

const VALID_OVERRIDE_MODES = ["pin_lead", "pin_supporting", "suppress"] as const;
type OverrideMode = (typeof VALID_OVERRIDE_MODES)[number];

/**
 * Pins or suppresses a single item on the public homepage.
 *
 * homepage_overrides has a unique constraint on content_id, so this upserts:
 * re-pinning an already-overridden item replaces its mode rather than failing.
 *
 * This cannot publish anything. An override only affects the ORDER of content
 * that is already published — the homepage query still filters to
 * status='published', so pinning a draft has no visible effect.
 */
export async function setHomepageOverride(formData: FormData): Promise<void> {
  await requireAdmin();
  const contentId = String(formData.get("content_id") ?? "");
  const mode = String(formData.get("mode") ?? "").trim() as OverrideMode;
  const note = String(formData.get("note") ?? "").trim();
  if (!contentId || !VALID_OVERRIDE_MODES.includes(mode)) return;

  const supabase = await createClient();
  await supabase
    .from("homepage_overrides")
    .upsert({ content_id: contentId, mode, note: note || null }, { onConflict: "content_id" });

  revalidatePath("/admin/engine/homepage");
  // The public homepage reads these, so its cache must drop too.
  revalidatePath("/");
}

export async function removeHomepageOverride(formData: FormData): Promise<void> {
  await requireAdmin();
  const id = String(formData.get("id") ?? "");
  if (!id) return;

  const supabase = await createClient();
  await supabase.from("homepage_overrides").delete().eq("id", id);

  revalidatePath("/admin/engine/homepage");
  revalidatePath("/");
}

// ---------------------------------------------------------------------------
// Phase 6 — update proposals
// ---------------------------------------------------------------------------

// 'open' is deliberately absent. Two reasons, both load-bearing:
//
//   1. engine_update_proposals carries partial unique indexes allowing only ONE
//      open proposal per (target, reason). Reopening a closed proposal while
//      the engine has since opened a fresh one for the same pair would violate
//      that index, and this action shape swallows the error — a decision that
//      silently didn't happen. The engine reopens by upserting; a human does
//      not need to.
//   2. A rejection that can be quietly un-rejected is a weaker record than one
//      that stands. If a rejected proposal turns out to matter, the honest move
//      is a new proposal with its own evidence, not resurrecting an old one.
const VALID_PROPOSAL_DECISIONS: Exclude<EngineUpdateProposalState, "open">[] = [
  "accepted",
  "rejected",
  "applied",
];

/**
 * Records a human decision on an engine update proposal.
 *
 * This writes to the PROPOSAL ROW AND NOTHING ELSE. Accepting a proposal does
 * not edit the target article or product, does not change its status or
 * is_published, does not touch its specs, and does not publish anything.
 * 'accepted' means "an editor agrees this page should change"; 'applied' means
 * "a human has since made that change through the normal editorial surfaces".
 * Neither state is produced by, or produces, an automated edit.
 *
 * That separation is the whole point of a proposal: the engine may argue for a
 * change to a published page, and only a person may make one.
 */
export async function setUpdateProposalState(formData: FormData): Promise<void> {
  await requireAdmin();
  const id = String(formData.get("id") ?? "");
  const state = String(formData.get("state") ?? "").trim() as EngineUpdateProposalState;
  const reason = String(formData.get("state_reason") ?? "").trim();
  if (!id || !VALID_PROPOSAL_DECISIONS.includes(state as Exclude<EngineUpdateProposalState, "open">)) {
    return;
  }

  // A decision with no note is unreadable six months later, but an empty box
  // should not block the decision — record what was decided instead of
  // inventing a rationale nobody gave.
  const stateReason = reason || `Marked ${state} by an administrator (no reason given).`;

  const supabase = await createClient();
  await supabase
    .from("engine_update_proposals")
    .update({ state, state_reason: stateReason, updated_at: new Date().toISOString() })
    .eq("id", id);

  revalidatePath("/admin/engine/update-proposals");
}

// ---------------------------------------------------------------------------
// Approve & build — the one-click package (Phase B)
// ---------------------------------------------------------------------------

/**
 * Approve a brief and immediately assemble its draft.
 *
 * WHAT THIS REPLACES
 * ------------------
 * Approving used to set `review_state` and stop. Assembly then happened on the
 * next nightly tick, which meant the owner approved something on Monday and
 * looked for it on Tuesday — and in practice never did, because nothing told
 * them it had appeared. This runs the same stage immediately for the one brief
 * the owner just approved.
 *
 * IT IS THE SAME PATH, NOT A PARALLEL ONE
 * ---------------------------------------
 * Body composition uses `assembleDraft`, SEO uses `proposeSeo`, the slug uses
 * `proposeSlug`, and the write goes through the `engine_assemble_draft` RPC —
 * every one of them the same function the nightly `draft_assembly` stage calls.
 * Nothing here is a second implementation that could drift from the engine's.
 *
 * THE PUBLISHING BOUNDARY IS UNCHANGED
 * ------------------------------------
 * `engine_assemble_draft` is SECURITY DEFINER and hard-wires `status='draft'`.
 * It cannot be made to publish by calling it from here, from an admin session,
 * or with any argument. "Approve & build" therefore means "create the draft and
 * everything around it"; publishing remains a separate human action on the
 * content editor, exactly as before.
 *
 * ORDER MATTERS: the RPC refuses a brief whose `review_state` is not
 * 'approved' (returning 'rejected_brief_not_approved'), so approval is written
 * first and its failure aborts before anything is assembled.
 */
export async function approveAndBuild(formData: FormData): Promise<void> {
  await requireAdmin();
  const id = String(formData.get("id") ?? "");
  if (!id) return;

  // Re-derive the package server-side. The client's view of `canBuild` is a
  // rendering, not an authorisation — a stale tab, a concurrent edit, or a
  // hand-made POST must not be able to build something the rules now block.
  const load = await loadApprovalPackage(id);
  if (!load.ok || !load.package.canBuild) return;

  const supabase = await createClient();

  const { data: brief, error: briefError } = await supabase
    .from("engine_briefs")
    .select(
      "id, proposed_title, proposed_slug, content_type, category_slug, search_intent, primary_query, " +
        "rationale, primary_question, supporting_questions, verified_facts, uncertainties, source_urls, " +
        "suggested_structure, brief_kind, freshness_sensitivity, related_product_slugs, related_content_slugs"
    )
    .eq("id", id)
    .maybeSingle();
  if (briefError || !brief) return;

  const b = brief as unknown as {
    id: string;
    proposed_title: string;
    proposed_slug: string | null;
    content_type: string | null;
    category_slug: string | null;
    search_intent: string | null;
    primary_query: string | null;
    rationale: string;
    primary_question: string | null;
    supporting_questions: string[] | null;
    verified_facts: string[] | null;
    uncertainties: string[] | null;
    source_urls: string[] | null;
    suggested_structure: string[] | null;
    brief_kind: string | null;
    freshness_sensitivity: string | null;
    related_product_slugs: string[] | null;
    related_content_slugs: string[] | null;
  };

  const now = new Date().toISOString();
  const { error: approveError } = await supabase
    .from("engine_briefs")
    .update({ review_state: "approved", reviewed_at: now, updated_at: now })
    .eq("id", id);
  // Abort rather than continue: assembling a draft for a brief whose approval
  // did not persist would produce an article nobody approved.
  if (approveError) return;

  // Context for the body — the same joins the nightly stage performs.
  const [{ data: contentRows }, { data: productRows }] = await Promise.all([
    supabase.from("content_items").select("title, slug"),
    (b.related_product_slugs ?? []).length > 0
      ? supabase
          .from("products")
          .select("name, slug, is_published")
          .in("slug", b.related_product_slugs ?? [])
      : Promise.resolve({ data: [] as { name: string; slug: string; is_published: boolean }[] }),
  ]);

  const contentList = (contentRows ?? []) as { title: string; slug: string }[];
  const takenSlugs = new Set(contentList.map((c) => c.slug));
  const relatedContent = contentList.filter((c) =>
    (b.related_content_slugs ?? []).includes(c.slug)
  );

  const draft = assembleDraft({
    title: b.proposed_title,
    contentType: b.content_type ?? "news",
    categorySlug: b.category_slug,
    primaryQuestion: b.primary_question,
    supportingQuestions: b.supporting_questions ?? [],
    verifiedFacts: b.verified_facts ?? [],
    uncertainties: b.uncertainties ?? [],
    sourceUrls: b.source_urls ?? [],
    suggestedStructure: b.suggested_structure ?? [],
    briefKind: b.brief_kind,
    freshnessSensitivity: b.freshness_sensitivity,
    rationale: b.rationale,
    relatedContent: relatedContent.map((c) => ({ title: c.title, slug: c.slug })),
    relatedProducts: (
      (productRows ?? []) as { name: string; slug: string; is_published: boolean }[]
    ).map((p) => ({ name: p.name, slug: p.slug, isPublished: p.is_published })),
  });

  const seo = proposeSeo({ title: b.proposed_title, primaryQuestion: b.primary_question });
  const slug =
    b.proposed_slug && !takenSlugs.has(b.proposed_slug)
      ? b.proposed_slug
      : proposeSlug(b.proposed_title, takenSlugs);
  if (!slug) return;

  await supabase.rpc("engine_assemble_draft", {
    p_brief_id: b.id,
    p_title: b.proposed_title,
    p_slug: slug,
    p_body: draft.body,
    p_content_type: b.content_type ?? "news",
    p_category_slug: b.category_slug,
    p_search_intent: b.search_intent,
    p_primary_query: b.primary_query,
    p_source_urls: b.source_urls ?? [],
    p_meta_title: seo.metaTitle,
    p_meta_description: seo.metaDescription,
  });

  revalidatePath("/admin/engine");
  revalidatePath("/admin/engine/briefs");
  revalidatePath("/admin/engine/drafts");
  revalidatePath("/admin/content");
  revalidatePath("/admin");
}

/**
 * Save per-stage operating modes.
 *
 * Writes the whole map rather than patching one key. The form always submits
 * every stage, so a full write is the accurate representation of what the owner
 * saw — a partial patch would leave a stage at a value that is no longer on
 * screen anywhere.
 *
 * Values are resolved through `resolveAllStageModes` BEFORE the write, so an
 * AUTOMATIC that the stage cannot honour is stored as the ASSISTED it actually
 * resolves to. Storing the refused value and re-refusing it on every read would
 * leave the database claiming an automation that never happens.
 *
 * If `stage_modes` does not exist yet (the migration in migrations_pending/ has
 * not been applied), the update errors and this returns without writing. The
 * page detects the same condition and renders read-only, so nothing silently
 * appears to save.
 */
export async function updateStageModes(formData: FormData): Promise<void> {
  await requireAdmin();
  const supabase = await createClient();

  const requested: Record<string, unknown> = {};
  for (const stage of ENGINE_STAGE_NAMES) {
    const value = formData.get(`mode_${stage}`);
    if (typeof value === "string") requested[stage] = value;
  }

  const resolved = resolveAllStageModes(requested);
  const toStore: Record<string, string> = {};
  for (const stage of ENGINE_STAGE_NAMES) {
    toStore[stage] = resolved[stage].mode;
  }

  const { error } = await supabase
    .from("engine_settings")
    .update({ stage_modes: toStore, updated_at: new Date().toISOString() })
    .eq("id", true);
  if (error) {
    console.error(`[updateStageModes] ${error.message}`);
    return;
  }

  revalidatePath("/admin/engine/autonomy");
  revalidatePath("/admin/engine/health");
  revalidatePath("/admin/engine");
}
