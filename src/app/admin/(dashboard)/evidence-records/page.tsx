import { requireAdmin } from "@/lib/dal";
import { createClient } from "@/lib/supabase/server";
import { listRowsPaginated } from "@/lib/admin/reference-service";
import { PageHeader, Card, Badge, EmptyState, QueryErrorBanner, TextLink } from "@/components/admin/ui";
import { Pagination } from "@/components/admin/pagination";

const PAGE_SIZE = 25;

export default async function EvidenceRecordsPage({
  searchParams,
}: {
  searchParams: Promise<{ page?: string }>;
}) {
  await requireAdmin();
  const { page: pageParam } = await searchParams;
  const page = Math.max(1, Number(pageParam) || 1);

  let rows: Awaited<ReturnType<typeof listRowsPaginated<"evidence_records">>>["rows"] = [];
  let total = 0;
  let pageCount = 1;
  let loadError: string | null = null;

  try {
    const result = await listRowsPaginated("evidence_records", {
      orderBy: "tested_at",
      ascending: false,
      page,
      pageSize: PAGE_SIZE,
    });
    rows = result.rows;
    total = result.total;
    pageCount = result.pageCount;
  } catch (e) {
    loadError = e instanceof Error ? e.message : "Failed to load evidence records.";
  }

  const productIds = [...new Set(rows.map((r) => r.product_id).filter((v): v is string => Boolean(v)))];
  const contentIds = [...new Set(rows.map((r) => r.content_id).filter((v): v is string => Boolean(v)))];

  const supabase = await createClient();
  const [{ data: products }, { data: contentItems }] = await Promise.all([
    productIds.length > 0
      ? supabase.from("products").select("id, name").in("id", productIds)
      : Promise.resolve({ data: [] as { id: string; name: string }[] }),
    contentIds.length > 0
      ? supabase.from("content_items").select("id, title").in("id", contentIds)
      : Promise.resolve({ data: [] as { id: string; title: string }[] }),
  ]);
  const productNameById = new Map((products ?? []).map((p) => [p.id, p.name]));
  const contentTitleById = new Map((contentItems ?? []).map((c) => [c.id, c.title]));

  return (
    <div>
      <PageHeader
        title="Evidence Records"
        description={`Read-only oversight across every product and content item (${total} total). Edit or add records from the parent's own edit page.`}
      />

      {loadError && <QueryErrorBanner message={loadError} />}

      {!loadError && rows.length === 0 ? (
        <EmptyState
          title="No evidence records yet"
          description="Evidence is added from a product or content item's edit page."
        />
      ) : !loadError ? (
        <>
          <Card className="overflow-hidden">
            <ul className="divide-y divide-neutral-100">
              {rows.map((row) => {
                const parentLabel = row.product_id
                  ? { href: `/admin/products/${row.product_id}`, label: productNameById.get(row.product_id) ?? "Unknown product" }
                  : { href: `/admin/content/${row.content_id}`, label: contentTitleById.get(row.content_id ?? "") ?? "Unknown content" };

                return (
                  <li key={row.id} className="p-4 flex flex-col gap-1">
                    <div className="flex items-center gap-2 text-sm">
                      <Badge>{row.test_type}</Badge>
                      <TextLink href={parentLabel.href}>{parentLabel.label}</TextLink>
                    </div>
                    <p className="text-sm text-neutral-700">{row.result_summary}</p>
                    <span className="text-xs text-neutral-400">
                      {new Date(row.tested_at).toLocaleDateString()}
                    </span>
                  </li>
                );
              })}
            </ul>
          </Card>
          <Pagination page={page} pageCount={pageCount} basePath="/admin/evidence-records" />
        </>
      ) : null}
    </div>
  );
}
