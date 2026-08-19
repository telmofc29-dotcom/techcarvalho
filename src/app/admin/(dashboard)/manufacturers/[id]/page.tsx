import { notFound } from "next/navigation";
import { requireAdmin } from "@/lib/dal";
import { getRowById, listRows } from "@/lib/admin/reference-service";
import { PageHeader } from "@/components/admin/ui";
import { ReferenceForm, type ReferenceFieldConfig } from "@/components/admin/reference-form";
import { updateManufacturer } from "../actions";

export default async function EditManufacturerPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  await requireAdmin();
  const { id } = await params;

  const [manufacturer, media] = await Promise.all([
    getRowById("manufacturers", id),
    listRows("media_assets", { orderBy: "created_at", ascending: false }),
  ]);

  if (!manufacturer) notFound();

  const fields: ReferenceFieldConfig[] = [
    { key: "name", label: "Name", kind: "text", required: true },
    { key: "slug", label: "Slug", kind: "text" },
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
      <PageHeader title={`Edit ${manufacturer.name}`} />
      <ReferenceForm
        fields={fields}
        defaultValues={manufacturer}
        action={updateManufacturer.bind(null, id)}
        submitLabel="Save changes"
      />
    </div>
  );
}
