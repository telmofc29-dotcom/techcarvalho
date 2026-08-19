import { requireAdmin } from "@/lib/dal";
import { listRows } from "@/lib/admin/reference-service";
import { PageHeader } from "@/components/admin/ui";
import { ReferenceForm, type ReferenceFieldConfig } from "@/components/admin/reference-form";
import { createManufacturer } from "../actions";

export default async function NewManufacturerPage() {
  await requireAdmin();
  const media = await listRows("media_assets", { orderBy: "created_at", ascending: false });

  const fields: ReferenceFieldConfig[] = [
    { key: "name", label: "Name", kind: "text", required: true },
    { key: "slug", label: "Slug", kind: "text", hint: "Leave blank to generate from the name." },
    { key: "website", label: "Website", kind: "url" },
    { key: "description", label: "Description", kind: "textarea" },
    {
      key: "logo_media_id",
      label: "Logo",
      kind: "select",
      emptyLabel: "No logo",
      options: media.map((m) => ({ value: m.id, label: m.storage_path })),
    },
  ];

  return (
    <div>
      <PageHeader title="New manufacturer" />
      <ReferenceForm fields={fields} action={createManufacturer} submitLabel="Create manufacturer" />
    </div>
  );
}
