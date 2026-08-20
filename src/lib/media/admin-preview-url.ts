import "server-only";
import { createClient } from "@/lib/supabase/server";
import { MEDIA_PRIVATE_BUCKET } from "@/lib/media/constants";
import { mediaPublicUrl } from "@/lib/media/public-url";
import type { Row } from "@/lib/types/database";

// Admin-only preview URL for a media asset: published assets use the plain
// public URL (fast, cacheable); private/draft assets get a short-lived
// signed URL generated per request for the currently-authenticated admin.
// Callers must already be behind requireAdmin() — this does not check
// authorization itself, it only decides which URL scheme to use.
export async function getAdminPreviewUrl(asset: Row<"media_assets">): Promise<string | null> {
  if (asset.publication_status === "published" && asset.public_storage_path) {
    return mediaPublicUrl(asset.public_storage_path);
  }

  const supabase = await createClient();
  const { data, error } = await supabase.storage
    .from(MEDIA_PRIVATE_BUCKET)
    .createSignedUrl(asset.storage_path, 60);

  if (error || !data) return null;
  return data.signedUrl;
}
