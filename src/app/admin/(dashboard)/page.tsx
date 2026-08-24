import Link from "next/link";
import { requireAdmin } from "@/lib/dal";
import { getDashboardCounts, getEditorialQualityCounts } from "@/lib/admin/dashboard-service";
import { PageHeader, Card, TextLink, LinkButton, QueryErrorBanner } from "@/components/admin/ui";
import { Badge } from "@/components/shared/ui";
import { loadOwnerQueue, loadEngineHealth } from "@/lib/engine/queue-service";

export default async function AdminDashboardPage() {
  const admin = await requireAdmin();
  const [counts, quality, queue, health] = await Promise.all([
    getDashboardCounts(),
    getEditorialQualityCounts(),
    loadOwnerQueue(),
    loadEngineHealth(),
  ]);

  const catalogTiles: { label: string; value: number; href: string }[] = [
    { label: "Products", value: counts.products, href: "/admin/products" },
    { label: "Published products", value: counts.productsPublished, href: "/admin/products?published=published" },
    { label: "Draft products", value: counts.productsDraft, href: "/admin/products?published=draft" },
    { label: "Manufacturers", value: counts.manufacturers, href: "/admin/manufacturers" },
  ];

  const editorialTiles: { label: string; value: number; href: string }[] = [
    { label: "Content records", value: counts.contentTotal, href: "/admin/content" },
    { label: "Published content", value: counts.contentPublished, href: "/admin/content?status=published" },
    { label: "Draft content", value: counts.contentDraft, href: "/admin/content?status=draft" },
    { label: "Content requiring review", value: counts.contentRequiringReview, href: "/admin/freshness" },
  ];

  const mediaTiles: { label: string; value: number; href: string }[] = [
    { label: "Media assets", value: counts.mediaAssets, href: "/admin/media" },
    { label: "Published media", value: counts.mediaPublished, href: "/admin/media" },
    { label: "Media awaiting rights review", value: counts.mediaPendingRights, href: "/admin/media?rights=pending_verification" },
  ];

  const editorialQualityTiles: { label: string; value: number; href: string }[] = [
    { label: "Content missing sources", value: quality.missingSources, href: "/admin/source-records" },
    { label: "Content missing evidence", value: quality.missingEvidence, href: "/admin/evidence-records" },
    { label: "Content with no product links", value: quality.noProductRelationships, href: "/admin/content" },
    { label: "Possible cannibalisation", value: quality.possibleCannibalisation, href: "/admin/content" },
    { label: "Missing SEO description", value: quality.missingSeoDescription, href: "/admin/content" },
    { label: "Missing category", value: quality.missingCategory, href: "/admin/content" },
  ];

  return (
    <div>
      <PageHeader
        title="Dashboard"
        description={`Welcome back${admin.display_name ? `, ${admin.display_name}` : ""}.`}
        action={
          <div className="flex flex-wrap gap-2">
            <LinkButton href="/admin/products/new">New product</LinkButton>
            <LinkButton href="/admin/content/new">New content</LinkButton>
            <LinkButton href="/admin/media/new">Upload media</LinkButton>
          </div>
        }
      />

      {counts.hasError && (
        <QueryErrorBanner message="One or more counts below failed to load and are showing as 0 — check server logs, this is not necessarily an empty registry." />
      )}
      {quality.hasError && (
        <QueryErrorBanner message="Editorial quality checks below failed to load and are showing as 0 — check server logs, this is not necessarily a clean registry." />
      )}

      <EngineBanner queue={queue} health={health} />

      <TileSection title="Catalog" tiles={catalogTiles} />
      <TileSection title="Editorial" tiles={editorialTiles} />
      <TileSection title="Editorial quality" tiles={editorialQualityTiles} />
      <TileSection title="Media" tiles={mediaTiles} />
    </div>
  );
}

/**
 * The engine, at the top of the dashboard, above the catalogue counts.
 *
 * Before Phase A this page showed eight tables' worth of counts and did not
 * link to /admin/engine at all — an owner could open the dashboard every day
 * and never learn that anything was waiting. Position is the fix: the one
 * number that means "you have work" goes first, and the inventory counts,
 * which are context rather than instructions, follow it.
 *
 * The count deliberately comes from the SAME loader the Today page uses, so
 * the two can never disagree about how much is waiting.
 */
function EngineBanner({
  queue,
  health,
}: {
  queue: Awaited<ReturnType<typeof loadOwnerQueue>>;
  health: Awaited<ReturnType<typeof loadEngineHealth>>;
}) {
  const state = health.unknown
    ? { tone: "amber" as const, text: "Status unknown" }
    : !health.masterEnabled
      ? { tone: "red" as const, text: "Engine stopped" }
      : health.healthy
        ? { tone: "green" as const, text: "Engine running" }
        : { tone: "amber" as const, text: "Running with failures" };

  const n = queue.summary.total;

  return (
    <div className="mb-8">
      <h2 className="text-xs font-semibold uppercase tracking-wider text-neutral-400 mb-3">Engine</h2>
      <Card className="p-5">
        <div className="flex flex-wrap items-center justify-between gap-4">
          <div className="flex flex-wrap items-center gap-3">
            <Badge tone={state.tone}>{state.text}</Badge>
            <p className="text-sm text-neutral-600">
              {n === 0
                ? "Nothing needs a decision right now."
                : `${n} item${n === 1 ? "" : "s"} need${n === 1 ? "s" : ""} your attention.`}
            </p>
            {queue.failures.length > 0 && (
              <span className="text-sm text-amber-700">
                ({queue.failures.length} source(s) unreadable — count may be incomplete)
              </span>
            )}
          </div>
          <Link
            href="/admin/engine"
            className="inline-flex items-center rounded-md bg-neutral-900 px-3 py-1.5 text-sm font-medium text-white hover:bg-neutral-700 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-neutral-900"
          >
            {n === 0 ? "Open engine" : "Review now"}
          </Link>
        </div>
      </Card>
    </div>
  );
}

function TileSection({ title, tiles }: { title: string; tiles: { label: string; value: number; href: string }[] }) {
  return (
    <div className="mb-8">
      <h2 className="text-xs font-semibold uppercase tracking-wider text-neutral-400 mb-3">{title}</h2>
      <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-4">
        {tiles.map((tile) => (
          <Card key={tile.label} className="p-5">
            <TextLink href={tile.href}>
              <p className="text-2xl font-semibold text-neutral-900">{tile.value}</p>
              <p className="text-sm text-neutral-500 mt-1">{tile.label}</p>
            </TextLink>
          </Card>
        ))}
      </div>
    </div>
  );
}
