"use server";

import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { requireAdmin } from "@/lib/dal";
import { createClient } from "@/lib/supabase/server";
import { updateRow, deleteRow, getRowById, type ValidationResult } from "@/lib/admin/reference-service";
import { MEDIA_PRIVATE_BUCKET, MEDIA_PUBLIC_BUCKET } from "@/lib/media/constants";
import { evaluatePublishEligibility } from "@/lib/media/rights";
import type { MediaType, MediaRole, MediaSourceType, MediaRightsStatus, MediaBrandRole, Insert } from "@/lib/types/database";
import type { FormState } from "@/components/admin/reference-form";

const VALID_MEDIA_TYPES: MediaType[] = ["image", "video"];
const VALID_ROLES: MediaRole[] = ["hero", "gallery", "thumbnail"];
const VALID_SOURCE_TYPES: MediaSourceType[] = [
  "manufacturer",
  "staff_photograph",
  "stock_licensed",
  "user_submitted",
  "press_kit",
  "other",
];
const VALID_RIGHTS_STATUSES: MediaRightsStatus[] = ["unknown", "pending_verification", "verified", "restricted"];
const VALID_BRAND_ROLES: MediaBrandRole[] = [
  "logo_full",
  "logo_full_tagline",
  "wordmark",
  "wordmark_tagline",
  "mark",
  "favicon",
  "og_image",
];

type MediaMetadata = Omit<Insert<"media_assets">, "storage_path">;
type PrimaryFields = Pick<MediaMetadata, "media_type" | "alt_text" | "width" | "height" | "license" | "creator">;
type ProvenanceFields = Pick<
  MediaMetadata,
  | "caption"
  | "source_type"
  | "source_url"
  | "attribution"
  | "attribution_required"
  | "ai_generated"
  | "owned"
  | "rights_status"
  | "brand_role"
>;

// Used on upload, where everything is captured in one form.
function readMetadata(formData: FormData): ValidationResult<MediaMetadata> {
  const primary = readPrimaryFields(formData);
  if ("error" in primary) return primary;
  const provenance = readProvenanceFields(formData);
  if ("error" in provenance) return provenance;
  return { payload: { ...primary.payload, ...provenance.payload } };
}

// Used on edit, where primary fields and provenance are two separate forms
// (so editing one doesn't require hidden inputs mirroring the other).
function readPrimaryFields(formData: FormData): ValidationResult<PrimaryFields> {
  const mediaType = String(formData.get("media_type") ?? "").trim();
  const altText = String(formData.get("alt_text") ?? "").trim();
  const license = String(formData.get("license") ?? "").trim();
  const creator = String(formData.get("creator") ?? "").trim();
  const widthRaw = String(formData.get("width") ?? "").trim();
  const heightRaw = String(formData.get("height") ?? "").trim();

  if (!VALID_MEDIA_TYPES.includes(mediaType as MediaType)) {
    return { error: "Choose a valid media type." };
  }

  return {
    payload: {
      media_type: mediaType as MediaType,
      alt_text: altText || null,
      license: license || null,
      creator: creator || null,
      width: widthRaw ? Number(widthRaw) : null,
      height: heightRaw ? Number(heightRaw) : null,
    },
  };
}

function readProvenanceFields(formData: FormData): ValidationResult<ProvenanceFields> {
  const caption = String(formData.get("caption") ?? "").trim();
  const sourceType = String(formData.get("source_type") ?? "").trim();
  const sourceUrl = String(formData.get("source_url") ?? "").trim();
  const attribution = String(formData.get("attribution") ?? "").trim();
  const attributionRequired = formData.get("attribution_required") === "on";
  const aiGenerated = formData.get("ai_generated") === "on";
  const owned = formData.get("owned") === "on";
  const rightsStatus = String(formData.get("rights_status") ?? "unknown").trim();
  const brandRole = String(formData.get("brand_role") ?? "").trim();

  if (sourceType && !VALID_SOURCE_TYPES.includes(sourceType as MediaSourceType)) {
    return { error: "Choose a valid source type." };
  }
  if (!VALID_RIGHTS_STATUSES.includes(rightsStatus as MediaRightsStatus)) {
    return { error: "Choose a valid rights status." };
  }
  if (brandRole && !VALID_BRAND_ROLES.includes(brandRole as MediaBrandRole)) {
    return { error: "Choose a valid brand asset role." };
  }

  return {
    payload: {
      caption: caption || null,
      source_type: (sourceType as MediaSourceType) || null,
      source_url: sourceUrl || null,
      attribution: attribution || null,
      attribution_required: attributionRequired,
      ai_generated: aiGenerated,
      owned,
      rights_status: rightsStatus as MediaRightsStatus,
      brand_role: (brandRole as MediaBrandRole) || null,
    },
  };
}

function sanitizeFileName(name: string): string {
  return name.toLowerCase().replace(/[^a-z0-9.]+/g, "-").replace(/^-+|-+$/g, "");
}

export async function uploadMediaAsset(_prev: FormState, formData: FormData): Promise<FormState> {
  await requireAdmin();

  const file = formData.get("file");
  if (!(file instanceof File) || file.size === 0) {
    return { error: "Choose a file to upload." };
  }

  const meta = readMetadata(formData);
  if ("error" in meta) return { error: meta.error };

  const path = `${meta.payload.media_type}/${crypto.randomUUID()}-${sanitizeFileName(file.name)}`;

  const supabase = await createClient();
  const { error: uploadError } = await supabase.storage.from(MEDIA_PRIVATE_BUCKET).upload(path, file, {
    contentType: file.type || undefined,
    upsert: false,
  });

  if (uploadError) {
    return { error: `Upload failed: ${uploadError.message}` };
  }

  const { error: insertError } = await supabase
    .from("media_assets")
    .insert({ storage_path: path, ...meta.payload });

  if (insertError) {
    await supabase.storage.from(MEDIA_PRIVATE_BUCKET).remove([path]);
    return { error: insertError.message };
  }

  revalidatePath("/admin/media");
  redirect("/admin/media");
}

// Batch-upload variant of uploadMediaAsset: same validation/storage/insert
// logic, but never redirects — called directly (not via a <form action>)
// once per file from the batch upload UI, so the client can show per-file
// progress/success/error and decide for itself when the whole batch is
// done, rather than the server bouncing away after the first file. Kept
// separate from uploadMediaAsset (still form-action-based, still
// redirects) rather than changing that function's behavior, since nothing
// about the traditional single-file path needs to change.
export type BatchUploadResult = { id: string; error: null } | { id: null; error: string };

export async function uploadMediaAssetBatchItem(formData: FormData): Promise<BatchUploadResult> {
  await requireAdmin();

  const file = formData.get("file");
  if (!(file instanceof File) || file.size === 0) {
    return { id: null, error: "No file provided." };
  }

  const meta = readMetadata(formData);
  if ("error" in meta) return { id: null, error: meta.error };

  const path = `${meta.payload.media_type}/${crypto.randomUUID()}-${sanitizeFileName(file.name)}`;

  const supabase = await createClient();
  const { error: uploadError } = await supabase.storage.from(MEDIA_PRIVATE_BUCKET).upload(path, file, {
    contentType: file.type || undefined,
    upsert: false,
  });
  if (uploadError) {
    return { id: null, error: `Upload failed: ${uploadError.message}` };
  }

  const { data, error: insertError } = await supabase
    .from("media_assets")
    .insert({ storage_path: path, ...meta.payload })
    .select("id")
    .single();
  if (insertError || !data) {
    await supabase.storage.from(MEDIA_PRIVATE_BUCKET).remove([path]);
    return { id: null, error: insertError?.message ?? "Insert failed." };
  }

  revalidatePath("/admin/media");
  return { id: data.id, error: null };
}

// Bulk actions for the media library grid's multi-select toolbar. Each
// mirrors the exact per-asset action it batches (publishMediaAsset,
// unpublishMediaAsset, or a plain rights_status update) — never a
// shortcut that bypasses evaluatePublishEligibility. Assets that fail
// eligibility are skipped, not force-published; the caller gets a summary
// so a partial result is visible rather than silently swallowed.
export type BulkActionSummary = { succeeded: number; skipped: { id: string; reason: string }[] };

export async function bulkPublishMediaAssets(ids: string[]): Promise<BulkActionSummary> {
  const admin = await requireAdmin();
  if (ids.length === 0) return { succeeded: 0, skipped: [] };

  const supabase = await createClient();
  const { data: assets } = await supabase.from("media_assets").select("*").in("id", ids);

  const summary: BulkActionSummary = { succeeded: 0, skipped: [] };
  for (const asset of assets ?? []) {
    const eligibility = evaluatePublishEligibility(asset);
    if (!eligibility.allowed) {
      summary.skipped.push({ id: asset.id, reason: eligibility.reason });
      continue;
    }
    const { error: copyError } = await supabase.storage
      .from(MEDIA_PRIVATE_BUCKET)
      .copy(asset.storage_path, asset.storage_path, { destinationBucket: MEDIA_PUBLIC_BUCKET });
    if (copyError) {
      summary.skipped.push({ id: asset.id, reason: copyError.message });
      continue;
    }
    const { error: updateError } = await supabase
      .from("media_assets")
      .update({
        publication_status: "published",
        public_storage_path: asset.storage_path,
        published_at: new Date().toISOString(),
        published_by: admin.id,
      })
      .eq("id", asset.id);
    if (updateError) {
      summary.skipped.push({ id: asset.id, reason: updateError.message });
      continue;
    }
    summary.succeeded++;
  }

  revalidatePath("/admin/media");
  return summary;
}

export async function bulkUnpublishMediaAssets(ids: string[]): Promise<BulkActionSummary> {
  await requireAdmin();
  if (ids.length === 0) return { succeeded: 0, skipped: [] };

  const supabase = await createClient();
  const { data: assets } = await supabase.from("media_assets").select("*").in("id", ids);

  const summary: BulkActionSummary = { succeeded: 0, skipped: [] };
  for (const asset of assets ?? []) {
    if (asset.public_storage_path) {
      await supabase.storage.from(MEDIA_PUBLIC_BUCKET).remove([asset.public_storage_path]);
    }
    const { error: updateError } = await supabase
      .from("media_assets")
      .update({ publication_status: "private", public_storage_path: null, published_at: null, published_by: null })
      .eq("id", asset.id);
    if (updateError) {
      summary.skipped.push({ id: asset.id, reason: updateError.message });
      continue;
    }
    summary.succeeded++;
  }

  revalidatePath("/admin/media");
  return summary;
}

export async function bulkSetRightsStatus(ids: string[], rightsStatus: MediaRightsStatus): Promise<BulkActionSummary> {
  await requireAdmin();
  if (ids.length === 0 || !VALID_RIGHTS_STATUSES.includes(rightsStatus)) return { succeeded: 0, skipped: [] };

  const supabase = await createClient();
  const { error, count } = await supabase
    .from("media_assets")
    .update({ rights_status: rightsStatus }, { count: "exact" })
    .in("id", ids);

  revalidatePath("/admin/media");
  if (error) return { succeeded: 0, skipped: ids.map((id) => ({ id, reason: error.message })) };
  return { succeeded: count ?? ids.length, skipped: [] };
}

export async function updateMediaAsset(id: string, _prev: FormState, formData: FormData): Promise<FormState> {
  await requireAdmin();
  const meta = readPrimaryFields(formData);
  if ("error" in meta) return { error: meta.error };

  try {
    await updateRow("media_assets", id, meta.payload);
  } catch (e) {
    return { error: e instanceof Error ? e.message : "Failed to update media asset." };
  }

  revalidatePath("/admin/media");
  revalidatePath(`/admin/media/${id}`);
  redirect(`/admin/media/${id}`);
}

export async function updateMediaProvenance(id: string, formData: FormData): Promise<void> {
  await requireAdmin();
  const meta = readProvenanceFields(formData);
  if ("error" in meta) throw new Error(meta.error);

  await updateRow("media_assets", id, meta.payload);
  revalidatePath("/admin/media");
  revalidatePath(`/admin/media/${id}`);
}

// Copies the private original into the public bucket and flips the row to
// published. Idempotent — publishing an already-published asset just
// refreshes the timestamp. Never touches the private copy, which stays the
// permanent archive/evidence record regardless of publication state.
export async function publishMediaAsset(id: string): Promise<FormState> {
  const admin = await requireAdmin();
  const asset = await getRowById("media_assets", id);
  if (!asset) return { error: "Media asset not found." };

  // Rights gate: enforced here, server-side, before any storage copy runs.
  // The UI may also explain this ahead of time, but this check is the real
  // boundary — it cannot be bypassed by calling the action directly.
  const eligibility = evaluatePublishEligibility(asset);
  if (!eligibility.allowed) return { error: eligibility.reason };

  const supabase = await createClient();
  const { error: copyError } = await supabase.storage
    .from(MEDIA_PRIVATE_BUCKET)
    .copy(asset.storage_path, asset.storage_path, { destinationBucket: MEDIA_PUBLIC_BUCKET });

  if (copyError) {
    return { error: `Publish failed: ${copyError.message}` };
  }

  const { error: updateError } = await supabase
    .from("media_assets")
    .update({
      publication_status: "published",
      public_storage_path: asset.storage_path,
      published_at: new Date().toISOString(),
      published_by: admin.id,
    })
    .eq("id", id);

  if (updateError) return { error: updateError.message };

  revalidatePath("/admin/media");
  revalidatePath(`/admin/media/${id}`);
  return { error: null };
}

// Removes the public copy only. The private original is untouched, so this
// can be republished later without re-uploading.
export async function unpublishMediaAsset(id: string): Promise<FormState> {
  await requireAdmin();
  const asset = await getRowById("media_assets", id);
  if (!asset) return { error: "Media asset not found." };

  const supabase = await createClient();
  if (asset.public_storage_path) {
    await supabase.storage.from(MEDIA_PUBLIC_BUCKET).remove([asset.public_storage_path]);
  }

  const { error: updateError } = await supabase
    .from("media_assets")
    .update({
      publication_status: "private",
      public_storage_path: null,
      published_at: null,
      published_by: null,
    })
    .eq("id", id);

  if (updateError) return { error: updateError.message };

  revalidatePath("/admin/media");
  revalidatePath(`/admin/media/${id}`);
  return { error: null };
}

export async function deleteMediaAsset(formData: FormData): Promise<void> {
  await requireAdmin();
  const id = String(formData.get("id") ?? "");
  if (!id) return;

  const asset = await getRowById("media_assets", id);

  // Delete the DB row first: if a storage removal below fails, the result
  // is a harmless orphaned object (reconcilable later), not a dangling
  // public-facing DB reference to a file that may no longer be reachable.
  await deleteRow("media_assets", id);

  if (asset) {
    const supabase = await createClient();
    await supabase.storage.from(MEDIA_PRIVATE_BUCKET).remove([asset.storage_path]);
    if (asset.public_storage_path) {
      await supabase.storage.from(MEDIA_PUBLIC_BUCKET).remove([asset.public_storage_path]);
    }
  }

  revalidatePath("/admin/media");
}

export async function updateMediaProductAssociations(
  mediaId: string,
  productIds: string[],
  formData: FormData
): Promise<void> {
  await requireAdmin();
  const supabase = await createClient();

  const { error: deleteError } = await supabase.from("product_media").delete().eq("media_id", mediaId);
  if (deleteError) throw new Error(deleteError.message);

  const links = productIds
    .map((productId) => {
      const role = String(formData.get(`role_${productId}`) ?? "");
      return VALID_ROLES.includes(role as MediaRole)
        ? { media_id: mediaId, product_id: productId, role: role as MediaRole }
        : null;
    })
    .filter((v): v is { media_id: string; product_id: string; role: MediaRole } => v !== null);

  if (links.length > 0) {
    const { error: insertError } = await supabase.from("product_media").insert(links);
    if (insertError) throw new Error(insertError.message);
  }

  revalidatePath(`/admin/media/${mediaId}`);
}

export async function updateMediaContentAssociations(
  mediaId: string,
  contentIds: string[],
  formData: FormData
): Promise<void> {
  await requireAdmin();
  const supabase = await createClient();

  const { error: deleteError } = await supabase.from("content_media").delete().eq("media_id", mediaId);
  if (deleteError) throw new Error(deleteError.message);

  const links = contentIds
    .map((contentId) => {
      const role = String(formData.get(`role_${contentId}`) ?? "");
      return VALID_ROLES.includes(role as MediaRole)
        ? { media_id: mediaId, content_id: contentId, role: role as MediaRole }
        : null;
    })
    .filter((v): v is { media_id: string; content_id: string; role: MediaRole } => v !== null);

  if (links.length > 0) {
    const { error: insertError } = await supabase.from("content_media").insert(links);
    if (insertError) throw new Error(insertError.message);
  }

  revalidatePath(`/admin/media/${mediaId}`);
}
