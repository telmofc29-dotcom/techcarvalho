import { requireAdmin } from "@/lib/dal";
import { listRows } from "@/lib/admin/reference-service";
import { PageHeader } from "@/components/admin/ui";
import { ReferenceForm, type ReferenceFieldConfig } from "@/components/admin/reference-form";
import { createProduct } from "../actions";

export default async function NewProductPage() {
  await requireAdmin();
  const [manufacturers, categories, families] = await Promise.all([
    listRows("manufacturers", { orderBy: "name" }),
    listRows("taxonomy_categories", { orderBy: "name" }),
    listRows("product_families", { orderBy: "name" }),
  ]);

  const fields: ReferenceFieldConfig[] = [
    { key: "name", label: "Name", kind: "text", required: true },
    { key: "slug", label: "Slug", kind: "text", hint: "Leave blank to generate from the name." },
    {
      key: "manufacturer_id",
      label: "Manufacturer",
      kind: "select",
      required: true,
      allowEmpty: false,
      options: manufacturers.map((m) => ({ value: m.id, label: m.name })),
    },
    {
      key: "category_id",
      label: "Category",
      kind: "select",
      required: true,
      allowEmpty: false,
      options: categories.map((c) => ({ value: c.id, label: c.name })),
    },
    {
      key: "family_id",
      label: "Product family",
      kind: "select",
      emptyLabel: "No family",
      options: families.map((f) => ({ value: f.id, label: f.name })),
    },
    { key: "model_number", label: "Model number", kind: "text" },
    { key: "release_date", label: "Release date", kind: "date" },
    {
      key: "status",
      label: "Status",
      kind: "select",
      required: true,
      allowEmpty: false,
      options: [
        { value: "active", label: "Active" },
        { value: "discontinued", label: "Discontinued" },
        { value: "rumored", label: "Rumored" },
      ],
    },
    { key: "summary", label: "Summary", kind: "textarea" },
    { key: "is_published", label: "Published (visible on the public site)", kind: "checkbox" },
  ];

  return (
    <div>
      <PageHeader
        title="New product"
        description="Tags, specs, and media associations can be added after the product is created."
      />
      <ReferenceForm fields={fields} action={createProduct} submitLabel="Create product" />
    </div>
  );
}
