"use server";

import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { requireAdmin } from "@/lib/dal";
import { insertRow, updateRow, deleteRow, type ValidationResult } from "@/lib/admin/reference-service";
import { slugify } from "@/lib/admin/slugify";
import type { FormState } from "@/components/admin/reference-form";
import type { Insert } from "@/lib/types/database";

function readPayload(formData: FormData, selfId?: string): ValidationResult<Insert<"taxonomy_categories">> {
  const name = String(formData.get("name") ?? "").trim();
  const slugInput = String(formData.get("slug") ?? "").trim();
  const description = String(formData.get("description") ?? "").trim();
  const parentId = String(formData.get("parent_id") ?? "").trim();
  const sortOrderRaw = String(formData.get("sort_order") ?? "").trim();

  if (!name) {
    return { error: "Name is required." };
  }
  if (selfId && parentId === selfId) {
    return { error: "A category cannot be its own parent." };
  }

  const sortOrder = sortOrderRaw ? Number(sortOrderRaw) : 0;
  if (Number.isNaN(sortOrder)) {
    return { error: "Sort order must be a number." };
  }

  return {
    payload: {
      name,
      slug: slugify(slugInput || name),
      description: description || null,
      parent_id: parentId || null,
      sort_order: sortOrder,
    },
  };
}

export async function createTaxonomyCategory(_prev: FormState, formData: FormData): Promise<FormState> {
  await requireAdmin();
  const result = readPayload(formData);
  if ("error" in result) return { error: result.error };

  try {
    await insertRow("taxonomy_categories", result.payload);
  } catch (e) {
    return { error: e instanceof Error ? e.message : "Failed to create category." };
  }

  revalidatePath("/admin/taxonomy-categories");
  redirect("/admin/taxonomy-categories");
}

export async function updateTaxonomyCategory(
  id: string,
  _prev: FormState,
  formData: FormData
): Promise<FormState> {
  await requireAdmin();
  const result = readPayload(formData, id);
  if ("error" in result) return { error: result.error };

  try {
    await updateRow("taxonomy_categories", id, result.payload);
  } catch (e) {
    return { error: e instanceof Error ? e.message : "Failed to update category." };
  }

  revalidatePath("/admin/taxonomy-categories");
  redirect("/admin/taxonomy-categories");
}

export async function deleteTaxonomyCategory(formData: FormData): Promise<void> {
  await requireAdmin();
  const id = String(formData.get("id") ?? "");
  if (!id) return;
  await deleteRow("taxonomy_categories", id);
  revalidatePath("/admin/taxonomy-categories");
}
