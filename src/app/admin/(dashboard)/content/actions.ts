"use server";

import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { requireAdmin } from "@/lib/dal";
import { createClient } from "@/lib/supabase/server";
import { insertRow, updateRow, deleteRow, type ValidationResult } from "@/lib/admin/reference-service";
import { slugify } from "@/lib/admin/slugify";
import type { ContentType, ContentStatus, ContentProductRole, Insert } from "@/lib/types/database";
import type { FormState } from "@/components/admin/reference-form";

const VALID_TYPES: ContentType[] = ["review", "guide", "comparison", "news"];
const VALID_STATUSES: ContentStatus[] = ["draft", "published"];
const VALID_ROLES: ContentProductRole[] = ["primary_subject", "mentioned", "compared_against"];

function readContentPayload(
  formData: FormData
): ValidationResult<Omit<Insert<"content_items">, "author_id">> {
  const type = String(formData.get("type") ?? "").trim();
  const title = String(formData.get("title") ?? "").trim();
  const slugInput = String(formData.get("slug") ?? "").trim();
  const body = String(formData.get("body") ?? "").trim();
  const status = String(formData.get("status") ?? "").trim();
  const publishedAtInput = String(formData.get("published_at") ?? "").trim();

  if (!VALID_TYPES.includes(type as ContentType)) return { error: "Choose a valid content type." };
  if (!title) return { error: "Title is required." };
  if (!VALID_STATUSES.includes(status as ContentStatus)) return { error: "Choose a valid status." };

  return {
    payload: {
      type: type as ContentType,
      title,
      slug: slugify(slugInput || title),
      body: body || null,
      status: status as ContentStatus,
      published_at: publishedAtInput ? new Date(publishedAtInput).toISOString() : null,
    },
  };
}

export async function createContentItem(_prev: FormState, formData: FormData): Promise<FormState> {
  const admin = await requireAdmin();
  const result = readContentPayload(formData);
  if ("error" in result) return { error: result.error };

  let id: string;
  try {
    const row = await insertRow("content_items", { ...result.payload, author_id: admin.id });
    id = row.id;
  } catch (e) {
    return { error: e instanceof Error ? e.message : "Failed to create content item." };
  }

  revalidatePath("/admin/content");
  redirect(`/admin/content/${id}`);
}

export async function updateContentItem(id: string, _prev: FormState, formData: FormData): Promise<FormState> {
  await requireAdmin();
  const result = readContentPayload(formData);
  if ("error" in result) return { error: result.error };

  try {
    await updateRow("content_items", id, result.payload);
  } catch (e) {
    return { error: e instanceof Error ? e.message : "Failed to update content item." };
  }

  revalidatePath("/admin/content");
  revalidatePath(`/admin/content/${id}`);
  redirect(`/admin/content/${id}`);
}

export async function deleteContentItem(formData: FormData): Promise<void> {
  await requireAdmin();
  const id = String(formData.get("id") ?? "");
  if (!id) return;
  await deleteRow("content_items", id);
  revalidatePath("/admin/content");
}

export async function unpublishContentItem(formData: FormData): Promise<void> {
  await requireAdmin();
  const id = String(formData.get("id") ?? "");
  if (!id) return;
  await updateRow("content_items", id, { status: "draft" });
  revalidatePath("/admin/content");
  revalidatePath(`/admin/content/${id}`);
}

export async function updateContentTags(contentId: string, formData: FormData): Promise<void> {
  await requireAdmin();
  const tagIds = formData.getAll("tag_id").map(String).filter(Boolean);

  const supabase = await createClient();
  const { error: deleteError } = await supabase.from("content_tags").delete().eq("content_id", contentId);
  if (deleteError) throw new Error(deleteError.message);

  if (tagIds.length > 0) {
    const { error: insertError } = await supabase
      .from("content_tags")
      .insert(tagIds.map((tag_id) => ({ content_id: contentId, tag_id })));
    if (insertError) throw new Error(insertError.message);
  }

  revalidatePath(`/admin/content/${contentId}`);
}

export async function updateContentProducts(
  contentId: string,
  productIds: string[],
  formData: FormData
): Promise<void> {
  await requireAdmin();
  const supabase = await createClient();

  const { error: deleteError } = await supabase.from("content_products").delete().eq("content_id", contentId);
  if (deleteError) throw new Error(deleteError.message);

  const links = productIds
    .map((productId) => {
      const role = String(formData.get(`role_${productId}`) ?? "");
      return VALID_ROLES.includes(role as ContentProductRole)
        ? { content_id: contentId, product_id: productId, role: role as ContentProductRole }
        : null;
    })
    .filter((v): v is { content_id: string; product_id: string; role: ContentProductRole } => v !== null);

  if (links.length > 0) {
    const { error: insertError } = await supabase.from("content_products").insert(links);
    if (insertError) throw new Error(insertError.message);
  }

  revalidatePath(`/admin/content/${contentId}`);
}

export async function updateContentSeo(contentId: string, formData: FormData): Promise<void> {
  await requireAdmin();
  const metaTitle = String(formData.get("meta_title") ?? "").trim();
  const metaDescription = String(formData.get("meta_description") ?? "").trim();
  const canonicalUrl = String(formData.get("canonical_url") ?? "").trim();
  const noindex = formData.get("noindex") === "on";

  const supabase = await createClient();
  const { error } = await supabase.from("seo_metadata").upsert(
    {
      content_id: contentId,
      meta_title: metaTitle || null,
      meta_description: metaDescription || null,
      canonical_url: canonicalUrl || null,
      noindex,
    },
    { onConflict: "content_id" }
  );
  if (error) throw new Error(error.message);

  revalidatePath(`/admin/content/${contentId}`);
}

export async function logContentFreshnessReview(contentId: string, formData: FormData): Promise<void> {
  const admin = await requireAdmin();
  const reason = String(formData.get("reason") ?? "").trim();
  if (!reason) return;

  const supabase = await createClient();
  const { error } = await supabase.from("freshness_log").insert({
    content_id: contentId,
    reviewed_by: admin.id,
    reason,
  });
  if (error) throw new Error(error.message);

  revalidatePath(`/admin/content/${contentId}`);
  revalidatePath("/admin/freshness");
}
