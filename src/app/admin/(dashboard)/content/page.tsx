import { requireAdmin } from "@/lib/dal";
import { listRows } from "@/lib/admin/reference-service";
import { PageHeader, Table, Th, Td, LinkButton, TextLink, EmptyState, Badge } from "@/components/admin/ui";
import { ConfirmDeleteButton } from "@/components/admin/submit-button";
import { deleteContentItem } from "./actions";

export default async function ContentListPage() {
  await requireAdmin();
  const content = await listRows("content_items", { orderBy: "updated_at", ascending: false });

  return (
    <div>
      <PageHeader
        title="Content"
        description="Reviews, guides, comparisons, and news. Only published items are visible on the public site."
        action={<LinkButton href="/admin/content/new">New content</LinkButton>}
      />

      {content.length === 0 ? (
        <EmptyState
          title="No content yet"
          description="Nothing has been written yet — the public site will honestly show an empty state until content is published."
          action={<LinkButton href="/admin/content/new">New content</LinkButton>}
        />
      ) : (
        <Table>
          <thead>
            <tr>
              <Th>Title</Th>
              <Th>Type</Th>
              <Th>Status</Th>
              <Th>Published at</Th>
              <Th />
            </tr>
          </thead>
          <tbody>
            {content.map((c) => (
              <tr key={c.id}>
                <Td className="font-medium text-neutral-900">{c.title}</Td>
                <Td>
                  <Badge>{c.type}</Badge>
                </Td>
                <Td>
                  <Badge tone={c.status === "published" ? "green" : "neutral"}>{c.status}</Badge>
                </Td>
                <Td className="text-neutral-500">
                  {c.published_at ? new Date(c.published_at).toLocaleString() : "—"}
                </Td>
                <Td>
                  <div className="flex items-center gap-3 justify-end">
                    <TextLink href={`/admin/content/${c.id}`}>Edit</TextLink>
                    <form action={deleteContentItem}>
                      <input type="hidden" name="id" value={c.id} />
                      <ConfirmDeleteButton confirmMessage={`Delete "${c.title}"? This removes its tags, associations, SEO metadata, and freshness history.`} />
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
