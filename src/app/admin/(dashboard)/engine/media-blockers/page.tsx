import { requireAdmin } from "@/lib/dal";
import { createClient } from "@/lib/supabase/server";
import { PageHeader, Card, Badge, TextLink, EmptyState, QueryErrorBanner } from "@/components/admin/ui";
import type { EngineSource, MediaRightsStatus } from "@/lib/engine/types";
import { EngineTabs, MediaRightsBadge } from "../shared";

// Requirement 13: which permissions would unlock the most products.
//
// The useful question is not "how many products are blocked" (we know: all of
// them, until media exists) but "which single permission unlocks the largest
// batch". So this page groups blocked products by manufacturer and ranks
// manufacturers by blocked count — the ranking IS the recommendation.
//
// It deliberately shows the rights status next to the count, because a
// manufacturer blocking 12 products is only worth pursuing if its terms are
// actually obtainable. A high count with 'prohibited' rights is a dead end,
// not a priority.

type BlockedProduct = {
  id: string;
  name: string;
  manufacturerId: string | null;
  sourcingStatus: string;
};

export default async function MediaBlockersPage() {
  await requireAdmin();
  const supabase = await createClient();

  // Open = anything not yet approved. An approved requirement is resolved and
  // is not a blocker.
  const { data: requirements, error: requirementsError } = await supabase
    .from("media_requirements")
    .select("id, product_id, content_id, sourcing_status, notes")
    .neq("sourcing_status", "approved");

  const productIds = (requirements ?? []).filter((r) => r.product_id).map((r) => r.product_id as string);
  const contentIds = (requirements ?? []).filter((r) => r.content_id).map((r) => r.content_id as string);

  const [
    { data: products, error: productsError },
    { data: contentRows, error: contentError },
    { data: manufacturers, error: manufacturersError },
    { data: sources, error: sourcesError },
  ] = await Promise.all([
    productIds.length > 0
      ? supabase.from("products").select("id, name, manufacturer_id").in("id", productIds)
      : Promise.resolve({ data: [] as { id: string; name: string; manufacturer_id: string | null }[], error: null }),
    contentIds.length > 0
      ? supabase.from("content_items").select("id, title").in("id", contentIds)
      : Promise.resolve({ data: [] as { id: string; title: string }[], error: null }),
    supabase.from("manufacturers").select("id, name"),
    supabase
      .from("engine_sources")
      .select(
        "id, organisation, url, source_type, categories, trust_level, is_active, discovery_permitted, media_republication_permitted, media_rights_status, terms_url, terms_notes, attribution_required, attribution_text, check_frequency_hours, last_checked_at, last_success_at, consecutive_failures, last_error"
      ),
  ]);

  const manufacturerNameById = new Map((manufacturers ?? []).map((m) => [m.id, m.name]));
  const productById = new Map((products ?? []).map((p) => [p.id, p]));
  const contentTitleById = new Map((contentRows ?? []).map((c) => [c.id, c.title]));

  // Match a manufacturer to a registered source by organisation name,
  // case-insensitively. A manufacturer with no matching source is reported as
  // "not yet assessed" — deliberately not as usable, since absence of a record
  // is absence of evidence, not permission.
  const sourceByOrg = new Map<string, EngineSource>();
  for (const s of (sources ?? []) as EngineSource[]) {
    sourceByOrg.set(s.organisation.trim().toLowerCase(), s);
  }

  const blockedProducts: BlockedProduct[] = [];
  const blockedContent: { id: string; title: string; sourcingStatus: string }[] = [];

  for (const r of requirements ?? []) {
    if (r.product_id) {
      const p = productById.get(r.product_id);
      if (p) {
        blockedProducts.push({
          id: p.id,
          name: p.name,
          manufacturerId: p.manufacturer_id,
          sourcingStatus: r.sourcing_status,
        });
      }
    } else if (r.content_id) {
      const title = contentTitleById.get(r.content_id);
      if (title) blockedContent.push({ id: r.content_id, title, sourcingStatus: r.sourcing_status });
    }
  }

  const groups = new Map<string, { manufacturerId: string | null; name: string; products: BlockedProduct[] }>();
  for (const p of blockedProducts) {
    const key = p.manufacturerId ?? "__none__";
    const name = p.manufacturerId
      ? (manufacturerNameById.get(p.manufacturerId) ?? "(unknown manufacturer)")
      : "(no manufacturer set)";
    const g = groups.get(key) ?? { manufacturerId: p.manufacturerId, name, products: [] };
    g.products.push(p);
    groups.set(key, g);
  }

  // The ranking is the point of the page: biggest unlock first.
  const ranked = [...groups.values()].sort((a, b) => b.products.length - a.products.length);

  const anyError = requirementsError || productsError || contentError || manufacturersError || sourcesError;

  return (
    <div>
      <PageHeader
        title="Media blockers"
        description="Products blocked on media, grouped by manufacturer and ranked by how many each one would unlock."
      />
      <EngineTabs current="/admin/engine/media-blockers" />

      <Card className="p-4 mb-6 border-blue-200 bg-blue-50">
        <p className="text-sm font-medium text-neutral-900">How to use this</p>
        <p className="text-xs text-neutral-700 mt-1">
          Manufacturers are ranked by how many blocked products they account for, so the top rows are the largest
          unlocks per permission obtained. A high count is only worth pursuing where the rights status suggests the
          terms are actually obtainable — a large group marked <strong>Prohibited</strong> is a dead end, not a
          priority. <strong>Not yet assessed</strong> means no source record exists for that manufacturer; it does not
          mean their imagery is usable.
        </p>
      </Card>

      {requirementsError && (
        <QueryErrorBanner message={`Failed to load media requirements: ${requirementsError.message}`} />
      )}
      {productsError && <QueryErrorBanner message={`Failed to load products: ${productsError.message}`} />}
      {contentError && <QueryErrorBanner message={`Failed to load content: ${contentError.message}`} />}
      {manufacturersError && (
        <QueryErrorBanner message={`Failed to load manufacturers: ${manufacturersError.message}`} />
      )}
      {sourcesError && <QueryErrorBanner message={`Failed to load source registry: ${sourcesError.message}`} />}

      {!anyError && ranked.length === 0 && blockedContent.length === 0 ? (
        <EmptyState
          title="Nothing blocked on media"
          description="Every record with a media requirement has been resolved."
        />
      ) : (
        !anyError && (
          <>
            <p className="text-sm text-neutral-600 mb-4">
              {blockedProducts.length} blocked product{blockedProducts.length === 1 ? "" : "s"} across {ranked.length}{" "}
              manufacturer group{ranked.length === 1 ? "" : "s"}
              {blockedContent.length > 0 ? `, plus ${blockedContent.length} content record(s).` : "."}
            </p>

            <div className="flex flex-col gap-3">
              {ranked.map((g, index) => {
                const source = g.manufacturerId ? sourceByOrg.get(g.name.trim().toLowerCase()) : undefined;
                return (
                  <Card key={g.manufacturerId ?? "none"} className="p-4">
                    <div className="flex flex-wrap items-start justify-between gap-2">
                      <div className="min-w-0">
                        <p className="text-sm font-medium text-neutral-900">
                          <span className="text-neutral-400 mr-2 tabular-nums">#{index + 1}</span>
                          {g.name}
                        </p>
                        <p className="text-xs text-neutral-500 mt-0.5">
                          Unlocks {g.products.length} product{g.products.length === 1 ? "" : "s"}
                        </p>
                      </div>
                      <div className="flex flex-wrap items-center gap-2">
                        <Badge tone="neutral">{g.products.length} blocked</Badge>
                        {source ? (
                          <MediaRightsBadge status={source.media_rights_status as MediaRightsStatus} />
                        ) : (
                          <Badge tone="neutral">Not yet assessed</Badge>
                        )}
                      </div>
                    </div>

                    {source ? (
                      <div className="mt-2 text-xs text-neutral-600">
                        <p className="break-all">Source: {source.url}</p>
                        {source.terms_url && <p className="break-all mt-0.5">Terms: {source.terms_url}</p>}
                        {source.terms_notes && <p className="mt-0.5">{source.terms_notes}</p>}
                        <p className="mt-1">
                          Republication currently{" "}
                          <strong>{source.media_republication_permitted ? "permitted" : "not permitted"}</strong>.
                        </p>
                      </div>
                    ) : (
                      <p className="text-xs text-amber-800 mt-2">
                        No source registered for this manufacturer, so its terms have never been verified. Add it to the
                        source registry before treating any of its imagery as usable.
                      </p>
                    )}

                    <details className="mt-3">
                      <summary className="cursor-pointer text-xs font-medium text-neutral-700">
                        Blocked products ({g.products.length})
                      </summary>
                      <ul className="flex flex-col gap-1 mt-2">
                        {g.products.map((p) => (
                          <li key={p.id} className="flex items-center justify-between gap-2 text-xs">
                            <TextLink href={`/admin/products/${p.id}`}>{p.name}</TextLink>
                            <Badge tone="neutral">{p.sourcingStatus}</Badge>
                          </li>
                        ))}
                      </ul>
                    </details>
                  </Card>
                );
              })}
            </div>

            {blockedContent.length > 0 && (
              <section className="mt-8">
                <h2 className="text-sm font-semibold text-neutral-900 mb-2">Content records awaiting media</h2>
                <p className="text-xs text-neutral-500 mb-3">
                  Not grouped by manufacturer — editorial media is usually sourced or created per article rather than
                  unlocked in bulk by one permission.
                </p>
                <div className="flex flex-col gap-1">
                  {blockedContent.map((c) => (
                    <Card key={c.id} className="p-3">
                      <div className="flex items-center justify-between gap-2 text-xs">
                        <TextLink href={`/admin/content/${c.id}`}>{c.title}</TextLink>
                        <Badge tone="neutral">{c.sourcingStatus}</Badge>
                      </div>
                    </Card>
                  ))}
                </div>
              </section>
            )}
          </>
        )
      )}
    </div>
  );
}
