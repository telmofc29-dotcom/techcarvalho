import Link from "next/link";
import { requireAdmin } from "@/lib/dal";
import { createClient } from "@/lib/supabase/server";
import { sanitizeSearchTerm } from "@/lib/search/sanitize";
import { ADMIN_PAGE_SIZE, parsePage } from "@/lib/admin/pagination";
import { PageHeader, Table, Th, Td, LinkButton, TextLink, EmptyState, Badge, QueryErrorBanner } from "@/components/admin/ui";
import { SearchBox } from "@/components/admin/search-box";
import { Pagination } from "@/components/admin/pagination";
import { ConfirmDeleteButton } from "@/components/admin/submit-button";
import { deleteContentItem } from "./actions";
import type { ContentStatus } from "@/lib/types/database";

const STATUS_FILTERS: { label: string; value: ContentStatus | "" }[] = [
  { label: "All", value: "" },
  { label: "Draft", value: "draft" },
  { label: "Published", value: "published" },
  { label: "Archived", value: "archived" },
];

export default async function ContentListPage({
  searchParams,
}: {
  searchParams: Promise<{ q?: string; status?: string; page?: string }>;
}) {
  await requireAdmin();
  const { q: rawQ, status, page: rawPage } = await searchParams;
  const q = rawQ ? sanitizeSearchTerm(rawQ) : "";
  const page = parsePage(rawPage);
  const from = (page - 1) * ADMIN_PAGE_SIZE;
  const to = from + ADMIN_PAGE_SIZE - 1;

  const supabase = await createClient();
  let query = supabase
    .from("content_items")
    .select("*", { count: "exact" })
    .order("updated_at", { ascending: false })
    .range(from, to);
  if (q) query = query.ilike("title", `%${q}%`);
  if (status === "draft" || status === "published" || status === "archived") query = query.eq("status", status);
  const { data: content, count, error } = await query;
  const pageCount = Math.max(1, Math.ceil((count ?? 0) / ADMIN_PAGE_SIZE));

  return (
    <div>
      <PageHeader
        title="Content"
        description="Reviews, guides, comparisons, and news. Only published items are visible on the public site."
        action={<LinkButton href="/admin/content/new">New content</LinkButton>}
      />

      <div className="flex flex-col sm:flex-row sm:items-center gap-3 mb-4">
        <SearchBox action="/admin/content" placeholder="Search by title..." defaultValue={q} />
        <div className="flex gap-2">
          {STATUS_FILTERS.map((f) => (
            <Link
              key={f.value}
              href={`/admin/content${f.value ? `?status=${f.value}` : ""}`}
              className={`rounded-full px-3 py-1 text-xs font-medium ${
                (status ?? "") === f.value ? "bg-neutral-900 text-white" : "bg-neutral-100 text-neutral-600"
              }`}
            >
              {f.label}
            </Link>
          ))}
        </div>
      </div>

      {error && <QueryErrorBanner message={error.message} />}

      {(content ?? []).length === 0 ? (
        !error && (
          <EmptyState
            title={q || status ? "No content matches your filters" : "No content yet"}
            description={
              q || status
                ? undefined
                : "Nothing has been written yet — the public site will honestly show an empty state until content is published."
            }
            action={!q && !status ? <LinkButton href="/admin/content/new">New content</LinkButton> : undefined}
          />
        )
      ) : (
        <>
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
              {(content ?? []).map((c) => (
                <tr key={c.id}>
                  <Td className="font-medium text-neutral-900">{c.title}</Td>
                  <Td>
                    <Badge>{c.type}</Badge>
                  </Td>
                  <Td>
                    <Badge tone={c.status === "published" ? "green" : c.status === "archived" ? "amber" : "neutral"}>
                      {c.status}
                    </Badge>
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
          <Pagination page={page} pageCount={pageCount} basePath="/admin/content" searchParams={{ q, status }} />
        </>
      )}
    </div>
  );
}
