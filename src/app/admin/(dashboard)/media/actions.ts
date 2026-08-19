"use server";

import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { requireAdmin } from "@/lib/dal";
import { createClient } from "@/lib/supabase/server";
import { updateRow, deleteRow, getRowById, type ValidationResult } from "@/lib/admin/reference-service";
import { MEDIA_BUCKET } from "@/lib/media/constants";
import type { MediaType, MediaRole, Insert } from "@/lib/types/database";
import type { FormState } from "@/components/admin/reference-form";

const VALID_MEDIA_TYPES: MediaType[] = ["image", "video"];
const VALID_ROLES: MediaRole[] = ["hero", "gallery", "thumbnail"];

type MediaMetadata = Omit<Insert<"media_assets">, "storage_path">;

function readMetadata(formData: FormData): ValidationResult<MediaMetadata> {
  const mediaType = String(formData.get("media_type") ?? "").trim();
  const altText = String(formData.get("alt_text") ?? "").trim();
  const license = String(formData.get("license") ?? "").trim();
  const attribution = String(formData.get("attribution") ?? "").trim();
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
      attribution: attribution || null,
      width: widthRaw ? Number(widthRaw) : null,
      height: heightRaw ? Number(heightRaw) : null,
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
  const { error: uploadError } = await supabase.storage.from(MEDIA_BUCKET).upload(path, file, {
    contentType: file.type || undefined,
    upsert: false,
  });

  if (uploadError) {
    return {
      error: `Upload failed: ${uploadError.message}. The "${MEDIA_BUCKET}" storage bucket may not be configured yet — see the pending Supabase setup notes.`,
    };
  }

  const { error: insertError } = await supabase
    .from("media_assets")
    .insert({ storage_path: path, ...meta.payload });

  if (insertError) {
    await supabase.storage.from(MEDIA_BUCKET).remove([path]);
    return { error: insertError.message };
  }

  revalidatePath("/admin/media");
  redirect("/admin/media");
}

export async function updateMediaAsset(id: string, _prev: FormState, formData: FormData): Promise<FormState> {
  await requireAdmin();
  const meta = readMetadata(formData);
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

export async function deleteMediaAsset(formData: FormData): Promise<void> {
  await requireAdmin();
  const id = String(formData.get("id") ?? "");
  if (!id) return;

  const asset = await getRowById("media_assets", id);
  if (asset) {
    const supabase = await createClient();
    await supabase.storage.from(MEDIA_BUCKET).remove([asset.storage_path]);
  }

  await deleteRow("media_assets", id);
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
