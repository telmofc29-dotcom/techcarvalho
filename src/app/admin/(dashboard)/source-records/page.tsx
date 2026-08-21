import { requireAdmin } from "@/lib/dal";
import { createClient } from "@/lib/supabase/server";
import { listRowsPaginated } from "@/lib/admin/reference-service";
import { PageHeader, Card, Badge, EmptyState, QueryErrorBanner, TextLink } from "@/components/admin/ui";
import { Pagination } from "@/components/admin/pagination";
import type { ReliabilityTier } from "@/lib/types/database";

const PAGE_SIZE = 25;

const RELIABILITY_TONE: Record<ReliabilityTier, "green" | "blue" | "neutral"> = {
  primary: "green",
  secondary: "blue",
  community: "neutral",
};

export default async function SourceRecordsPage({
  searchParams,
}: {
  searchParams: Promise<{ page?: string }>;
}) {
  await requireAdmin();
  const { page: pageParam } = await searchParams;
  const page = Math.max(1, Number(pageParam) || 1);

  let rows: Awaited<ReturnType<typeof listRowsPaginated<"source_records">>>["rows"] = [];
  let total = 0;
  let pageCount = 1;
  let loadError: string | null = null;

  try {
    const result = await listRowsPaginated("source_records", {
      orderBy: "retrieved_at",
      ascending: false,
      page,
      pageSize: PAGE_SIZE,
    });
    rows = result.rows;
    total = result.total;
    pageCount = result.pageCount;
  } catch (e) {
    loadError = e instanceof Error ? e.message : "Failed to load source records.";
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
        title="Source Records"
        description={`Read-only oversight across every product and content item (${total} total). Edit or add records from the parent's own edit page.`}
      />

      {loadError && <QueryErrorBanner message={loadError} />}

      {!loadError && rows.length === 0 ? (
        <EmptyState
          title="No source records yet"
          description="Sources are added from a product or content item's edit page."
        />
      ) : !loadError ? (
        <>
          <Card className="overflow-hidden">
            <ul className="divide-y divide-neutral-100">
              {rows.map((row) => {
                const parentLabel = row.product_id
                  ? { href: `/admin/products/${row.product_id}`, label: productNameById.get(row.product_id) ?? "Unknown product" }
                  : row.content_id
                    ? { href: `/admin/content/${row.content_id}`, label: contentTitleById.get(row.content_id) ?? "Unknown content" }
                    : row.product_spec_id
                      ? { href: null, label: "A product spec (no dedicated edit page yet)" }
                      : { href: null, label: "Unattached" };

                return (
                  <li key={row.id} className="p-4 flex flex-col gap-1">
                    <div className="flex items-center gap-2 text-sm">
                      <Badge tone={RELIABILITY_TONE[row.reliability_tier]}>{row.reliability_tier}</Badge>
                      {parentLabel.href ? (
                        <TextLink href={parentLabel.href}>{parentLabel.label}</TextLink>
                      ) : (
                        <span className="text-neutral-500">{parentLabel.label}</span>
                      )}
                    </div>
                    <a
                      href={row.url}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="text-sm underline hover:text-neutral-900 break-all"
                    >
                      {row.publisher || row.url}
                    </a>
                    <span className="text-xs text-neutral-400">
                      Retrieved {new Date(row.retrieved_at).toLocaleDateString()}
                    </span>
                  </li>
                );
              })}
            </ul>
          </Card>
          <Pagination page={page} pageCount={pageCount} basePath="/admin/source-records" />
        </>
      ) : null}
    </div>
  );
}
