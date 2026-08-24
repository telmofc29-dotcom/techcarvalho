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
import { checkUploadCandidate, isIssuedStoragePath, sanitizeFileName } from "@/lib/media/upload-limits";
import { getAdminPreviewUrl } from "@/lib/media/admin-preview-url";
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

// The two Server Actions that used to receive the file itself —
// uploadMediaAsset and uploadMediaAssetBatchItem — have been REMOVED, not left
// unused. Both took the binary as FormData, so both carried Next's 1 MB body
// cap and, underneath it, Vercel's 4.5 MB function limit. Keeping a working
// upload path with those ceilings still wired to it is how the same failure
// comes back the next time someone reaches for "the upload action".
//
// Uploading now goes through createMediaUploadTicket + finaliseMediaUpload
// below, which never carry the bytes.

// ---------------------------------------------------------------------------
// Direct-to-storage upload
// ---------------------------------------------------------------------------
//
// WHY THE BINARY NO LONGER GOES THROUGH A SERVER ACTION
// ----------------------------------------------------
// uploadMediaAssetBatchItem above receives the whole file as FormData, which
// means every byte crosses a Vercel function. Two ceilings sit in that path:
//
//   * Next caps a Server Action body at 1 MB by default. Exceeding it throws
//     "Body exceeded 1 MB limit" (413), which React masks as #441 — the failure
//     the owner hit on every real photograph.
//   * Vercel caps a function request body at 4.5 MB, plan-independent, and
//     returns 413 FUNCTION_PAYLOAD_TOO_LARGE. Raising Next's bodySizeLimit
//     CANNOT get past this; the platform rejects the request before the
//     function runs.
//
// So a 20 MB ceiling is unreachable while the bytes pass through Vercel, no
// matter how the framework is configured. The binary now goes browser ->
// Supabase Storage directly, using a short-lived signed URL that the server
// mints. Vercel only ever sees small JSON.
//
// WHAT STAYS ENFORCED SERVER-SIDE
//   * Admin authentication — the ticket is only issued to an admin.
//   * The storage path is generated HERE, never accepted from the client.
//   * Size and MIME are validated here as well as in the browser.
//   * The row is only created after the object is confirmed to exist.
//   * All rights/provenance validation is unchanged, and nothing is published.

/** Result of recording an uploaded object in the library. */
export type BatchUploadResult = { id: string; error: null } | { id: null; error: string };

export type UploadTicket =
  | { path: string; token: string; error: null }
  | { path: null; token: null; error: string };

/**
 * Authorise one direct upload into the private bucket.
 *
 * The returned token is scoped by Supabase to exactly the path issued here, so
 * a client cannot redirect it at another object. The path embeds a fresh uuid,
 * so it cannot collide with or overwrite an existing master.
 */
export async function createMediaUploadTicket(
  fileName: string,
  fileType: string,
  fileSize: number
): Promise<UploadTicket> {
  await requireAdmin();

  // Re-validated server-side. The browser checks the same rules first so the
  // admin gets an instant message, but a client-side check is a courtesy and
  // never a control.
  const check = checkUploadCandidate({ name: fileName, type: fileType, size: fileSize });
  if (!check.ok) return { path: null, token: null, error: check.error };

  const safeName = sanitizeFileName(fileName) || "upload";
  const path = `${check.mediaType}/${crypto.randomUUID()}-${safeName}`;

  const supabase = await createClient();
  const { data, error } = await supabase.storage.from(MEDIA_PRIVATE_BUCKET).createSignedUploadUrl(path);
  if (error || !data) {
    return { path: null, token: null, error: error?.message ?? "Could not authorise the upload." };
  }

  return { path, token: data.token, error: null };
}

/**
 * Create the media_assets row for an object that has already been uploaded.
 *
 * Called only after the browser reports a successful direct upload — and it
 * does not take that report on trust. The object is confirmed to exist in the
 * private bucket before any row is written, so a record can never claim an
 * upload that did not happen.
 */
export async function finaliseMediaUpload(formData: FormData): Promise<BatchUploadResult> {
  const admin = await requireAdmin();

  const path = String(formData.get("storage_path") ?? "").trim();

  // The path must look like one this application issued. Combined with the
  // duplicate check below, this stops a finalise call from attaching a new row
  // to an existing master or to an arbitrary object elsewhere in the bucket.
  if (!isIssuedStoragePath(path)) {
    return { id: null, error: "Invalid storage path." };
  }

  const supabase = await createClient();

  const { data: existingRow } = await supabase
    .from("media_assets")
    .select("id")
    .eq("storage_path", path)
    .maybeSingle();
  if (existingRow) {
    return { id: null, error: "This file has already been recorded in the library." };
  }

  // Confirm the object is really there. list() on the parent prefix with an
  // exact name filter is the cheapest existence check the storage API offers.
  const slash = path.indexOf("/");
  const prefix = path.slice(0, slash);
  const objectName = path.slice(slash + 1);
  const { data: found, error: listError } = await supabase.storage
    .from(MEDIA_PRIVATE_BUCKET)
    .list(prefix, { search: objectName, limit: 1 });
  if (listError) return { id: null, error: `Could not verify the upload: ${listError.message}` };
  if (!found || !found.some((o) => o.name === objectName)) {
    return { id: null, error: "The uploaded file could not be found in storage, so no record was created." };
  }

  const meta = readMetadata(formData);
  if ("error" in meta) return { id: null, error: meta.error };
  const payload = stampModificationAssessment(meta.payload, admin.id, new Date().toISOString());

  const { data, error: insertError } = await supabase
    .from("media_assets")
    .insert({ storage_path: path, ...payload })
    .select("id")
    .single();

  if (insertError && isPendingMigrationRoleViolation(insertError.code, meta.payload.asset_role)) {
    await supabase.storage.from(MEDIA_PRIVATE_BUCKET).remove([path]);
    return {
      id: null,
      error:
        "This editorial role is not yet accepted by the database. Apply the pending migration for it, then upload " +
        "again. The file was not kept.",
    };
  }
  if (insertError || !data) {
    // No orphans: if the row cannot be written, the object it would have
    // described is removed rather than left in the bucket unreferenced.
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

/**
 * One target whose hero slot is already occupied by a DIFFERENT asset.
 *
 * Returned to the form so the admin can decide, instead of the server picking
 * for them — which is what produced two hero rows on ps5-vs-ps5-pro-worth-it.
 */
export type HeroCollision = {
  targetId: string;
  targetLabel: string;
  currentHeroMediaId: string;
  currentHeroAlt: string | null;
  currentHeroPreviewUrl: string | null;
  currentHeroDescriptor: string;
};

export type AssociationState = {
  error: string | null;
  /** Present when the save stopped to ask. Nothing has been written yet. */
  collisions?: HeroCollision[];
  /**
   * The roles the admin asked for, echoed back so the confirmation submit can
   * resend them as hidden inputs.
   *
   * Needed because the role <select>s are server-rendered with a defaultValue
   * taken from the database. When the collision panel re-renders the form, the
   * newly chosen "hero" is not in that defaultValue, so relying on the DOM to
   * still hold it made the second submit silently send the OLD roles — the
   * decision was applied to an empty request and nothing changed.
   */
  pendingRoles?: { targetId: string; role: MediaRole }[];
  /** Set after a save that actually changed something. */
  savedAt?: string;
};

const HERO_DECISIONS = new Set(["replace", "add_to_gallery", "cancel"]);

/**
 * Save this asset's associations to products or articles.
 *
 * WHY THIS IS NOT A PLAIN DELETE-AND-REINSERT ANY MORE
 * ----------------------------------------------------
 * It used to delete every row for THIS ASSET and re-insert from the form. That
 * is correct for the asset's own rows and completely blind to the slot: giving
 * asset B the hero role never touched asset A's hero row, so the target ended
 * up with two heroes and the public page picked one arbitrarily.
 *
 * Now, before writing anything, every target being given the hero role is
 * checked for an existing hero held by a different asset. If any are found the
 * whole save STOPS and returns them for a decision. Nothing is partially
 * applied — a half-saved batch is worse than one that asked first.
 */
async function saveAssociations(input: {
  kind: "product" | "content";
  mediaId: string;
  targetIds: string[];
  formData: FormData;
}): Promise<AssociationState> {
  await requireAdmin();
  const { kind, mediaId, targetIds, formData } = input;

  const table = kind === "product" ? "product_media" : "content_media";
  const targetColumn = kind === "product" ? "product_id" : "content_id";

  const supabase = await createClient();

  // What the form is asking for, per target.
  const desired = new Map<string, MediaRole>();
  for (const targetId of targetIds) {
    const role = String(formData.get(`role_${targetId}`) ?? "");
    if (VALID_ROLES.includes(role as MediaRole)) desired.set(targetId, role as MediaRole);
  }
  // Roles carried over from the collision step take precedence over whatever
  // the (stale) selects submitted. See AssociationState.pendingRoles.
  for (const [key, value] of formData.entries()) {
    if (!key.startsWith("pending_role_")) continue;
    const targetId = key.slice("pending_role_".length);
    const role = String(value);
    if (VALID_ROLES.includes(role as MediaRole)) desired.set(targetId, role as MediaRole);
  }

  const wantsHeroOn = [...desired.entries()].filter(([, role]) => role === "hero").map(([id]) => id);

  const collisions: HeroCollision[] = [];
  const decisions = new Map<string, string>();
  const plannedDemotions: { targetId: string; mediaId: string }[] = [];

  if (wantsHeroOn.length > 0) {
    // Queried per kind rather than through the union, so the column names stay
    // statically checked against each table instead of being cast.
    const heroQuery =
      kind === "product"
        ? await supabase.from("product_media").select("product_id, media_id").in("product_id", wantsHeroOn).eq("role", "hero")
        : await supabase.from("content_media").select("content_id, media_id").in("content_id", wantsHeroOn).eq("role", "hero");
    if (heroQuery.error) return { error: heroQuery.error.message };

    const rows = (heroQuery.data ?? []) as unknown as Record<string, string>[];
    const foreignHeroes = rows.filter((r) => r.media_id !== mediaId);

    if (foreignHeroes.length > 0) {
      const heroAssetIds = [...new Set(foreignHeroes.map((r) => r.media_id))];
      const { data: heroAssets } = await supabase.from("media_assets").select("*").in("id", heroAssetIds);
      const assetById = new Map((heroAssets ?? []).map((a) => [a.id, a]));

      const labels = await targetLabels(
        supabase,
        kind,
        foreignHeroes.map((r) => r[targetColumn])
      );

      for (const row of foreignHeroes) {
        const targetId = row[targetColumn];
        const decision = String(formData.get("hero_decision_" + targetId) ?? "");

        if (!HERO_DECISIONS.has(decision)) {
          const asset = assetById.get(row.media_id);
          collisions.push({
            targetId,
            targetLabel: labels.get(targetId) ?? targetId,
            currentHeroMediaId: row.media_id,
            currentHeroAlt: asset?.alt_text ?? null,
            currentHeroPreviewUrl: asset ? await getAdminPreviewUrl(asset) : null,
            currentHeroDescriptor: describeAsset(asset),
          });
          continue;
        }

        decisions.set(targetId, decision);
        if (decision === "replace") plannedDemotions.push({ targetId, mediaId: row.media_id });
      }
    }
  }

  if (collisions.length > 0) {
    // Nothing written. The admin has to choose first.
    return {
      error: null,
      collisions,
      pendingRoles: [...desired.entries()].map(([targetId, role]) => ({ targetId, role })),
    };
  }

  // Apply decisions to the OTHER asset's rows before touching our own.
  for (const demotion of plannedDemotions) {
    // A displaced hero is DEMOTED, never deleted: the asset keeps its rights,
    // its provenance and its attachment to the thing it illustrates. Losing the
    // hero slot is not a reason to throw a picture away.
    const demote =
      kind === "product"
        ? await supabase
            .from("product_media")
            .update({ role: "gallery" as MediaRole })
            .eq("product_id", demotion.targetId)
            .eq("media_id", demotion.mediaId)
            .eq("role", "hero")
        : await supabase
            .from("content_media")
            .update({ role: "gallery" as MediaRole })
            .eq("content_id", demotion.targetId)
            .eq("media_id", demotion.mediaId)
            .eq("role", "hero");
    if (demote.error) return { error: "Could not move the existing hero to the gallery: " + demote.error.message };
  }

  for (const [targetId, decision] of decisions) {
    if (decision === "cancel") desired.delete(targetId);
    if (decision === "add_to_gallery") desired.set(targetId, "gallery");
  }

  const { error: deleteError } = await supabase.from(table).delete().eq("media_id", mediaId);
  if (deleteError) return { error: deleteError.message };

  const links = [...desired.entries()].map(([targetId, role]) => ({
    media_id: mediaId,
    [targetColumn]: targetId,
    role,
  }));

  if (links.length > 0) {
    const { error: insertError } = await supabase.from(table).insert(links as never);
    if (insertError) return { error: insertError.message };
  }

  revalidatePath("/admin/media/" + mediaId);
  revalidatePath("/admin/media");
  return { error: null, savedAt: new Date().toISOString() };
}

/** Human labels for the targets named in a collision. */
async function targetLabels(
  supabase: Awaited<ReturnType<typeof createClient>>,
  kind: "product" | "content",
  ids: string[]
): Promise<Map<string, string>> {
  const unique = [...new Set(ids)];
  if (unique.length === 0) return new Map();
  if (kind === "product") {
    const { data } = await supabase.from("products").select("id, name").in("id", unique);
    return new Map((data ?? []).map((r) => [r.id, r.name]));
  }
  const { data } = await supabase.from("content_items").select("id, title").in("id", unique);
  return new Map((data ?? []).map((r) => [r.id, r.title]));
}

/** Short "what this asset is" line, so a collision panel is informative. */
function describeAsset(
  asset: { asset_role?: string | null; source_type?: string | null; publication_status?: string | null } | undefined
): string {
  if (!asset) return "unknown asset";
  const parts = [
    asset.asset_role ? asset.asset_role.replace(/_/g, " ") : "no editorial role",
    asset.source_type ? asset.source_type.replace(/_/g, " ") : "no source type",
  ];
  if (asset.publication_status !== "published") parts.push("NOT PUBLISHED - cannot render");
  return parts.join(" · ");
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
  _prev: AssociationState,
  formData: FormData
): Promise<AssociationState> {
  return saveAssociations({
    kind: "product",
    mediaId,
    targetIds: productIds,
    formData,
  });
}

export async function updateMediaContentAssociations(
  mediaId: string,
  contentIds: string[],
  _prev: AssociationState,
  formData: FormData
): Promise<AssociationState> {
  return saveAssociations({
    kind: "content",
    mediaId,
    targetIds: contentIds,
    formData,
  });
}
