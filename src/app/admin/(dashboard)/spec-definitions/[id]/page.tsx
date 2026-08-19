import { notFound } from "next/navigation";
import { requireAdmin } from "@/lib/dal";
import { getRowById, listRows } from "@/lib/admin/reference-service";
import { PageHeader } from "@/components/admin/ui";
import { ReferenceForm, type ReferenceFieldConfig } from "@/components/admin/reference-form";
import { updateSpecDefinition } from "../actions";

export default async function EditSpecDefinitionPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  await requireAdmin();
  const { id } = await params;

  const [spec, categories] = await Promise.all([
    getRowById("spec_definitions", id),
    listRows("taxonomy_categories", { orderBy: "name" }),
  ]);

  if (!spec) notFound();

  const fields: ReferenceFieldConfig[] = [
    { key: "name", label: "Name", kind: "text", required: true },
    { key: "slug", label: "Slug", kind: "text" },
    {
      key: "data_type",
      label: "Data type",
      kind: "select",
      required: true,
      allowEmpty: false,
      options: [
        { value: "text", label: "Text" },
        { value: "number", label: "Number" },
        { value: "boolean", label: "Boolean" },
        { value: "enum", label: "Enum" },
      ],
    },
    { key: "unit", label: "Unit", kind: "text" },
    {
      key: "category_id",
      label: "Restrict to category",
      kind: "select",
      emptyLabel: "Any category",
      options: categories.map((c) => ({ value: c.id, label: c.name })),
    },
  ];

  return (
    <div>
      <PageHeader title={`Edit ${spec.name}`} />
      <ReferenceForm
        fields={fields}
        defaultValues={spec}
        action={updateSpecDefinition.bind(null, id)}
        submitLabel="Save changes"
      />
    </div>
  );
}
