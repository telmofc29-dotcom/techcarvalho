import { notFound } from "next/navigation";
import { requireAdmin } from "@/lib/dal";
import { createClient } from "@/lib/supabase/server";
import { getRowById } from "@/lib/admin/reference-service";
import { PageHeader, Card, Checkbox, Field, TextInput, Select, Badge } from "@/components/admin/ui";
import { SubmitButton } from "@/components/admin/submit-button";
import { ReferenceForm, type ReferenceFieldConfig } from "@/components/admin/reference-form";
import {
  updateContentItem,
  updateContentTags,
  updateContentProducts,
  updateContentSeo,
  logContentFreshnessReview,
} from "../actions";

function toDatetimeLocal(iso: string | null): string {
  if (!iso) return "";
  const d = new Date(iso);
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

export default async function EditContentPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  await requireAdmin();
  const { id } = await params;

  const content = await getRowById("content_items", id);
  if (!content) notFound();

  const supabase = await createClient();
  const [
    { data: allTags },
    { data: contentTagRows },
    { data: allProducts },
    { data: contentProductRows },
    { data: seo },
    { data: freshnessEntries },
  ] = await Promise.all([
    supabase.from("taxonomy_tags").select("*").order("name"),
    supabase.from("content_tags").select("tag_id").eq("content_id", id),
    supabase.from("products").select("id, name").order("name"),
    supabase.from("content_products").select("product_id, role").eq("content_id", id),
    supabase.from("seo_metadata").select("*").eq("content_id", id).maybeSingle(),
    supabase.from("freshness_log").select("*").eq("content_id", id).order("reviewed_at", { ascending: false }),
  ]);

  const selectedTagIds = new Set((contentTagRows ?? []).map((r) => r.tag_id));
  const roleByProductId = new Map((contentProductRows ?? []).map((r) => [r.product_id, r.role]));
  const productIds = (allProducts ?? []).map((p) => p.id);

  const fields: ReferenceFieldConfig[] = [
    {
      key: "type",
      label: "Content type",
      kind: "select",
      required: true,
      allowEmpty: false,
      options: [
        { value: "review", label: "Review" },
        { value: "guide", label: "Guide" },
        { value: "comparison", label: "Comparison" },
        { value: "news", label: "News" },
      ],
    },
    { key: "title", label: "Title", kind: "text", required: true },
    { key: "slug", label: "Slug", kind: "text" },
    { key: "body", label: "Body", kind: "textarea" },
    {
      key: "status",
      label: "Status",
      kind: "select",
      required: true,
      allowEmpty: false,
      options: [
        { value: "draft", label: "Draft" },
        { value: "published", label: "Published" },
      ],
    },
    { key: "published_at", label: "Publish at", kind: "datetime" },
  ];

  const defaultValues = { ...content, published_at: toDatetimeLocal(content.published_at) };

  return (
    <div className="flex flex-col gap-8 max-w-3xl">
      <div>
        <PageHeader title={`Edit ${content.title}`} />
        <ReferenceForm
          fields={fields}
          defaultValues={defaultValues}
          action={updateContentItem.bind(null, id)}
          submitLabel="Save changes"
        />
      </div>

      <Card className="p-5 bg-amber-50 border-amber-200">
        <h2 className="text-sm font-semibold text-amber-900 mb-1">Fields pending a schema migration</h2>
        <p className="text-xs text-amber-800">
          Primary taxonomy/category, search intent, primary query, and intent fingerprint were requested for
          this registry but have no backing columns in the applied schema yet. A draft, additive migration for
          these (plus a proper &quot;archived&quot; status) is prepared under{" "}
          <code>supabase/migrations_pending/</code> and needs review and manual application before this form can
          safely support them.
        </p>
      </Card>

      <Card className="p-5">
        <h2 className="text-sm font-semibold text-neutral-900 mb-3">Tags</h2>
        {(allTags ?? []).length === 0 ? (
          <p className="text-sm text-neutral-500">No taxonomy tags exist yet.</p>
        ) : (
          <form action={updateContentTags.bind(null, id)} className="flex flex-col gap-3">
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
        <h2 className="text-sm font-semibold text-neutral-900 mb-3">Product associations</h2>
        {(allProducts ?? []).length === 0 ? (
          <p className="text-sm text-neutral-500">No products exist yet.</p>
        ) : (
          <form action={updateContentProducts.bind(null, id, productIds)} className="flex flex-col gap-3">
            <div className="flex flex-col gap-2">
              {(allProducts ?? []).map((product) => (
                <div key={product.id} className="flex items-center gap-3">
                  <span className="text-sm text-neutral-800 flex-1">{product.name}</span>
                  <Select name={`role_${product.id}`} defaultValue={roleByProductId.get(product.id) ?? ""} className="w-48">
                    <option value="">Not linked</option>
                    <option value="primary_subject">Primary subject</option>
                    <option value="mentioned">Mentioned</option>
                    <option value="compared_against">Compared against</option>
                  </Select>
                </div>
              ))}
            </div>
            <div>
              <SubmitButton pendingLabel="Saving associations...">Save associations</SubmitButton>
            </div>
          </form>
        )}
      </Card>

      <Card className="p-5">
        <h2 className="text-sm font-semibold text-neutral-900 mb-3">SEO metadata</h2>
        <form action={updateContentSeo.bind(null, id)} className="flex flex-col gap-4">
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
        <h2 className="text-sm font-semibold text-neutral-900 mb-3">Freshness</h2>
        <form action={logContentFreshnessReview.bind(null, id)} className="flex flex-col gap-3 mb-5">
          <Field label="Log a freshness review" htmlFor="reason" hint="Records that this content was checked/updated today.">
            <TextInput id="reason" name="reason" placeholder="e.g. Verified pricing and availability" required />
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
