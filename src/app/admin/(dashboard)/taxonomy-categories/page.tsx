import { requireAdmin } from "@/lib/dal";
import { listRows } from "@/lib/admin/reference-service";
import { PageHeader, Table, Th, Td, LinkButton, TextLink, EmptyState } from "@/components/admin/ui";
import { ConfirmDeleteButton } from "@/components/admin/submit-button";
import { deleteTaxonomyCategory } from "./actions";

export default async function TaxonomyCategoriesPage() {
  await requireAdmin();
  const categories = await listRows("taxonomy_categories", { orderBy: "sort_order" });
  const nameById = new Map(categories.map((c) => [c.id, c.name]));

  return (
    <div>
      <PageHeader
        title="Taxonomy Categories"
        description="Subject areas used to organize products and public navigation."
        action={<LinkButton href="/admin/taxonomy-categories/new">New category</LinkButton>}
      />

      {categories.length === 0 ? (
        <EmptyState
          title="No categories yet"
          description="Create categories to match the site's planned subject areas (e.g. Cameras & Photography)."
          action={<LinkButton href="/admin/taxonomy-categories/new">New category</LinkButton>}
        />
      ) : (
        <Table>
          <thead>
            <tr>
              <Th>Name</Th>
              <Th>Slug</Th>
              <Th>Parent</Th>
              <Th>Sort</Th>
              <Th />
            </tr>
          </thead>
          <tbody>
            {categories.map((c) => (
              <tr key={c.id}>
                <Td className="font-medium text-neutral-900">{c.name}</Td>
                <Td className="text-neutral-500">{c.slug}</Td>
                <Td className="text-neutral-500">{c.parent_id ? nameById.get(c.parent_id) ?? "—" : "—"}</Td>
                <Td className="text-neutral-500">{c.sort_order}</Td>
                <Td>
                  <div className="flex items-center gap-3 justify-end">
                    <TextLink href={`/admin/taxonomy-categories/${c.id}`}>Edit</TextLink>
                    <form action={deleteTaxonomyCategory}>
                      <input type="hidden" name="id" value={c.id} />
                      <ConfirmDeleteButton confirmMessage={`Delete category "${c.name}"?`} />
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
