"use server";

import { revalidatePath } from "next/cache";
import { requireAdmin } from "@/lib/dal";
import { createClient } from "@/lib/supabase/server";

// evidence_records attaches to exactly one of product_id/content_id (enforced
// by a DB check constraint).
export type EvidenceParent = { type: "product" | "content"; id: string };

function parentPath(parent: EvidenceParent): string {
  return parent.type === "product" ? `/admin/products/${parent.id}` : `/admin/content/${parent.id}`;
}

// test_type has no CHECK constraint in the schema — it's free text. The form
// offers a suggested vocabulary (see evidence-test-types.ts) plus an "other"
// fallback, but this action accepts whatever the form sends rather than
// re-validating against that list, since the vocabulary is a UI suggestion,
// not a schema-level enum.
export async function addEvidenceRecord(parent: EvidenceParent, formData: FormData): Promise<void> {
  const admin = await requireAdmin();
  const testTypeSelect = String(formData.get("test_type") ?? "").trim();
  const testTypeOther = String(formData.get("test_type_other") ?? "").trim();
  const testType = testTypeSelect === "other" ? testTypeOther : testTypeSelect;
  const conditions = String(formData.get("conditions") ?? "").trim();
  const resultSummary = String(formData.get("result_summary") ?? "").trim();
  const rawDataText = String(formData.get("raw_data") ?? "").trim();

  if (!testType || !resultSummary) return;

  let rawData: unknown = null;
  if (rawDataText) {
    try {
      rawData = JSON.parse(rawDataText);
    } catch {
      throw new Error("Raw data must be valid JSON, or left blank.");
    }
  }

  const supabase = await createClient();
  const { error } = await supabase.from("evidence_records").insert({
    product_id: parent.type === "product" ? parent.id : null,
    content_id: parent.type === "content" ? parent.id : null,
    test_type: testType,
    conditions: conditions || null,
    result_summary: resultSummary,
    raw_data: rawData,
    tested_by: admin.id,
  });
  if (error) throw new Error(error.message);

  revalidatePath(parentPath(parent));
  revalidatePath("/admin/evidence-records");
}

export async function deleteEvidenceRecord(formData: FormData): Promise<void> {
  await requireAdmin();
  const id = String(formData.get("id") ?? "");
  const parentType = String(formData.get("parent_type") ?? "") as EvidenceParent["type"] | "";
  const parentId = String(formData.get("parent_id") ?? "");
  if (!id) return;

  const supabase = await createClient();
  const { error } = await supabase.from("evidence_records").delete().eq("id", id);
  if (error) throw new Error(error.message);

  if (parentType && parentId) revalidatePath(parentPath({ type: parentType, id: parentId }));
  revalidatePath("/admin/evidence-records");
}
