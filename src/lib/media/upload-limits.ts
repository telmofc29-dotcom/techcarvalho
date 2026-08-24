// What may be uploaded, and how big it may be.
//
// WHY THIS MODULE EXISTS
// ----------------------
// /admin/media/new sent the whole file through a Next.js Server Action. Next
// caps a Server Action request body at 1 MB by default, so any real photograph
// produced:
//
//   Error: Body exceeded 1 MB limit.   statusCode: 413
//   digest: 4292037696@E394
//
// which React masked as #441. The form gave no warning beforehand because
// nothing on the client knew there was a limit — and no automated test caught
// it because the test fixture was a 1x1 PNG.
//
// The binary no longer travels through a Server Action at all (see
// createMediaUploadTicket / finaliseMediaUpload), so the ceiling here is ours to
// choose rather than the platform's. It is enforced in three places: the file
// picker's accept list, this validator on the client BEFORE anything is sent,
// and the same validator on the server when a ticket is requested — because a
// client-side check is a courtesy, not a control.
//
// Pure. No I/O, no React, no server-only imports.

/**
 * Largest original we accept, in bytes.
 *
 * 20 MB covers full-resolution photography from a modern camera — the library's
 * biggest existing master is a 9.9 MB 4203x3152 PNG — with room to spare.
 *
 * This is NOT constrained by Vercel's 4.5 MB function body limit, because the
 * bytes go straight from the browser to Supabase Storage and never pass through
 * a Vercel function. That limit is precisely why the direct-upload path exists.
 */
export const MAX_UPLOAD_BYTES = 20 * 1024 * 1024;

export const ACCEPTED_IMAGE_TYPES = [
  "image/jpeg",
  "image/png",
  "image/webp",
  "image/gif",
  "image/svg+xml",
] as const;

export const ACCEPTED_VIDEO_TYPES = ["video/mp4", "video/webm", "video/quicktime"] as const;

/** Human-facing list of formats, for the form to display. */
export const ACCEPTED_FORMATS_LABEL = "JPG, PNG, WebP, GIF, SVG, MP4, WebM, MOV";

export type UploadMediaType = "image" | "video";

/** Which media_type column value a MIME type maps to, or null if unsupported. */
export function mediaTypeForMime(mime: string): UploadMediaType | null {
  if ((ACCEPTED_IMAGE_TYPES as readonly string[]).includes(mime)) return "image";
  if ((ACCEPTED_VIDEO_TYPES as readonly string[]).includes(mime)) return "video";
  return null;
}

/**
 * Bytes as a short human string.
 *
 * One decimal place from a megabyte upwards, because "24.6 MB" and "20 MB" is
 * the comparison an admin actually needs to make; whole kilobytes below that.
 */
export function formatBytes(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes < 0) return "unknown size";
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

export type UploadCandidate = { name: string; size: number; type: string };
export type UploadCheck = { ok: true; mediaType: UploadMediaType } | { ok: false; error: string };

/**
 * Is this file acceptable?
 *
 * The oversize message states BOTH numbers, because "too large" without the
 * limit means the admin has to guess how much to shrink by:
 *
 *   "This file is 24.6 MB. The current upload limit is 20 MB."
 */
export function checkUploadCandidate(file: UploadCandidate): UploadCheck {
  const mediaType = mediaTypeForMime(file.type);
  if (!mediaType) {
    return {
      ok: false,
      error: `Unsupported file type${file.type ? ` (${file.type})` : ""}. Accepted formats: ${ACCEPTED_FORMATS_LABEL}.`,
    };
  }

  if (!Number.isFinite(file.size) || file.size <= 0) {
    return { ok: false, error: "This file appears to be empty." };
  }

  if (file.size > MAX_UPLOAD_BYTES) {
    return {
      ok: false,
      error: `This file is ${formatBytes(file.size)}. The current upload limit is ${formatBytes(MAX_UPLOAD_BYTES)}.`,
    };
  }

  return { ok: true, mediaType };
}

/**
 * The storage path shape this application issues.
 *
 * `<image|video>/<uuid>-<sanitised original name>`. Used by the server to
 * confirm that a path presented for finalisation looks like one it minted,
 * rather than an arbitrary string pointing at somebody else's object.
 */
export const STORAGE_PATH_PATTERN =
  /^(image|video)\/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}-[a-z0-9.-]+$/;

export function isIssuedStoragePath(path: string): boolean {
  return STORAGE_PATH_PATTERN.test(path);
}

/** Lowercase, punctuation-collapsed filename, matching what upload writes. */
export function sanitizeFileName(name: string): string {
  return name.toLowerCase().replace(/[^a-z0-9.]+/g, "-").replace(/^-+|-+$/g, "");
}
