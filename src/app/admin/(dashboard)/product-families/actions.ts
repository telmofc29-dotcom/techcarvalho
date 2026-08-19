"use server";

import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { requireAdmin } from "@/lib/dal";
import { insertRow, updateRow, deleteRow, type ValidationResult } from "@/lib/admin/reference-service";
import { slugify } from "@/lib/admin/slugify";
import type { FormState } from "@/components/admin/reference-form";
import type { Insert } from "@/lib/types/database";

function readPayload(formData: FormData): ValidationResult<Insert<"product_families">> {
  const name = String(formData.get("name") ?? "").trim();
  const slugInput = String(formData.get("slug") ?? "").trim();
  const description = String(formData.get("description") ?? "").trim();
  const categoryId = String(formData.get("category_id") ?? "").trim();

  if (!name) {
    return { error: "Name is required." };
  }

  return {
    payload: {
      name,
      slug: slugify(slugInput || name),
      description: description || null,
      category_id: categoryId || null,
    },
  };
}

export async function createProductFamily(_prev: FormState, formData: FormData): Promise<FormState> {
  await requireAdmin();
  const result = readPayload(formData);
  if ("error" in result) return { error: result.error };

  try {
    await insertRow("product_families", result.payload);
  } catch (e) {
    return { error: e instanceof Error ? e.message : "Failed to create product family." };
  }

  revalidatePath("/admin/product-families");
  redirect("/admin/product-families");
}

export async function updateProductFamily(
  id: string,
  _prev: FormState,
  formData: FormData
): Promise<FormState> {
  await requireAdmin();
  const result = readPayload(formData);
  if ("error" in result) return { error: result.error };

  try {
    await updateRow("product_families", id, result.payload);
  } catch (e) {
    return { error: e instanceof Error ? e.message : "Failed to update product family." };
  }

  revalidatePath("/admin/product-families");
  redirect("/admin/product-families");
}

export async function deleteProductFamily(formData: FormData): Promise<void> {
  await requireAdmin();
  const id = String(formData.get("id") ?? "");
  if (!id) return;
  await deleteRow("product_families", id);
  revalidatePath("/admin/product-families");
}
