import { requireAdmin } from "@/lib/dal";
import { PageHeader } from "@/components/admin/ui";
import { ReferenceForm, type ReferenceFieldConfig } from "@/components/admin/reference-form";
import { createTaxonomyTag } from "../actions";

const fields: ReferenceFieldConfig[] = [
  { key: "name", label: "Name", kind: "text", required: true },
  { key: "slug", label: "Slug", kind: "text", hint: "Leave blank to generate from the name." },
];

export default async function NewTaxonomyTagPage() {
  await requireAdmin();
  return (
    <div>
      <PageHeader title="New taxonomy tag" />
      <ReferenceForm fields={fields} action={createTaxonomyTag} submitLabel="Create tag" />
    </div>
  );
}
