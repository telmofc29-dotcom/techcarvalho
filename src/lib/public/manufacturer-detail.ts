import "server-only";
import { createClient } from "@/lib/supabase/server";
import { logQueryError } from "@/lib/log/query-error";

export type ManufacturerDetail = {
  manufacturer: { id: string; name: string; slug: string; website: string | null; description: string | null };
  products: { id: string; name: string; slug: string; summary: string | null; status: string; family_id: string | null }[];
  families: { id: string; name: string; slug: string }[];
};

// manufacturers is world-readable reference data (no publish gating) per
// the applied RLS — but its products are only shown here if published,
// same as everywhere else on the public site. Product families have no
// direct manufacturer_id column in the schema, so "families" here is
// derived from the distinct families actually used by this manufacturer's
// published products — real data, not a fabricated relationship.
export async function getManufacturerDetail(slug: string): Promise<ManufacturerDetail | null> {
  const supabase = await createClient();

  const { data: manufacturer, error: manufacturerError } = await supabase
    .from("manufacturers")
    .select("id, name, slug, website, description")
    .eq("slug", slug)
    .maybeSingle();
  logQueryError(`getManufacturerDetail(${slug}) manufacturer`, manufacturerError);

  if (!manufacturer) return null;

  const { data: products, error: productsError } = await supabase
    .from("products")
    .select("id, name, slug, summary, status, family_id")
    .eq("manufacturer_id", manufacturer.id)
    .eq("is_published", true)
    .order("name");
  logQueryError(`getManufacturerDetail(${slug}) products`, productsError);

  const familyIds = [...new Set((products ?? []).map((p) => p.family_id).filter((id): id is string => Boolean(id)))];
  const { data: families, error: familiesError } =
    familyIds.length > 0
      ? await supabase.from("product_families").select("id, name, slug").in("id", familyIds).order("name")
      : { data: [], error: null };
  logQueryError(`getManufacturerDetail(${slug}) families`, familiesError);

  return { manufacturer, products: products ?? [], families: families ?? [] };
}
