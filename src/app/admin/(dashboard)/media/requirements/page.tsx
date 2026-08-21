import { requireAdmin } from "@/lib/dal";
import { createClient } from "@/lib/supabase/server";
import { evaluateMediaReadiness } from "@/lib/media/requirements";
import { PageHeader, Card, Badge, TextLink, EmptyState, QueryErrorBanner } from "@/components/admin/ui";
import type { MediaSourcingStatus } from "@/lib/types/database";

const STATUS_FILTERS: { label: string; value: MediaSourcingStatus | "" }[] = [
  { label: "All open", value: "" },
  { label: "Needed", value: "needed" },
  { label: "Sourcing", value: "sourcing" },
  { label: "Available", value: "available" },
  { label: "Blocked", value: "blocked" },
  { label: "Approved", value: "approved" },
];

// Consolidated cross-record view of the media sourcing workflow — the
// "which products/content are blocked and why" list. Deliberately a single
// read-only report page, not a second place to edit requirements (editing
// happens on the product/content record itself via MediaRequirementCard) —
// keeps this a list, not a parallel subsystem.
export default async function MediaRequirementsPage({
  searchParams,
}: {
  searchParams: Promise<{ status?: string }>;
}) {
  await requireAdmin();
  const { status } = await searchParams;
  const supabase = await createClient();

  let query = supabase
    .from("media_requirements")
    .select("id, product_id, content_id, sourcing_status, target_source_type, notes, resolved_media_id, updated_at")
    .order("updated_at", { ascending: false });
  const validStatus = STATUS_FILTERS.find((f) => f.value === status && f.value !== "")?.value;
  if (validStatus) query = query.eq("sourcing_status", validStatus);
  else query = query.neq("sourcing_status", "approved"); // "All open" = everything not yet resolved

  const { data: requirements, error } = await query;

  const productIds = (requirements ?? []).filter((r) => r.product_id).map((r) => r.product_id as string);
  const contentIds = (requirements ?? []).filter((r) => r.content_id).map((r) => r.content_id as string);

  const [{ data: products }, { data: content }, { data: heroLinksP }, { data: heroLinksC }] = await Promise.all([
    productIds.length > 0
      ? supabase.from("products").select("id, name, slug, is_published").in("id", productIds)
      : Promise.resolve({ data: [] as { id: string; name: string; slug: string; is_published: boolean }[] }),
    contentIds.length > 0
      ? supabase.from("content_items").select("id, title, slug, status").in("id", contentIds)
      : Promise.resolve({ data: [] as { id: string; title: string; slug: string; status: string }[] }),
    productIds.length > 0
      ? supabase.from("product_media").select("product_id, media_id").eq("role", "hero").in("product_id", productIds)
      : Promise.resolve({ data: [] as { product_id: string; media_id: string }[] }),
    contentIds.length > 0
      ? supabase.from("content_media").select("content_id, media_id").eq("role", "hero").in("content_id", contentIds)
      : Promise.resolve({ data: [] as { content_id: string; media_id: string }[] }),
  ]);

  const heroMediaIds = [
    ...(heroLinksP ?? []).map((h) => h.media_id),
    ...(heroLinksC ?? []).map((h) => h.media_id),
  ];
  const { data: heroAssets } =
    heroMediaIds.length > 0
      ? await supabase.from("media_assets").select("id, rights_status, owned, source_type").in("id", heroMediaIds)
      : { data: [] };

  const productById = new Map((products ?? []).map((p) => [p.id, p]));
  const contentById = new Map((content ?? []).map((c) => [c.id, c]));
  const heroAssetByProductId = new Map(
    (heroLinksP ?? []).map((h) => [h.product_id, (heroAssets ?? []).find((a) => a.id === h.media_id) ?? null])
  );
  const heroAssetByContentId = new Map(
    (heroLinksC ?? []).map((h) => [h.content_id, (heroAssets ?? []).find((a) => a.id === h.media_id) ?? null])
  );

  const rows = (requirements ?? []).map((r) => {
    const isProduct = !!r.product_id;
    const record = isProduct ? productById.get(r.product_id!) : contentById.get(r.content_id!);
    const heroAsset = isProduct
      ? (heroAssetByProductId.get(r.product_id!) ?? null)
      : (heroAssetByContentId.get(r.content_id!) ?? null);
    const readiness = evaluateMediaReadiness({ heroAsset, requirement: { sourcing_status: r.sourcing_status } });
    return { requirement: r, isProduct, record, readiness };
  });

  return (
    <div>
      <PageHeader
        title="Awaiting media"
        description="Every product/content record with an open media sourcing requirement — from the media-first publishing rule."
      />

      <div className="flex flex-wrap gap-2 mb-4">
        {STATUS_FILTERS.map((f) => (
          <a
            key={f.value}
            href={`/admin/media/requirements${f.value ? `?status=${f.value}` : ""}`}
            className={`rounded-full px-3 py-1 text-xs font-medium ${
              (status ?? "") === f.value ? "bg-neutral-900 text-white" : "bg-neutral-100 text-neutral-600"
            }`}
          >
            {f.label}
          </a>
        ))}
      </div>

      {error && <QueryErrorBanner message={`Failed to load media requirements: ${error.message}`} />}

      {!error && rows.length === 0 ? (
        <EmptyState title="Nothing open" description="No records currently have an unresolved media requirement." />
      ) : (
        <div className="flex flex-col gap-2">
          {rows.map(({ requirement, isProduct, record, readiness }) => (
            <Card key={requirement.id} className="p-4">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <div>
                  <p className="text-sm font-medium text-neutral-900">
                    {record ? (
                      <TextLink href={isProduct ? `/admin/products/${record.id}` : `/admin/content/${record.id}`}>
                        {isProduct ? (record as { name: string }).name : (record as { title: string }).title}
                      </TextLink>
                    ) : (
                      "(record no longer exists)"
                    )}
                  </p>
                  <p className="text-xs text-neutral-400">{isProduct ? "Product" : "Content"}</p>
                </div>
                <div className="flex items-center gap-2">
                  <Badge tone="neutral">{requirement.sourcing_status}</Badge>
                  {requirement.target_source_type && <Badge tone="neutral">{requirement.target_source_type}</Badge>}
                  <Badge tone={readiness.ready ? "green" : "amber"}>
                    {readiness.ready ? "Passes gate" : "Blocked"}
                  </Badge>
                </div>
              </div>
              {requirement.notes && <p className="text-sm text-neutral-600 mt-2">{requirement.notes}</p>}
              {!readiness.ready && <p className="text-xs text-neutral-400 mt-1">{readiness.reason}</p>}
            </Card>
          ))}
        </div>
      )}
    </div>
  );
}
