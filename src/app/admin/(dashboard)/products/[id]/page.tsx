import { notFound } from "next/navigation";
import { requireAdmin } from "@/lib/dal";
import { createClient } from "@/lib/supabase/server";
import { getRowById, listRows } from "@/lib/admin/reference-service";
import { PageHeader, Card, Checkbox, Field, TextInput, Badge } from "@/components/admin/ui";
import { SubmitButton } from "@/components/admin/submit-button";
import { ReferenceForm, type ReferenceFieldConfig } from "@/components/admin/reference-form";
import {
  updateProduct,
  updateProductTags,
  updateProductSpecs,
  logProductFreshnessReview,
} from "../actions";

export default async function EditProductPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  await requireAdmin();
  const { id } = await params;

  const [product, manufacturers, categories, families] = await Promise.all([
    getRowById("products", id),
    listRows("manufacturers", { orderBy: "name" }),
    listRows("taxonomy_categories", { orderBy: "name" }),
    listRows("product_families", { orderBy: "name" }),
  ]);

  if (!product) notFound();

  const supabase = await createClient();
  const [
    { data: allTags },
    { data: productTagRows },
    { data: allSpecs },
    { data: productSpecRows },
    { data: freshnessEntries },
  ] = await Promise.all([
    supabase.from("taxonomy_tags").select("*").order("name"),
    supabase.from("product_tags").select("tag_id").eq("product_id", id),
    supabase.from("spec_definitions").select("*").order("name"),
    supabase.from("product_specs").select("*").eq("product_id", id),
    supabase.from("freshness_log").select("*").eq("product_id", id).order("reviewed_at", { ascending: false }),
  ]);

  const selectedTagIds = new Set((productTagRows ?? []).map((r) => r.tag_id));
  const applicableSpecs = (allSpecs ?? []).filter(
    (s) => s.category_id === null || s.category_id === product.category_id
  );
  const specValueByDefId = new Map((productSpecRows ?? []).map((r) => [r.spec_definition_id, r.value]));

  const fields: ReferenceFieldConfig[] = [
    { key: "name", label: "Name", kind: "text", required: true },
    { key: "slug", label: "Slug", kind: "text" },
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

  const specDefsForAction = applicableSpecs.map((s) => ({ id: s.id, data_type: s.data_type }));

  return (
    <div className="flex flex-col gap-8 max-w-3xl">
      <div>
        <PageHeader title={`Edit ${product.name}`} />
        <ReferenceForm
          fields={fields}
          defaultValues={product}
          action={updateProduct.bind(null, id)}
          submitLabel="Save changes"
        />
      </div>

      <Card className="p-5">
        <h2 className="text-sm font-semibold text-neutral-900 mb-3">Tags</h2>
        {(allTags ?? []).length === 0 ? (
          <p className="text-sm text-neutral-500">No taxonomy tags exist yet.</p>
        ) : (
          <form action={updateProductTags.bind(null, id)} className="flex flex-col gap-3">
            <div className="flex flex-wrap gap-x-6 gap-y-2">
              {(allTags ?? []).map((tag) => (
                <Checkbox
                  key={tag.id}
                  name="tag_id"
                  value={tag.id}
                  label={tag.name}
                  defaultChecked={selectedTagIds.has(tag.id)}
                />
              ))}
            </div>
            <div>
              <SubmitButton pendingLabel="Saving tags...">Save tags</SubmitButton>
            </div>
          </form>
        )}
      </Card>

      <Card className="p-5">
        <h2 className="text-sm font-semibold text-neutral-900 mb-1">Specs</h2>
        <p className="text-xs text-neutral-500 mb-3">
          Values shown are those applicable to this product&apos;s category, plus any category-agnostic specs.
        </p>
        {applicableSpecs.length === 0 ? (
          <p className="text-sm text-neutral-500">
            No spec definitions apply to this category yet. Add some under Spec Definitions.
          </p>
        ) : (
          <form action={updateProductSpecs.bind(null, id, specDefsForAction)} className="flex flex-col gap-4">
            {applicableSpecs.map((spec) => {
              const current = specValueByDefId.get(spec.id);
              const fieldName = `spec_${spec.id}`;
              if (spec.data_type === "boolean") {
                return (
                  <Checkbox
                    key={spec.id}
                    name={fieldName}
                    label={spec.name}
                    defaultChecked={current === true}
                  />
                );
              }
              return (
                <Field key={spec.id} label={`${spec.name}${spec.unit ? ` (${spec.unit})` : ""}`} htmlFor={fieldName}>
                  <TextInput
                    id={fieldName}
                    name={fieldName}
                    type={spec.data_type === "number" ? "number" : "text"}
                    defaultValue={typeof current === "string" || typeof current === "number" ? String(current) : ""}
                  />
                </Field>
              );
            })}
            <div>
              <SubmitButton pendingLabel="Saving specs...">Save specs</SubmitButton>
            </div>
          </form>
        )}
      </Card>

      <Card className="p-5">
        <h2 className="text-sm font-semibold text-neutral-900 mb-3">Freshness</h2>
        <form action={logProductFreshnessReview.bind(null, id)} className="flex flex-col gap-3 mb-5">
          <Field label="Log a freshness review" htmlFor="reason" hint="Records that this product's details were checked/updated today.">
            <TextInput id="reason" name="reason" placeholder="e.g. Verified spec sheet against manufacturer site" required />
          </Field>
          <div>
            <SubmitButton pendingLabel="Logging...">Log review</SubmitButton>
          </div>
        </form>
        {(freshnessEntries ?? []).length === 0 ? (
          <p className="text-sm text-neutral-500">No freshness reviews logged yet.</p>
        ) : (
          <ul className="flex flex-col gap-2">
            {(freshnessEntries ?? []).map((entry) => (
              <li key={entry.id} className="text-sm text-neutral-700 flex items-center gap-2">
                <Badge tone="blue">{new Date(entry.reviewed_at).toLocaleDateString()}</Badge>
                {entry.reason}
              </li>
            ))}
          </ul>
        )}
      </Card>
    </div>
  );
}
