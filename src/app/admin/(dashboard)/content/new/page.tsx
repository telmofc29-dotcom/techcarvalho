import { requireAdmin } from "@/lib/dal";
import { listRows } from "@/lib/admin/reference-service";
import { createClient } from "@/lib/supabase/server";
import { PageHeader } from "@/components/admin/ui";
import { ReferenceForm, type ReferenceFieldConfig } from "@/components/admin/reference-form";
import { CannibalisationCheck } from "@/components/admin/cannibalisation-check";
import { CONTENT_TYPE_OPTIONS, CONTENT_STATUS_OPTIONS } from "@/lib/admin/content-options";
import { createContentItem } from "../actions";

export default async function NewContentPage() {
  await requireAdmin();
  const categories = await listRows("taxonomy_categories", { orderBy: "name" });

  const supabase = await createClient();
  const { data: existingContent } = await supabase
    .from("content_items")
    .select("id, title, primary_query, intent_fingerprint")
    .neq("status", "archived");

  const fields: ReferenceFieldConfig[] = [
    {
      key: "type",
      label: "Content type",
      kind: "select",
      required: true,
      allowEmpty: false,
      options: CONTENT_TYPE_OPTIONS,
    },
    { key: "title", label: "Title", kind: "text", required: true },
    { key: "slug", label: "Slug", kind: "text", hint: "Leave blank to generate from the title." },
    {
      key: "body",
      label: "Body",
      kind: "textarea",
      hint: "Plain text. Blank lines separate paragraphs; \"## \"/\"### \" for headings, \"- \" for a bullet list.",
    },
    {
      key: "status",
      label: "Status",
      kind: "select",
      required: true,
      allowEmpty: false,
      options: CONTENT_STATUS_OPTIONS,
    },
    {
      key: "published_at",
      label: "Publish at",
      kind: "datetime",
      hint: "Content is only public once status is Published and this time has passed. Leave blank when setting Status to Published and it's filled in automatically with the current time — only set this yourself for a specific past/future date.",
    },
    {
      key: "category_id",
      label: "Primary category",
      kind: "select",
      emptyLabel: "No category",
      options: categories.map((c) => ({ value: c.id, label: c.name })),
    },
    {
      key: "search_intent",
      label: "Search intent",
      kind: "select",
      emptyLabel: "Not specified",
      options: [
        { value: "informational", label: "Informational" },
        { value: "commercial", label: "Commercial" },
        { value: "transactional", label: "Transactional" },
        { value: "navigational", label: "Navigational" },
      ],
    },
    { key: "primary_query", label: "Primary target query", kind: "text", hint: "The main search query this piece targets." },
    {
      key: "intent_fingerprint",
      label: "Intent fingerprint",
      kind: "text",
      hint: "Free-form identifier for the query cluster this targets — useful for spotting duplicate/competing content.",
    },
  ];

  return (
    <div>
      <PageHeader
        title="New content"
        description="Tags, product associations, SEO, and freshness tracking can be added after creation."
      />
      <CannibalisationCheck existing={existingContent ?? []}>
        <ReferenceForm fields={fields} action={createContentItem} submitLabel="Create content" />
      </CannibalisationCheck>
    </div>
  );
}
