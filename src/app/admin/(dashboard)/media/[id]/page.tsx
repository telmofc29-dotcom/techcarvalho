import Image from "next/image";
import { notFound } from "next/navigation";
import { requireAdmin } from "@/lib/dal";
import { createClient } from "@/lib/supabase/server";
import { getRowById } from "@/lib/admin/reference-service";
import { getAdminPreviewUrl } from "@/lib/media/admin-preview-url";
import { evaluatePublishEligibility } from "@/lib/media/rights";
import { PageHeader, Card, Select, Checkbox, Textarea, Field, TextInput, Badge } from "@/components/admin/ui";
import { SubmitButton, ConfirmDeleteButton } from "@/components/admin/submit-button";
import { ReferenceForm, type ReferenceFieldConfig } from "@/components/admin/reference-form";
import { PublishToggle } from "../publish-toggle";
import {
  updateMediaAsset,
  updateMediaProvenance,
  deleteMediaAsset,
  updateMediaProductAssociations,
  updateMediaContentAssociations,
} from "../actions";

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
        <form action={updateMediaProvenance.bind(null, id)} className="flex flex-col gap-4">
          <Field label="Caption" htmlFor="caption">
            <TextInput id="caption" name="caption" defaultValue={asset.caption ?? ""} />
          </Field>
          <Field label="Source type" htmlFor="source_type">
            <Select id="source_type" name="source_type" defaultValue={asset.source_type ?? ""}>
              <option value="">Not specified</option>
              <option value="manufacturer">Manufacturer</option>
              <option value="staff_photograph">Staff photograph</option>
              <option value="stock_licensed">Stock (licensed)</option>
              <option value="user_submitted">User submitted</option>
              <option value="press_kit">Press kit</option>
              <option value="public_domain_or_cc">Public domain / Creative Commons</option>
              <option value="tc_graphic">TechCarvalho-created graphic/diagram</option>
              <option value="other">Other</option>
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
              <option value="unknown">Unknown</option>
              <option value="pending_verification">Pending verification</option>
              <option value="verified">Verified</option>
              <option value="restricted">Restricted (never publish)</option>
            </Select>
          </Field>
          <Field
            label="Brand asset role"
            htmlFor="brand_role"
            hint="Leave as 'Not a brand asset' for product/article photography. Only for TechCarvalho's own logo/mark/icon files."
          >
            <Select id="brand_role" name="brand_role" defaultValue={asset.brand_role ?? ""}>
              <option value="">Not a brand asset</option>
              <option value="logo_full">Full logo (mark + wordmark)</option>
              <option value="logo_full_tagline">Full logo + tagline</option>
              <option value="wordmark">Wordmark only</option>
              <option value="wordmark_tagline">Wordmark + tagline</option>
              <option value="mark">Mark / monogram only</option>
              <option value="favicon">Favicon candidate</option>
              <option value="og_image">Social / OG image candidate</option>
            </Select>
          </Field>
          <div>
            <SubmitButton pendingLabel="Saving...">Save provenance</SubmitButton>
          </div>
        </form>
      </Card>

      <Card className="p-5">
        <h2 className="text-sm font-semibold text-neutral-900 mb-3">Product associations</h2>
        {(allProducts ?? []).length === 0 ? (
          <p className="text-sm text-neutral-500">No products exist yet.</p>
        ) : (
          <form action={updateMediaProductAssociations.bind(null, id, productIds)} className="flex flex-col gap-3">
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
            <div>
              <SubmitButton pendingLabel="Saving...">Save product associations</SubmitButton>
            </div>
          </form>
        )}
      </Card>

      <Card className="p-5">
        <h2 className="text-sm font-semibold text-neutral-900 mb-3">Content associations</h2>
        {(allContent ?? []).length === 0 ? (
          <p className="text-sm text-neutral-500">No content items exist yet.</p>
        ) : (
          <form action={updateMediaContentAssociations.bind(null, id, contentIds)} className="flex flex-col gap-3">
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
            <div>
              <SubmitButton pendingLabel="Saving...">Save content associations</SubmitButton>
            </div>
          </form>
        )}
      </Card>
    </div>
  );
}
