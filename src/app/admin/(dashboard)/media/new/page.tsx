import { requireAdmin } from "@/lib/dal";
import { PageHeader } from "@/components/admin/ui";
import { MediaUploadForm } from "../media-upload-form";

export default async function NewMediaPage() {
  await requireAdmin();
  return (
    <div>
      <PageHeader
        title="Upload media"
        description="Requires the Supabase storage bucket and RLS policies to be applied — see admin setup notes if uploads fail."
      />
      <MediaUploadForm />
    </div>
  );
}
