import type { Metadata } from "next";
import { cache } from "react";
import Link from "next/link";
import Image from "next/image";
import { notFound } from "next/navigation";
import { buildMetadata, canonicalPathWithParams } from "@/lib/seo/metadata";
import { findPlannedCategory } from "@/lib/public/categories";
import {
  getCategoryBySlug,
  getCategorySeo,
  getCategoryPublishedCounts,
  getSubcategories,
  getManufacturersForCategory,
  getAllCategoryNodes,
} from "@/lib/public/queries";
import { getCategoryContentRows, enrichContentCards } from "@/lib/public/content-list";
import { getCategoryProductRows, enrichProductCards } from "@/lib/public/product-list";
import { HUB_SECTION_PAGE_SIZE, pageSlice, parsePageParam, resolveHubPage } from "@/lib/public/pagination";
import { itemListJsonLd, safeJsonLdString } from "@/lib/seo/jsonld";
import { getTrendingContent } from "@/lib/public/trending";
import { getCategoryHeroImage, categoryGradient } from "@/lib/public/category-hero";
import { Breadcrumbs } from "@/components/public/breadcrumbs";
import { breadcrumbTrail } from "@/lib/public/taxonomy-tree";
import { mediaFit } from "@/lib/media/presentation";
import { classifiable } from "@/lib/public/hero-image";
import { ContentCard, ProductCard, SectionHeading } from "@/components/public/cards";
import { PublicPagination } from "@/components/public/pagination";
import { TrendingSection } from "@/components/public/trending";
import { EmptyState } from "@/components/shared/ui";
import { PageViewTracker } from "@/components/analytics/page-view-tracker";
import { InternalLinkTracker } from "@/components/analytics/internal-link-tracker";
import { requiredDisclosure } from "@/lib/media/classification";

type CategorySearchParams = { page?: string | string[] };

// One resolved view of a category hub page, shared by generateMetadata and the
// render via React `cache` so the page number, the totals and the rows are
// decided once per request. generateMetadata needs the RESOLVED page (not the
// requested one) because that is what goes in the canonical: a request for
// ?page=99 on a two-page hub renders page 2 and must say so, rather than
// declaring a URL that holds nothing.
//
// The two card sections share a single `?page=` param. Two independent page
// params would square the crawlable URL space of every hub — /computing?
// articles=2&products=3 and its 30-odd siblings, all near-duplicates — for no
// reader benefit.
const getCategoryHubPage = cache(async (slug: string, categoryId: string, requestedPage: number) => {
  const [trending, contentRows, productRows] = await Promise.all([
    getTrendingContent({ categorySlug: slug, supportingCount: 3 }),
    getCategoryContentRows(categoryId),
    getCategoryProductRows(categoryId),
  ]);

  // Anything in the trending rail is removed from the paginated article list
  // BEFORE the page count is worked out, not after slicing. Filtering a slice
  // would leave short pages, and — worse — an article promoted into trending
  // that happened to fall in page 2's slice would vanish from page 2 while the
  // rail that replaces it only exists on page 1.
  const trendingIds = new Set(
    [trending.lead?.id, ...trending.supporting.map((s) => s.id)].filter(Boolean) as string[]
  );
  const articleRows = contentRows.filter((c) => !trendingIds.has(c.id));

  const { page, pageCount } = resolveHubPage(
    [articleRows.length, productRows.length],
    requestedPage,
    HUB_SECTION_PAGE_SIZE
  );

  const [content, products] = await Promise.all([
    enrichContentCards(pageSlice(articleRows, page, HUB_SECTION_PAGE_SIZE)),
    enrichProductCards(pageSlice(productRows, page, HUB_SECTION_PAGE_SIZE)),
  ]);

  return {
    trending,
    content,
    products,
    page,
    pageCount,
    // Totals describe the whole hub, not this page: the header count line and
    // the indexability gate are both statements about the category, and the
    // article total includes the pieces shown in the trending rail.
    articleTotal: contentRows.length,
    productTotal: productRows.length,
  };
});

export async function generateMetadata({
  params,
  searchParams,
}: {
  params: Promise<{ category: string }>;
  searchParams: Promise<CategorySearchParams>;
}): Promise<Metadata> {
  const { category: slug } = await params;
  const requestedPage = parsePageParam((await searchParams).page);
  const planned = findPlannedCategory(slug);
  const dbCategory = await getCategoryBySlug(slug);

  if (!planned && !dbCategory) notFound();

  const label = dbCategory?.name ?? planned?.label ?? slug;

  const [seo, counts, bannerImage, hub] = dbCategory
    ? await Promise.all([
        getCategorySeo(dbCategory.id),
        getCategoryPublishedCounts(dbCategory.id),
        getCategoryHeroImage(slug, label),
        getCategoryHubPage(slug, dbCategory.id, requestedPage),
      ])
    : [null, { productCount: 0, contentCount: 0 }, null, null];

  const hasPublishedContent = counts.productCount > 0 || counts.contentCount > 0;
  const page = hub?.page ?? 1;
  const title = seo?.meta_title ?? label;

  return buildMetadata({
    // The page number belongs in the title, so a paginated hub is not several
    // identical <title>s competing with each other.
    title: page > 1 ? `${title} — page ${page}` : title,
    description:
      seo?.meta_description ??
      // The planned blurb is a one-line nav label ("Cameras, lenses, and the
      // gear behind them.") — fine as a fallback, but a hub with real content
      // deserves a description that says what is actually on it.
      (hasPublishedContent
        ? `${planned?.blurb ?? dbCategory?.description ?? `${label} on Tech Carvalho`} Reviews, guides, comparisons, and product specifications.`
        : planned?.blurb ?? dbCategory?.description ?? undefined),
    // Self-referencing and normalized against an allow-list of exactly one
    // param. Tracking junk (utm_*, fbclid) is dropped, and page=1 collapses to
    // the bare hub path — so /cameras-photography?page=1 and
    // /cameras-photography are one URL, not two competing ones.
    path: canonicalPathWithParams(`/${slug}`, { page }, ["page"]),
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
  searchParams,
}: {
  params: Promise<{ category: string }>;
  searchParams: Promise<CategorySearchParams>;
}) {
  const { category: slug } = await params;
  const requestedPage = parsePageParam((await searchParams).page);
  const planned = findPlannedCategory(slug);
  const dbCategory = await getCategoryBySlug(slug);

  if (!planned && !dbCategory) notFound();

  const label = dbCategory?.name ?? planned?.label ?? slug;

  // Ancestor trail, ending with this category. Built from
  // taxonomy_categories.parent_id so a child names the subject it belongs to
  // rather than presenting itself as a top-level topic. A category with no
  // parent yields a single crumb, which is the previous behaviour exactly.
  const categoryNodes = dbCategory ? await getAllCategoryNodes() : [];
  const ancestorCrumbs = dbCategory
    ? breadcrumbTrail(dbCategory.id, categoryNodes)
    : [{ slug, name: label }];

  const [hub, subcategories, manufacturers, bannerImage] = dbCategory
    ? await Promise.all([
        getCategoryHubPage(slug, dbCategory.id, requestedPage),
        getSubcategories(dbCategory.id),
        getManufacturersForCategory(dbCategory.id),
        getCategoryHeroImage(slug, label),
      ])
    : [null, [], [], null];

  // A PLANNED_CATEGORIES slug with no taxonomy_categories row yet has no hub to
  // page through — it renders the "Coming soon" empty state below.
  const trending = hub?.trending ?? { lead: null, supporting: [], isRecencyFallback: true };
  const content = hub?.content ?? [];
  const products = hub?.products ?? [];
  const page = hub?.page ?? 1;
  const pageCount = hub?.pageCount ?? 1;
  const articleTotal = hub?.articleTotal ?? 0;
  const productTotal = hub?.productTotal ?? 0;

  const hasContent = productTotal > 0 || articleTotal > 0 || subcategories.length > 0;

  // The trending rail is the hub's editorial lead, so it belongs on the hub's
  // first page and nowhere else. Its pieces are already excluded from every
  // page of the article list (see getCategoryHubPage), so they are shown once
  // across the whole paginated set rather than repeated on each page.
  const showRails = page === 1;

  // Split this page's articles by intent so the hub reads as a publication
  // rather than one long undifferentiated grid. The underlying list is ordered
  // guides-first, so these two buckets stay contiguous across pages instead of
  // fragmenting.
  const guidesAndComparisons = content.filter((c) => c.type === "guide" || c.type === "comparison");
  const otherArticles = content.filter((c) => c.type !== "guide" && c.type !== "comparison");

  return (
    <div>
      <PageViewTracker entityType="category" categorySlug={slug} />
      {/* One ItemList for the hub's editorial coverage, one for its catalogue.
          Both list only what THIS page actually renders — a paginated page
          must not claim the whole hub's contents — and neither is emitted on
          an empty "Coming soon" hub, which is noindex and where markup
          describing a list of nothing is worse than no markup. */}
      {content.length > 0 && (
        <script
          type="application/ld+json"
          dangerouslySetInnerHTML={{
            __html: safeJsonLdString(
              itemListJsonLd(
                content.map((item) => ({ name: item.title, path: `/articles/${item.slug}` })),
                { name: pageCount > 1 ? `${label} articles — page ${page}` : `${label} articles` }
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
                { name: pageCount > 1 ? `${label} products — page ${page}` : `${label} products` }
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
          {/* Home > parent > this. Built from taxonomy_categories.parent_id, so a
              child category names the subject it belongs to instead of
              presenting itself as a top-level topic. Falls back to the flat
              two-item trail when the category has no parent. */}
          <Breadcrumbs
            items={[
              { name: "Home", path: "/" },
              ...ancestorCrumbs.map((c) => ({ name: c.name, path: `/${c.slug}` })),
            ]}
          />
          <h1 className="font-display text-3xl sm:text-5xl font-bold tracking-tight text-zinc-900">{label}</h1>
          {(planned?.blurb || dbCategory?.description) && (
            <p className="mt-4 max-w-xl text-lg text-zinc-700">{planned?.blurb ?? dbCategory?.description}</p>
          )}
          {hasContent && (
            // Counts describe the whole category, not this page, so a reader
            // landing on page 2 still sees how much there is — with the page
            // position said plainly next to it.
            <p className="mt-5 text-sm font-medium text-zinc-600">
              {articleTotal} article{articleTotal === 1 ? "" : "s"}
              {productTotal > 0 && ` · ${productTotal} product${productTotal === 1 ? "" : "s"}`}
              {pageCount > 1 && ` · page ${page} of ${pageCount}`}
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
            {showRails && trending.lead && (
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

            {/* Subcategory and manufacturer chips are navigation, not cards:
                a few hundred bytes of text that cost nothing to keep on every
                page, and that a reader on page 2 needs just as much. */}
            {subcategories.length > 0 && (
              <section>
                <SectionHeading>Subcategories</SectionHeading>
                <InternalLinkTracker linkPosition="category_page">
                  <ul className="flex flex-wrap gap-3">
                    {subcategories.map((sc) => (
                      <li key={sc.id} data-entity-type="category" data-category-slug={sc.slug}>
                        <Link
                          href={`/${sc.slug}`}
                          className="inline-flex min-h-11 items-center rounded-full border border-border-subtle bg-white px-4 text-sm font-medium hover:border-accent/40"
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
                          imageDisclosure={requiredDisclosure(classifiable(item.heroImage))}
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
                          imageDisclosure={requiredDisclosure(classifiable(item.heroImage))}
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
                          imageDisclosure={requiredDisclosure(classifiable(p.heroImage))}
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
                          className="inline-flex min-h-11 items-center rounded-full border border-border-subtle bg-white px-4 text-sm font-medium hover:border-accent/40"
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

        {/* Real <a href> page links, server-rendered: nothing on this hub is
            reachable only by running JavaScript. Outside the section stack so
            it reads as the end of the list rather than as another section. */}
        {hasContent && <PublicPagination page={page} pageCount={pageCount} basePath={`/${slug}`} />}
      </div>
    </div>
  );
}
