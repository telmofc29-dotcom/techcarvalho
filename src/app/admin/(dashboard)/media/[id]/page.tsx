import Image from "next/image";
import { notFound } from "next/navigation";
import { requireAdmin } from "@/lib/dal";
import { createClient } from "@/lib/supabase/server";
import { getRowById } from "@/lib/admin/reference-service";
import { mediaPublicUrl } from "@/lib/media/public-url";
import { PageHeader, Card, Select } from "@/components/admin/ui";
import { SubmitButton, ConfirmDeleteButton } from "@/components/admin/submit-button";
import { ReferenceForm, type ReferenceFieldConfig } from "@/components/admin/reference-form";
import {
  updateMediaAsset,
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

  const supabase = await createClient();
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
    { key: "attribution", label: "Attribution", kind: "text" },
  ];

  return (
    <div className="flex flex-col gap-8 max-w-3xl">
      <div>
        <PageHeader
          title="Edit media"
          action={
            <form action={deleteMediaAsset}>
              <input type="hidden" name="id" value={id} />
              <ConfirmDeleteButton confirmMessage="Delete this media asset? This removes the file and all associations." />
            </form>
          }
        />
        {asset.media_type === "image" && (
          <div className="relative w-full max-w-sm aspect-video bg-neutral-100 rounded-lg overflow-hidden mb-4">
            <Image src={mediaPublicUrl(asset.storage_path)} alt={asset.alt_text ?? ""} fill className="object-cover" unoptimized />
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

      <Card className="p-5 bg-amber-50 border-amber-200">
        <h2 className="text-sm font-semibold text-amber-900 mb-1">Fields pending a schema migration</h2>
        <p className="text-xs text-amber-800">
          Caption, source type, creator, source URL, attribution-required flag, AI-generated flag, and owned
          flag were requested for this registry but have no backing columns yet. Draft additive columns are
          prepared under <code>supabase/migrations_pending/</code>, not yet applied.
        </p>
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
