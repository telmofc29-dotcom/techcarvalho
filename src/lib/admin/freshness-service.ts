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
  const [productsRes, contentRes, logsRes] = await Promise.all([
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

  // These three reads used to be `?? []`, which made a FAILURE indistinguishable
  // from a genuinely empty table — the exact pattern that once let every public
  // page render an honest-looking empty state for weeks. Here the two failure
  // modes are both actively misleading rather than merely blank:
  //
  //   freshness_log fails  -> every item shows "never reviewed" and the page
  //                           invents a site-wide overdue backlog.
  //   products fails       -> the products simply vanish and the page reads as
  //                           "everything is reviewed", which is the dangerous
  //                           direction: a false all-clear.
  //
  // So each is checked by name and thrown, which /admin/(dashboard)/error.tsx
  // renders as a visible failure.
  for (const [label, res] of [
    ["products", productsRes],
    ["content_items", contentRes],
    ["freshness_log", logsRes],
  ] as const) {
    if (res.error) throw new Error(`freshness overview: reading ${label} failed — ${res.error.message}`);
    if (res.data === null) throw new Error(`freshness overview: ${label} returned null rather than rows`);
  }

  const products = productsRes.data!;
  const content = contentRes.data!;
  const logs = logsRes.data!;

  const latestForProduct = new Map<string, string>();
  const latestForContent = new Map<string, string>();
  for (const log of logs) {
    if (log.product_id && !latestForProduct.has(log.product_id)) {
      latestForProduct.set(log.product_id, log.reviewed_at);
    }
    if (log.content_id && !latestForContent.has(log.content_id)) {
      latestForContent.set(log.content_id, log.reviewed_at);
    }
  }

  const items: FreshnessItem[] = [];
  for (const p of products) {
    const last = latestForProduct.get(p.id) ?? null;
    items.push({ kind: "product", id: p.id, label: p.name, lastReviewedAt: last, bucket: bucketForReviewDate(last) });
  }
  for (const c of content) {
    const last = latestForContent.get(c.id) ?? null;
    items.push({ kind: "content", id: c.id, label: c.title, lastReviewedAt: last, bucket: bucketForReviewDate(last) });
  }

  return items;
}
