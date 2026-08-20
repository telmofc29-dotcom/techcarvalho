import { requireAdmin } from "@/lib/dal";
import { listRows } from "@/lib/admin/reference-service";
import { PageHeader } from "@/components/admin/ui";
import { ReferenceForm, type ReferenceFieldConfig } from "@/components/admin/reference-form";
import { createContentItem } from "../actions";

export default async function NewContentPage() {
  await requireAdmin();
  const categories = await listRows("taxonomy_categories", { orderBy: "name" });

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
    { key: "slug", label: "Slug", kind: "text", hint: "Leave blank to generate from the title." },
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
        { value: "archived", label: "Archived" },
      ],
    },
    {
      key: "published_at",
      label: "Publish at",
      kind: "datetime",
      hint: "Content is only public once status is Published and this time has passed.",
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
      <ReferenceForm fields={fields} action={createContentItem} submitLabel="Create content" />
    </div>
  );
}
