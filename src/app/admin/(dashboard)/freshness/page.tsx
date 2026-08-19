import { requireAdmin } from "@/lib/dal";
import { getFreshnessOverview } from "@/lib/admin/freshness-service";
import { FRESHNESS_BUCKET_LABELS, FRESHNESS_OVERDUE_DAYS, FRESHNESS_DUE_SOON_DAYS, type FreshnessBucket } from "@/lib/admin/freshness";
import { PageHeader, Card, Badge, EmptyState, TextLink } from "@/components/admin/ui";

const BUCKET_ORDER: FreshnessBucket[] = ["overdue", "due_soon", "no_review", "recent"];
const BUCKET_TONE: Record<FreshnessBucket, "red" | "amber" | "neutral" | "green"> = {
  overdue: "red",
  due_soon: "amber",
  no_review: "neutral",
  recent: "green",
};

export default async function FreshnessPage() {
  await requireAdmin();
  const items = await getFreshnessOverview();

  const byBucket = new Map<FreshnessBucket, typeof items>();
  for (const bucket of BUCKET_ORDER) byBucket.set(bucket, []);
  for (const item of items) byBucket.get(item.bucket)!.push(item);

  return (
    <div>
      <PageHeader
        title="Freshness"
        description={`Editorial review status for every product and content item. Overdue at ${FRESHNESS_OVERDUE_DAYS}+ days since last review, due soon from ${FRESHNESS_DUE_SOON_DAYS} days.`}
      />

      {items.length === 0 ? (
        <EmptyState title="Nothing to review yet" description="Add products or content to start tracking freshness." />
      ) : (
        <div className="flex flex-col gap-6">
          {BUCKET_ORDER.map((bucket) => {
            const bucketItems = byBucket.get(bucket)!;
            return (
              <Card key={bucket} className="p-5">
                <div className="flex items-center gap-2 mb-3">
                  <h2 className="text-sm font-semibold text-neutral-900">{FRESHNESS_BUCKET_LABELS[bucket]}</h2>
                  <Badge tone={BUCKET_TONE[bucket]}>{bucketItems.length}</Badge>
                </div>
                {bucketItems.length === 0 ? (
                  <p className="text-sm text-neutral-500">Nothing here.</p>
                ) : (
                  <ul className="flex flex-col gap-1.5">
                    {bucketItems.map((item) => (
                      <li key={`${item.kind}-${item.id}`} className="flex items-center justify-between text-sm">
                        <TextLink href={`/admin/${item.kind === "product" ? "products" : "content"}/${item.id}`}>
                          {item.label}
                        </TextLink>
                        <span className="text-neutral-500 text-xs">
                          {item.lastReviewedAt ? new Date(item.lastReviewedAt).toLocaleDateString() : "Never reviewed"}
                        </span>
                      </li>
                    ))}
                  </ul>
                )}
              </Card>
            );
          })}
        </div>
      )}
    </div>
  );
}
