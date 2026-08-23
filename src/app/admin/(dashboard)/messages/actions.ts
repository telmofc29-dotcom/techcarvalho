"use server";

import { revalidatePath } from "next/cache";
import { requireAdmin } from "@/lib/dal";
import { createClient } from "@/lib/supabase/server";
import type { ContactMessageStatus } from "@/lib/types/database";

// requireAdmin() in every one of these, not just in the page. A Server Action
// is invoked directly and bypasses the layout that protects the page — see the
// authorization note in CLAUDE.md. RLS (is_admin()) is the layer underneath.

const VALID_STATUSES: ContactMessageStatus[] = ["new", "read", "archived"];

export async function setContactMessageStatus(formData: FormData): Promise<void> {
  const admin = await requireAdmin();
  const id = String(formData.get("id") ?? "");
  const status = String(formData.get("status") ?? "");
  if (!id) return;
  if (!VALID_STATUSES.includes(status as ContactMessageStatus)) return;

  const supabase = await createClient();
  const { error } = await supabase
    .from("contact_messages")
    .update({
      status: status as ContactMessageStatus,
      // "new" means nobody has dealt with it, so moving back to it clears the
      // handling record rather than leaving a stale claim that somebody did.
      handled_at: status === "new" ? null : new Date().toISOString(),
      handled_by: status === "new" ? null : admin.id,
    })
    .eq("id", id);
  if (error) throw new Error(error.message);

  revalidatePath("/admin/messages");
}

export async function deleteContactMessage(formData: FormData): Promise<void> {
  await requireAdmin();
  const id = String(formData.get("id") ?? "");
  if (!id) return;

  const supabase = await createClient();
  const { error } = await supabase.from("contact_messages").delete().eq("id", id);
  if (error) throw new Error(error.message);

  revalidatePath("/admin/messages");
}
