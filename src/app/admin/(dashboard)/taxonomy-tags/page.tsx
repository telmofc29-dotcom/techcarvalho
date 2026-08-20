import { requireAdmin } from "@/lib/dal";
import { listRowsPaginated } from "@/lib/admin/reference-service";
import { ADMIN_PAGE_SIZE, parsePage } from "@/lib/admin/pagination";
import { PageHeader, Table, Th, Td, LinkButton, TextLink, EmptyState } from "@/components/admin/ui";
import { Pagination } from "@/components/admin/pagination";
import { ConfirmDeleteButton } from "@/components/admin/submit-button";
import { deleteTaxonomyTag } from "./actions";

export default async function TaxonomyTagsPage({
  searchParams,
}: {
  searchParams: Promise<{ page?: string }>;
}) {
  await requireAdmin();
  const { page: rawPage } = await searchParams;
  const page = parsePage(rawPage);
  const { rows: tags, pageCount } = await listRowsPaginated("taxonomy_tags", {
    orderBy: "name",
    page,
    pageSize: ADMIN_PAGE_SIZE,
  });

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
        <>
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
          <Pagination page={page} pageCount={pageCount} basePath="/admin/taxonomy-tags" />
        </>
      )}
    </div>
  );
}
