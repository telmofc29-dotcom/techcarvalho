import { notFound } from "next/navigation";
import { requireAdmin } from "@/lib/dal";
import { getRowById } from "@/lib/admin/reference-service";
import { PageHeader } from "@/components/admin/ui";
import { ReferenceForm, type ReferenceFieldConfig } from "@/components/admin/reference-form";
import { updateTaxonomyTag } from "../actions";

const fields: ReferenceFieldConfig[] = [
  { key: "name", label: "Name", kind: "text", required: true },
  { key: "slug", label: "Slug", kind: "text" },
];

export default async function EditTaxonomyTagPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  await requireAdmin();
  const { id } = await params;
  const tag = await getRowById("taxonomy_tags", id);
  if (!tag) notFound();

  return (
    <div>
      <PageHeader title={`Edit ${tag.name}`} />
      <ReferenceForm
        fields={fields}
        defaultValues={tag}
        action={updateTaxonomyTag.bind(null, id)}
        submitLabel="Save changes"
      />
    </div>
  );
}
