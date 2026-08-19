import { requireAdmin } from "@/lib/dal";
import { listRows } from "@/lib/admin/reference-service";
import { PageHeader, Table, Th, Td, LinkButton, TextLink, EmptyState } from "@/components/admin/ui";
import { ConfirmDeleteButton } from "@/components/admin/submit-button";
import { deleteTaxonomyTag } from "./actions";

export default async function TaxonomyTagsPage() {
  await requireAdmin();
  const tags = await listRows("taxonomy_tags", { orderBy: "name" });

  return (
    <div>
      <PageHeader
        title="Taxonomy Tags"
        description="Free-form labels attached to products and content."
        action={<LinkButton href="/admin/taxonomy-tags/new">New tag</LinkButton>}
      />

      {tags.length === 0 ? (
        <EmptyState title="No tags yet" action={<LinkButton href="/admin/taxonomy-tags/new">New tag</LinkButton>} />
      ) : (
        <Table>
          <thead>
            <tr>
              <Th>Name</Th>
              <Th>Slug</Th>
              <Th />
            </tr>
          </thead>
          <tbody>
            {tags.map((t) => (
              <tr key={t.id}>
                <Td className="font-medium text-neutral-900">{t.name}</Td>
                <Td className="text-neutral-500">{t.slug}</Td>
                <Td>
                  <div className="flex items-center gap-3 justify-end">
                    <TextLink href={`/admin/taxonomy-tags/${t.id}`}>Edit</TextLink>
                    <form action={deleteTaxonomyTag}>
                      <input type="hidden" name="id" value={t.id} />
                      <ConfirmDeleteButton confirmMessage={`Delete tag "${t.name}"?`} />
                    </form>
                  </div>
                </Td>
              </tr>
            ))}
          </tbody>
        </Table>
      )}
    </div>
  );
}
