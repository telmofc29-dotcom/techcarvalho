import "server-only";
import { createClient } from "@/lib/supabase/server";
import { sanitizeSearchTerm } from "@/lib/search/sanitize";
import { logQueryError } from "@/lib/log/query-error";

export type SiteSearchResults = {
  products: { id: string; name: string; slug: string; summary: string | null }[];
  content: { id: string; title: string; slug: string; type: string }[];
  manufacturers: { id: string; name: string; slug: string }[];
  categories: { id: string; name: string; slug: string }[];
};

const EMPTY: SiteSearchResults = { products: [], content: [], manufacturers: [], categories: [] };
const RESULT_LIMIT = 20;

// Postgres ILIKE across existing columns — no full-text index yet. Fine at
// today's scale; worth revisiting (tsvector + GIN index, applied via a
// proper migration) once the catalog is large enough for it to matter. See
// docs/proposed-migrations.md for the drafted proposal — not applied.
export async function searchSite(rawQuery: string): Promise<SiteSearchResults> {
  const q = sanitizeSearchTerm(rawQuery);
  if (!q) return EMPTY;

  const supabase = await createClient();
  const like = `%${q}%`;

  const [products, content, manufacturers, categories] = await Promise.all([
    supabase
      .from("products")
      .select("id, name, slug, summary")
      .eq("is_published", true)
      .or(`name.ilike.${like},summary.ilike.${like},model_number.ilike.${like}`)
      .order("name")
      .limit(RESULT_LIMIT),
    supabase
      .from("content_items")
      .select("id, title, slug, type")
      .eq("status", "published")
      .lte("published_at", new Date().toISOString())
      .ilike("title", like)
      .order("published_at", { ascending: false })
      .limit(RESULT_LIMIT),
    supabase.from("manufacturers").select("id, name, slug").ilike("name", like).order("name").limit(10),
    supabase.from("taxonomy_categories").select("id, name, slug").ilike("name", like).order("name").limit(10),
  ]);
  logQueryError(`searchSite(${q}) products`, products.error);
  logQueryError(`searchSite(${q}) content`, content.error);
  logQueryError(`searchSite(${q}) manufacturers`, manufacturers.error);
  logQueryError(`searchSite(${q}) categories`, categories.error);

  return {
    products: products.data ?? [],
    content: content.data ?? [],
    manufacturers: manufacturers.data ?? [],
    categories: categories.data ?? [],
  };
}
