import { requireAdmin } from "@/lib/dal";
import { createClient } from "@/lib/supabase/server";
import { PageHeader } from "@/components/admin/ui";
import { MediaUploadForm } from "../media-upload-form";

export default async function NewMediaPage() {
  await requireAdmin();

  // Existing filenames (the sanitized-original-name portion of each
  // storage_path, after the uuid- prefix) — passed to the upload form so
  // it can warn (not hard-block) on a likely-duplicate re-upload without
  // needing its own query.
  const supabase = await createClient();
  const { data } = await supabase.from("media_assets").select("storage_path");
  const existingFileNames = (data ?? []).map((row) => {
    const base = row.storage_path.split("/").pop() ?? "";
    // uuid- prefix is always 36 chars + "-"
    return base.length > 37 ? base.slice(37) : base;
  });

  return (
    <div>
      <PageHeader
        title="Upload media"
        description="Drag files in, or browse — upload several at once. Metadata below applies to every file in this batch; edit individual assets afterward if they need to differ."
      />
      <MediaUploadForm existingFileNames={existingFileNames} />
    </div>
  );
}
