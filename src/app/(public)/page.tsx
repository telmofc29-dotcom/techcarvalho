import type { Metadata } from "next";
import { SITE_NAME, SITE_TAGLINE } from "@/lib/seo/site";
import { buildMetadata } from "@/lib/seo/metadata";
import { getHomepageData, composeHomepage } from "@/lib/public/homepage";
import { getTrendingContent } from "@/lib/public/trending";
import { EmptyState } from "@/components/shared/ui";
import { ContentCard, ProductCard, SectionHeading, CARD_FOCUS, ArrowGlyph } from "@/components/public/cards";
import { TrendingSection } from "@/components/public/trending";
import {
  CategorySectionBlock,
  QuestionRail,
  ReferencedGuides,
  SubjectAreaGrid,
} from "@/components/public/home-sections";
import { PageViewTracker } from "@/components/analytics/page-view-tracker";
import { InternalLinkTracker } from "@/components/analytics/internal-link-tracker";
import { CtaLink } from "@/components/analytics/cta-link";

// The front page.
//
// ---------------------------------------------------------------------------
// The rule this page is built around
// ---------------------------------------------------------------------------
// A section exists only when there is enough real, published content to fill
// it. There are no decorative sections, no placeholder cards, and no invented
// figures anywhere below — every number shown is a count of rows a visitor can
// click through and verify, and no section claims popularity, traffic, ratings,
// or search volume, because none of that is data this page can honestly read
// (see the notes in src/lib/public/homepage.ts and src/lib/public/trending.ts).
//
// The gating rules themselves live in composeHomepage() so they are all in one
// readable place rather than scattered through JSX conditions.
//
// Sections, and what each is conditional on:
//   Trending now      — a lead story exists at all.
//   Latest            — at least one published story not already shown above.
//   Category blocks   — a category with >= CATEGORY_SECTION_MIN_STORIES unused
//                       published stories; capped at MAX_CATEGORY_SECTIONS.
//   Most referenced   — >= REFERENCED_GUIDES_MIN guides with a real link in the
//     guides            content graph.
//   Questions         — >= QUESTION_RAIL_MIN articles that record a primary_query.
//   New releases      — >= LAUNCH_SECTION_MIN products actually released inside
//                       the last LAUNCH_WINDOW_MONTHS months.
//   Catalogue         — at least one published product.
//   Subject areas     — always, once categories exist; shows live counts and
//                       says plainly which areas have nothing published.

// Declared here rather than left to the root layout's inherited defaults.
// The layout's `title.default` and description are the site-wide FALLBACK for
// any segment that sets nothing — the homepage is a page in its own right and
// should state its own title, description and self-referencing canonical
// explicitly, not share the string every other page falls back to.
export const metadata: Metadata = buildMetadata({
  title: `${SITE_NAME} — ${SITE_TAGLINE}`,
  description:
    "Reviews, buying guides, and comparisons for cameras, drones, computing, networking, and gaming — built on a structured product catalogue with real sourcing and freshness records.",
  path: "/",
});

export default async function HomePage() {
  const [data, trending] = await Promise.all([
    getHomepageData(),
    getTrendingContent({ supportingCount: 5 }),
  ]);

  // The trending block already surfaces its lead + supporting items. Excluding
  // them from everything below avoids the same story appearing twice within one
  // screen, which is what makes a homepage feel thin rather than active.
  const trendingIds = [trending.lead?.id, ...trending.supporting.map((s) => s.id)].filter(
    (id): id is string => Boolean(id)
  );
  const sections = composeHomepage(data, trendingIds);

  const liveAreaCount = data.subjectAreas.filter(
    (a) => a.articleCount > 0 || a.productCount > 0
  ).length;
  // Only real figures, and only when they're non-zero — an empty site shows no
  // stat line at all rather than "0 articles".
  const stats = [
    data.totalArticles > 0
      ? `${data.totalArticles} article${data.totalArticles === 1 ? "" : "s"} published`
      : null,
    liveAreaCount > 0 ? `${liveAreaCount} subject area${liveAreaCount === 1 ? "" : "s"} live` : null,
    data.lastPublished ? `Latest ${data.lastPublished.toLowerCase()}` : null,
  ].filter((s): s is string => Boolean(s));

  const hasAnyContent =
    Boolean(trending.lead) || data.stories.length > 0 || data.products.length > 0;

  return (
    <div>
      <PageViewTracker />

      {/* Intentionally compact. This masthead previously ran py-20/py-28,
          which pushed the Trending block entirely below the fold — the whole
          point of Trending Now is that a visitor sees what is current without
          scrolling, so the masthead yields vertical space to it. */}
      <section className="border-b border-border-subtle bg-gradient-to-b from-accent-soft/60 to-white">
        <div className="mx-auto max-w-6xl px-6 py-9 sm:py-11">
          <p className="mb-3 text-xs font-semibold uppercase tracking-widest text-accent">{SITE_NAME}</p>
          <div className="flex flex-col gap-5 lg:flex-row lg:items-end lg:justify-between">
            <div>
              <h1 className="font-display max-w-2xl text-3xl font-bold leading-[1.1] tracking-tight text-zinc-900 sm:text-4xl">
                {SITE_TAGLINE}
              </h1>
              <p className="mt-3 max-w-xl text-base leading-relaxed text-zinc-600">
                Reviews, guides, and comparisons built on real testing and real sourcing — cameras, drones,
                computing, networking, and gaming, explained without the noise.
              </p>
              {stats.length > 0 && (
                <p className="mt-4 flex flex-wrap items-center gap-x-2 gap-y-1 text-xs font-medium text-zinc-500">
                  {stats.map((stat, index) => (
                    <span key={stat} className="flex items-center gap-2">
                      {index > 0 && (
                        <span aria-hidden="true" className="h-1 w-1 rounded-full bg-zinc-300" />
                      )}
                      {stat}
                    </span>
                  ))}
                </p>
              )}
            </div>
            <form action="/search" method="get" className="w-full max-w-md lg:w-80 lg:shrink-0">
              <input
                type="search"
                name="q"
                placeholder="Search reviews, guides, products..."
                aria-label="Search Tech Carvalho"
                className="w-full rounded-full border border-border-subtle bg-white px-5 py-3 text-sm shadow-sm focus:border-accent/50 focus:outline-none focus:ring-2 focus:ring-accent/30"
              />
            </form>
          </div>
        </div>
      </section>

      <div className="mx-auto max-w-6xl px-6">
        <div className="divide-y divide-border-subtle">
          {!hasAnyContent && (
            <div className="py-16">
              <EmptyState
                title="Nothing published yet"
                description="Reviews, guides, comparisons, and news will appear here as they're published — nothing is shown until it's real."
              />
            </div>
          )}

          {trending.lead && (
            <div className="py-10 sm:py-12">
              <TrendingSection
                lead={trending.lead}
                supporting={trending.supporting}
                isRecencyFallback={trending.isRecencyFallback}
                linkPosition="home"
              />
            </div>
          )}

          {sections.latest.length > 0 && (
            <div className="py-12 sm:py-14">
              <section aria-labelledby="home-latest">
                <SectionHeading
                  id="home-latest"
                  action={
                    <CtaLink
                      href="/articles"
                      ctaId="home_view_all_articles"
                      linkPosition="home"
                      className={`inline-flex items-center gap-1.5 rounded text-sm font-semibold text-accent hover:underline ${CARD_FOCUS}`}
                    >
                      View all articles
                      <ArrowGlyph className="h-4 w-4" />
                    </CtaLink>
                  }
                >
                  Latest
                </SectionHeading>
                <InternalLinkTracker linkPosition="home">
                  <ul className="grid grid-cols-1 gap-5 sm:grid-cols-2 lg:grid-cols-3">
                    {sections.latest.map((item) => (
                      <li key={item.id} data-entity-type="content" data-entity-id={item.id}>
                        <ContentCard
                          href={`/articles/${item.slug}`}
                          type={item.type}
                          title={item.title}
                          publishedAt={item.publishedAt}
                          dateLabel={item.dateLabel}
                          excerpt={item.excerpt}
                          imageUrl={item.heroImage?.url}
                          imageAlt={item.heroImage?.alt}
                          categoryLabel={item.categoryLabel}
                        />
                      </li>
                    ))}
                  </ul>
                </InternalLinkTracker>
              </section>
            </div>
          )}

          {/* First two subject-area blocks, then the guide rail, then the rest.
              Breaking the run of category sections keeps the page reading as a
              front page rather than as a list of lists. */}
          {sections.categorySections.slice(0, 2).map((section) => (
            <div key={section.slug} className="py-12 sm:py-14">
              <CategorySectionBlock section={section} />
            </div>
          ))}

          {sections.referencedGuides.length > 0 && (
            <div className="py-12 sm:py-14">
              <ReferencedGuides guides={sections.referencedGuides} />
            </div>
          )}

          {sections.categorySections.slice(2).map((section) => (
            <div key={section.slug} className="py-12 sm:py-14">
              <CategorySectionBlock section={section} />
            </div>
          ))}

          {sections.questions.length > 0 && (
            <div className="py-12 sm:py-14">
              <QuestionRail questions={sections.questions} />
            </div>
          )}

          {sections.recentLaunches.length > 0 && (
            <div className="py-12 sm:py-14">
              <section aria-labelledby="home-new-releases">
                <SectionHeading
                  id="home-new-releases"
                  note="Hardware released in the last 18 months that we've documented. Release dates are the manufacturer's; we don't list prices we haven't verified."
                >
                  New releases
                </SectionHeading>
                <InternalLinkTracker linkPosition="home">
                  <ul className="grid grid-cols-1 gap-5 sm:grid-cols-2 lg:grid-cols-3">
                    {sections.recentLaunches.map((product) => (
                      <li key={product.id} data-entity-type="product" data-entity-id={product.id}>
                        <ProductCard
                          href={`/products/${product.slug}`}
                          name={product.name}
                          manufacturerName={product.manufacturerName}
                          summary={product.summary}
                          status={product.status}
                          meta={product.releaseLabel ? `Released ${product.releaseLabel}` : null}
                          imageUrl={product.heroImage?.url}
                          imageAlt={product.heroImage?.alt}
                        />
                      </li>
                    ))}
                  </ul>
                </InternalLinkTracker>
              </section>
            </div>
          )}

          {sections.catalogue.length > 0 && (
            <div className="py-12 sm:py-14">
              <section aria-labelledby="home-catalogue">
                <SectionHeading
                  id="home-catalogue"
                  note="Products with a documented specification record on the site, most recently updated first."
                  action={
                    <CtaLink
                      href="/products"
                      ctaId="home_view_all_products"
                      linkPosition="home"
                      className={`inline-flex items-center gap-1.5 rounded text-sm font-semibold text-accent hover:underline ${CARD_FOCUS}`}
                    >
                      View all products
                      <ArrowGlyph className="h-4 w-4" />
                    </CtaLink>
                  }
                >
                  In the catalogue
                </SectionHeading>
                <InternalLinkTracker linkPosition="home">
                  <ul className="grid grid-cols-1 gap-5 sm:grid-cols-2 lg:grid-cols-3">
                    {sections.catalogue.map((product) => (
                      <li key={product.id} data-entity-type="product" data-entity-id={product.id}>
                        <ProductCard
                          href={`/products/${product.slug}`}
                          name={product.name}
                          manufacturerName={product.manufacturerName}
                          summary={product.summary}
                          status={product.status}
                          meta={product.releaseLabel ? `Released ${product.releaseLabel}` : null}
                          imageUrl={product.heroImage?.url}
                          imageAlt={product.heroImage?.alt}
                        />
                      </li>
                    ))}
                  </ul>
                </InternalLinkTracker>
              </section>
            </div>
          )}

          {data.subjectAreas.length > 0 && (
            <div className="py-12 sm:py-14">
              <SubjectAreaGrid areas={data.subjectAreas} />
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
