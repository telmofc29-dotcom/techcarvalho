import { requireAdmin } from "@/lib/dal";
import { listRows } from "@/lib/admin/reference-service";
import { PageHeader, Table, Th, Td, LinkButton, TextLink, EmptyState, Badge } from "@/components/admin/ui";
import { ConfirmDeleteButton } from "@/components/admin/submit-button";
import { deleteSpecDefinition } from "./actions";

export default async function SpecDefinitionsPage() {
  await requireAdmin();
  const [specs, categories] = await Promise.all([
    listRows("spec_definitions", { orderBy: "name" }),
    listRows("taxonomy_categories"),
  ]);
  const categoryName = new Map(categories.map((c) => [c.id, c.name]));

  return (
    <div>
      <PageHeader
        title="Spec Definitions"
        description="Attribute definitions available for products (e.g. Sensor size, Megapixels)."
        action={<LinkButton href="/admin/spec-definitions/new">New spec definition</LinkButton>}
      />

      {specs.length === 0 ? (
        <EmptyState
          title="No spec definitions yet"
          action={<LinkButton href="/admin/spec-definitions/new">New spec definition</LinkButton>}
        />
      ) : (
        <Table>
          <thead>
            <tr>
              <Th>Name</Th>
              <Th>Data type</Th>
              <Th>Unit</Th>
              <Th>Category</Th>
              <Th />
            </tr>
          </thead>
          <tbody>
            {specs.map((s) => (
              <tr key={s.id}>
                <Td className="font-medium text-neutral-900">{s.name}</Td>
                <Td>
                  <Badge>{s.data_type}</Badge>
                </Td>
                <Td className="text-neutral-500">{s.unit ?? "—"}</Td>
                <Td className="text-neutral-500">{s.category_id ? categoryName.get(s.category_id) ?? "—" : "Any"}</Td>
                <Td>
                  <div className="flex items-center gap-3 justify-end">
                    <TextLink href={`/admin/spec-definitions/${s.id}`}>Edit</TextLink>
                    <form action={deleteSpecDefinition}>
                      <input type="hidden" name="id" value={s.id} />
                      <ConfirmDeleteButton confirmMessage={`Delete spec definition "${s.name}"?`} />
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
