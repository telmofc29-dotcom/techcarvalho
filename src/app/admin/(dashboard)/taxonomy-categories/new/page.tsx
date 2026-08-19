import { requireAdmin } from "@/lib/dal";
import { listRows } from "@/lib/admin/reference-service";
import { PageHeader } from "@/components/admin/ui";
import { ReferenceForm, type ReferenceFieldConfig } from "@/components/admin/reference-form";
import { createTaxonomyCategory } from "../actions";

export default async function NewTaxonomyCategoryPage() {
  await requireAdmin();
  const categories = await listRows("taxonomy_categories", { orderBy: "name" });

  const fields: ReferenceFieldConfig[] = [
    { key: "name", label: "Name", kind: "text", required: true },
    { key: "slug", label: "Slug", kind: "text", hint: "Leave blank to generate from the name." },
    {
      key: "parent_id",
      label: "Parent category",
      kind: "select",
      emptyLabel: "Top-level category",
      options: categories.map((c) => ({ value: c.id, label: c.name })),
    },
    { key: "sort_order", label: "Sort order", kind: "number", hint: "Lower numbers appear first." },
    { key: "description", label: "Description", kind: "textarea" },
  ];

  return (
    <div>
      <PageHeader title="New taxonomy category" />
      <ReferenceForm fields={fields} action={createTaxonomyCategory} submitLabel="Create category" />
    </div>
  );
}
