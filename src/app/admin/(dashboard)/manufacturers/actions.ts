"use server";

import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { requireAdmin } from "@/lib/dal";
import { insertRow, updateRow, deleteRow, type ValidationResult } from "@/lib/admin/reference-service";
import { slugify } from "@/lib/admin/slugify";
import type { FormState } from "@/components/admin/reference-form";
import type { Insert } from "@/lib/types/database";

function readPayload(formData: FormData): ValidationResult<Insert<"manufacturers">> {
  const name = String(formData.get("name") ?? "").trim();
  const slugInput = String(formData.get("slug") ?? "").trim();
  const website = String(formData.get("website") ?? "").trim();
  const description = String(formData.get("description") ?? "").trim();
  const logoMediaId = String(formData.get("logo_media_id") ?? "").trim();

  if (!name) {
    return { error: "Name is required." };
  }

  return {
    payload: {
      name,
      slug: slugify(slugInput || name),
      website: website || null,
      description: description || null,
      logo_media_id: logoMediaId || null,
    },
  };
}

export async function createManufacturer(_prev: FormState, formData: FormData): Promise<FormState> {
  await requireAdmin();
  const result = readPayload(formData);
  if ("error" in result) return { error: result.error };

  try {
    await insertRow("manufacturers", result.payload);
  } catch (e) {
    return { error: e instanceof Error ? e.message : "Failed to create manufacturer." };
  }

  revalidatePath("/admin/manufacturers");
  redirect("/admin/manufacturers");
}

export async function updateManufacturer(
  id: string,
  _prev: FormState,
  formData: FormData
): Promise<FormState> {
  await requireAdmin();
  const result = readPayload(formData);
  if ("error" in result) return { error: result.error };

  try {
    await updateRow("manufacturers", id, result.payload);
  } catch (e) {
    return { error: e instanceof Error ? e.message : "Failed to update manufacturer." };
  }

  revalidatePath("/admin/manufacturers");
  redirect("/admin/manufacturers");
}

export async function deleteManufacturer(formData: FormData): Promise<void> {
  await requireAdmin();
  const id = String(formData.get("id") ?? "");
  if (!id) return;
  await deleteRow("manufacturers", id);
  revalidatePath("/admin/manufacturers");
}
