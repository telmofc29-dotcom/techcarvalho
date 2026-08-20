"use server";

import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { requireAdmin } from "@/lib/dal";
import { createClient } from "@/lib/supabase/server";
import { insertRow, updateRow, deleteRow, type ValidationResult } from "@/lib/admin/reference-service";
import { slugify } from "@/lib/admin/slugify";
import type { ProductStatus, SpecDataType, RelationshipType, Insert } from "@/lib/types/database";
import type { FormState } from "@/components/admin/reference-form";

const VALID_STATUSES: ProductStatus[] = ["active", "discontinued", "rumored"];
const VALID_RELATIONSHIP_TYPES: RelationshipType[] = [
  "successor_of",
  "alternative_to",
  "accessory_for",
  "compatible_with",
  "requires",
];

function readProductPayload(formData: FormData): ValidationResult<Insert<"products">> {
  const name = String(formData.get("name") ?? "").trim();
  const slugInput = String(formData.get("slug") ?? "").trim();
  const manufacturerId = String(formData.get("manufacturer_id") ?? "").trim();
  const categoryId = String(formData.get("category_id") ?? "").trim();
  const familyId = String(formData.get("family_id") ?? "").trim();
  const modelNumber = String(formData.get("model_number") ?? "").trim();
  const releaseDate = String(formData.get("release_date") ?? "").trim();
  const status = String(formData.get("status") ?? "").trim();
  const summary = String(formData.get("summary") ?? "").trim();
  const isPublished = formData.get("is_published") === "on";

  if (!name) return { error: "Name is required." };
  if (!manufacturerId) return { error: "Manufacturer is required." };
  if (!categoryId) return { error: "Category is required." };
  if (!VALID_STATUSES.includes(status as ProductStatus)) {
    return { error: "Choose a valid status." };
  }

  return {
    payload: {
      name,
      slug: slugify(slugInput || name),
      manufacturer_id: manufacturerId,
      category_id: categoryId,
      family_id: familyId || null,
      model_number: modelNumber || null,
      release_date: releaseDate || null,
      status: status as ProductStatus,
      summary: summary || null,
      is_published: isPublished,
    },
  };
}

export async function createProduct(_prev: FormState, formData: FormData): Promise<FormState> {
  await requireAdmin();
  const result = readProductPayload(formData);
  if ("error" in result) return { error: result.error };

  let id: string;
  try {
    const row = await insertRow("products", result.payload);
    id = row.id;
  } catch (e) {
    return { error: e instanceof Error ? e.message : "Failed to create product." };
  }

  revalidatePath("/admin/products");
  redirect(`/admin/products/${id}`);
}

export async function updateProduct(id: string, _prev: FormState, formData: FormData): Promise<FormState> {
  await requireAdmin();
  const result = readProductPayload(formData);
  if ("error" in result) return { error: result.error };

  try {
    await updateRow("products", id, result.payload);
  } catch (e) {
    return { error: e instanceof Error ? e.message : "Failed to update product." };
  }

  revalidatePath("/admin/products");
  revalidatePath(`/admin/products/${id}`);
  redirect(`/admin/products/${id}`);
}

export async function deleteProduct(formData: FormData): Promise<void> {
  await requireAdmin();
  const id = String(formData.get("id") ?? "");
  if (!id) return;
  await deleteRow("products", id);
  revalidatePath("/admin/products");
}

export async function updateProductTags(productId: string, formData: FormData): Promise<void> {
  await requireAdmin();
  const tagIds = formData.getAll("tag_id").map(String).filter(Boolean);

  const supabase = await createClient();
  const { error: deleteError } = await supabase.from("product_tags").delete().eq("product_id", productId);
  if (deleteError) throw new Error(deleteError.message);

  if (tagIds.length > 0) {
    const { error: insertError } = await supabase
      .from("product_tags")
      .insert(tagIds.map((tag_id) => ({ product_id: productId, tag_id })));
    if (insertError) throw new Error(insertError.message);
  }

  revalidatePath(`/admin/products/${productId}`);
}

export async function logProductFreshnessReview(productId: string, formData: FormData): Promise<void> {
  const admin = await requireAdmin();
  const reason = String(formData.get("reason") ?? "").trim();
  if (!reason) return;

  const supabase = await createClient();
  const { error } = await supabase.from("freshness_log").insert({
    product_id: productId,
    reviewed_by: admin.id,
    reason,
  });
  if (error) throw new Error(error.message);

  revalidatePath(`/admin/products/${productId}`);
  revalidatePath("/admin/freshness");
}

export async function addProductRelationship(productId: string, formData: FormData): Promise<void> {
  await requireAdmin();
  const relatedProductId = String(formData.get("related_product_id") ?? "").trim();
  const relationshipType = String(formData.get("relationship_type") ?? "").trim();

  if (!relatedProductId || relatedProductId === productId) return;
  if (!VALID_RELATIONSHIP_TYPES.includes(relationshipType as RelationshipType)) return;

  const supabase = await createClient();
  const { error } = await supabase.from("product_relationships").insert({
    product_id: productId,
    related_product_id: relatedProductId,
    relationship_type: relationshipType as RelationshipType,
  });
  // Ignore duplicate-relationship conflicts (unique constraint) rather than
  // surfacing a confusing error for re-adding the same pair/type.
  if (error && error.code !== "23505") throw new Error(error.message);

  revalidatePath(`/admin/products/${productId}`);
}

export async function deleteProductRelationship(formData: FormData): Promise<void> {
  await requireAdmin();
  const id = String(formData.get("id") ?? "");
  const productId = String(formData.get("product_id") ?? "");
  if (!id) return;

  const supabase = await createClient();
  const { error } = await supabase.from("product_relationships").delete().eq("id", id);
  if (error) throw new Error(error.message);

  if (productId) revalidatePath(`/admin/products/${productId}`);
}

function coerceSpecValue(dataType: SpecDataType, raw: string): unknown | undefined {
  if (dataType === "boolean") return raw === "on";
  if (raw.trim() === "") return undefined;
  if (dataType === "number") {
    const n = Number(raw);
    return Number.isNaN(n) ? undefined : n;
  }
  return raw.trim();
}

export async function updateProductSpecs(
  productId: string,
  specDefinitions: { id: string; data_type: SpecDataType }[],
  formData: FormData
): Promise<void> {
  await requireAdmin();
  const supabase = await createClient();

  for (const def of specDefinitions) {
    const fieldName = `spec_${def.id}`;
    const raw = def.data_type === "boolean" ? (formData.get(fieldName) as string | null) ?? "" : String(formData.get(fieldName) ?? "");
    const value = coerceSpecValue(def.data_type, raw);

    if (value === undefined) {
      const { error } = await supabase
        .from("product_specs")
        .delete()
        .eq("product_id", productId)
        .eq("spec_definition_id", def.id);
      if (error) throw new Error(error.message);
      continue;
    }

    const { error } = await supabase
      .from("product_specs")
      .upsert(
        { product_id: productId, spec_definition_id: def.id, value: value as never },
        { onConflict: "product_id,spec_definition_id" }
      );
    if (error) throw new Error(error.message);
  }

  revalidatePath(`/admin/products/${productId}`);
}
