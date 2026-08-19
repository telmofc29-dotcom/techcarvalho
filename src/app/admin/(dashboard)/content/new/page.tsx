import { requireAdmin } from "@/lib/dal";
import { PageHeader } from "@/components/admin/ui";
import { ReferenceForm, type ReferenceFieldConfig } from "@/components/admin/reference-form";
import { createContentItem } from "../actions";

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
    ],
  },
  {
    key: "published_at",
    label: "Publish at",
    kind: "datetime",
    hint: "Content is only public once status is Published and this time has passed.",
  },
];

export default async function NewContentPage() {
  await requireAdmin();
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
