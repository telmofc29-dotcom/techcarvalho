import { MEDIA_PUBLIC_BUCKET } from "@/lib/media/constants";

// Pure string construction — matches Supabase Storage's public URL scheme.
// Only call this with a *published* asset's public_storage_path. Private
// assets have no public URL by design (see getAdminPreviewUrl for those).
export function mediaPublicUrl(publicStoragePath: string): string {
  const base = process.env.NEXT_PUBLIC_SUPABASE_URL!.replace(/\/$/, "");
  return `${base}/storage/v1/object/public/${MEDIA_PUBLIC_BUCKET}/${publicStoragePath}`;
}
