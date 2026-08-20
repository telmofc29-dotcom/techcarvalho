import { requireAdmin } from "@/lib/dal";
import { listRows, listRowsPaginated } from "@/lib/admin/reference-service";
import { ADMIN_PAGE_SIZE, parsePage } from "@/lib/admin/pagination";
import { PageHeader, Table, Th, Td, LinkButton, TextLink, EmptyState } from "@/components/admin/ui";
import { Pagination } from "@/components/admin/pagination";
import { ConfirmDeleteButton } from "@/components/admin/submit-button";
import { deleteTaxonomyCategory } from "./actions";

export default async function TaxonomyCategoriesPage({
  searchParams,
}: {
  searchParams: Promise<{ page?: string }>;
}) {
  await requireAdmin();
  const { page: rawPage } = await searchParams;
  const page = parsePage(rawPage);
  const [{ rows: categories, pageCount }, allCategories] = await Promise.all([
    listRowsPaginated("taxonomy_categories", { orderBy: "sort_order", page, pageSize: ADMIN_PAGE_SIZE }),
    listRows("taxonomy_categories"),
  ]);
  const nameById = new Map(allCategories.map((c) => [c.id, c.name]));

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
        <>
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
          <Pagination page={page} pageCount={pageCount} basePath="/admin/taxonomy-categories" />
        </>
      )}
    </div>
  );
}
