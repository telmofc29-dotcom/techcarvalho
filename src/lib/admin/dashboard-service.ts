import "server-only";
import { createClient } from "@/lib/supabase/server";
import { getFreshnessOverview } from "./freshness-service";

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
