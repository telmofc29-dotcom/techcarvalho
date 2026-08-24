import Image from "next/image";
import { notFound } from "next/navigation";
import { requireAdmin } from "@/lib/dal";
import { createClient } from "@/lib/supabase/server";
import { getRowById } from "@/lib/admin/reference-service";
import { getAdminPreviewUrl } from "@/lib/media/admin-preview-url";
import { evaluatePublishEligibility } from "@/lib/media/rights";
import { PageHeader, Card, Select, Checkbox, Textarea, Field, TextInput, Badge } from "@/components/admin/ui";
import { ConfirmDeleteButton } from "@/components/admin/submit-button";
import { ReferenceForm, type ReferenceFieldConfig } from "@/components/admin/reference-form";
import { ActionForm } from "@/components/admin/action-form";
import { ASSET_ROLE_OPTIONS, BRAND_ROLE_OPTIONS, SOURCE_TYPE_OPTIONS, RIGHTS_STATUS_OPTIONS, EDITED_FIELDS_INPUT } from "@/lib/media/form-options";
import { PublishToggle } from "../publish-toggle";
import {
  updateMediaAsset,
  updateMediaProvenance,
  deleteMediaAsset,
  updateMediaProductAssociations,
  updateMediaContentAssociations,
} from "../actions";

// Exactly the provenance fields this form renders an input for. The action
// writes these and nothing else, so a field absent from the form keeps its
// stored value instead of being overwritten with the empty default it would
// otherwise read back as.
const PROVENANCE_FIELDS_EDITED_HERE = [
  "caption",
  "source_type",
  "source_url",
  "attribution",
  "attribution_required",
  "ai_generated",
  "owned",
  "rights_status",
  "brand_role",
  "asset_role",
  "licence_permits_modification",
].join(",");

export default async function EditMediaPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  await requireAdmin();
  const { id } = await params;

  const asset = await getRowById("media_assets", id);
  if (!asset) notFound();

  const isPublished = asset.publication_status === "published";
  const eligibility = evaluatePublishEligibility(asset);

  const [previewUrl, supabase] = await Promise.all([getAdminPreviewUrl(asset), createClient()]);
  const [{ data: allProducts }, { data: productLinks }, { data: allContent }, { data: contentLinks }] =
    await Promise.all([
      supabase.from("products").select("id, name").order("name"),
      supabase.from("product_media").select("product_id, role").eq("media_id", id),
      supabase.from("content_items").select("id, title").order("title"),
      supabase.from("content_media").select("content_id, role").eq("media_id", id),
    ]);

  const productRoleById = new Map((productLinks ?? []).map((r) => [r.product_id, r.role]));
  const contentRoleById = new Map((contentLinks ?? []).map((r) => [r.content_id, r.role]));
  const productIds = (allProducts ?? []).map((p) => p.id);
  const contentIds = (allContent ?? []).map((c) => c.id);

  const fields: ReferenceFieldConfig[] = [
    {
      key: "media_type",
      label: "Media type",
      kind: "select",
      required: true,
      allowEmpty: false,
      options: [
        { value: "image", label: "Image" },
        { value: "video", label: "Video" },
      ],
    },
    { key: "alt_text", label: "Alt text", kind: "text" },
    { key: "width", label: "Width (px)", kind: "number" },
    { key: "height", label: "Height (px)", kind: "number" },
    { key: "license", label: "License", kind: "text" },
    { key: "creator", label: "Creator", kind: "text" },
  ];

  return (
    <div className="flex flex-col gap-8 max-w-3xl">
      <div>
        <PageHeader
          title="Edit media"
          action={
            <form action={deleteMediaAsset}>
              <input type="hidden" name="id" value={id} />
              <ConfirmDeleteButton confirmMessage="Delete this media asset? This removes the file(s) and all associations." />
            </form>
          }
        />
        <div className="mb-4 flex flex-col gap-2">
          <div className="flex items-center gap-3">
            <PublishToggle id={id} isPublished={isPublished} />
            <Badge
              tone={
                asset.rights_status === "restricted"
                  ? "red"
                  : asset.rights_status === "verified"
                    ? "green"
                    : asset.rights_status === "pending_verification"
                      ? "amber"
                      : "neutral"
              }
            >
              Rights: {(asset.rights_status ?? "unknown").replace("_", " ")}
            </Badge>
            {asset.brand_role && <Badge tone="amber">Brand: {asset.brand_role.replace(/_/g, " ")}</Badge>}
          </div>
          {!isPublished && !eligibility.allowed && (
            <p className="text-xs text-amber-700 max-w-md">{eligibility.reason}</p>
          )}
        </div>
        {asset.media_type === "image" && (
          <div className="relative w-full max-w-sm aspect-video bg-neutral-100 rounded-lg overflow-hidden mb-4">
            {previewUrl ? (
              <Image src={previewUrl} alt={asset.alt_text ?? ""} fill className="object-cover" unoptimized />
            ) : (
              <div className="flex items-center justify-center h-full text-xs text-neutral-500">
                No preview available
              </div>
            )}
          </div>
        )}
        <p className="text-xs text-neutral-500 mb-4 font-mono">{asset.storage_path}</p>
        <ReferenceForm
          fields={fields}
          defaultValues={asset}
          action={updateMediaAsset.bind(null, id)}
          submitLabel="Save changes"
        />
      </div>

      <Card className="p-5">
        <h2 className="text-sm font-semibold text-neutral-900 mb-3">Source, licensing &amp; provenance</h2>
        <ActionForm action={updateMediaProvenance.bind(null, id)} submitLabel="Save provenance">
          <input type="hidden" name={EDITED_FIELDS_INPUT} value={PROVENANCE_FIELDS_EDITED_HERE} />
          <p className="text-xs text-neutral-500">
            An externally-sourced asset marked Verified needs a source URL, a licence, and either a creator or
            attribution text. License and Creator are edited in the form above.
          </p>
          <Field label="Caption" htmlFor="caption">
            <TextInput id="caption" name="caption" defaultValue={asset.caption ?? ""} />
          </Field>
          <Field label="Source type" htmlFor="source_type">
            <Select id="source_type" name="source_type" defaultValue={asset.source_type ?? ""}>
              <option value="">Not specified</option>
              {SOURCE_TYPE_OPTIONS.map((o) => (
                <option key={o.value} value={o.value}>
                  {o.label}
                </option>
              ))}
            </Select>
          </Field>
          {/* Previously absent from this form while the action still wrote it,
              so every save nulled it — on production, 114 of 116 assets were one
              click from losing the classification that separates a product
              photograph from a concept render. */}
          <Field
            label="Editorial role"
            htmlFor="asset_role"
            hint="What this image IS. A concept render can never be product photography."
          >
            <Select id="asset_role" name="asset_role" defaultValue={asset.asset_role ?? ""}>
              <option value="">— not set —</option>
              {ASSET_ROLE_OPTIONS.map((o) => (
                <option key={o.value} value={o.value}>
                  {o.label}
                </option>
              ))}
            </Select>
          </Field>
          <Field
            label="Modification permitted?"
            htmlFor="licence_permits_modification"
            hint="Reuse permission is NOT modification permission. Leave unassessed unless the licence actually says."
          >
            <Select
              id="licence_permits_modification"
              name="licence_permits_modification"
              defaultValue={
                asset.licence_permits_modification === null || asset.licence_permits_modification === undefined
                  ? ""
                  : String(asset.licence_permits_modification)
              }
            >
              <option value="">Not assessed</option>
              <option value="true">Yes — the licence permits modification</option>
              <option value="false">No — no-derivatives licence</option>
            </Select>
          </Field>
          <Field label="Source URL" htmlFor="source_url">
            <TextInput id="source_url" name="source_url" type="url" defaultValue={asset.source_url ?? ""} />
          </Field>
          <Field label="Attribution text" htmlFor="attribution">
            <Textarea id="attribution" name="attribution" rows={2} defaultValue={asset.attribution ?? ""} />
          </Field>
          <div className="flex flex-col gap-2">
            <Checkbox
              id="attribution_required"
              name="attribution_required"
              label="Attribution required"
              defaultChecked={asset.attribution_required ?? false}
            />
            <Checkbox
              id="ai_generated"
              name="ai_generated"
              label="AI-generated"
              defaultChecked={asset.ai_generated ?? false}
            />
            <Checkbox
              id="owned"
              name="owned"
              label="Owned by Tech Carvalho"
              defaultChecked={asset.owned ?? false}
            />
          </div>
          <Field
            label="Rights status"
            htmlFor="rights_status"
            hint="Only Verified assets — or ones marked Owned, or a staff photograph — can be published."
          >
            <Select id="rights_status" name="rights_status" defaultValue={asset.rights_status ?? "unknown"}>
              {RIGHTS_STATUS_OPTIONS.map((o) => (
                <option key={o.value} value={o.value}>
                  {o.label}
                </option>
              ))}
            </Select>
          </Field>
          <Field
            label="Brand asset role"
            htmlFor="brand_role"
            hint="Leave as 'Not a brand asset' for product/article photography. Only for TechCarvalho's own logo/mark/icon files."
          >
            <Select id="brand_role" name="brand_role" defaultValue={asset.brand_role ?? ""}>
              <option value="">Not a brand asset</option>
              {BRAND_ROLE_OPTIONS.map((o) => (
                <option key={o.value} value={o.value}>
                  {o.label}
                </option>
              ))}
            </Select>
          </Field>
        </ActionForm>
      </Card>

      <Card className="p-5">
        <h2 className="text-sm font-semibold text-neutral-900 mb-3">Product associations</h2>
        {(allProducts ?? []).length === 0 ? (
          <p className="text-sm text-neutral-500">No products exist yet.</p>
        ) : (
          <ActionForm
            action={updateMediaProductAssociations.bind(null, id, productIds)}
            submitLabel="Save product associations"
            className="flex flex-col gap-3"
          >
            <div className="flex flex-col gap-2">
              {(allProducts ?? []).map((product) => (
                <div key={product.id} className="flex items-center gap-3">
                  <span className="text-sm text-neutral-800 flex-1">{product.name}</span>
                  <Select name={`role_${product.id}`} defaultValue={productRoleById.get(product.id) ?? ""} className="w-40">
                    <option value="">Not linked</option>
                    <option value="hero">Hero</option>
                    <option value="gallery">Gallery</option>
                    <option value="thumbnail">Thumbnail</option>
                  </Select>
                </div>
              ))}
            </div>
          </ActionForm>
        )}
      </Card>

      <Card className="p-5">
        <h2 className="text-sm font-semibold text-neutral-900 mb-3">Content associations</h2>
        {(allContent ?? []).length === 0 ? (
          <p className="text-sm text-neutral-500">No content items exist yet.</p>
        ) : (
          <ActionForm
            action={updateMediaContentAssociations.bind(null, id, contentIds)}
            submitLabel="Save content associations"
            className="flex flex-col gap-3"
          >
            <div className="flex flex-col gap-2">
              {(allContent ?? []).map((item) => (
                <div key={item.id} className="flex items-center gap-3">
                  <span className="text-sm text-neutral-800 flex-1">{item.title}</span>
                  <Select name={`role_${item.id}`} defaultValue={contentRoleById.get(item.id) ?? ""} className="w-40">
                    <option value="">Not linked</option>
                    <option value="hero">Hero</option>
                    <option value="gallery">Gallery</option>
                    <option value="thumbnail">Thumbnail</option>
                  </Select>
                </div>
              ))}
            </div>
          </ActionForm>
        )}
      </Card>
    </div>
  );
}
