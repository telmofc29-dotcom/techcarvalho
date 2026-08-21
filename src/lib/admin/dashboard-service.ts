import "server-only";
import { createClient } from "@/lib/supabase/server";
import { getFreshnessOverview } from "./freshness-service";
import { findCannibalisationMatches, type ContentSignal } from "./cannibalisation";

export type DashboardCounts = {
  products: number;
  manufacturers: number;
  contentTotal: number;
  contentPublished: number;
  contentDraft: number;
  mediaAssets: number;
  mediaPublished: number;
  mediaPendingRights: number;
  contentRequiringReview: number;
  // Distinguishes "counted zero rows" from "the count query itself failed"
  // — the exact confusion that hid the 2026-08 anon-grant outage.
  hasError: boolean;
};

export async function getDashboardCounts(): Promise<DashboardCounts> {
  const supabase = await createClient();

  const [
    productsResult,
    manufacturersResult,
    contentTotalResult,
    contentPublishedResult,
    contentDraftResult,
    mediaAssetsResult,
    mediaPublishedResult,
    mediaPendingRightsResult,
    freshness,
  ] = await Promise.all([
    supabase.from("products").select("*", { count: "exact", head: true }),
    supabase.from("manufacturers").select("*", { count: "exact", head: true }),
    supabase.from("content_items").select("*", { count: "exact", head: true }),
    supabase.from("content_items").select("*", { count: "exact", head: true }).eq("status", "published"),
    supabase.from("content_items").select("*", { count: "exact", head: true }).eq("status", "draft"),
    supabase.from("media_assets").select("*", { count: "exact", head: true }),
    supabase.from("media_assets").select("*", { count: "exact", head: true }).eq("publication_status", "published"),
    supabase
      .from("media_assets")
      .select("*", { count: "exact", head: true })
      .in("rights_status", ["unknown", "pending_verification"]),
    getFreshnessOverview(),
  ]);

  const errors = [
    productsResult.error,
    manufacturersResult.error,
    contentTotalResult.error,
    contentPublishedResult.error,
    contentDraftResult.error,
    mediaAssetsResult.error,
    mediaPublishedResult.error,
    mediaPendingRightsResult.error,
  ].filter(Boolean);
  for (const e of errors) console.error(`[query-error] getDashboardCounts: ${e!.message}`);

  const contentRequiringReview = freshness.filter(
    (item) => item.bucket === "overdue" || item.bucket === "no_review"
  ).length;

  return {
    products: productsResult.count ?? 0,
    manufacturers: manufacturersResult.count ?? 0,
    contentTotal: contentTotalResult.count ?? 0,
    contentPublished: contentPublishedResult.count ?? 0,
    contentDraft: contentDraftResult.count ?? 0,
    mediaAssets: mediaAssetsResult.count ?? 0,
    mediaPublished: mediaPublishedResult.count ?? 0,
    mediaPendingRights: mediaPendingRightsResult.count ?? 0,
    contentRequiringReview,
    hasError: errors.length > 0,
  };
}

export type EditorialQualityCounts = {
  missingSources: number;
  missingEvidence: number;
  noProductRelationships: number;
  possibleCannibalisation: number;
  missingSeoDescription: number;
  missingCategory: number;
  // Same "0 vs failed" distinction as DashboardCounts.hasError above.
  hasError: boolean;
};

// All computed client-side (JS set operations) after separate count-free
// queries, rather than a raw SQL join — content_items is small-scale today
// (near-empty catalog), so an O(n) / O(n^2) in-process pass is simpler and
// cheaper than adding an RPC just for this. Revisit if the catalog grows
// enough that this becomes a real cost.
export async function getEditorialQualityCounts(): Promise<EditorialQualityCounts> {
  const supabase = await createClient();

  const [contentResult, sourceResult, evidenceResult, productLinkResult, seoResult] = await Promise.all([
    supabase
      .from("content_items")
      .select("id, title, category_id, primary_query, intent_fingerprint")
      .neq("status", "archived"),
    supabase.from("source_records").select("content_id").not("content_id", "is", null),
    supabase.from("evidence_records").select("content_id").not("content_id", "is", null),
    supabase.from("content_products").select("content_id"),
    supabase.from("seo_metadata").select("content_id, meta_description").not("content_id", "is", null),
  ]);

  const errors = [
    contentResult.error,
    sourceResult.error,
    evidenceResult.error,
    productLinkResult.error,
    seoResult.error,
  ].filter(Boolean);
  for (const e of errors) console.error(`[query-error] getEditorialQualityCounts: ${e!.message}`);

  if (errors.length > 0 || !contentResult.data) {
    return {
      missingSources: 0,
      missingEvidence: 0,
      noProductRelationships: 0,
      possibleCannibalisation: 0,
      missingSeoDescription: 0,
      missingCategory: 0,
      hasError: true,
    };
  }

  const content = contentResult.data;
  const sourcedIds = new Set((sourceResult.data ?? []).map((r) => r.content_id));
  const evidencedIds = new Set((evidenceResult.data ?? []).map((r) => r.content_id));
  const linkedIds = new Set((productLinkResult.data ?? []).map((r) => r.content_id));
  // A row with no meta_description counts the same as no row at all — both
  // mean nothing meaningful will show up in search results.
  const describedIds = new Set(
    (seoResult.data ?? []).filter((r) => r.meta_description && r.meta_description.trim() !== "").map((r) => r.content_id)
  );

  const missingSources = content.filter((c) => !sourcedIds.has(c.id)).length;
  const missingEvidence = content.filter((c) => !evidencedIds.has(c.id)).length;
  const noProductRelationships = content.filter((c) => !linkedIds.has(c.id)).length;
  const missingSeoDescription = content.filter((c) => !describedIds.has(c.id)).length;
  const missingCategory = content.filter((c) => !c.category_id).length;

  const signals: ContentSignal[] = content.map((c) => ({
    id: c.id,
    title: c.title,
    primary_query: c.primary_query,
    intent_fingerprint: c.intent_fingerprint,
  }));
  const flagged = new Set<string>();
  for (const item of content) {
    if (flagged.has(item.id)) continue;
    const others = signals.filter((s) => s.id !== item.id);
    const matches = findCannibalisationMatches(
      {
        title: item.title,
        primary_query: item.primary_query ?? "",
        intent_fingerprint: item.intent_fingerprint ?? "",
      },
      others
    );
    if (matches.length > 0) {
      flagged.add(item.id);
      for (const m of matches) flagged.add(m.id);
    }
  }

  return {
    missingSources,
    missingEvidence,
    noProductRelationships,
    possibleCannibalisation: flagged.size,
    missingSeoDescription,
    missingCategory,
    hasError: false,
  };
}
