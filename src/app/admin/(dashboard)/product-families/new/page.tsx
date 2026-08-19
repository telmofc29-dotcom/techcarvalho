import { requireAdmin } from "@/lib/dal";
import { listRows } from "@/lib/admin/reference-service";
import { PageHeader } from "@/components/admin/ui";
import { ReferenceForm, type ReferenceFieldConfig } from "@/components/admin/reference-form";
import { createProductFamily } from "../actions";

export default async function NewProductFamilyPage() {
  await requireAdmin();
  const categories = await listRows("taxonomy_categories", { orderBy: "name" });

  const fields: ReferenceFieldConfig[] = [
    { key: "name", label: "Name", kind: "text", required: true },
    { key: "slug", label: "Slug", kind: "text", hint: "Leave blank to generate from the name." },
    {
      key: "category_id",
      label: "Category",
      kind: "select",
      emptyLabel: "No category",
      options: categories.map((c) => ({ value: c.id, label: c.name })),
    },
    { key: "description", label: "Description", kind: "textarea" },
  ];

  return (
    <div>
      <PageHeader title="New product family" />
      <ReferenceForm fields={fields} action={createProductFamily} submitLabel="Create product family" />
    </div>
  );
}
