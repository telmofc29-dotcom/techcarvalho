import "server-only";
import { createClient } from "@/lib/supabase/server";
import { logQueryError } from "@/lib/log/query-error";

export type ManufacturerListItem = {
  id: string;
  name: string;
  slug: string;
  description: string | null;
  productCount: number;
};

// manufacturers are world-readable reference data — no publish gating on
// the manufacturer row itself, but the count shown only reflects published
// products so it's never misleading about what's actually visible.
export async function getManufacturerList(): Promise<ManufacturerListItem[]> {
  const supabase = await createClient();

  const [{ data: manufacturers, error: manufacturersError }, { data: products, error: productsError }] =
    await Promise.all([
      supabase.from("manufacturers").select("id, name, slug, description").order("name"),
      supabase.from("products").select("manufacturer_id").eq("is_published", true),
    ]);
  logQueryError("getManufacturerList manufacturers", manufacturersError);
  logQueryError("getManufacturerList products", productsError);

  const countByManufacturerId = new Map<string, number>();
  for (const p of products ?? []) {
    countByManufacturerId.set(p.manufacturer_id, (countByManufacturerId.get(p.manufacturer_id) ?? 0) + 1);
  }

  return (manufacturers ?? []).map((m) => ({
    ...m,
    productCount: countByManufacturerId.get(m.id) ?? 0,
  }));
}
