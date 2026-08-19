import { requireAdmin } from "@/lib/dal";
import { getDashboardCounts } from "@/lib/admin/dashboard-service";
import { PageHeader, Card, TextLink } from "@/components/admin/ui";

export default async function AdminDashboardPage() {
  await requireAdmin();
  const counts = await getDashboardCounts();

  const tiles: { label: string; value: number; href: string }[] = [
    { label: "Products", value: counts.products, href: "/admin/products" },
    { label: "Manufacturers", value: counts.manufacturers, href: "/admin/manufacturers" },
    { label: "Content records", value: counts.contentTotal, href: "/admin/content" },
    { label: "Published content", value: counts.contentPublished, href: "/admin/content" },
    { label: "Planned / draft content", value: counts.contentDraft, href: "/admin/content" },
    { label: "Media assets", value: counts.mediaAssets, href: "/admin/media" },
    { label: "Content requiring review", value: counts.contentRequiringReview, href: "/admin/freshness" },
  ];

  return (
    <div>
      <PageHeader title="Dashboard" description="Tech Carvalho admin overview." />
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
