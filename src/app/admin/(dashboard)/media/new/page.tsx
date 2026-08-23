import { requireAdmin } from "@/lib/dal";
import { createClient } from "@/lib/supabase/server";
import { PageHeader } from "@/components/admin/ui";
import { MediaUploadForm } from "../media-upload-form";
import { existingFileNames } from "@/lib/media/existing-filenames";
import { logQueryError } from "@/lib/log/query-error";

export default async function NewMediaPage() {
  await requireAdmin();

  // Existing filenames (the sanitized-original-name portion of each
  // storage_path, after the uuid- prefix) — passed to the upload form so
  // it can warn (not hard-block) on a likely-duplicate re-upload without
  // needing its own query.
  const supabase = await createClient();
  const { data, error } = await supabase.from("media_assets").select("storage_path");

  // The error is CHECKED, not discarded, and the parsing is total.
  //
  // This page crashed in production with React #441 — "An error occurred in the
  // Server Components render", message masked in production. The previous code
  // discarded this error and then called `.split()` on a value nothing
  // guarantees to be a string, which is exactly how a #441 is produced.
  //
  // A failure here must not take the page down: the filename list only powers a
  // duplicate-upload WARNING, and losing it is a far smaller cost than losing
  // the only route for adding media. So it degrades to an empty list and logs.
  if (error) logQueryError("NewMediaPage existing filenames", error);
  const names = existingFileNames(data);

  return (
    <div>
      <PageHeader
        title="Upload media"
        description="Drag files in, or browse — upload several at once. Metadata below applies to every file in this batch; edit individual assets afterward if they need to differ."
      />
      <MediaUploadForm existingFileNames={names} />
    </div>
  );
}
