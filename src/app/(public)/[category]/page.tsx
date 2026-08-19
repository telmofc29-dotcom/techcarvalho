import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { buildMetadata } from "@/lib/seo/metadata";
import { findPlannedCategory } from "@/lib/public/categories";
import { getCategoryBySlug, getPublishedContentForCategory, getPublishedProductsForCategory } from "@/lib/public/queries";
import { Breadcrumbs } from "@/components/public/breadcrumbs";
import { Badge, EmptyState } from "@/components/shared/ui";

export async function generateMetadata({
  params,
}: {
  params: Promise<{ category: string }>;
}): Promise<Metadata> {
  const { category: slug } = await params;
  const planned = findPlannedCategory(slug);
  const dbCategory = await getCategoryBySlug(slug);

  if (!planned && !dbCategory) return buildMetadata({ title: "Not found", path: `/${slug}`, noindex: true });

  const label = dbCategory?.name ?? planned?.label ?? slug;
  return buildMetadata({ title: label, description: planned?.blurb ?? dbCategory?.description ?? undefined, path: `/${slug}` });
}

export default async function CategoryPage({
  params,
}: {
  params: Promise<{ category: string }>;
}) {
  const { category: slug } = await params;
  const planned = findPlannedCategory(slug);
  const dbCategory = await getCategoryBySlug(slug);

  if (!planned && !dbCategory) notFound();

  const label = dbCategory?.name ?? planned?.label ?? slug;
  const [products, content] = dbCategory
    ? await Promise.all([
        getPublishedProductsForCategory(dbCategory.id),
        getPublishedContentForCategory(dbCategory.id),
      ])
    : [[], []];

  const hasContent = products.length > 0 || content.length > 0;

  return (
    <div className="mx-auto max-w-6xl px-6 py-12">
      <Breadcrumbs items={[{ name: "Home", path: "/" }, { name: label, path: `/${slug}` }]} />
      <h1 className="text-2xl font-semibold text-neutral-900 mb-2">{label}</h1>
      {planned?.blurb && <p className="text-neutral-500 mb-8 max-w-xl">{planned.blurb}</p>}

      {!hasContent ? (
        <EmptyState
          title="Coming soon"
          description={`${label} content hasn't been published yet. Check back once products and articles for this area go live.`}
        />
      ) : (
        <div className="flex flex-col gap-10">
          {products.length > 0 && (
            <section>
              <h2 className="text-sm font-semibold uppercase tracking-wide text-neutral-500 mb-4">Products</h2>
              <ul className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
                {products.map((p) => (
                  <li key={p.id} className="rounded-lg border border-neutral-200 p-5">
                    <h3 className="font-medium text-neutral-900">
                      <Link href={`/products/${p.slug}`}>{p.name}</Link>
                    </h3>
                    {p.summary && <p className="text-sm text-neutral-500 mt-1">{p.summary}</p>}
                  </li>
                ))}
              </ul>
            </section>
          )}
          {content.length > 0 && (
            <section>
              <h2 className="text-sm font-semibold uppercase tracking-wide text-neutral-500 mb-4">Articles</h2>
              <ul className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
                {content.map((item) => (
                  <li key={item.id} className="rounded-lg border border-neutral-200 p-5">
                    <Badge>{item.type}</Badge>
                    <h3 className="font-medium text-neutral-900 mt-2">
                      <Link href={`/articles/${item.slug}`}>{item.title}</Link>
                    </h3>
                  </li>
                ))}
              </ul>
            </section>
          )}
        </div>
      )}
    </div>
  );
}
