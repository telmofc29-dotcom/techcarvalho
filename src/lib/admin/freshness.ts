// Freshness review thresholds. Not specified by the schema or product spec,
// so a reasonable editorial default is chosen here — adjust freely, this is
// the single place that defines "overdue" vs "due soon".
export const FRESHNESS_OVERDUE_DAYS = 180;
export const FRESHNESS_DUE_SOON_DAYS = 150;

export type FreshnessBucket = "overdue" | "due_soon" | "no_review" | "recent";

export function bucketForReviewDate(reviewedAt: string | null): FreshnessBucket {
  if (!reviewedAt) return "no_review";
  const ageDays = (Date.now() - new Date(reviewedAt).getTime()) / (1000 * 60 * 60 * 24);
  if (ageDays >= FRESHNESS_OVERDUE_DAYS) return "overdue";
  if (ageDays >= FRESHNESS_DUE_SOON_DAYS) return "due_soon";
  return "recent";
}

export const FRESHNESS_BUCKET_LABELS: Record<FreshnessBucket, string> = {
  overdue: "Overdue",
  due_soon: "Due soon",
  no_review: "No review date",
  recent: "Recently verified",
};
