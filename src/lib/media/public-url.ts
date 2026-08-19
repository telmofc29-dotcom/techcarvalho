import { MEDIA_BUCKET } from "@/lib/media/constants";

// Pure string construction — matches Supabase Storage's public URL scheme.
// Safe to call even if the bucket/object doesn't exist yet; the browser
// will simply show a broken image rather than anything fabricated.
export function mediaPublicUrl(storagePath: string): string {
  const base = process.env.NEXT_PUBLIC_SUPABASE_URL!.replace(/\/$/, "");
  return `${base}/storage/v1/object/public/${MEDIA_BUCKET}/${storagePath}`;
}
