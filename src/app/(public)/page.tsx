import Link from "next/link";
import { createClient } from "@/lib/supabase/server";
import { SITE_NAME, SITE_TAGLINE } from "@/lib/seo/site";
import { PLANNED_CATEGORIES } from "@/lib/public/categories";
import { getLatestPublishedContent, getLatestPublishedProducts, getLatestPublishedGuides } from "@/lib/public/queries";
import { getTrendingContent } from "@/lib/public/trending";
import { Badge, EmptyState } from "@/components/shared/ui";
import { ContentCard, ProductCard, SectionHeading } from "@/components/public/cards";
import { TrendingSection } from "@/components/public/trending";
import { PageViewTracker } from "@/components/analytics/page-view-tracker";
import { InternalLinkTracker } from "@/components/analytics/internal-link-tracker";
import { CtaLink } from "@/components/analytics/cta-link";

export default async function HomePage() {
  const supabase = await createClient();
  const [{ data: categories }, latestContent, latestProducts, latestGuides, trending] = await Promise.all([
    supabase.from("taxonomy_categories").select("id, slug").is("parent_id", null),
    getLatestPublishedContent(6),
    getLatestPublishedProducts(6),
    getLatestPublishedGuides(6),
    getTrendingContent({ supportingCount: 4 }),
  ]);

  // The trending block already surfaces its lead + supporting items. Filtering
  // them out of "Latest" below avoids the same story appearing twice within one
  // screen, which is what makes a homepage feel thin rather than active.
  const trendingIds = new Set(
    [trending.lead?.id, ...trending.supporting.map((s) => s.id)].filter(Boolean) as string[]
  );
  const latestWithoutTrending = latestContent.filter((item) => !trendingIds.has(item.id));

  // Only worth its own section once there are enough guides to read as a
  // distinct rail from "Latest" above — below that threshold it would just
  // duplicate the same 1-2 items in a second list.
  const showGuidesSection = latestGuides.length >= 3;

  let liveSlugSet = new Set<string>();
  if (categories && categories.length > 0) {
    const { data: publishedCounts } = await supabase
      .from("products")
      .select("category_id")
      .eq("is_published", true)
      .in(
        "category_id",
        categories.map((c) => c.id)
      );
    const categoryIdToSlug = new Map(categories.map((c) => [c.id, c.slug]));
    liveSlugSet = new Set(
      (publishedCounts ?? []).map((p) => categoryIdToSlug.get(p.category_id)).filter((s): s is string => Boolean(s))
    );
  }

  return (
    <div>
      <PageViewTracker />
      {/* Intentionally compact. This masthead previously ran py-20/py-28,
          which pushed the Trending block entirely below the fold — the whole
          point of Trending Now is that a visitor sees what is current without
          scrolling, so the masthead yields vertical space to it. */}
      <section className="border-b border-border-subtle bg-gradient-to-b from-accent-soft/60 to-white">
        <div className="mx-auto max-w-6xl px-6 py-10 sm:py-12">
          <p className="text-xs font-semibold uppercase tracking-widest text-accent mb-3">{SITE_NAME}</p>
          <div className="flex flex-col gap-5 lg:flex-row lg:items-end lg:justify-between">
            <div>
              <h1 className="font-display max-w-2xl text-3xl sm:text-4xl font-bold tracking-tight text-zinc-900">
                {SITE_TAGLINE}
              </h1>
              <p className="mt-3 max-w-xl text-base text-zinc-600">
                Reviews, guides, and comparisons built on real testing and real sourcing — cameras, drones,
                computing, networking, and gaming, explained without the noise.
              </p>
            </div>
            <form action="/search" method="get" className="w-full max-w-md lg:w-80 lg:shrink-0">
              <input
                type="search"
                name="q"
                placeholder="Search reviews, guides, products..."
                aria-label="Search Tech Carvalho"
                className="w-full rounded-full border border-border-subtle bg-white px-5 py-3 text-sm shadow-sm focus:outline-none focus:ring-2 focus:ring-accent/30 focus:border-accent/50"
              />
            </form>
          </div>
        </div>
      </section>

      <div className="mx-auto max-w-6xl px-6">
        {trending.lead && (
          <div className="py-12 border-b border-border-subtle">
            <TrendingSection
              lead={trending.lead}
              supporting={trending.supporting}
              isRecencyFallback={trending.isRecencyFallback}
              linkPosition="home"
            />
          </div>
        )}

        <section className="py-16 border-b border-border-subtle">
          <SectionHeading>Subject areas</SectionHeading>
          <InternalLinkTracker linkPosition="home">
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
              {PLANNED_CATEGORIES.map((category) => {
                const isLive = liveSlugSet.has(category.slug);
                return (
                  <Link
                    key={category.slug}
                    href={`/${category.slug}`}
                    id={`home-category-${category.slug}`}
                    data-entity-type="category"
                    data-category-slug={category.slug}
                    className="group rounded-xl border border-border-subtle bg-white p-5 transition-colors hover:border-accent/40"
                  >
                    <div className="flex items-center justify-between mb-2">
                      <h3 className="font-display font-semibold text-zinc-900 group-hover:text-accent">
                        {category.label}
                      </h3>
                      {!isLive && <Badge>Coming soon</Badge>}
                    </div>
                    <p className="text-sm text-zinc-500">{category.blurb}</p>
                  </Link>
                );
              })}
            </div>
          </InternalLinkTracker>
        </section>

        <section className="py-16 border-b border-border-subtle">
          <SectionHeading
            action={
              <CtaLink href="/articles" ctaId="home_view_all_articles" linkPosition="home" className="text-sm font-medium text-accent hover:underline">
                View all articles →
              </CtaLink>
            }
          >
            Latest
          </SectionHeading>
          {latestWithoutTrending.length === 0 ? (
            <EmptyState
              title={latestContent.length === 0 ? "Nothing published yet" : "All caught up"}
              description={
                latestContent.length === 0
                  ? "Reviews, guides, comparisons, and news will appear here as they're published — nothing is shown until it's real."
                  : "Everything recent is already featured above. New articles will appear here as they're published."
              }
            />
          ) : (
            <InternalLinkTracker linkPosition="home">
              <ul className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
                {latestWithoutTrending.map((item) => (
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
          )}
        </section>

        {showGuidesSection && (
          <section className="py-16 border-b border-border-subtle">
            <SectionHeading
              action={
                <CtaLink href="/articles?type=guide" ctaId="home_view_all_guides" linkPosition="home" className="text-sm font-medium text-accent hover:underline">
                  View all guides →
                </CtaLink>
              }
            >
              Buying guides
            </SectionHeading>
            <InternalLinkTracker linkPosition="home">
              <ul className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
                {latestGuides.map((item) => (
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

        <section className="py-16">
          <SectionHeading
            action={
              <CtaLink href="/products" ctaId="home_view_all_products" linkPosition="home" className="text-sm font-medium text-accent hover:underline">
                View all products →
              </CtaLink>
            }
          >
            Recently updated products
          </SectionHeading>
          {latestProducts.length === 0 ? (
            <EmptyState
              title="No products published yet"
              description="Products will appear here as they're added and published to the catalog."
            />
          ) : (
            <InternalLinkTracker linkPosition="home">
              <ul className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
                {latestProducts.map((p) => (
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
          )}
        </section>
      </div>
    </div>
  );
}
