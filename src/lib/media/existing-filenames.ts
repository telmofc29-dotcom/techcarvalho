// The "have you uploaded this already?" filename list.
//
// WHY THIS IS A MODULE
// --------------------
// /admin/media/new crashed in production with React error #441, which decodes
// to "An error occurred in the Server Components render. The specific message
// is omitted in production builds." That is a SERVER-side throw with its
// message deliberately masked — not a hydration bug, and not something the
// client can reveal.
//
// The page's own code was the obvious candidate:
//
//   const { data } = await supabase.from("media_assets").select("storage_path");
//   const base = row.storage_path.split("/").pop() ?? "";
//
// Two faults in three lines. The query error is DISCARDED, which the project's
// own rule forbids on admin pages. And `.split()` is called on a value the
// types say is a string but the runtime does not guarantee — a null there
// throws a TypeError during render, which is precisely a #441.
//
// Production currently holds no null storage_path, so that exact throw is not
// firing today and the crash could not be reproduced on the live build. The
// fault is real regardless: this is one bad row away from a page that cannot
// load, on the only route for adding media.
//
// So the parsing is pulled out here, made total, and tested — including against
// the shapes that would have thrown.
//
// Pure. No I/O.

/** A uuid prefix plus its separator: 36 characters and a dash. */
const UUID_PREFIX_LENGTH = 37;

/**
 * Recover the human filename from a storage path.
 *
 * Upload writes `image/<uuid>-<sanitised-original-name>`, so the original name
 * is everything after the uuid. A path that does not carry one — anything
 * written before that convention, or by hand — yields the basename unchanged
 * rather than a slice of the wrong length.
 *
 * Total by construction: every input, including null, undefined and the empty
 * string, produces a string. Nothing here can throw.
 */
export function fileNameFromStoragePath(storagePath: unknown): string {
  if (typeof storagePath !== "string") return "";
  const base = storagePath.split("/").pop() ?? "";
  return base.length > UUID_PREFIX_LENGTH ? base.slice(UUID_PREFIX_LENGTH) : base;
}

/**
 * Map rows to filenames, skipping anything unusable.
 *
 * Returns only non-empty names: an empty string would match every future
 * upload's "have I seen this name?" check and warn on all of them, which is
 * how a helpful warning becomes noise people click past.
 */
export function existingFileNames(
  rows: readonly { storage_path?: unknown }[] | null | undefined
): string[] {
  if (!rows) return [];
  const out: string[] = [];
  for (const row of rows) {
    const name = fileNameFromStoragePath(row?.storage_path);
    if (name) out.push(name);
  }
  return out;
}
