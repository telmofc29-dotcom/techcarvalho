"use server";

import { revalidatePath } from "next/cache";
import { requireAdmin } from "@/lib/dal";
import { createClient } from "@/lib/supabase/server";
import type { MediaSourceType, MediaSourcingStatus } from "@/lib/types/database";

const VALID_SOURCING_STATUSES: MediaSourcingStatus[] = ["needed", "sourcing", "available", "blocked", "approved"];
const VALID_SOURCE_TYPES: MediaSourceType[] = [
  "manufacturer",
  "staff_photograph",
  "stock_licensed",
  "user_submitted",
  "press_kit",
  "public_domain_or_cc",
  "tc_graphic",
  "other",
];

// One shared action for both the product and content edit surfaces — the
// requirement row shape doesn't differ by record type, only which FK is
// set (product_id xor content_id, enforced by the DB constraint). Plain
// Promise<void> (not a useActionState-style result) to match this
// project's existing simple-form-action convention (see addProductOffer in
// products/actions.ts) — invalid input is silently ignored rather than
// surfaced inline, consistent with those other simple admin forms.
export async function upsertMediaRequirement(
  target: { productId: string } | { contentId: string },
  formData: FormData
): Promise<void> {
  await requireAdmin();

  const sourcingStatus = String(formData.get("sourcing_status") ?? "needed").trim();
  const targetSourceType = String(formData.get("target_source_type") ?? "").trim();
  const notes = String(formData.get("notes") ?? "").trim();
  const resolvedMediaId = String(formData.get("resolved_media_id") ?? "").trim();

  if (!VALID_SOURCING_STATUSES.includes(sourcingStatus as MediaSourcingStatus)) return;
  if (targetSourceType && !VALID_SOURCE_TYPES.includes(targetSourceType as MediaSourceType)) return;

  const supabase = await createClient();
  const conflictColumn = "productId" in target ? "product_id" : "content_id";
  await supabase.from("media_requirements").upsert(
    {
      product_id: "productId" in target ? target.productId : null,
      content_id: "contentId" in target ? target.contentId : null,
      sourcing_status: sourcingStatus as MediaSourcingStatus,
      target_source_type: (targetSourceType as MediaSourceType) || null,
      notes: notes || null,
      resolved_media_id: resolvedMediaId || null,
      updated_at: new Date().toISOString(),
    },
    { onConflict: conflictColumn }
  );

  const path =
    "productId" in target ? `/admin/products/${target.productId}` : `/admin/content/${target.contentId}`;
  revalidatePath(path);
  revalidatePath("/admin/media/requirements");
}

export async function deleteMediaRequirement(id: string, redirectPath: string): Promise<void> {
  await requireAdmin();
  const supabase = await createClient();
  await supabase.from("media_requirements").delete().eq("id", id);
  revalidatePath(redirectPath);
  revalidatePath("/admin/media/requirements");
}
