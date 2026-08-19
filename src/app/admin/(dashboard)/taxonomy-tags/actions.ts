"use server";

import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { requireAdmin } from "@/lib/dal";
import { insertRow, updateRow, deleteRow, type ValidationResult } from "@/lib/admin/reference-service";
import { slugify } from "@/lib/admin/slugify";
import type { FormState } from "@/components/admin/reference-form";
import type { Insert } from "@/lib/types/database";

function readPayload(formData: FormData): ValidationResult<Insert<"taxonomy_tags">> {
  const name = String(formData.get("name") ?? "").trim();
  const slugInput = String(formData.get("slug") ?? "").trim();

  if (!name) {
    return { error: "Name is required." };
  }

  return { payload: { name, slug: slugify(slugInput || name) } };
}

export async function createTaxonomyTag(_prev: FormState, formData: FormData): Promise<FormState> {
  await requireAdmin();
  const result = readPayload(formData);
  if ("error" in result) return { error: result.error };

  try {
    await insertRow("taxonomy_tags", result.payload);
  } catch (e) {
    return { error: e instanceof Error ? e.message : "Failed to create tag." };
  }

  revalidatePath("/admin/taxonomy-tags");
  redirect("/admin/taxonomy-tags");
}

export async function updateTaxonomyTag(id: string, _prev: FormState, formData: FormData): Promise<FormState> {
  await requireAdmin();
  const result = readPayload(formData);
  if ("error" in result) return { error: result.error };

  try {
    await updateRow("taxonomy_tags", id, result.payload);
  } catch (e) {
    return { error: e instanceof Error ? e.message : "Failed to update tag." };
  }

  revalidatePath("/admin/taxonomy-tags");
  redirect("/admin/taxonomy-tags");
}

export async function deleteTaxonomyTag(formData: FormData): Promise<void> {
  await requireAdmin();
  const id = String(formData.get("id") ?? "");
  if (!id) return;
  await deleteRow("taxonomy_tags", id);
  revalidatePath("/admin/taxonomy-tags");
}
