import "server-only";

import { createClient } from "@/lib/supabase/server";
import { resolveExistingFileNames, type ExistingFileNamesResult } from "@/lib/media/existing-filenames";
import { logQueryError } from "@/lib/log/query-error";

export type { ExistingFileNamesResult };

/**
 * Load the "have you uploaded this already?" filename list for the upload page.
 *
 * A thin wiring layer: the behaviour — including the guarantee that it never
 * throws — lives in resolveExistingFileNames(), which is unit-tested against
 * both a returned error and a thrown one. Note that createClient() is called
 * INSIDE the callback, so a throw from constructing the client (malformed
 * session cookies, missing environment variables) is caught too, rather than
 * escaping before the guard applies.
 */
export async function loadExistingFileNames(): Promise<ExistingFileNamesResult> {
  return resolveExistingFileNames(async () => {
    const supabase = await createClient();
    return supabase.from("media_assets").select("storage_path");
  }, logQueryError);
}
