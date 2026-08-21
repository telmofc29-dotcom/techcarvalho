"use server";

import { revalidatePath } from "next/cache";
import { requireAdmin } from "@/lib/dal";
import { createClient } from "@/lib/supabase/server";
import type { ReliabilityTier } from "@/lib/types/database";

const VALID_RELIABILITY_TIERS: ReliabilityTier[] = ["primary", "secondary", "community"];

// source_records attaches to exactly one of product_id/content_id/product_spec_id
// (enforced by a DB check constraint) — this admin UI only ever creates records
// against a product or content parent, since product_specs don't have their own
// edit page to attach a source from; product_spec-level sourcing is a documented
// gap, not silently dropped (see the oversight list page for that same note).
export type SourceParent = { type: "product" | "content"; id: string };

function parentPath(parent: SourceParent): string {
  return parent.type === "product" ? `/admin/products/${parent.id}` : `/admin/content/${parent.id}`;
}

export async function addSourceRecord(parent: SourceParent, formData: FormData): Promise<void> {
  await requireAdmin();
  const url = String(formData.get("url") ?? "").trim();
  const publisher = String(formData.get("publisher") ?? "").trim();
  const reliabilityTier = String(formData.get("reliability_tier") ?? "").trim();

  if (!url) return;
  if (!VALID_RELIABILITY_TIERS.includes(reliabilityTier as ReliabilityTier)) return;

  const supabase = await createClient();
  const { error } = await supabase.from("source_records").insert({
    product_id: parent.type === "product" ? parent.id : null,
    content_id: parent.type === "content" ? parent.id : null,
    url,
    publisher: publisher || null,
    reliability_tier: reliabilityTier as ReliabilityTier,
  });
  if (error) throw new Error(error.message);

  revalidatePath(parentPath(parent));
  revalidatePath("/admin/source-records");
}

export async function deleteSourceRecord(formData: FormData): Promise<void> {
  await requireAdmin();
  const id = String(formData.get("id") ?? "");
  const parentType = String(formData.get("parent_type") ?? "") as SourceParent["type"] | "";
  const parentId = String(formData.get("parent_id") ?? "");
  if (!id) return;

  const supabase = await createClient();
  const { error } = await supabase.from("source_records").delete().eq("id", id);
  if (error) throw new Error(error.message);

  if (parentType && parentId) revalidatePath(parentPath({ type: parentType, id: parentId }));
  revalidatePath("/admin/source-records");
}
