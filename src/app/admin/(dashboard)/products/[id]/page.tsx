import { notFound } from "next/navigation";
import { requireAdmin } from "@/lib/dal";
import { createClient } from "@/lib/supabase/server";
import { getRowById, listRows } from "@/lib/admin/reference-service";
import { PageHeader, Card, Checkbox, Field, TextInput, Select, Badge, TextLink } from "@/components/admin/ui";
import { SubmitButton, ConfirmDeleteButton } from "@/components/admin/submit-button";
import { ReferenceForm, type ReferenceFieldConfig } from "@/components/admin/reference-form";
import { SourceRecordsCard, EvidenceRecordsCard } from "@/components/admin/source-evidence-cards";
import { MediaRequirementCard } from "@/components/admin/media-requirement-card";
import { MediaSlots } from "@/components/admin/media-slots";
import {
  updateProduct,
  updateProductTags,
  updateProductSpecs,
  updateProductSeo,
  updateProductLaunchPricing,
  logProductFreshnessReview,
  addProductRelationship,
  deleteProductRelationship,
  addProductOffer,
  deleteProductOffer,
} from "../actions";
import type { RelationshipType, AffiliateStatus, LaunchPricingCurrency } from "@/lib/types/database";

const LAUNCH_PRICING_CURRENCIES: { value: LaunchPricingCurrency; label: string; symbol: string }[] = [
  { value: "USD", label: "USD", symbol: "$" },
  { value: "GBP", label: "GBP", symbol: "£" },
  { value: "EUR", label: "EUR", symbol: "€" },
];

const RELATIONSHIP_LABELS: Record<RelationshipType, string> = {
  successor_of: "Successor of",
  alternative_to: "Alternative to",
  accessory_for: "Accessory for",
  compatible_with: "Compatible with",
  requires: "Requires",
  same_family: "Same family",
  modern_equivalent: "Modern equivalent",
  mount_successor: "Earlier mount version",
  requires_adapter: "Requires an adapter for",
  supports_extender: "Supports extender",
  competes_with: "Competes with",
};

const AFFILIATE_STATUS_LABELS: Record<AffiliateStatus, string> = {
  non_affiliate: "Not affiliate",
  affiliate: "Affiliate",
  pending: "Pending affiliate setup",
};

const REVERSE_RELATIONSHIP_LABELS: Record<RelationshipType, string> = {
  successor_of: "Predecessor of",
  alternative_to: "Alternative to",
  accessory_for: "Has accessory",
  compatible_with: "Compatible with",
  requires: "Required by",
  same_family: "Same family",
  modern_equivalent: "Earlier equivalent",
  mount_successor: "Newer mount version",
  requires_adapter: "Adapts to",
  supports_extender: "Extender for",
  competes_with: "Competes with",
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
    { data: seo },
    { data: launchPricingRows },
    { data: freshnessEntries },
    { data: outgoingRel },
    { data: incomingRel },
    { data: allProducts },
    { data: mediaLinks },
    { data: sourceRecords },
    { data: evidenceRecords },
    { data: productOffers },
  ] = await Promise.all([
    supabase.from("taxonomy_tags").select("*").order("name"),
    supabase.from("product_tags").select("tag_id").eq("product_id", id),
    supabase.from("spec_definitions").select("*").order("name"),
    supabase.from("product_specs").select("*").eq("product_id", id),
    supabase.from("seo_metadata").select("*").eq("product_id", id).maybeSingle(),
    supabase.from("product_launch_pricing").select("*").eq("product_id", id),
    supabase.from("freshness_log").select("*").eq("product_id", id).order("reviewed_at", { ascending: false }),
    supabase.from("product_relationships").select("id, related_product_id, relationship_type").eq("product_id", id),
    supabase.from("product_relationships").select("id, product_id, relationship_type").eq("related_product_id", id),
    supabase.from("products").select("id, name").neq("id", id).order("name"),
    supabase.from("product_media").select("media_id, role").eq("product_id", id),
    supabase
      .from("source_records")
      .select("id, url, publisher, reliability_tier, retrieved_at")
      .eq("product_id", id)
      .order("retrieved_at", { ascending: false }),
    supabase
      .from("evidence_records")
      .select("id, test_type, conditions, result_summary, tested_at")
      .eq("product_id", id)
      .order("tested_at", { ascending: false }),
    supabase
      .from("product_offers")
      .select("id, retailer, url, affiliate_status, price_note, is_active")
      .eq("product_id", id)
      .order("retailer"),
  ]);

  const launchPricingByCurrency = new Map((launchPricingRows ?? []).map((r) => [r.currency, r]));
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
      ? await supabase
          .from("media_assets")
          .select("id, alt_text, storage_path, publication_status, rights_status, owned, source_type")
          .in("id", mediaIds)
      : { data: [] };
  const mediaById = new Map((mediaRows ?? []).map((m) => [m.id, m]));
  const heroLink = (mediaLinks ?? []).find((m) => m.role === "hero");
  const heroAsset = heroLink ? (mediaById.get(heroLink.media_id) ?? null) : null;
  const { data: mediaRequirement } = await supabase
    .from("media_requirements")
    .select("id, sourcing_status, target_source_type, notes, resolved_media_id")
    .eq("product_id", id)
    .maybeSingle();

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

      <MediaSlots kind="product" targetId={id} targetLabel={product.name} />

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
        <h2 className="text-sm font-semibold text-neutral-900 mb-3">SEO metadata</h2>
        <form action={updateProductSeo.bind(null, id)} className="flex flex-col gap-4">
          <Field label="Meta title" htmlFor="meta_title">
            <TextInput id="meta_title" name="meta_title" defaultValue={seo?.meta_title ?? ""} />
          </Field>
          <Field label="Meta description" htmlFor="meta_description">
            <TextInput id="meta_description" name="meta_description" defaultValue={seo?.meta_description ?? ""} />
          </Field>
          <Field label="Canonical URL" htmlFor="canonical_url">
            <TextInput id="canonical_url" name="canonical_url" type="url" defaultValue={seo?.canonical_url ?? ""} />
          </Field>
          <Checkbox name="noindex" label="noindex" defaultChecked={seo?.noindex ?? false} />
          <div>
            <SubmitButton pendingLabel="Saving SEO...">Save SEO metadata</SubmitButton>
          </div>
        </form>
      </Card>

      <Card className="p-5">
        <h2 className="text-sm font-semibold text-neutral-900 mb-1">Launch pricing</h2>
        <p className="text-xs text-neutral-500 mb-3">
          Historical launch MSRP, per currency, only when genuinely sourced. Leave a currency blank rather than
          guessing or converting from another currency — the public site never fabricates a regional price. The
          existing &quot;Launch MSRP (USD)&quot; spec above is separate and untouched by this.
        </p>
        <form action={updateProductLaunchPricing.bind(null, id)} className="flex flex-col gap-6">
          {LAUNCH_PRICING_CURRENCIES.map((c) => {
            const existing = launchPricingByCurrency.get(c.value);
            return (
              <div key={c.value} className="flex flex-col gap-3 border-t border-neutral-100 pt-4 first:border-t-0 first:pt-0">
                <h3 className="text-sm font-medium text-neutral-900">{c.label} ({c.symbol})</h3>
                <div className="grid grid-cols-2 gap-3">
                  <Field label="Amount" htmlFor={`amount_${c.value}`}>
                    <TextInput
                      id={`amount_${c.value}`}
                      name={`amount_${c.value}`}
                      type="number"
                      step="0.01"
                      defaultValue={existing ? String(existing.amount) : ""}
                    />
                  </Field>
                  <Field label="Source publisher" htmlFor={`source_publisher_${c.value}`}>
                    <TextInput
                      id={`source_publisher_${c.value}`}
                      name={`source_publisher_${c.value}`}
                      defaultValue={existing?.source_publisher ?? ""}
                    />
                  </Field>
                </div>
                <Field label="Source URL" htmlFor={`source_url_${c.value}`}>
                  <TextInput
                    id={`source_url_${c.value}`}
                    name={`source_url_${c.value}`}
                    type="url"
                    defaultValue={existing?.source_url ?? ""}
                  />
                </Field>
                <Field label="Note" htmlFor={`note_${c.value}`}>
                  <TextInput id={`note_${c.value}`} name={`note_${c.value}`} defaultValue={existing?.note ?? ""} />
                </Field>
                <Checkbox
                  name={`is_estimated_${c.value}`}
                  label="This is an approximate/derived conversion, not a directly sourced price"
                  defaultChecked={existing?.is_estimated ?? false}
                />
              </div>
            );
          })}
          <div>
            <SubmitButton pendingLabel="Saving launch pricing...">Save launch pricing</SubmitButton>
          </div>
        </form>
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
        <h2 className="text-sm font-semibold text-neutral-900 mb-1">Where to buy</h2>
        <p className="text-xs text-neutral-500 mb-3">
          Retailer offers shown on the public product page (only when active and the product is published). Marking
          an offer &quot;Affiliate&quot; makes it render with the affiliate disclosure — only pick that once a real
          affiliate relationship with the retailer exists.
        </p>
        {(productOffers ?? []).length === 0 ? (
          <p className="text-sm text-neutral-500 mb-4">No offers yet.</p>
        ) : (
          <ul className="flex flex-col gap-2 mb-4">
            {(productOffers ?? []).map((offer) => (
              <li key={offer.id} className="flex items-center justify-between text-sm gap-3">
                <span className="flex items-center gap-2 min-w-0">
                  <Badge tone={offer.affiliate_status === "affiliate" ? "amber" : "neutral"}>
                    {AFFILIATE_STATUS_LABELS[offer.affiliate_status]}
                  </Badge>
                  {!offer.is_active && <Badge tone="blue">Inactive</Badge>}
                  <span className="truncate">
                    {offer.retailer}
                    {offer.price_note ? ` — ${offer.price_note}` : ""}
                  </span>
                </span>
                <form action={deleteProductOffer}>
                  <input type="hidden" name="id" value={offer.id} />
                  <input type="hidden" name="product_id" value={id} />
                  <ConfirmDeleteButton confirmMessage="Remove this offer?" label="Remove" />
                </form>
              </li>
            ))}
          </ul>
        )}
        <form action={addProductOffer.bind(null, id)} className="flex flex-wrap items-end gap-3">
          <Field label="Retailer" htmlFor="retailer">
            <TextInput id="retailer" name="retailer" required className="w-40" />
          </Field>
          <Field label="URL" htmlFor="offer_url">
            <TextInput id="offer_url" name="url" type="url" required className="w-64" />
          </Field>
          <Field label="Affiliate status" htmlFor="affiliate_status">
            <Select id="affiliate_status" name="affiliate_status" defaultValue="non_affiliate" className="w-44">
              {Object.entries(AFFILIATE_STATUS_LABELS).map(([value, label]) => (
                <option key={value} value={value}>
                  {label}
                </option>
              ))}
            </Select>
          </Field>
          <Field label="Price note" htmlFor="price_note" hint="Optional, e.g. &quot;around $900&quot; — never a live price.">
            <TextInput id="price_note" name="price_note" className="w-40" />
          </Field>
          <Checkbox name="is_active" label="Active" defaultChecked />
          <SubmitButton pendingLabel="Adding...">Add offer</SubmitButton>
        </form>
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

      <MediaRequirementCard
        target={{ productId: id }}
        requirement={mediaRequirement ?? null}
        heroAsset={heroAsset}
        associatedMedia={(mediaRows ?? []).map((m) => ({
          id: m.id,
          label: m.alt_text ?? m.storage_path.split("/").pop() ?? m.id,
        }))}
      />

      <SourceRecordsCard parent={{ type: "product", id }} records={sourceRecords ?? []} />

      <EvidenceRecordsCard parent={{ type: "product", id }} records={evidenceRecords ?? []} />

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
