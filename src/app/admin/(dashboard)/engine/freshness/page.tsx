import { requireAdmin } from "@/lib/dal";
import { createClient } from "@/lib/supabase/server";
import { PageHeader, Card, Badge, TextLink, EmptyState, QueryErrorBanner } from "@/components/admin/ui";
import { SubmitButton } from "@/components/admin/submit-button";
import type { FreshnessReason } from "@/lib/engine/types";
import { setFreshnessReviewState } from "../actions";
import { EngineTabs, formatDateTime, humanise } from "../shared";

const STATE_FILTERS = ["open", "acknowledged", "actioned", "dismissed"] as const;

const REASON_FILTERS: (FreshnessReason | "")[] = [
  "",
  "spec_changed",
  "successor_released",
  "discontinued",
  "firmware_changed",
  "stale_facts",
  "stale_pricing",
  "broken_source_link",
  "outdated_comparison",
  "missing_internal_links",
];

const SEVERITY_TONE: Record<string, "red" | "amber" | "neutral"> = {
  high: "red",
  medium: "amber",
  low: "neutral",
};

type ReviewRow = {
  id: string;
  product_id: string | null;
  content_id: string | null;
  reason: FreshnessReason;
  detail: string | null;
  severity: string;
  state: string;
  detected_at: string;
};

export default async function EngineFreshnessPage({
  searchParams,
}: {
  searchParams: Promise<{ state?: string; reason?: string }>;
}) {
  await requireAdmin();
  const { state, reason } = await searchParams;
  const supabase = await createClient();

  const activeState = STATE_FILTERS.find((s) => s === state) ?? "open";

  let query = supabase
    .from("engine_freshness_reviews")
    .select("id, product_id, content_id, reason, detail, severity, state, detected_at")
    .eq("state", activeState)
    .order("detected_at", { ascending: false })
    .limit(200);

  const validReason = REASON_FILTERS.find((r) => r !== "" && r === reason);
  if (validReason) query = query.eq("reason", validReason);

  const { data, error } = await query;
  const rows = (data ?? []) as ReviewRow[];

  const productIds = rows.filter((r) => r.product_id).map((r) => r.product_id as string);
  const contentIds = rows.filter((r) => r.content_id).map((r) => r.content_id as string);

  const [{ data: products, error: productsError }, { data: content, error: contentError }] = await Promise.all([
    productIds.length > 0
      ? supabase.from("products").select("id, name").in("id", productIds)
      : Promise.resolve({ data: [] as { id: string; name: string }[], error: null }),
    contentIds.length > 0
      ? supabase.from("content_items").select("id, title").in("id", contentIds)
      : Promise.resolve({ data: [] as { id: string; title: string }[], error: null }),
  ]);

  const productById = new Map((products ?? []).map((p) => [p.id, p.name]));
  const contentById = new Map((content ?? []).map((c) => [c.id, c.title]));

  const filterHref = (nextState: string, nextReason: string) => {
    const params = new URLSearchParams();
    if (nextState) params.set("state", nextState);
    if (nextReason) params.set("reason", nextReason);
    const qs = params.toString();
    return `/admin/engine/freshness${qs ? `?${qs}` : ""}`;
  };

  return (
    <div>
      <PageHeader
        title="Freshness"
        description="Existing records that look stale. These are recommendations for a human — the engine never rewrites published facts on its own."
      />
      <EngineTabs current="/admin/engine/freshness" />

      <div className="flex flex-col gap-2 mb-4">
        <div className="flex flex-wrap gap-2">
          {STATE_FILTERS.map((f) => (
            <a
              key={f}
              href={filterHref(f, reason ?? "")}
              className={`rounded-full px-3 py-1 text-xs font-medium ${
                activeState === f ? "bg-neutral-900 text-white" : "bg-neutral-100 text-neutral-600"
              }`}
            >
              {humanise(f)}
            </a>
          ))}
        </div>
        <div className="flex flex-wrap gap-2">
          {REASON_FILTERS.map((f) => (
            <a
              key={f || "all"}
              href={filterHref(activeState, f)}
              className={`rounded-full px-3 py-1 text-xs font-medium ${
                (reason ?? "") === f ? "bg-neutral-900 text-white" : "bg-neutral-100 text-neutral-600"
              }`}
            >
              {f ? humanise(f) : "All reasons"}
            </a>
          ))}
        </div>
      </div>

      {error && <QueryErrorBanner message={`Failed to load freshness reviews: ${error.message}`} />}
      {productsError && <QueryErrorBanner message={`Failed to load related products: ${productsError.message}`} />}
      {contentError && <QueryErrorBanner message={`Failed to load related content: ${contentError.message}`} />}

      {!error && rows.length === 0 ? (
        <EmptyState
          title={`Nothing ${activeState}`}
          description="Freshness checks record recommendations here once the engine and freshness checks are enabled."
        />
      ) : (
        !error && (
          <div className="flex flex-col gap-2">
            {rows.map((r) => {
              const isProduct = !!r.product_id;
              const name = isProduct
                ? productById.get(r.product_id as string)
                : contentById.get(r.content_id as string);
              const href = isProduct ? `/admin/products/${r.product_id}` : `/admin/content/${r.content_id}`;
              return (
                <Card key={r.id} className="p-4">
                  <div className="flex flex-wrap items-start justify-between gap-2">
                    <div className="min-w-0">
                      <p className="text-sm font-medium text-neutral-900">
                        {name ? <TextLink href={href}>{name}</TextLink> : "(record no longer exists)"}
                      </p>
                      <p className="text-xs text-neutral-400 mt-0.5">{isProduct ? "Product" : "Content"}</p>
                    </div>
                    <div className="flex flex-wrap items-center gap-2">
                      <Badge tone="neutral">{humanise(r.reason)}</Badge>
                      <Badge tone={SEVERITY_TONE[r.severity] ?? "neutral"}>{humanise(r.severity)}</Badge>
                    </div>
                  </div>

                  {r.detail && <p className="text-sm text-neutral-700 mt-2">{r.detail}</p>}
                  <p className="text-[11px] text-neutral-400 mt-2">Detected {formatDateTime(r.detected_at)}</p>

                  <div className="flex flex-wrap gap-2 mt-3">
                    {(["acknowledged", "actioned", "dismissed"] as const)
                      .filter((s) => s !== r.state)
                      .map((s) => (
                        <form key={s} action={setFreshnessReviewState}>
                          <input type="hidden" name="id" value={r.id} />
                          <input type="hidden" name="state" value={s} />
                          <SubmitButton pendingLabel="Saving...">Mark {humanise(s).toLowerCase()}</SubmitButton>
                        </form>
                      ))}
                  </div>
                </Card>
              );
            })}
          </div>
        )
      )}
    </div>
  );
}
