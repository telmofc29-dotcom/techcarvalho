"use server";

import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { requireAdmin } from "@/lib/dal";
import { createClient } from "@/lib/supabase/server";
import { insertRow, updateRow, deleteRow, type ValidationResult } from "@/lib/admin/reference-service";
import { slugify } from "@/lib/admin/slugify";
import type {
  ContentType,
  ContentStatus,
  ContentProductRole,
  ContentRelationshipType,
  SearchIntent,
  Insert,
} from "@/lib/types/database";
import type { FormState } from "@/components/admin/reference-form";

const VALID_CONTENT_RELATIONSHIP_TYPES: ContentRelationshipType[] = ["pillar_of", "supporting_of", "related_to"];

// Must match CONTENT_TYPE_OPTIONS/CONTENT_STATUS_OPTIONS in
// src/lib/admin/content-options.ts (the dropdowns these validate) — both
// widened by supabase/migrations/20260820_content_troubleshooting_type.sql
// and 20260820_editorial_workflow_statuses.sql, applied to production.
const VALID_TYPES: ContentType[] = ["review", "guide", "comparison", "news", "troubleshooting"];
const VALID_STATUSES: ContentStatus[] = [
  "idea",
  "planned",
  "draft",
  "review",
  "ready",
  "published",
  "needs_update",
  "archived",
];
const VALID_ROLES: ContentProductRole[] = ["primary_subject", "mentioned", "compared_against"];
const VALID_SEARCH_INTENTS: SearchIntent[] = ["informational", "commercial", "transactional", "navigational"];

function readContentPayload(
  formData: FormData
): ValidationResult<Omit<Insert<"content_items">, "author_id">> {
  const type = String(formData.get("type") ?? "").trim();
  const title = String(formData.get("title") ?? "").trim();
  const slugInput = String(formData.get("slug") ?? "").trim();
  const body = String(formData.get("body") ?? "").trim();
  const status = String(formData.get("status") ?? "").trim();
  const publishedAtInput = String(formData.get("published_at") ?? "").trim();
  const categoryId = String(formData.get("category_id") ?? "").trim();
  const searchIntent = String(formData.get("search_intent") ?? "").trim();
  const primaryQuery = String(formData.get("primary_query") ?? "").trim();
  const intentFingerprint = String(formData.get("intent_fingerprint") ?? "").trim();

  if (!VALID_TYPES.includes(type as ContentType)) return { error: "Choose a valid content type." };
  if (!title) return { error: "Title is required." };
  if (!VALID_STATUSES.includes(status as ContentStatus)) return { error: "Choose a valid status." };
  if (searchIntent && !VALID_SEARCH_INTENTS.includes(searchIntent as SearchIntent)) {
    return { error: "Choose a valid search intent." };
  }

  // The published_at weakness this closes: RLS requires status = 'published'
  // AND published_at <= now() for public visibility (see
  // 20260819202305_rls_policies.sql) — published_at is a fully separate
  // form field with no prior auto-fill, so setting Status to Published
  // without also remembering to fill in Publish At silently produced a
  // "Published" record that stayed completely invisible on the public
  // site, with nothing in the admin UI making that obvious. Auto-filling
  // to now() ONLY when the field was left blank AND status is being set to
  // published preserves a deliberately-set historical/backdated date (an
  // admin who explicitly typed one keeps exactly what they typed) while
  // making the common case — flip to Published, forget the date — safe by
  // default instead of silently broken.
  const publishedAt = publishedAtInput
    ? new Date(publishedAtInput).toISOString()
    : status === "published"
      ? new Date().toISOString()
      : null;

  return {
    payload: {
      type: type as ContentType,
      title,
      slug: slugify(slugInput || title),
      body: body || null,
      status: status as ContentStatus,
      published_at: publishedAt,
      category_id: categoryId || null,
      search_intent: (searchIntent as SearchIntent) || null,
      primary_query: primaryQuery || null,
      intent_fingerprint: intentFingerprint || null,
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

export async function archiveContentItem(formData: FormData): Promise<void> {
  await requireAdmin();
  const id = String(formData.get("id") ?? "");
  if (!id) return;
  await updateRow("content_items", id, { status: "archived" });
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

// content_relationships — pillar/supporting/related content-to-content
// structure. See supabase/migrations/20260820_content_relationships.sql:
// directional, mirrors product_relationships — only ever insert the
// forward-direction row; the app infers the reverse at query time.
export async function addContentRelationship(contentId: string, formData: FormData): Promise<void> {
  await requireAdmin();
  const relatedContentId = String(formData.get("related_content_id") ?? "").trim();
  const relationshipType = String(formData.get("relationship_type") ?? "").trim();

  if (!relatedContentId || relatedContentId === contentId) return;
  if (!VALID_CONTENT_RELATIONSHIP_TYPES.includes(relationshipType as ContentRelationshipType)) return;

  const supabase = await createClient();
  const { error } = await supabase.from("content_relationships").insert({
    content_id: contentId,
    related_content_id: relatedContentId,
    relationship_type: relationshipType as ContentRelationshipType,
  });
  // Ignore duplicate-relationship conflicts (unique constraint) rather than
  // surfacing a confusing error for re-adding the same pair/type.
  if (error && error.code !== "23505") throw new Error(error.message);

  revalidatePath(`/admin/content/${contentId}`);
}

export async function deleteContentRelationship(formData: FormData): Promise<void> {
  await requireAdmin();
  const id = String(formData.get("id") ?? "");
  const contentId = String(formData.get("content_id") ?? "");
  if (!id) return;

  const supabase = await createClient();
  const { error } = await supabase.from("content_relationships").delete().eq("id", id);
  if (error) throw new Error(error.message);

  if (contentId) revalidatePath(`/admin/content/${contentId}`);
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
