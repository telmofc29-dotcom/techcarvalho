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
  contentRequiringReview: number;
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
    freshness,
  ] = await Promise.all([
    supabase.from("products").select("*", { count: "exact", head: true }),
    supabase.from("manufacturers").select("*", { count: "exact", head: true }),
    supabase.from("content_items").select("*", { count: "exact", head: true }),
    supabase.from("content_items").select("*", { count: "exact", head: true }).eq("status", "published"),
    supabase.from("content_items").select("*", { count: "exact", head: true }).eq("status", "draft"),
    supabase.from("media_assets").select("*", { count: "exact", head: true }),
    getFreshnessOverview(),
  ]);

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
    contentRequiringReview,
  };
}
