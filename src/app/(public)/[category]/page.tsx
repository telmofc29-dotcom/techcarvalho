import type { Metadata } from "next";
import Link from "next/link";
import Image from "next/image";
import { notFound } from "next/navigation";
import { buildMetadata } from "@/lib/seo/metadata";
import { findPlannedCategory } from "@/lib/public/categories";
import {
  getCategoryBySlug,
  getCategorySeo,
  getCategoryPublishedCounts,
  getPublishedContentForCategory,
  getPublishedProductsForCategory,
  getSubcategories,
  getManufacturersForCategory,
} from "@/lib/public/queries";
import { itemListJsonLd, safeJsonLdString } from "@/lib/seo/jsonld";
import { getTrendingContent } from "@/lib/public/trending";
import { getCategoryHeroImage, categoryGradient } from "@/lib/public/category-hero";
import { Breadcrumbs } from "@/components/public/breadcrumbs";
import { mediaFit } from "@/lib/media/presentation";
import { classifiable } from "@/lib/public/hero-image";
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
  const [seo, counts, bannerImage] = dbCategory
    ? await Promise.all([
        getCategorySeo(dbCategory.id),
        getCategoryPublishedCounts(dbCategory.id),
        getCategoryHeroImage(slug, label),
      ])
    : [null, { productCount: 0, contentCount: 0 }, null];

  const hasPublishedContent = counts.productCount > 0 || counts.contentCount > 0;

  return buildMetadata({
    title: seo?.meta_title ?? label,
    description:
      seo?.meta_description ??
      // The planned blurb is a one-line nav label ("Cameras, lenses, and the
      // gear behind them.") — fine as a fallback, but a hub with real content
      // deserves a description that says what is actually on it.
      (hasPublishedContent
        ? `${planned?.blurb ?? dbCategory?.description ?? `${label} on Tech Carvalho`} Reviews, guides, comparisons, and product specifications.`
        : planned?.blurb ?? dbCategory?.description ?? undefined),
    path: `/${slug}`,
    canonicalUrl: seo?.canonical_url,
    // A subject area with nothing published renders the "Coming soon" empty
    // state. Ten of those — one per PLANNED_CATEGORIES entry, all structurally
    // identical, differing only in a heading and a one-line blurb — is a
    // textbook thin-content cluster, and they were all indexable AND listed in
    // sitemap.xml. They stay crawlable (follow) so the nav still works and so
    // each one flips to indexable the moment it has content, but they do not
    // ask to be indexed while empty.
    noindex: seo?.noindex ?? !hasPublishedContent,
    follow: true,
    // The real category banner asset when one exists — the same image the
    // page renders at the top. Falls back to the site OG image otherwise;
    // the on-page gradient is CSS, not an image, so there is nothing to share.
    image: bannerImage,
  });
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
      {/* One ItemList for the hub's editorial coverage, one for its catalogue.
          Both list only what this page actually renders, and neither is
          emitted on an empty "Coming soon" hub — that page is noindex, and
          markup describing a list of nothing is worse than no markup. */}
      {content.length > 0 && (
        <script
          type="application/ld+json"
          dangerouslySetInnerHTML={{
            __html: safeJsonLdString(
              itemListJsonLd(
                content.map((item) => ({ name: item.title, path: `/articles/${item.slug}` })),
                { name: `${label} articles` }
              )
            ),
          }}
        />
      )}
      {products.length > 0 && (
        <script
          type="application/ld+json"
          dangerouslySetInnerHTML={{
            __html: safeJsonLdString(
              itemListJsonLd(
                products.map((p) => ({ name: p.name, path: `/products/${p.slug}` })),
                { name: `${label} products` }
              )
            ),
          }}
        />
      )}

      {/* Category banner. Uses a real category_hero asset when one exists;
          otherwise a deterministic per-category gradient so the header still
          reads as designed rather than as a failed image load. */}
      <div className="relative overflow-hidden border-b border-border-subtle bg-zinc-50">
        {bannerImage ? (
          <>
            <Image
              src={bannerImage.url}
              // Decorative: the <h1> sitting on top of this banner already
              // names the category, and the scrim means the image is a ground
              // for that heading rather than content in its own right. `alt=""`
              // is how that is spelled — repeating the label made a screen
              // reader read the category name twice in a row.
              alt=""
              fill
              // The banner genuinely IS full-bleed, so 100vw is honest here —
              // unlike the fill images elsewhere that inherited 100vw by
              // omission while sitting in a 720px column.
              sizes="100vw"
              // `priority` is deprecated in Next 16; `preload` is the same
              // behaviour under a name that says what it does. This is the
              // page's single preloaded image.
              preload
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
                // Exactly one preloaded image per page, and it has to be the
                // one the viewport actually lands on. When this hub has a real
                // banner asset the banner is that image and preloading the
                // trending lead as well would put two competing <link rel=
                // preload> tags in the head. When it does NOT — most hubs fall
                // back to the CSS gradient, which is not an image at all —
                // there is nothing above the trending lead, so the lead is the
                // LCP candidate and preloading it is the whole point.
                preloadLead={!bannerImage}
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
                          imageFit={mediaFit(classifiable(item.heroImage))}
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
                          imageFit={mediaFit(classifiable(item.heroImage))}
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
                          imageFit={mediaFit(classifiable(p.heroImage))}
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
