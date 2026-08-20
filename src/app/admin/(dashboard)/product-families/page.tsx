import { requireAdmin } from "@/lib/dal";
import { listRows, listRowsPaginated } from "@/lib/admin/reference-service";
import { ADMIN_PAGE_SIZE, parsePage } from "@/lib/admin/pagination";
import { PageHeader, Table, Th, Td, LinkButton, TextLink, EmptyState } from "@/components/admin/ui";
import { Pagination } from "@/components/admin/pagination";
import { ConfirmDeleteButton } from "@/components/admin/submit-button";
import { deleteProductFamily } from "./actions";

export default async function ProductFamiliesPage({
  searchParams,
}: {
  searchParams: Promise<{ page?: string }>;
}) {
  await requireAdmin();
  const { page: rawPage } = await searchParams;
  const page = parsePage(rawPage);
  const [{ rows: families, pageCount }, categories] = await Promise.all([
    listRowsPaginated("product_families", { orderBy: "name", page, pageSize: ADMIN_PAGE_SIZE }),
    listRows("taxonomy_categories"),
  ]);
  const categoryName = new Map(categories.map((c) => [c.id, c.name]));

  return (
    <div>
      <PageHeader
        title="Product Families"
        description="Model lines that group related products (e.g. a camera series)."
        action={<LinkButton href="/admin/product-families/new">New product family</LinkButton>}
      />

      {families.length === 0 ? (
        <EmptyState
          title="No product families yet"
          action={<LinkButton href="/admin/product-families/new">New product family</LinkButton>}
        />
      ) : (
        <>
          <Table>
            <thead>
              <tr>
                <Th>Name</Th>
                <Th>Slug</Th>
                <Th>Category</Th>
                <Th />
              </tr>
            </thead>
            <tbody>
              {families.map((f) => (
                <tr key={f.id}>
                  <Td className="font-medium text-neutral-900">{f.name}</Td>
                  <Td className="text-neutral-500">{f.slug}</Td>
                  <Td className="text-neutral-500">{f.category_id ? categoryName.get(f.category_id) ?? "—" : "—"}</Td>
                  <Td>
                    <div className="flex items-center gap-3 justify-end">
                      <TextLink href={`/admin/product-families/${f.id}`}>Edit</TextLink>
                      <form action={deleteProductFamily}>
                        <input type="hidden" name="id" value={f.id} />
                        <ConfirmDeleteButton confirmMessage={`Delete product family "${f.name}"?`} />
                      </form>
                    </div>
                  </Td>
                </tr>
              ))}
            </tbody>
          </Table>
          <Pagination page={page} pageCount={pageCount} basePath="/admin/product-families" />
        </>
      )}
    </div>
  );
}
