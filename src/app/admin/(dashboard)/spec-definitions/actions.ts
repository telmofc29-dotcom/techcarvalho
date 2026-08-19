"use server";

import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { requireAdmin } from "@/lib/dal";
import { insertRow, updateRow, deleteRow, type ValidationResult } from "@/lib/admin/reference-service";
import { slugify } from "@/lib/admin/slugify";
import type { SpecDataType, Insert } from "@/lib/types/database";
import type { FormState } from "@/components/admin/reference-form";

const VALID_DATA_TYPES: SpecDataType[] = ["text", "number", "boolean", "enum"];

function readPayload(formData: FormData): ValidationResult<Insert<"spec_definitions">> {
  const name = String(formData.get("name") ?? "").trim();
  const slugInput = String(formData.get("slug") ?? "").trim();
  const dataType = String(formData.get("data_type") ?? "").trim();
  const unit = String(formData.get("unit") ?? "").trim();
  const categoryId = String(formData.get("category_id") ?? "").trim();

  if (!name) {
    return { error: "Name is required." };
  }
  if (!VALID_DATA_TYPES.includes(dataType as SpecDataType)) {
    return { error: "Choose a valid data type." };
  }

  return {
    payload: {
      name,
      slug: slugify(slugInput || name),
      data_type: dataType as SpecDataType,
      unit: unit || null,
      category_id: categoryId || null,
    },
  };
}

export async function createSpecDefinition(_prev: FormState, formData: FormData): Promise<FormState> {
  await requireAdmin();
  const result = readPayload(formData);
  if ("error" in result) return { error: result.error };

  try {
    await insertRow("spec_definitions", result.payload);
  } catch (e) {
    return { error: e instanceof Error ? e.message : "Failed to create spec definition." };
  }

  revalidatePath("/admin/spec-definitions");
  redirect("/admin/spec-definitions");
}

export async function updateSpecDefinition(
  id: string,
  _prev: FormState,
  formData: FormData
): Promise<FormState> {
  await requireAdmin();
  const result = readPayload(formData);
  if ("error" in result) return { error: result.error };

  try {
    await updateRow("spec_definitions", id, result.payload);
  } catch (e) {
    return { error: e instanceof Error ? e.message : "Failed to update spec definition." };
  }

  revalidatePath("/admin/spec-definitions");
  redirect("/admin/spec-definitions");
}

export async function deleteSpecDefinition(formData: FormData): Promise<void> {
  await requireAdmin();
  const id = String(formData.get("id") ?? "");
  if (!id) return;
  await deleteRow("spec_definitions", id);
  revalidatePath("/admin/spec-definitions");
}
