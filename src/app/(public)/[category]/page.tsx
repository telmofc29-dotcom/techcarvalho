import type { Metadata } from "next";
import Link from "next/link";
import Image from "next/image";
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
import { getTrendingContent } from "@/lib/public/trending";
import { getCategoryHeroImage, categoryGradient } from "@/lib/public/category-hero";
import { Breadcrumbs } from "@/components/public/breadcrumbs";
import { ContentCard, ProductCard, SectionHeading } from "@/components/public/cards";
import { TrendingSection } from "@/components/public/trending";
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

  const [products, content, subcategories, manufacturers, trending, bannerImage] = dbCategory
    ? await Promise.all([
        getPublishedProductsForCategory(dbCategory.id),
        getPublishedContentForCategory(dbCategory.id),
        getSubcategories(dbCategory.id),
        getManufacturersForCategory(dbCategory.id),
        getTrendingContent({ categorySlug: slug, supportingCount: 3 }),
        getCategoryHeroImage(slug, label),
      ])
    : [
        [],
        [],
        [],
        [],
        { lead: null, supporting: [], isRecencyFallback: true } as Awaited<ReturnType<typeof getTrendingContent>>,
        null,
      ];

  const hasContent = products.length > 0 || content.length > 0 || subcategories.length > 0;

  // Split the article list by intent so the page reads as a publication rather
  // than one long undifferentiated grid. Anything shown in the trending block
  // is excluded so the same piece doesn't appear twice on one screen.
  const trendingIds = new Set(
    [trending.lead?.id, ...trending.supporting.map((s) => s.id)].filter(Boolean) as string[]
  );
  const remaining = content.filter((c) => !trendingIds.has(c.id));
  const guidesAndComparisons = remaining.filter((c) => c.type === "guide" || c.type === "comparison");
  const otherArticles = remaining.filter((c) => c.type !== "guide" && c.type !== "comparison");

  return (
    <div>
      <PageViewTracker entityType="category" categorySlug={slug} />

      {/* Category banner. Uses a real category_hero asset when one exists;
          otherwise a deterministic per-category gradient so the header still
          reads as designed rather than as a failed image load. */}
      <div className="relative overflow-hidden border-b border-border-subtle bg-zinc-50">
        {bannerImage ? (
          <>
            <Image
              src={bannerImage.url}
              alt={bannerImage.alt ?? label}
              fill
              priority
              sizes="100vw"
              className="object-cover"
            />
            {/* Scrim keeps heading contrast legible over an arbitrary photo. */}
            <div className="absolute inset-0 bg-gradient-to-r from-white via-white/85 to-white/40" aria-hidden="true" />
          </>
        ) : (
          <div
            className={`absolute inset-0 bg-gradient-to-br ${categoryGradient(slug)}`}
            aria-hidden="true"
          />
        )}
        <div className="relative mx-auto max-w-6xl px-6 py-14 sm:py-20">
          <Breadcrumbs items={[{ name: "Home", path: "/" }, { name: label, path: `/${slug}` }]} />
          <h1 className="font-display text-3xl sm:text-5xl font-bold tracking-tight text-zinc-900">{label}</h1>
          {(planned?.blurb || dbCategory?.description) && (
            <p className="mt-4 max-w-xl text-lg text-zinc-700">{planned?.blurb ?? dbCategory?.description}</p>
          )}
          {hasContent && (
            <p className="mt-5 text-sm font-medium text-zinc-600">
              {content.length} article{content.length === 1 ? "" : "s"}
              {products.length > 0 && ` · ${products.length} product${products.length === 1 ? "" : "s"}`}
            </p>
          )}
        </div>
      </div>

      <div className="mx-auto max-w-6xl px-6 py-12">
        {!hasContent ? (
          <EmptyState
            title="Coming soon"
            description={`${label} content hasn't been published yet. Check back once products and articles for this area go live.`}
          />
        ) : (
          <div className="flex flex-col gap-14">
            {trending.lead && (
              <TrendingSection
                lead={trending.lead}
                supporting={trending.supporting}
                isRecencyFallback={trending.isRecencyFallback}
                linkPosition="category_page"
                categorySlug={slug}
                heading={`Trending in ${label}`}
              />
            )}

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

            {guidesAndComparisons.length > 0 && (
              <section>
                <SectionHeading>Guides &amp; comparisons</SectionHeading>
                <InternalLinkTracker linkPosition="category_page" categorySlug={slug}>
                  <ul className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
                    {guidesAndComparisons.map((item) => (
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

            {otherArticles.length > 0 && (
              <section>
                <SectionHeading>Latest articles</SectionHeading>
                <InternalLinkTracker linkPosition="category_page" categorySlug={slug}>
                  <ul className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
                    {otherArticles.map((item) => (
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
