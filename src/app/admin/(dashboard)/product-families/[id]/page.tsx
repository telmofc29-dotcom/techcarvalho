import { notFound } from "next/navigation";
import { requireAdmin } from "@/lib/dal";
import { getRowById, listRows } from "@/lib/admin/reference-service";
import { PageHeader } from "@/components/admin/ui";
import { ReferenceForm, type ReferenceFieldConfig } from "@/components/admin/reference-form";
import { updateProductFamily } from "../actions";

export default async function EditProductFamilyPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  await requireAdmin();
  const { id } = await params;

  const [family, categories] = await Promise.all([
    getRowById("product_families", id),
    listRows("taxonomy_categories", { orderBy: "name" }),
  ]);

  if (!family) notFound();

  const fields: ReferenceFieldConfig[] = [
    { key: "name", label: "Name", kind: "text", required: true },
    { key: "slug", label: "Slug", kind: "text" },
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
      <PageHeader title={`Edit ${family.name}`} />
      <ReferenceForm
        fields={fields}
        defaultValues={family}
        action={updateProductFamily.bind(null, id)}
        submitLabel="Save changes"
      />
    </div>
  );
}
