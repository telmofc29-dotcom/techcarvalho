import { notFound } from "next/navigation";
import { requireAdmin } from "@/lib/dal";
import { createClient } from "@/lib/supabase/server";
import { getRowById, listRows } from "@/lib/admin/reference-service";
import { PageHeader, Card, Checkbox, Field, TextInput, Select, Badge, TextLink } from "@/components/admin/ui";
import { SubmitButton, ConfirmDeleteButton } from "@/components/admin/submit-button";
import { ReferenceForm, type ReferenceFieldConfig } from "@/components/admin/reference-form";
import {
  updateProduct,
  updateProductTags,
  updateProductSpecs,
  logProductFreshnessReview,
  addProductRelationship,
  deleteProductRelationship,
} from "../actions";
import type { RelationshipType } from "@/lib/types/database";

const RELATIONSHIP_LABELS: Record<RelationshipType, string> = {
  successor_of: "Successor of",
  alternative_to: "Alternative to",
  accessory_for: "Accessory for",
  compatible_with: "Compatible with",
  requires: "Requires",
};

const REVERSE_RELATIONSHIP_LABELS: Record<RelationshipType, string> = {
  successor_of: "Predecessor of",
  alternative_to: "Alternative to",
  accessory_for: "Has accessory",
  compatible_with: "Compatible with",
  requires: "Required by",
};

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
    { data: outgoingRel },
    { data: incomingRel },
    { data: allProducts },
    { data: mediaLinks },
  ] = await Promise.all([
    supabase.from("taxonomy_tags").select("*").order("name"),
    supabase.from("product_tags").select("tag_id").eq("product_id", id),
    supabase.from("spec_definitions").select("*").order("name"),
    supabase.from("product_specs").select("*").eq("product_id", id),
    supabase.from("freshness_log").select("*").eq("product_id", id).order("reviewed_at", { ascending: false }),
    supabase.from("product_relationships").select("id, related_product_id, relationship_type").eq("product_id", id),
    supabase.from("product_relationships").select("id, product_id, relationship_type").eq("related_product_id", id),
    supabase.from("products").select("id, name").neq("id", id).order("name"),
    supabase.from("product_media").select("media_id, role").eq("product_id", id),
  ]);

  const selectedTagIds = new Set((productTagRows ?? []).map((r) => r.tag_id));
  const applicableSpecs = (allSpecs ?? []).filter(
    (s) => s.category_id === null || s.category_id === product.category_id
  );
  const specValueByDefId = new Map((productSpecRows ?? []).map((r) => [r.spec_definition_id, r.value]));

  const relatedProductIds = [
    ...(outgoingRel ?? []).map((r) => r.related_product_id),
    ...(incomingRel ?? []).map((r) => r.product_id),
  ];
  const { data: relatedProductRows } =
    relatedProductIds.length > 0
      ? await supabase.from("products").select("id, name").in("id", relatedProductIds)
      : { data: [] };
  const nameById = new Map((relatedProductRows ?? []).map((p) => [p.id, p.name]));

  const mediaIds = (mediaLinks ?? []).map((m) => m.media_id);
  const { data: mediaRows } =
    mediaIds.length > 0
      ? await supabase.from("media_assets").select("id, alt_text, storage_path, publication_status").in("id", mediaIds)
      : { data: [] };
  const mediaById = new Map((mediaRows ?? []).map((m) => [m.id, m]));

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
        <h2 className="text-sm font-semibold text-neutral-900 mb-3">Relationships</h2>
        {(outgoingRel ?? []).length === 0 && (incomingRel ?? []).length === 0 ? (
          <p className="text-sm text-neutral-500 mb-4">No relationships yet.</p>
        ) : (
          <ul className="flex flex-col gap-2 mb-4">
            {(outgoingRel ?? []).map((r) => (
              <li key={r.id} className="flex items-center justify-between text-sm">
                <span>
                  <Badge>{RELATIONSHIP_LABELS[r.relationship_type]}</Badge>{" "}
                  {nameById.get(r.related_product_id) ?? "Unknown product"}
                </span>
                <form action={deleteProductRelationship}>
                  <input type="hidden" name="id" value={r.id} />
                  <input type="hidden" name="product_id" value={id} />
                  <ConfirmDeleteButton confirmMessage="Remove this relationship?" label="Remove" />
                </form>
              </li>
            ))}
            {(incomingRel ?? []).map((r) => (
              <li key={r.id} className="flex items-center justify-between text-sm">
                <span>
                  <Badge tone="blue">{REVERSE_RELATIONSHIP_LABELS[r.relationship_type]}</Badge>{" "}
                  {nameById.get(r.product_id) ?? "Unknown product"}
                </span>
                <form action={deleteProductRelationship}>
                  <input type="hidden" name="id" value={r.id} />
                  <input type="hidden" name="product_id" value={id} />
                  <ConfirmDeleteButton confirmMessage="Remove this relationship?" label="Remove" />
                </form>
              </li>
            ))}
          </ul>
        )}
        {(allProducts ?? []).length === 0 ? (
          <p className="text-sm text-neutral-500">No other products exist yet to relate this one to.</p>
        ) : (
          <form action={addProductRelationship.bind(null, id)} className="flex flex-wrap items-end gap-3">
            <Field label="Related product" htmlFor="related_product_id">
              <Select id="related_product_id" name="related_product_id" required className="w-56">
                <option value="">Choose a product</option>
                {(allProducts ?? []).map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.name}
                  </option>
                ))}
              </Select>
            </Field>
            <Field label="Relationship" htmlFor="relationship_type">
              <Select id="relationship_type" name="relationship_type" required className="w-48">
                {Object.entries(RELATIONSHIP_LABELS).map(([value, label]) => (
                  <option key={value} value={value}>
                    {label}
                  </option>
                ))}
              </Select>
            </Field>
            <SubmitButton pendingLabel="Adding...">Add relationship</SubmitButton>
          </form>
        )}
      </Card>

      <Card className="p-5">
        <h2 className="text-sm font-semibold text-neutral-900 mb-1">Media</h2>
        <p className="text-xs text-neutral-500 mb-3">
          Managed from the Media Registry — associate this product from a media asset&apos;s edit page.
        </p>
        {(mediaLinks ?? []).length === 0 ? (
          <p className="text-sm text-neutral-500">No media associated yet.</p>
        ) : (
          <ul className="flex flex-col gap-2">
            {(mediaLinks ?? []).map((link) => {
              const asset = mediaById.get(link.media_id);
              if (!asset) return null;
              return (
                <li key={link.media_id} className="flex items-center justify-between text-sm">
                  <span>
                    <Badge>{link.role}</Badge> {asset.alt_text ?? asset.storage_path.split("/").pop()}
                  </span>
                  <div className="flex items-center gap-2">
                    <Badge tone={asset.publication_status === "published" ? "green" : "neutral"}>
                      {asset.publication_status}
                    </Badge>
                    <TextLink href={`/admin/media/${asset.id}`}>Edit</TextLink>
                  </div>
                </li>
              );
            })}
          </ul>
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
