import "server-only";
import { createClient } from "@/lib/supabase/server";
import { logQueryError } from "@/lib/log/query-error";
import { attachHeroImages } from "./hero-image";

const PAGE_SIZE = 24;

export type ProductListFilters = { manufacturerSlug?: string; categorySlug?: string };

export async function getPublishedProductsPage(page: number, filters: ProductListFilters = {}) {
  const supabase = await createClient();
  const from = (page - 1) * PAGE_SIZE;
  const to = from + PAGE_SIZE - 1;

  let manufacturerId: string | null = null;
  if (filters.manufacturerSlug) {
    const { data, error } = await supabase
      .from("manufacturers")
      .select("id")
      .eq("slug", filters.manufacturerSlug)
      .maybeSingle();
    logQueryError(`getPublishedProductsPage manufacturer lookup`, error);
    manufacturerId = data?.id ?? null;
  }

  let categoryId: string | null = null;
  if (filters.categorySlug) {
    const { data, error } = await supabase
      .from("taxonomy_categories")
      .select("id")
      .eq("slug", filters.categorySlug)
      .maybeSingle();
    logQueryError(`getPublishedProductsPage category lookup`, error);
    categoryId = data?.id ?? null;
  }

  let query = supabase
    .from("products")
    .select("id, name, slug, summary, status, manufacturer_id", { count: "exact" })
    .eq("is_published", true)
    .order("name")
    .range(from, to);
  if (manufacturerId) query = query.eq("manufacturer_id", manufacturerId);
  if (categoryId) query = query.eq("category_id", categoryId);

  const { data, count, error } = await query;
  logQueryError(`getPublishedProductsPage(${page})`, error);

  const manufacturerIds = [...new Set((data ?? []).map((p) => p.manufacturer_id))];
  const { data: manufacturers, error: manufacturersError } =
    manufacturerIds.length > 0
      ? await supabase.from("manufacturers").select("id, name").in("id", manufacturerIds)
      : { data: [], error: null };
  logQueryError(`getPublishedProductsPage(${page}) manufacturers`, manufacturersError);
  const manufacturerNameById = new Map((manufacturers ?? []).map((m) => [m.id, m.name]));

  const productsWithManufacturer = (data ?? []).map((p) => ({
    ...p,
    manufacturerName: manufacturerNameById.get(p.manufacturer_id) ?? null,
  }));
  const products = await attachHeroImages(supabase, productsWithManufacturer, "product");
  const total = count ?? 0;

  return { products, total, pageCount: Math.max(1, Math.ceil(total / PAGE_SIZE)) };
}

// Filter option lists: only manufacturers/categories that actually have at
// least one published product — no point offering a filter that always
// returns empty.
export async function getProductFilterOptions() {
  const supabase = await createClient();
  const { data: products, error } = await supabase
    .from("products")
    .select("manufacturer_id, category_id")
    .eq("is_published", true);
  logQueryError("getProductFilterOptions products", error);

  const manufacturerIds = [...new Set((products ?? []).map((p) => p.manufacturer_id))];
  const categoryIds = [...new Set((products ?? []).map((p) => p.category_id))];

  const [{ data: manufacturers, error: mErr }, { data: categories, error: cErr }] = await Promise.all([
    manufacturerIds.length > 0
      ? supabase.from("manufacturers").select("id, name, slug").in("id", manufacturerIds).order("name")
      : Promise.resolve({ data: [], error: null }),
    categoryIds.length > 0
      ? supabase.from("taxonomy_categories").select("id, name, slug").in("id", categoryIds).order("name")
      : Promise.resolve({ data: [], error: null }),
  ]);
  logQueryError("getProductFilterOptions manufacturers", mErr);
  logQueryError("getProductFilterOptions categories", cErr);

  return { manufacturers: manufacturers ?? [], categories: categories ?? [] };
}

export { PAGE_SIZE as PRODUCT_LIST_PAGE_SIZE };
