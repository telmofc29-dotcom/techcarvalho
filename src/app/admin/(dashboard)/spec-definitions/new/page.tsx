import { requireAdmin } from "@/lib/dal";
import { listRows } from "@/lib/admin/reference-service";
import { PageHeader } from "@/components/admin/ui";
import { ReferenceForm, type ReferenceFieldConfig } from "@/components/admin/reference-form";
import { createSpecDefinition } from "../actions";

export default async function NewSpecDefinitionPage() {
  await requireAdmin();
  const categories = await listRows("taxonomy_categories", { orderBy: "name" });

  const fields: ReferenceFieldConfig[] = [
    { key: "name", label: "Name", kind: "text", required: true },
    { key: "slug", label: "Slug", kind: "text", hint: "Leave blank to generate from the name." },
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
    { key: "unit", label: "Unit", kind: "text", hint: "e.g. mm, g, MP — leave blank if not applicable." },
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
      <PageHeader title="New spec definition" />
      <ReferenceForm fields={fields} action={createSpecDefinition} submitLabel="Create spec definition" />
    </div>
  );
}
