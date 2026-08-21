import "server-only";
import { createClient } from "@/lib/supabase/server";
import { bucketForReviewDate, type FreshnessBucket } from "./freshness";

export type FreshnessItem = {
  kind: "product" | "content";
  id: string;
  label: string;
  lastReviewedAt: string | null;
  bucket: FreshnessBucket;
};

export async function getFreshnessOverview(): Promise<FreshnessItem[]> {
  const supabase = await createClient();
  const [{ data: products }, { data: content }, { data: logs }] = await Promise.all([
    supabase.from("products").select("id, name"),
    // Archived content is deliberately excluded — 'archived' means it's no
    // longer meant to be current, so nagging it for review is a false
    // positive, not a genuine freshness gap.
    supabase.from("content_items").select("id, title").neq("status", "archived"),
    supabase
      .from("freshness_log")
      .select("product_id, content_id, reviewed_at")
      .order("reviewed_at", { ascending: false }),
  ]);

  const latestForProduct = new Map<string, string>();
  const latestForContent = new Map<string, string>();
  for (const log of logs ?? []) {
    if (log.product_id && !latestForProduct.has(log.product_id)) {
      latestForProduct.set(log.product_id, log.reviewed_at);
    }
    if (log.content_id && !latestForContent.has(log.content_id)) {
      latestForContent.set(log.content_id, log.reviewed_at);
    }
  }

  const items: FreshnessItem[] = [];
  for (const p of products ?? []) {
    const last = latestForProduct.get(p.id) ?? null;
    items.push({ kind: "product", id: p.id, label: p.name, lastReviewedAt: last, bucket: bucketForReviewDate(last) });
  }
  for (const c of content ?? []) {
    const last = latestForContent.get(c.id) ?? null;
    items.push({ kind: "content", id: c.id, label: c.title, lastReviewedAt: last, bucket: bucketForReviewDate(last) });
  }

  return items;
}
