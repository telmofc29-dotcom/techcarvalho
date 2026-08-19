import { requireAdmin } from "@/lib/dal";
import { listRows } from "@/lib/admin/reference-service";
import { PageHeader, Table, Th, Td, LinkButton, TextLink, EmptyState } from "@/components/admin/ui";
import { ConfirmDeleteButton } from "@/components/admin/submit-button";
import { deleteManufacturer } from "./actions";

export default async function ManufacturersPage() {
  await requireAdmin();
  const manufacturers = await listRows("manufacturers", { orderBy: "name" });

  return (
    <div>
      <PageHeader
        title="Manufacturers"
        description="Brands whose products appear in the catalog."
        action={<LinkButton href="/admin/manufacturers/new">New manufacturer</LinkButton>}
      />

      {manufacturers.length === 0 ? (
        <EmptyState
          title="No manufacturers yet"
          description="Add the first manufacturer to start building the product catalog."
          action={<LinkButton href="/admin/manufacturers/new">New manufacturer</LinkButton>}
        />
      ) : (
        <Table>
          <thead>
            <tr>
              <Th>Name</Th>
              <Th>Slug</Th>
              <Th>Website</Th>
              <Th />
            </tr>
          </thead>
          <tbody>
            {manufacturers.map((m) => (
              <tr key={m.id}>
                <Td className="font-medium text-neutral-900">{m.name}</Td>
                <Td className="text-neutral-500">{m.slug}</Td>
                <Td className="text-neutral-500">{m.website ?? "—"}</Td>
                <Td>
                  <div className="flex items-center gap-3 justify-end">
                    <TextLink href={`/admin/manufacturers/${m.id}`}>Edit</TextLink>
                    <form action={deleteManufacturer}>
                      <input type="hidden" name="id" value={m.id} />
                      <ConfirmDeleteButton
                        confirmMessage={`Delete manufacturer "${m.name}"? This cannot be undone.`}
                      />
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
