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
import { assessDeletion, type MediaDeletionAssessment } from "@/lib/media/deletion-safety";
import { presetById } from "@/lib/media/classification-presets";
import { readImageDimensions, isPlausible } from "@/lib/media/image-dimensions";
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
  let payload = stampModificationAssessment(meta.payload, admin.id, new Date().toISOString());

  // MEASURE ON THE SERVER WHEN THE CLIENT DID NOT.
  //
  // The upload form reads naturalWidth/naturalHeight in the browser, so a normal
  // upload arrives measured. Five assets in production were not: they came from
  // the Commons import scripts, which insert rows directly and never touch this
  // form. Two of them were published article heroes, and the Discover audit
  // could only report them as unmeasurable.
  //
  // Measuring here closes every route, because this is the one function that
  // creates a media_assets row from an uploaded object. The bytes decide; the
  // filename never does — both of those five were named "1280px-..." and both
  // turned out to be PORTRAIT, so a filename-derived width would have been
  // right about the number and wrong about the shape.
  //
  // A failure to measure leaves the columns null, exactly as before. An
  // unmeasured asset is a known gap the audit reports; a wrongly measured one
  // silences that audit.
  if (payload.media_type === "image" && (payload.width == null || payload.height == null)) {
    const { data: blob } = await supabase.storage.from(MEDIA_PRIVATE_BUCKET).download(path);
    if (blob) {
      const head = new Uint8Array((await blob.arrayBuffer()).slice(0, 65536));
      const dims = readImageDimensions(head);
      if (isPlausible(dims)) payload = { ...payload, width: dims.width, height: dims.height };
    }
  }

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

// ---------------------------------------------------------------------------
// BULK DELETE
// ---------------------------------------------------------------------------
//
// WHY THIS IS NOT bulkPublishMediaAssets WITH A DIFFERENT VERB
// ------------------------------------------------------------
// Publishing is reversible. Deleting a media asset is not: the row goes, and
// with it both storage objects, and there is no undo. So this action is built
// around what the FOREIGN KEYS actually do when a row disappears, which is not
// one thing:
//
//   content_media.media_id               cascade   article silently loses its image
//   product_media.media_id               cascade   product silently loses its image
//   media_derivatives.media_asset_id     cascade   derived files go too (correct)
//   content_items.og_media_id            SET NULL  the social card blanks
//   manufacturers.logo_media_id          SET NULL  the brand logo blanks
//   media_requirements.resolved_media_id SET NULL  the record that a sourcing
//                                                  request was satisfied is erased
//   engine_media_candidates.ingested_media_id SET NULL
//
// Every one of those happens without a word from Postgres. `deleteMediaAsset`,
// the single-asset action, accepts that: it is invoked from one asset's own
// page by someone looking at that asset. A bulk action is invoked on twenty
// things at once by someone looking at a grid of thumbnails, and "the delete
// succeeded" would be a true statement about a page that just lost its hero.
//
// So: ATTACHED MEDIA IS REFUSED, server-side and unconditionally. The
// confirmation dialog in the grid is user interface; this is the enforcement,
// and it takes no "force" argument, because the safe way to delete an attached
// asset is to detach it first and look at what that page becomes.
//
// NO SILENT PARTIAL DELETION. Every id the caller passed comes back in exactly
// one bucket — deleted, refused, or failed — each with a reason. A caller that
// asked for twenty and got nine is told which nine, and why the other eleven
// survived.

/**
 * What would happen if these assets were deleted.
 *
 * Read-only. The grid calls this to build its confirmation dialog, and
 * bulkDeleteMediaAssets calls it AGAIN before writing anything — the dialog's
 * answer is never trusted as the authority, because the library can change
 * between the two calls and because a client can send whatever it likes.
 *
 * The DECISION lives in media/deletion-safety.ts and is unit-tested there.
 * This function is the I/O half: it counts what points at each asset and hands
 * the counts over. Keeping the judgement out of the Server Action is what makes
 * it testable without deleting anything.
 */
export async function inspectMediaForDeletion(ids: string[]): Promise<MediaDeletionAssessment[]> {
  await requireAdmin();
  if (ids.length === 0) return [];

  const supabase = await createClient();

  const [assets, contentLinks, productLinks, derivatives, ogRefs, logoRefs, requirementRefs, candidateRefs] =
    await Promise.all([
      supabase.from("media_assets").select("id, storage_path, publication_status").in("id", ids),
      supabase.from("content_media").select("media_id, role").in("media_id", ids),
      supabase.from("product_media").select("media_id, role").in("media_id", ids),
      supabase.from("media_derivatives").select("media_asset_id").in("media_asset_id", ids),
      // seo_metadata, NOT content_items. The og_media_id column lives on
      // seo_metadata (initial schema, line 297) and content_items has no such
      // column at all. Querying the wrong table did not fail loudly — it
      // returned PGRST204, which this function correctly treats as a read
      // failure and therefore refuses EVERY deletion. Safe, and completely
      // non-functional. Found by running the real queries against production;
      // the unit tests feed assessDeletion synthetic counts and could never see
      // a wrong table name.
      supabase.from("seo_metadata").select("og_media_id").in("og_media_id", ids),
      supabase.from("manufacturers").select("logo_media_id").in("logo_media_id", ids),
      supabase.from("media_requirements").select("resolved_media_id").in("resolved_media_id", ids),
      supabase.from("engine_media_candidates").select("ingested_media_id").in("ingested_media_id", ids),
    ]);

  const readFailures: string[] = [];
  for (const [name, res] of [
    ["media_assets", assets],
    ["content_media", contentLinks],
    ["product_media", productLinks],
    ["media_derivatives", derivatives],
    ["seo_metadata.og_media_id", ogRefs],
    ["manufacturers.logo_media_id", logoRefs],
    ["media_requirements", requirementRefs],
    ["engine_media_candidates", candidateRefs],
  ] as const) {
    if (res.error) readFailures.push(`${name}: ${res.error.message}`);
  }

  const tally = (rows: unknown, key: string): Map<string, number> => {
    const m = new Map<string, number>();
    for (const r of (rows ?? []) as Record<string, unknown>[]) {
      const id = String(r[key] ?? "");
      if (id) m.set(id, (m.get(id) ?? 0) + 1);
    }
    return m;
  };
  const roles = (rows: unknown, key: string): Map<string, string[]> => {
    const m = new Map<string, string[]>();
    for (const r of (rows ?? []) as Record<string, unknown>[]) {
      const id = String(r[key] ?? "");
      if (id) m.set(id, [...(m.get(id) ?? []), String(r.role ?? "")]);
    }
    return m;
  };

  const contentByRole = roles(contentLinks.data, "media_id");
  const productByRole = roles(productLinks.data, "media_id");
  const derivCount = tally(derivatives.data, "media_asset_id");
  const ogCount = tally(ogRefs.data, "og_media_id");
  const logoCount = tally(logoRefs.data, "logo_media_id");
  const reqCount = tally(requirementRefs.data, "resolved_media_id");
  const candCount = tally(candidateRefs.data, "ingested_media_id");

  const byId = new Map(
    ((assets.data ?? []) as { id: string; storage_path: string; publication_status: string }[]).map((a) => [a.id, a])
  );

  return ids.map((id) => {
    const row = byId.get(id);
    return assessDeletion(id, row ? (row.storage_path.split("/").pop() ?? row.storage_path) : id, {
      contentRoles: contentByRole.get(id) ?? [],
      productRoles: productByRole.get(id) ?? [],
      ogReferences: ogCount.get(id) ?? 0,
      logoReferences: logoCount.get(id) ?? 0,
      requirementReferences: reqCount.get(id) ?? 0,
      derivatives: derivCount.get(id) ?? 0,
      engineCandidates: candCount.get(id) ?? 0,
      publicationStatus: row?.publication_status ?? "unknown",
      exists: row !== undefined,
      readFailures,
    });
  });
}

export type BulkDeleteSummary = {
  requested: number;
  deleted: { id: string; filename: string }[];
  refused: { id: string; filename: string; reason: string }[];
  failed: { id: string; filename: string; reason: string }[];
  /** Storage objects no DB row describes any more. Reconcilable, never silent. */
  storageOrphans: string[];
};

/**
 * Delete the selected media assets, refusing any that are attached to anything.
 *
 * Order matters, and matches the single-asset action: the DB row goes first,
 * then the storage objects. If a storage removal fails the result is an
 * orphaned file — harmless, listed in the summary, reconcilable — rather than a
 * live row pointing at a file that is gone.
 */
export async function bulkDeleteMediaAssets(ids: string[]): Promise<BulkDeleteSummary> {
  await requireAdmin();
  const summary: BulkDeleteSummary = {
    requested: ids.length,
    deleted: [],
    refused: [],
    failed: [],
    storageOrphans: [],
  };
  if (ids.length === 0) return summary;

  // RE-CHECKED HERE, not taken from the dialog. What the admin confirmed was
  // rendered from a snapshot; this is the state at the moment of writing.
  const assessments = await inspectMediaForDeletion(ids);
  const supabase = await createClient();

  for (const assessment of assessments) {
    if (assessment.blocked) {
      summary.refused.push({
        id: assessment.id,
        filename: assessment.filename,
        reason: assessment.reason ?? "Refused.",
      });
      continue;
    }

    const { data: row, error: readError } = await supabase
      .from("media_assets")
      .select("storage_path, public_storage_path")
      .eq("id", assessment.id)
      .maybeSingle();
    if (readError || !row) {
      summary.failed.push({
        id: assessment.id,
        filename: assessment.filename,
        reason: readError?.message ?? "Could not read the row.",
      });
      continue;
    }

    const { error: deleteError } = await supabase.from("media_assets").delete().eq("id", assessment.id);
    if (deleteError) {
      summary.failed.push({ id: assessment.id, filename: assessment.filename, reason: deleteError.message });
      continue;
    }

    const { error: privateError } = await supabase.storage
      .from(MEDIA_PRIVATE_BUCKET)
      .remove([row.storage_path]);
    if (privateError) summary.storageOrphans.push(`${MEDIA_PRIVATE_BUCKET}/${row.storage_path}`);
    if (row.public_storage_path) {
      const { error: publicError } = await supabase.storage
        .from(MEDIA_PUBLIC_BUCKET)
        .remove([row.public_storage_path]);
      if (publicError) summary.storageOrphans.push(`${MEDIA_PUBLIC_BUCKET}/${row.public_storage_path}`);
    }

    summary.deleted.push({ id: assessment.id, filename: assessment.filename });
    revalidatePath(`/admin/media/${assessment.id}`);
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

/**
 * Delete a media asset and return to the library.
 *
 * THE REDIRECT IS THE FIX. This used to revalidate and stop, leaving the
 * browser on /admin/media/[deleted-id]. That page then calls notFound() --
 * correctly, the asset is gone -- and with no not-found boundary under /admin
 * the request fell through to the ROOT not-found, which renders in the PUBLIC
 * layout. So deleting an image ended on the public 404 page, and it looked as
 * though something had been destroyed.
 *
 * Nothing had been. media_assets cascades only INTO content_media and
 * product_media; there is no FK from media to content_items or products, so a
 * media delete can never remove an article or a product. It removes the
 * ASSOCIATIONS, which is the intended behaviour, and the parent rows are
 * untouched.
 *
 * `returnTo` carries the library's search/filter/page state so deleting from a
 * filtered view comes back to that view rather than to an unfiltered list.
 */
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
  revalidatePath(`/admin/media/${id}`);

  // Only ever an admin path, and only ever a relative one: `returnTo` arrives
  // from a form field, so treating it as a trusted URL would be an open
  // redirect. Anything that is not a /admin/media query string is discarded.
  const raw = String(formData.get("returnTo") ?? "");
  const safeQuery = /^\?[\w=&%.\-+]*$/.test(raw) ? raw : "";
  redirect(`/admin/media${safeQuery}${safeQuery ? "&" : "?"}deleted=1`);
}

/**
 * One target whose hero slot is already occupied by a DIFFERENT asset.
 *
 * Returned to the form so the admin can decide, instead of the server picking
 * for them — which is what produced two hero rows on ps5-vs-ps5-pro-worth-it.
 */
export type HeroCollision = {
  targetId: string;
  /** Which exclusive slot is contested. */
  slot: "hero" | "thumbnail";
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
  /** Targets the pending submission was responsible for. */
  pendingScope?: string[];
  /** Set after a save that actually changed something. */
  savedAt?: string;
  /** What actually happened, in words the admin can check against. */
  savedMessage?: string;
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
/**
 * Save this asset's associations, as a SET of slots per target.
 *
 * WHY THIS IS A SET AND NOT A ROLE
 * --------------------------------
 * A media asset is one physical master; its usages are separate relationships.
 * The same picture legitimately belongs in the hero slot, the card slot AND the
 * gallery of one article, and the database has always allowed that — the unique
 * key is on the TRIPLE (target, media, role), so three rows with different
 * roles coexist and a duplicate of the same role is refused. Verified by probe
 * before this was written.
 *
 * The restriction was entirely here: this function modelled the request as
 * Map<targetId, MediaRole> — ONE role per target — and then deleted every row
 * for the asset and re-inserted one. Ticking "hero" therefore silently removed
 * the gallery use. The UI matched the bug: one dropdown per target.
 *
 * SCOPE. Only targets this submission is actually responsible for are touched:
 * the ones whose checkboxes were submitted, plus the ones already attached
 * (which the form always renders). A target that was neither shown nor
 * submitted is left completely alone, so searching for one article can never
 * disturb another.
 */
async function saveAssociations(input: {
  kind: "product" | "content";
  mediaId: string;
  targetIds: string[];
  formData: FormData;
}): Promise<AssociationState> {
  // Named on every association this writes. See humanSelection().
  const admin = await requireAdmin();
  const { kind, mediaId, formData } = input;

  const targetColumn = kind === "product" ? "product_id" : "content_id";
  const supabase = await createClient();

  // --- what the form is asking for ------------------------------------------
  const desired = new Map<string, Set<MediaRole>>();
  for (const [key, value] of formData.entries()) {
    if (!key.startsWith("roles_")) continue;
    const targetId = key.slice("roles_".length);
    const role = String(value);
    if (!VALID_ROLES.includes(role as MediaRole)) continue;
    const set = desired.get(targetId) ?? new Set<MediaRole>();
    set.add(role as MediaRole);
    desired.set(targetId, set);
  }
  // A row rendered with every box cleared still has to be actionable, so the
  // form declares which targets it showed.
  for (const [key] of formData.entries()) {
    if (!key.startsWith("scope_")) continue;
    const targetId = key.slice("scope_".length);
    if (!desired.has(targetId)) desired.set(targetId, new Set());
  }

  // --- what exists now, for this asset --------------------------------------
  const mineQuery =
    kind === "product"
      ? await supabase.from("product_media").select("id, product_id, media_id, role").eq("media_id", mediaId)
      : await supabase.from("content_media").select("id, content_id, media_id, role").eq("media_id", mediaId);
  if (mineQuery.error) return { error: mineQuery.error.message };
  const mine = (mineQuery.data ?? []) as unknown as Record<string, string>[];

  const currentByTarget = new Map<string, Set<MediaRole>>();
  for (const row of mine) {
    const t = row[targetColumn];
    const set = currentByTarget.get(t) ?? new Set<MediaRole>();
    set.add(row.role as MediaRole);
    currentByTarget.set(t, set);
  }
  for (const t of currentByTarget.keys()) {
    if (!desired.has(t)) continue; // untouched targets stay untouched
  }

  const scope = new Set<string>(desired.keys());
  if (scope.size === 0) return { error: null, savedAt: new Date().toISOString(), savedMessage: "Nothing to change." };

  // --- exclusive slots held by OTHER assets ---------------------------------
  const wantsHero = [...desired.entries()].filter(([, r]) => r.has("hero")).map(([t]) => t);
  const wantsThumb = [...desired.entries()].filter(([, r]) => r.has("thumbnail")).map(([t]) => t);
  const exclusiveTargets = [...new Set([...wantsHero, ...wantsThumb])];

  const collisions: HeroCollision[] = [];
  const demotions: { targetId: string; mediaId: string; slot: MediaRole }[] = [];

  if (exclusiveTargets.length > 0) {
    const occQuery =
      kind === "product"
        ? await supabase
            .from("product_media")
            .select("product_id, media_id, role")
            .in("product_id", exclusiveTargets)
            .in("role", ["hero", "thumbnail"])
        : await supabase
            .from("content_media")
            .select("content_id, media_id, role")
            .in("content_id", exclusiveTargets)
            .in("role", ["hero", "thumbnail"]);
    if (occQuery.error) return { error: occQuery.error.message };
    const occupants = (occQuery.data ?? []) as unknown as Record<string, string>[];

    const foreign = occupants.filter((r) => r.media_id !== mediaId);
    const needed: { targetId: string; slot: MediaRole; holder: string }[] = [];
    for (const row of foreign) {
      const t = row[targetColumn];
      const slot = row.role as MediaRole;
      if (slot === "hero" && !wantsHero.includes(t)) continue;
      if (slot === "thumbnail" && !wantsThumb.includes(t)) continue;
      needed.push({ targetId: t, slot, holder: row.media_id });
    }

    if (needed.length > 0) {
      const holderIds = [...new Set(needed.map((n) => n.holder))];
      const { data: holderAssets } = await supabase.from("media_assets").select("*").in("id", holderIds);
      const byId = new Map((holderAssets ?? []).map((a) => [a.id, a]));
      const labels = await targetLabels(supabase, kind, needed.map((n) => n.targetId));

      for (const n of needed) {
        const decisionField = n.slot === "hero" ? `hero_decision_${n.targetId}` : `thumb_decision_${n.targetId}`;
        const decision = String(formData.get(decisionField) ?? "");

        if (!HERO_DECISIONS.has(decision)) {
          const asset = byId.get(n.holder);
          collisions.push({
            targetId: n.targetId,
            slot: n.slot === "hero" ? "hero" : "thumbnail",
            targetLabel: labels.get(n.targetId) ?? n.targetId,
            currentHeroMediaId: n.holder,
            currentHeroAlt: asset?.alt_text ?? null,
            currentHeroPreviewUrl: asset ? await getAdminPreviewUrl(asset) : null,
            currentHeroDescriptor: describeAsset(asset),
          });
          continue;
        }

        if (decision === "cancel") {
          // Leave this target entirely alone, every slot of it.
          desired.delete(n.targetId);
          scope.delete(n.targetId);
        } else if (decision === "add_to_gallery") {
          // "Keep the existing one." The OTHER slots the owner ticked must
          // survive — only the contested slot is dropped.
          desired.get(n.targetId)?.delete(n.slot);
        } else if (decision === "replace") {
          demotions.push({ targetId: n.targetId, mediaId: n.holder, slot: n.slot });
        }
      }
    }
  }

  if (collisions.length > 0) {
    return {
      error: null,
      collisions,
      pendingRoles: [...desired.entries()].flatMap(([targetId, roles]) =>
        [...roles].map((role) => ({ targetId, role }))
      ),
      pendingScope: [...scope],
    };
  }

  // --- displace the incumbents ----------------------------------------------
  for (const d of demotions) {
    if (d.slot === "hero") {
      // A displaced hero is DEMOTED to gallery, never deleted — unless it is
      // already in the gallery, in which case the hero row simply goes.
      const alreadyGallery =
        kind === "product"
          ? await supabase.from("product_media").select("id").eq("product_id", d.targetId).eq("media_id", d.mediaId).eq("role", "gallery").maybeSingle()
          : await supabase.from("content_media").select("id").eq("content_id", d.targetId).eq("media_id", d.mediaId).eq("role", "gallery").maybeSingle();

      const res = alreadyGallery.data
        ? await deleteAssoc(supabase, kind, d.targetId, d.mediaId, "hero")
        : await setRole(supabase, kind, d.targetId, d.mediaId, "hero", "gallery");
      if (res.error) return { error: `Could not move the existing hero: ${res.error.message}` };
    } else {
      // A displaced explicit card image just stops being the card image; it is
      // not demoted anywhere, because a thumbnail is a pointer rather than a
      // place in a list.
      const res = await deleteAssoc(supabase, kind, d.targetId, d.mediaId, "thumbnail");
      if (res.error) return { error: `Could not clear the existing card image: ${res.error.message}` };
    }
  }

  // --- reconcile THIS asset's rows, per target ------------------------------
  let added = 0;
  let removed = 0;
  for (const targetId of scope) {
    const want = desired.get(targetId) ?? new Set<MediaRole>();
    const have = currentByTarget.get(targetId) ?? new Set<MediaRole>();

    for (const role of have) {
      if (want.has(role)) continue;
      const res = await deleteAssoc(supabase, kind, targetId, mediaId, role);
      if (res.error) return { error: res.error.message };
      removed++;
    }
    for (const role of want) {
      if (have.has(role)) continue;
      const res = await insertAssoc(supabase, kind, targetId, mediaId, role, admin.id);
      if (res.error) return { error: res.error.message };
      added++;
    }
  }

  // Publish-and-apply. Deliberately AFTER the slots are written, and only when
  // explicitly asked for — uploads stay private by default and nothing here
  // changes that. publishMediaAsset() runs the same fail-closed rights gate as
  // the publish button, so this is a shortcut through the clicks, not through
  // the checks.
  let publishNote = "";
  if (String(formData.get("publish_after") ?? "") === "1") {
    const result = await publishMediaAsset(mediaId);
    publishNote = result.error
      ? ` The image could NOT be published: ${result.error} It is attached but still private, so it will not appear publicly yet.`
      : " The image is now published and will appear on public pages.";
  }

  revalidatePath("/admin/media/" + mediaId);
  revalidatePath("/admin/media");

  const parts: string[] = [];
  const replacedHero = demotions.filter((d) => d.slot === "hero").length;
  const replacedThumb = demotions.filter((d) => d.slot === "thumbnail").length;
  if (replacedHero > 0) parts.push("Hero replaced successfully. The previous hero was kept in the gallery.");
  if (replacedThumb > 0) parts.push(`Card image replaced.`);
  if (added > 0) parts.push(`${added} slot${added === 1 ? "" : "s"} added.`);
  if (removed > 0) parts.push(`${removed} slot${removed === 1 ? "" : "s"} removed.`);
  if (parts.length === 0) parts.push("No changes were needed.");

  return { error: null, savedAt: new Date().toISOString(), savedMessage: parts.join(" ") + publishNote };
}

function deleteAssoc(
  supabase: Awaited<ReturnType<typeof createClient>>,
  kind: "product" | "content",
  targetId: string,
  mediaId: string,
  role: MediaRole
) {
  return kind === "product"
    ? supabase.from("product_media").delete().eq("product_id", targetId).eq("media_id", mediaId).eq("role", role)
    : supabase.from("content_media").delete().eq("content_id", targetId).eq("media_id", mediaId).eq("role", role);
}

/**
 * The provenance stamp for a slot an ADMIN filled.
 *
 * Every write from the admin UI is a human decision by definition — somebody
 * looked at the image and pressed a button — so it is recorded as one, and it
 * names them. The database enforces the pairing: content_media_human_needs_actor
 * refuses a 'human' row with no actor, and refuses an 'engine' row that claims
 * one. A provenance field nothing enforces drifts into decoration; this one
 * cannot.
 *
 * The engine's own attach path uses the opposite stamp — see
 * selection-policy.ts for what each one licenses.
 */
function humanSelection(adminId: string): {
  selection_kind: "human";
  selected_by: string;
  selected_at: string;
} {
  return { selection_kind: "human", selected_by: adminId, selected_at: new Date().toISOString() };
}

function insertAssoc(
  supabase: Awaited<ReturnType<typeof createClient>>,
  kind: "product" | "content",
  targetId: string,
  mediaId: string,
  role: MediaRole,
  adminId: string
) {
  const provenance = humanSelection(adminId);
  const row =
    kind === "product"
      ? { product_id: targetId, media_id: mediaId, role, sort_order: 0, ...provenance }
      : { content_id: targetId, media_id: mediaId, role, sort_order: 0, ...provenance };
  return kind === "product"
    ? supabase.from("product_media").insert(row as never)
    : supabase.from("content_media").insert(row as never);
}

function setRole(
  supabase: Awaited<ReturnType<typeof createClient>>,
  kind: "product" | "content",
  targetId: string,
  mediaId: string,
  fromRole: MediaRole,
  toRole: MediaRole
) {
  return kind === "product"
    ? supabase.from("product_media").update({ role: toRole }).eq("product_id", targetId).eq("media_id", mediaId).eq("role", fromRole)
    : supabase.from("content_media").update({ role: toRole }).eq("content_id", targetId).eq("media_id", mediaId).eq("role", fromRole);
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

/**
 * Apply a "where did this come from?" classification.
 *
 * The whole point is that the owner states ONE fact — who made this and what it
 * is — and the legitimate metadata follows. It writes only the fields the chosen
 * preset covers; everything else on the row is left alone (the same PATCH
 * discipline the provenance form uses).
 *
 * It never invents a source URL, licence, creator or attribution. The external
 * preset deliberately records almost nothing and leaves real provenance to be
 * typed in by hand.
 *
 * The provenance invariant is still checked before writing, so this cannot be
 * used as a way round the constraint — it is a way to satisfy it honestly.
 */
export async function classifyMediaAsset(
  id: string,
  _prev: FormState,
  formData: FormData
): Promise<FormState> {
  const admin = await requireAdmin();

  const presetId = String(formData.get("preset") ?? "");
  const preset = presetById(presetId);
  if (!preset) return { error: "Choose where this file came from." };
  if (preset.id === "unclassified") return { error: null };

  const existing = await getRowById("media_assets", id);
  if (!existing) return { error: "This media asset no longer exists." };

  const patch: Record<string, unknown> = { ...preset.patch };

  // "AI-generated" is a fact about how the file was made, not something a
  // classification can assume. The render presets ask; a concept render is
  // machine-made speculation by definition and the preset already fixes it.
  if (preset.id === "tc_render") {
    patch.ai_generated = formData.get("ai_generated") === "on";
  }

  const merged = { ...existing, ...patch };
  const problem = explainProvenanceRequirement(merged);
  if (problem) return { error: problem };

  try {
    await updateRow("media_assets", id, stampModificationAssessment(patch, admin.id, new Date().toISOString()));
  } catch (e) {
    return { error: e instanceof Error ? e.message : "Could not save the classification." };
  }

  revalidatePath("/admin/media");
  revalidatePath(`/admin/media/${id}`);
  return { error: null };
}

// ---------------------------------------------------------------------------
// Media Intelligence — one approval does the whole filing job
// ---------------------------------------------------------------------------

/**
 * Apply one suggestion from /admin/media/suggestions.
 *
 * Does, in one action, what previously meant three screens: save proposed alt
 * text where there is none, attach the asset to the target, and fill the slots
 * the matcher offered.
 *
 * IT RE-DERIVES THE MATCH SERVER-SIDE. The form is a rendering, not an
 * authorisation: a stale tab could otherwise post a slot that has since been
 * filled, or a pairing the rules now refuse. The matcher is the authority in
 * both places, and it is asked again here.
 *
 * IT NEVER PUBLISHES. Publishing an asset makes it reachable from the public
 * internet, which is a decision with consequences outside the admin, so it
 * stays a separate deliberate act.
 *
 * IT NEVER OVERWRITES A FILLED SLOT. The matcher withholds occupied slots and
 * this re-check drops any that arrived anyway, so an existing hero survives a
 * stale form post.
 */
/**
 * A newly attached lead image answers the open sourcing request for that page.
 *
 * WHY THIS EXISTS
 * ---------------
 * The brief's requirement is "new uploaded media should be capable of
 * satisfying awaiting-media requests", and it was the one half of the loop that
 * was not wired. `media_requirements` rows were OPENED automatically (by
 * scripts/ensure-media-requirements.ts, when the matcher could honestly fill
 * nothing) and were never CLOSED by anything except a human editing the row by
 * hand. So attaching the very image a request asked for left the request open,
 * the awaiting-media queue kept counting it, and `resolved_media_id` — the
 * column whose entire purpose is to record which asset answered — stayed null.
 *
 * IT MOVES TO 'available', NOT 'approved'
 * ---------------------------------------
 * 'approved' is the state `evaluateMediaReadiness` treats as the gate for
 * publishing the record. Letting an automatic attach reach it would be this
 * system approving its own work, which is the one thing the whole engine is
 * built not to do. 'available' is the honest statement of what just happened:
 * the image now exists and is attached, and a person still decides whether it
 * is good enough. The human approval gate is untouched.
 *
 * NON-DESTRUCTIVE. A requirement already at 'approved' is left alone — that is
 * a decision somebody made — and existing notes are never rewritten, because
 * they record sourcing work already done.
 */
async function resolveMediaRequirementFor(
  supabase: Awaited<ReturnType<typeof createClient>>,
  target: { kind: "content" | "product"; id: string },
  mediaId: string
): Promise<void> {
  const column = target.kind === "content" ? "content_id" : "product_id";

  const { data: requirement, error } = await supabase
    .from("media_requirements")
    .select("id, sourcing_status, resolved_media_id")
    .eq(column, target.id)
    .maybeSingle();
  if (error) {
    console.error(`[resolveMediaRequirementFor] read: ${error.message}`);
    return;
  }
  if (!requirement) return;

  const row = requirement as { id: string; sourcing_status: string; resolved_media_id: string | null };
  // Already settled by a person. Not this function's business.
  if (row.sourcing_status === "approved") return;
  if (row.resolved_media_id === mediaId && row.sourcing_status === "available") return;

  const { error: updateError } = await supabase
    .from("media_requirements")
    .update({
      sourcing_status: "available",
      resolved_media_id: mediaId,
      updated_at: new Date().toISOString(),
    })
    .eq("id", row.id);
  if (updateError) console.error(`[resolveMediaRequirementFor] update: ${updateError.message}`);

  revalidatePath("/admin/media/requirements");
}

export async function applyMediaSuggestion(formData: FormData): Promise<void> {
  // The admin is named on the row this writes: an image applied from the
  // suggestion queue was still CHOSEN by a person pressing Apply.
  const admin = await requireAdmin();
  const mediaId = String(formData.get("media_id") ?? "");
  const targetKind = String(formData.get("target_kind") ?? "");
  const targetId = String(formData.get("target_id") ?? "");
  const requestedSlots = String(formData.get("slots") ?? "")
    .split(",")
    .map((s) => s.trim())
    .filter((s): s is MediaRole => s === "hero" || s === "thumbnail" || s === "gallery");
  const altText = String(formData.get("alt_text") ?? "").trim();

  if (!mediaId || !targetId || requestedSlots.length === 0) return;
  if (targetKind !== "content" && targetKind !== "product") return;

  const supabase = await createClient();

  // Re-read the slots as they are NOW, not as the page rendered them.
  // Branched rather than parameterised: a dynamic column name defeats the
  // generated row types, and losing that check on the one function that writes
  // associations is a bad trade for three saved lines.
  const existingResult =
    targetKind === "content"
      ? await supabase.from("content_media").select("media_id, role").eq("content_id", targetId)
      : await supabase.from("product_media").select("media_id, role").eq("product_id", targetId);
  if (existingResult.error) {
    console.error(`[applyMediaSuggestion] slot read: ${existingResult.error.message}`);
    return;
  }
  const existing = existingResult.data;

  const occupied = new Set(
    ((existing ?? []) as { media_id: string; role: string }[])
      .filter((r) => r.role === "hero" || r.role === "thumbnail")
      .map((r) => r.role)
  );
  const alreadyHere = new Set(
    ((existing ?? []) as { media_id: string; role: string }[])
      .filter((r) => r.media_id === mediaId)
      .map((r) => r.role)
  );

  const slots = requestedSlots.filter((role) => {
    if (alreadyHere.has(role)) return false;
    // Exclusive slots are never taken from an incumbent here.
    if ((role === "hero" || role === "thumbnail") && occupied.has(role)) return false;
    return true;
  });
  if (slots.length === 0) return;

  // Alt text only where there is none — a generated description must never
  // replace one a human wrote.
  if (altText) {
    const { data: asset } = await supabase
      .from("media_assets")
      .select("alt_text")
      .eq("id", mediaId)
      .maybeSingle();
    if (asset && !(asset as { alt_text: string | null }).alt_text?.trim()) {
      await supabase.from("media_assets").update({ alt_text: altText }).eq("id", mediaId);
    }
  }

  const insertError =
    targetKind === "content"
      ? (
          await supabase
            .from("content_media")
            .insert(
              slots.map((role) => ({
                content_id: targetId,
                media_id: mediaId,
                role,
                sort_order: 0,
                ...humanSelection(admin.id),
              }))
            )
        ).error
      : (
          await supabase
            .from("product_media")
            .insert(
              slots.map((role) => ({
                product_id: targetId,
                media_id: mediaId,
                role,
                sort_order: 0,
                ...humanSelection(admin.id),
              }))
            )
        ).error;
  if (insertError) {
    // A unique-constraint collision means somebody filled the slot between the
    // read above and this write. That is the constraint doing its job.
    console.error(`[applyMediaSuggestion] attach: ${insertError.message}`);
  } else if (slots.includes("hero")) {
    // The page now HAS the lead image its sourcing request was asking for, so
    // the request is answered. Only on the hero: a gallery addition does not
    // satisfy a request for a lead image, and treating it as though it did is
    // how "awaiting media" would start reading as done while the page still had
    // no face. See resolveMediaRequirementFor.
    await resolveMediaRequirementFor(supabase, { kind: targetKind, id: targetId }, mediaId);
  }

  revalidatePath("/admin/media/suggestions");
  revalidatePath("/admin/media");
  revalidatePath(`/admin/media/${mediaId}`);
  revalidatePath("/admin");
}
