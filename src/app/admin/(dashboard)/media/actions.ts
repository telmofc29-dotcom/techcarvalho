"use server";

import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { requireAdmin } from "@/lib/dal";
import { createClient } from "@/lib/supabase/server";
import { updateRow, deleteRow, getRowById, type ValidationResult } from "@/lib/admin/reference-service";
import { MEDIA_PRIVATE_BUCKET, MEDIA_PUBLIC_BUCKET } from "@/lib/media/constants";
import { evaluatePublishEligibility } from "@/lib/media/rights";
import { resolvePublicationSource } from "@/lib/media/publication-source";
import type { MediaType, MediaRole, MediaSourceType, MediaRightsStatus, MediaBrandRole, MediaAssetRole, Insert } from "@/lib/types/database";
import { explainProvenanceRequirement, stampModificationAssessment } from "@/lib/media/provenance-invariant";
import {
  ASSET_ROLES_PENDING_MIGRATION,
  EDITED_FIELDS_INPUT,
  isValidAssetRole,
  isValidBrandRole,
  isValidMediaType,
  isValidRightsStatus,
  isValidSourceType,
} from "@/lib/media/form-options";
import type { FormState } from "@/components/admin/reference-form";

// Every enumerated choice comes from src/lib/media/form-options.ts, which the
// upload form ALSO renders from. Two hand-maintained copies of the same enum is
// exactly how this route came to offer "Public domain / Creative Commons" and
// "TechCarvalho-created graphic/diagram" in the menu while refusing both on
// submit — values the database itself accepts. One list, no drift.
const VALID_ROLES: MediaRole[] = ["hero", "gallery", "thumbnail"];

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
  | "asset_role"
  | "licence_permits_modification"
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

  if (!isValidMediaType(mediaType)) {
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
  const assetRole = String(formData.get("asset_role") ?? "").trim();
  const modificationRaw = String(formData.get("licence_permits_modification") ?? "").trim();

  if (sourceType && !isValidSourceType(sourceType)) {
    return { error: "Choose a valid source type." };
  }
  if (assetRole && !isValidAssetRole(assetRole)) {
    return { error: "Choose a valid editorial role." };
  }
  if (modificationRaw && !["true", "false"].includes(modificationRaw)) {
    return { error: "Modification permission must be yes, no, or unassessed." };
  }
  if (!isValidRightsStatus(rightsStatus)) {
    return { error: "Choose a valid rights status." };
  }
  if (brandRole && !isValidBrandRole(brandRole)) {
    return { error: "Choose a valid brand asset role." };
  }

  const full: ProvenanceFields = {
    caption: caption || null,
    source_type: (sourceType as MediaSourceType) || null,
    source_url: sourceUrl || null,
    attribution: attribution || null,
    attribution_required: attributionRequired,
    owned,
    rights_status: rightsStatus as MediaRightsStatus,
    brand_role: (brandRole as MediaBrandRole) || null,
    asset_role: (assetRole as MediaAssetRole) || null,
    // Tri-state on purpose. "" means NOBODY ASSESSED IT and is stored as
    // NULL, which the watermark gate treats as a refusal — unknown is never
    // permission. Collapsing it to false would claim we checked and found no.
    licence_permits_modification: modificationRaw === "" ? null : modificationRaw === "true",
    // A concept render is machine-made speculation by definition. Recording
    // it any other way would let it slip past the AI checks downstream.
    ai_generated: assetRole === "concept_render" ? true : aiGenerated,
  };

  // PATCH, not full-row overwrite.
  //
  // Every field above is reconstructed from the form, and a field the form does
  // not contain reads back as "" or false — which then OVERWRITES the stored
  // value. The edit page's provenance form carries no asset_role and no
  // licence_permits_modification input, so saving it wrote null over both. On
  // production that was 114 of 116 assets one click away from losing the
  // classification that distinguishes a product photograph from a concept
  // render. An unchecked checkbox is indistinguishable from an absent one in
  // FormData, so presence cannot be inferred — the form has to declare what it
  // edits, which is what EDITED_FIELDS_INPUT carries.
  //
  // Absent marker means "this form owns every field", which is correct for the
  // upload form, where the row is being created rather than patched.
  const declared = formData.get(EDITED_FIELDS_INPUT);
  if (typeof declared !== "string") return { payload: full };

  const editable = new Set(declared.split(",").map((s) => s.trim()).filter(Boolean));
  const patch: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(full)) {
    if (editable.has(key)) patch[key] = value;
  }
  // ai_generated is derived from asset_role rather than typed, so it has to
  // follow asset_role into the patch even when the form has no checkbox for it.
  if (editable.has("asset_role") && assetRole === "concept_render") {
    patch.ai_generated = true;
  }
  return { payload: patch as ProvenanceFields };
}

/**
 * True when an insert failed the asset_role CHECK because the role submitted is
 * one whose widening migration has not been applied in this environment.
 *
 * 23514 is check_violation. Pairing it with the submitted role keeps the
 * migration hint off unrelated constraint failures, which would otherwise send
 * an admin to run a migration that has nothing to do with their problem.
 */
function isPendingMigrationRoleViolation(code: string | undefined, assetRole: MediaAssetRole | null | undefined): boolean {
  if (code !== "23514" || !assetRole) return false;
  return (ASSET_ROLES_PENDING_MIGRATION as readonly string[]).includes(assetRole);
}

function sanitizeFileName(name: string): string {
  return name.toLowerCase().replace(/[^a-z0-9.]+/g, "-").replace(/^-+|-+$/g, "");
}

export async function uploadMediaAsset(_prev: FormState, formData: FormData): Promise<FormState> {
  const admin = await requireAdmin();

  const file = formData.get("file");
  if (!(file instanceof File) || file.size === 0) {
    return { error: "Choose a file to upload." };
  }

  const meta = readMetadata(formData);
  if ("error" in meta) return { error: meta.error };
  // A modification judgement must carry its assessor — see
  // media_assets_licence_modification_attributed.
  const payload = stampModificationAssessment(meta.payload, admin.id, new Date().toISOString());

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
    .insert({ storage_path: path, ...payload });

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
  const admin = await requireAdmin();

  const file = formData.get("file");
  if (!(file instanceof File) || file.size === 0) {
    return { id: null, error: "No file provided." };
  }

  const meta = readMetadata(formData);
  if ("error" in meta) return { id: null, error: meta.error };
  const payload = stampModificationAssessment(meta.payload, admin.id, new Date().toISOString());

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
    .insert({ storage_path: path, ...payload })
    .select("id")
    .single();
  // The CHECK rejects a role the code offers. That means
  // 20260828_concept_render_role.sql has not been applied — say so, rather than
  // surfacing a bare 23514 that reads as a bug in the upload.
  //
  // Matched on the SQLSTATE plus the role actually submitted, not on the text of
  // the error message: Postgres is free to reword a constraint violation, and a
  // diagnostic that depends on the wording is one upgrade away from silently
  // falling back to the generic branch.
  if (insertError && isPendingMigrationRoleViolation(insertError.code, meta.payload.asset_role)) {
    await supabase.storage.from(MEDIA_PRIVATE_BUCKET).remove([path]);
    return {
      id: null,
      error:
        "This editorial role is not yet accepted by the database. Apply " +
        "supabase/migrations_pending/20260828_concept_render_role.sql, then upload again. " +
        "The file was not kept.",
    };
  }
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
    // The same second gate as publishMediaAsset. A bulk action must mirror the
    // per-asset action exactly — a shortcut here is how a boundary enforced in
    // one place gets bypassed in another.
    const { data: derivRows, error: derivError } = await supabase
      .from("media_derivatives")
      .select("id, storage_path, watermarked, width, crop, format")
      .eq("media_asset_id", asset.id);
    if (derivError) {
      summary.skipped.push({ id: asset.id, reason: `reading derivatives failed: ${derivError.message}` });
      continue;
    }
    const publication = resolvePublicationSource(
      asset,
      (derivRows ?? []).map((d) => ({
        id: d.id,
        storagePath: d.storage_path,
        watermarked: d.watermarked,
        width: d.width,
        crop: d.crop,
        format: d.format,
      }))
    );
    if (!publication.allowed) {
      summary.skipped.push({ id: asset.id, reason: publication.reason });
      continue;
    }
    const { error: copyError } = await supabase.storage
      .from(MEDIA_PRIVATE_BUCKET)
      .copy(publication.source.storagePath, publication.source.storagePath, {
        destinationBucket: MEDIA_PUBLIC_BUCKET,
      });
    if (copyError) {
      summary.skipped.push({ id: asset.id, reason: copyError.message });
      continue;
    }
    const { error: updateError } = await supabase
      .from("media_assets")
      .update({
        publication_status: "published",
        public_storage_path: publication.source.storagePath,
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
  if (ids.length === 0 || !isValidRightsStatus(rightsStatus)) return { succeeded: 0, skipped: [] };

  const supabase = await createClient();

  // Per-row, not one blanket UPDATE. Marking a batch "verified" where some rows
  // lack the provenance the invariant requires used to fail the ENTIRE
  // statement on the first offender, so a selection of twenty assets changed
  // nothing and reported one constraint error. Now each ineligible row is
  // skipped with a reason and the rest go through — the same posture
  // bulkPublishMediaAssets already takes.
  const { data: assets, error: readError } = await supabase
    .from("media_assets")
    .select("id, rights_status, owned, source_type, source_url, license, creator, attribution")
    .in("id", ids);
  if (readError) return { succeeded: 0, skipped: ids.map((id) => ({ id, reason: readError.message })) };

  const summary: BulkActionSummary = { succeeded: 0, skipped: [] };
  const eligible: string[] = [];
  for (const asset of assets ?? []) {
    const problem = explainProvenanceRequirement({ ...asset, rights_status: rightsStatus });
    if (problem) summary.skipped.push({ id: asset.id, reason: problem });
    else eligible.push(asset.id);
  }

  if (eligible.length > 0) {
    const { error, count } = await supabase
      .from("media_assets")
      .update({ rights_status: rightsStatus }, { count: "exact" })
      .in("id", eligible);
    if (error) {
      summary.skipped.push(...eligible.map((id) => ({ id, reason: error.message })));
    } else {
      summary.succeeded = count ?? eligible.length;
    }
  }

  revalidatePath("/admin/media");
  return summary;
}

export async function updateMediaAsset(id: string, _prev: FormState, formData: FormData): Promise<FormState> {
  await requireAdmin();
  const meta = readPrimaryFields(formData);
  if ("error" in meta) return { error: meta.error };

  // This form owns License and Creator, which are two thirds of what the
  // provenance invariant requires. Blanking either on an externally-sourced
  // verified asset takes the row below the threshold — on production, 39 assets
  // are verified on the strength of exactly these two fields. Checked against
  // the merged row so the reason names the field rather than arriving as a
  // constraint violation.
  const existing = await getRowById("media_assets", id);
  if (!existing) return { error: "This media asset no longer exists." };
  const problem = explainProvenanceRequirement({ ...existing, ...meta.payload });
  if (problem) return { error: problem };

  try {
    await updateRow("media_assets", id, meta.payload);
  } catch (e) {
    return { error: e instanceof Error ? e.message : "Failed to update media asset." };
  }

  revalidatePath("/admin/media");
  revalidatePath(`/admin/media/${id}`);
  redirect(`/admin/media/${id}`);
}

export async function updateMediaProvenance(
  id: string,
  _prev: FormState,
  formData: FormData
): Promise<FormState> {
  const admin = await requireAdmin();
  const meta = readProvenanceFields(formData);
  if ("error" in meta) return { error: meta.error };

  // Check the provenance invariant BEFORE writing, against the row as it would
  // be AFTER the patch — the patch alone cannot be judged, because whether
  // "verified" is allowed depends on stored fields the form may not carry.
  //
  // This used to go straight to the database, which refused it with
  // media_assets_external_verified_needs_provenance, and the refusal was thrown
  // out of a Server Action — reaching the admin as a masked React #441 that
  // named neither the rule nor the missing field. Production digest 994149443.
  const existing = await getRowById("media_assets", id);
  if (!existing) return { error: "This media asset no longer exists." };

  const patch = stampModificationAssessment(meta.payload, admin.id, new Date().toISOString());
  const merged = { ...existing, ...patch };
  const problem = explainProvenanceRequirement(merged);
  if (problem) return { error: problem };

  try {
    await updateRow("media_assets", id, patch);
  } catch (e) {
    // The database keeps the final say. If it still refuses, say so plainly
    // rather than throwing — a constraint name is not a user-facing message,
    // but it is far better than a crash with no information at all.
    return { error: e instanceof Error ? e.message : "Failed to save provenance." };
  }

  revalidatePath("/admin/media");
  revalidatePath(`/admin/media/${id}`);
  return { error: null };
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

  // SECOND gate, and a different question. Rights eligibility above answers
  // "may this be public at all". This answers "in what FORM" — and for one of
  // our own photographs the answer must be a watermarked derivative, never the
  // master. Publishing the master would put the unmarked full-resolution
  // original at a public URL one hop from the marked copies, which is not a
  // weaker form of protection but none at all.
  //
  // Today this changes nothing: shouldWatermark() refuses all 112 assets in the
  // library, so every one of them still publishes its master exactly as before.
  // It arms itself on the first owned photograph.
  const { data: derivRows, error: derivError } = await supabase
    .from("media_derivatives")
    .select("id, storage_path, watermarked, width, crop, format")
    .eq("media_asset_id", id);
  // A failed read must not be treated as "no derivatives exist" — that would
  // turn a transient error into a publish refusal, or worse, into publishing
  // the master for an asset that has perfectly good marked derivatives.
  if (derivError) return { error: `Publish failed reading derivatives: ${derivError.message}` };

  const publication = resolvePublicationSource(
    asset,
    (derivRows ?? []).map((d) => ({
      id: d.id,
      storagePath: d.storage_path,
      watermarked: d.watermarked,
      width: d.width,
      crop: d.crop,
      format: d.format,
    }))
  );
  if (!publication.allowed) return { error: publication.reason };

  const { error: copyError } = await supabase.storage
    .from(MEDIA_PRIVATE_BUCKET)
    .copy(publication.source.storagePath, publication.source.storagePath, {
      destinationBucket: MEDIA_PUBLIC_BUCKET,
    });

  if (copyError) {
    return { error: `Publish failed: ${copyError.message}` };
  }

  const { error: updateError } = await supabase
    .from("media_assets")
    .update({
      publication_status: "published",
      // The path of what was ACTUALLY copied, which for an owned original is
      // the derivative. Recording the master here while copying a derivative
      // would make unpublish remove the wrong object and leave the public copy
      // orphaned in the bucket.
      public_storage_path: publication.source.storagePath,
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

// Associations write ONLY to the join table. They never touch media_assets, so
// an association edit cannot change source type, ownership, licence,
// modification permission or verification state — the separation is structural,
// not a convention to remember.
//
// They return FormState rather than throwing for the same reason
// updateMediaProvenance now does: a thrown Server Action reaches the admin as a
// masked React #441 with no message.
export async function updateMediaProductAssociations(
  mediaId: string,
  productIds: string[],
  _prev: FormState,
  formData: FormData
): Promise<FormState> {
  await requireAdmin();
  const supabase = await createClient();

  const { error: deleteError } = await supabase.from("product_media").delete().eq("media_id", mediaId);
  if (deleteError) return { error: deleteError.message };

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
    if (insertError) return { error: insertError.message };
  }

  revalidatePath(`/admin/media/${mediaId}`);
  return { error: null };
}

export async function updateMediaContentAssociations(
  mediaId: string,
  contentIds: string[],
  _prev: FormState,
  formData: FormData
): Promise<FormState> {
  await requireAdmin();
  const supabase = await createClient();

  const { error: deleteError } = await supabase.from("content_media").delete().eq("media_id", mediaId);
  if (deleteError) return { error: deleteError.message };

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
    if (insertError) return { error: insertError.message };
  }

  revalidatePath(`/admin/media/${mediaId}`);
  return { error: null };
}
