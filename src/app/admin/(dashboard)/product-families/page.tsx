import { requireAdmin } from "@/lib/dal";
import { listRows } from "@/lib/admin/reference-service";
import { PageHeader, Table, Th, Td, LinkButton, TextLink, EmptyState } from "@/components/admin/ui";
import { ConfirmDeleteButton } from "@/components/admin/submit-button";
import { deleteProductFamily } from "./actions";

export default async function ProductFamiliesPage() {
  await requireAdmin();
  const [families, categories] = await Promise.all([
    listRows("product_families", { orderBy: "name" }),
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
      )}
    </div>
  );
}
