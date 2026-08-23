import { requireAdmin } from "@/lib/dal";
import { PageHeader, QueryErrorBanner } from "@/components/admin/ui";
import { MediaUploadForm } from "../media-upload-form";
import { loadExistingFileNames } from "./load-existing-filenames";

export default async function NewMediaPage() {
  // OUTSIDE the try/catch below, deliberately. requireAdmin() signals "not an
  // admin" by calling redirect(), which works by THROWING a control-flow error
  // that Next must be allowed to catch. Wrapping it would swallow the redirect
  // and turn a logged-out visitor into a rendered page. Authorization is also
  // the one dependency here that must never degrade.
  await requireAdmin();

  // Everything else is optional. The reason this route exists is the upload
  // form; the filename list only powers a "you may have uploaded this already"
  // warning. Before this change a failure anywhere in that lookup — a thrown
  // client constructor, a rejected query, a malformed row — took the whole page
  // down with React #441 and left the admin with no way to add media at all.
  //
  // The failure is REPORTED, not hidden: a banner names it above a form that
  // still works. That is the opposite of masking, and it matches the project
  // rule that an admin must never be shown a failure disguised as empty data.
  const { names, failure } = await loadExistingFileNames();

  return (
    <div>
      <PageHeader
        title="Upload media"
        description="Drag files in, or browse — upload several at once. Metadata below applies to every file in this batch; edit individual assets afterward if they need to differ."
      />
      {failure && (
        <QueryErrorBanner
          message={`Duplicate-name checking is unavailable for this batch (${failure}). Uploading still works normally — you just won't be warned if a filename already exists in the library.`}
        />
      )}
      <MediaUploadForm existingFileNames={names} />
    </div>
  );
}
