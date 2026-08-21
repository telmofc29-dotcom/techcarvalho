import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { buildMetadata } from "@/lib/seo/metadata";
import { findPlannedCategory } from "@/lib/public/categories";
import {
  getCategoryBySlug,
  getPublishedContentForCategory,
  getPublishedProductsForCategory,
  getSubcategories,
  getManufacturersForCategory,
} from "@/lib/public/queries";
import { Breadcrumbs } from "@/components/public/breadcrumbs";
import { ContentCard, ProductCard, SectionHeading } from "@/components/public/cards";
import { EmptyState } from "@/components/shared/ui";
import { PageViewTracker } from "@/components/analytics/page-view-tracker";
import { InternalLinkTracker } from "@/components/analytics/internal-link-tracker";

export async function generateMetadata({
  params,
}: {
  params: Promise<{ category: string }>;
}): Promise<Metadata> {
  const { category: slug } = await params;
  const planned = findPlannedCategory(slug);
  const dbCategory = await getCategoryBySlug(slug);

  if (!planned && !dbCategory) notFound();

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
  const [products, content, subcategories, manufacturers] = dbCategory
    ? await Promise.all([
        getPublishedProductsForCategory(dbCategory.id),
        getPublishedContentForCategory(dbCategory.id),
        getSubcategories(dbCategory.id),
        getManufacturersForCategory(dbCategory.id),
      ])
    : [[], [], [], []];

  const hasContent = products.length > 0 || content.length > 0 || subcategories.length > 0;

  return (
    <div>
      <PageViewTracker entityType="category" categorySlug={slug} />
      <div className="border-b border-border-subtle bg-zinc-50">
        <div className="mx-auto max-w-6xl px-6 py-12">
          <Breadcrumbs items={[{ name: "Home", path: "/" }, { name: label, path: `/${slug}` }]} />
          <h1 className="font-display text-3xl sm:text-4xl font-bold tracking-tight text-zinc-900">{label}</h1>
          {planned?.blurb && <p className="mt-3 max-w-xl text-lg text-zinc-600">{planned.blurb}</p>}
        </div>
      </div>

      <div className="mx-auto max-w-6xl px-6 py-12">
        {!hasContent ? (
          <EmptyState
            title="Coming soon"
            description={`${label} content hasn't been published yet. Check back once products and articles for this area go live.`}
          />
        ) : (
          <div className="flex flex-col gap-12">
            {subcategories.length > 0 && (
              <section>
                <SectionHeading>Subcategories</SectionHeading>
                <InternalLinkTracker linkPosition="category_page">
                  <ul className="flex flex-wrap gap-3">
                    {subcategories.map((sc) => (
                      <li key={sc.id} data-entity-type="category" data-category-slug={sc.slug}>
                        <Link
                          href={`/${sc.slug}`}
                          className="rounded-full border border-border-subtle bg-white px-4 py-2 text-sm font-medium hover:border-accent/40"
                        >
                          {sc.name}
                        </Link>
                      </li>
                    ))}
                  </ul>
                </InternalLinkTracker>
              </section>
            )}

            {content.length > 0 && (
              <section>
                <SectionHeading>Latest articles</SectionHeading>
                <InternalLinkTracker linkPosition="category_page" categorySlug={slug}>
                  <ul className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
                    {content.map((item) => (
                      <li key={item.id} data-entity-type="content" data-entity-id={item.id}>
                        <ContentCard
                          href={`/articles/${item.slug}`}
                          type={item.type}
                          title={item.title}
                          publishedAt={item.published_at}
                          excerpt={item.excerpt}
                          imageUrl={item.heroImage?.url}
                          imageAlt={item.heroImage?.alt}
                        />
                      </li>
                    ))}
                  </ul>
                </InternalLinkTracker>
              </section>
            )}

            {products.length > 0 && (
              <section>
                <SectionHeading>Products</SectionHeading>
                <InternalLinkTracker linkPosition="category_page" categorySlug={slug}>
                  <ul className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
                    {products.map((p) => (
                      <li key={p.id} data-entity-type="product" data-entity-id={p.id}>
                        <ProductCard
                          href={`/products/${p.slug}`}
                          name={p.name}
                          summary={p.summary}
                          status={p.status}
                          imageUrl={p.heroImage?.url}
                          imageAlt={p.heroImage?.alt}
                        />
                      </li>
                    ))}
                  </ul>
                </InternalLinkTracker>
              </section>
            )}

            {manufacturers.length > 0 && (
              <section>
                <SectionHeading>Manufacturers</SectionHeading>
                <InternalLinkTracker linkPosition="category_page" categorySlug={slug}>
                  <ul className="flex flex-wrap gap-3">
                    {manufacturers.map((m) => (
                      <li key={m.id} data-entity-type="manufacturer" data-entity-id={m.id}>
                        <Link
                          href={`/manufacturers/${m.slug}`}
                          className="rounded-full border border-border-subtle bg-white px-4 py-2 text-sm font-medium hover:border-accent/40"
                        >
                          {m.name}
                        </Link>
                      </li>
                    ))}
                  </ul>
                </InternalLinkTracker>
              </section>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
