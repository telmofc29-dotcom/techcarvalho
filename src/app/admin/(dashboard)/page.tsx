import { requireAdmin } from "@/lib/dal";
import { getDashboardCounts, getEditorialQualityCounts } from "@/lib/admin/dashboard-service";
import { PageHeader, Card, TextLink, LinkButton, QueryErrorBanner } from "@/components/admin/ui";

export default async function AdminDashboardPage() {
  const admin = await requireAdmin();
  const [counts, quality] = await Promise.all([getDashboardCounts(), getEditorialQualityCounts()]);

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

      <TileSection title="Catalog" tiles={catalogTiles} />
      <TileSection title="Editorial" tiles={editorialTiles} />
      <TileSection title="Editorial quality" tiles={editorialQualityTiles} />
      <TileSection title="Media" tiles={mediaTiles} />
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
