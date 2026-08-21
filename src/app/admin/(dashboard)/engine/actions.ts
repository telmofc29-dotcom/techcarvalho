"use server";

import { revalidatePath } from "next/cache";
import { requireAdmin } from "@/lib/dal";
import { createClient } from "@/lib/supabase/server";
import type {
  EngineSourceType,
  MediaRightsStatus,
  TrustLevel,
} from "@/lib/engine/types";
import type { EngineFreshnessState, EnginePipelineState } from "@/lib/types/database";

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
    // These two are independent on purpose — see the migration's Source
    // Registry header. Reading facts from a source never implies the right to
    // republish its imagery, so they are never derived from one another.
    discovery_permitted: formData.get("discovery_permitted") === "on",
    media_republication_permitted: formData.get("media_republication_permitted") === "on",
    media_rights_status: mediaRights as MediaRightsStatus,
    terms_url: String(formData.get("terms_url") ?? "").trim() || null,
    terms_notes: String(formData.get("terms_notes") ?? "").trim() || null,
    attribution_required: formData.get("attribution_required") === "on",
    attribution_text: String(formData.get("attribution_text") ?? "").trim() || null,
    check_frequency_hours: Number.isFinite(frequency) && frequency >= 1 ? Math.floor(frequency) : 24,
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
      media_republication_permitted: formData.get("media_republication_permitted") === "on",
      media_rights_status: mediaRights as MediaRightsStatus,
      terms_url: String(formData.get("terms_url") ?? "").trim() || null,
      terms_notes: String(formData.get("terms_notes") ?? "").trim() || null,
      attribution_required: formData.get("attribution_required") === "on",
      attribution_text: String(formData.get("attribution_text") ?? "").trim() || null,
      check_frequency_hours: Number.isFinite(frequency) && frequency >= 1 ? Math.floor(frequency) : 24,
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

  revalidatePath("/admin/engine/briefs");
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
