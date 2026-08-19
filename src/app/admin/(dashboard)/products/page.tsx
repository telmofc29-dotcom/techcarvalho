import { requireAdmin } from "@/lib/dal";
import { listRows } from "@/lib/admin/reference-service";
import { PageHeader, Table, Th, Td, LinkButton, TextLink, EmptyState, Badge } from "@/components/admin/ui";
import { ConfirmDeleteButton } from "@/components/admin/submit-button";
import { deleteProduct } from "./actions";

export default async function ProductsPage() {
  await requireAdmin();
  const [products, manufacturers, categories] = await Promise.all([
    listRows("products", { orderBy: "updated_at", ascending: false }),
    listRows("manufacturers"),
    listRows("taxonomy_categories"),
  ]);
  const manufacturerName = new Map(manufacturers.map((m) => [m.id, m.name]));
  const categoryName = new Map(categories.map((c) => [c.id, c.name]));

  return (
    <div>
      <PageHeader
        title="Products"
        description="The product catalog. Only published products are visible on the public site."
        action={<LinkButton href="/admin/products/new">New product</LinkButton>}
      />

      {products.length === 0 ? (
        <EmptyState title="No products yet" action={<LinkButton href="/admin/products/new">New product</LinkButton>} />
      ) : (
        <Table>
          <thead>
            <tr>
              <Th>Name</Th>
              <Th>Manufacturer</Th>
              <Th>Category</Th>
              <Th>Status</Th>
              <Th>Published</Th>
              <Th />
            </tr>
          </thead>
          <tbody>
            {products.map((p) => (
              <tr key={p.id}>
                <Td className="font-medium text-neutral-900">{p.name}</Td>
                <Td className="text-neutral-500">{manufacturerName.get(p.manufacturer_id) ?? "—"}</Td>
                <Td className="text-neutral-500">{categoryName.get(p.category_id) ?? "—"}</Td>
                <Td>
                  <Badge tone={p.status === "active" ? "green" : p.status === "rumored" ? "amber" : "neutral"}>
                    {p.status}
                  </Badge>
                </Td>
                <Td>
                  <Badge tone={p.is_published ? "green" : "neutral"}>{p.is_published ? "Published" : "Draft"}</Badge>
                </Td>
                <Td>
                  <div className="flex items-center gap-3 justify-end">
                    <TextLink href={`/admin/products/${p.id}`}>Edit</TextLink>
                    <form action={deleteProduct}>
                      <input type="hidden" name="id" value={p.id} />
                      <ConfirmDeleteButton confirmMessage={`Delete product "${p.name}"? This removes its specs, tags, and media links.`} />
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
