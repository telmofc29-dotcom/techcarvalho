import "server-only";
import { createClient } from "@/lib/supabase/server";
import { logQueryError } from "@/lib/log/query-error";
import { attachExcerpts } from "./excerpt";
import { attachHeroImages } from "./hero-image";
import type { ContentType } from "@/lib/types/database";

const PAGE_SIZE = 24;

export async function getPublishedContentPage(page: number, type?: ContentType) {
  const supabase = await createClient();
  const from = (page - 1) * PAGE_SIZE;
  const to = from + PAGE_SIZE - 1;

  let query = supabase
    .from("content_items")
    .select("id, title, slug, type, published_at", { count: "exact" })
    .eq("status", "published")
    .lte("published_at", new Date().toISOString())
    .order("published_at", { ascending: false })
    .range(from, to);
  if (type) query = query.eq("type", type);

  const { data, count, error } = await query;
  logQueryError(`getPublishedContentPage(${page}, ${type ?? "all"})`, error);
  const total = count ?? 0;
  const content = await attachHeroImages(supabase, await attachExcerpts(supabase, data ?? []), "content");

  return { content, total, pageCount: Math.max(1, Math.ceil(total / PAGE_SIZE)) };
}
