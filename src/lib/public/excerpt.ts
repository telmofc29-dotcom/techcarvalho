import "server-only";
import type { createClient } from "@/lib/supabase/server";
import { logQueryError } from "@/lib/log/query-error";

// excerpt is derived from seo_metadata.meta_description — no separate
// excerpt/summary column exists on content_items (see the excerpt
// investigation note in src/components/public/cards.tsx): reusing the SEO
// description as the card preview avoids a third content-summarization
// field alongside body and meta_description.
//
// A Supabase embedded-resource select (`seo_metadata(meta_description)`)
// would do this in one query, but the hand-written Database type's
// Relationships metadata (src/lib/types/database.ts) isn't populated for
// any table yet, so the typed client can't verify that join shape at
// compile time. Rather than force it past the type checker with an unsafe
// cast, this fetches seo_metadata in one extra query per list and merges
// in JS — still a fixed, single round-trip pair per call site, not N+1.
export async function attachExcerpts<T extends { id: string }>(
  supabase: Awaited<ReturnType<typeof createClient>>,
  rows: T[]
): Promise<(T & { excerpt: string | null })[]> {
  if (rows.length === 0) return [];
  const { data: seoRows, error } = await supabase
    .from("seo_metadata")
    .select("content_id, meta_description")
    .in(
      "content_id",
      rows.map((r) => r.id)
    );
  logQueryError("attachExcerpts", error);
  const descriptionByContentId = new Map((seoRows ?? []).map((s) => [s.content_id, s.meta_description]));
  return rows.map((r) => ({ ...r, excerpt: descriptionByContentId.get(r.id) ?? null }));
}
