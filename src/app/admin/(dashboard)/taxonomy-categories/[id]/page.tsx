import { notFound } from "next/navigation";
import { requireAdmin } from "@/lib/dal";
import { getRowById, listRows } from "@/lib/admin/reference-service";
import { PageHeader } from "@/components/admin/ui";
import { ReferenceForm, type ReferenceFieldConfig } from "@/components/admin/reference-form";
import { updateTaxonomyCategory } from "../actions";

export default async function EditTaxonomyCategoryPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  await requireAdmin();
  const { id } = await params;

  const [category, categories] = await Promise.all([
    getRowById("taxonomy_categories", id),
    listRows("taxonomy_categories", { orderBy: "name" }),
  ]);

  if (!category) notFound();

  const fields: ReferenceFieldConfig[] = [
    { key: "name", label: "Name", kind: "text", required: true },
    { key: "slug", label: "Slug", kind: "text" },
    {
      key: "parent_id",
      label: "Parent category",
      kind: "select",
      emptyLabel: "Top-level category",
      options: categories.filter((c) => c.id !== id).map((c) => ({ value: c.id, label: c.name })),
    },
    { key: "sort_order", label: "Sort order", kind: "number", hint: "Lower numbers appear first." },
    { key: "description", label: "Description", kind: "textarea" },
  ];

  return (
    <div>
      <PageHeader title={`Edit ${category.name}`} />
      <ReferenceForm
        fields={fields}
        defaultValues={category}
        action={updateTaxonomyCategory.bind(null, id)}
        submitLabel="Save changes"
      />
    </div>
  );
}
