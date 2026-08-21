import Link from "next/link";
import { createClient } from "@/lib/supabase/server";
import { SITE_NAME, SITE_TAGLINE } from "@/lib/seo/site";
import { PLANNED_CATEGORIES } from "@/lib/public/categories";
import { getLatestPublishedContent, getLatestPublishedProducts, getLatestPublishedGuides } from "@/lib/public/queries";
import { Badge, EmptyState } from "@/components/shared/ui";
import { ContentCard, ProductCard, SectionHeading } from "@/components/public/cards";

export default async function HomePage() {
  const supabase = await createClient();
  const [{ data: categories }, latestContent, latestProducts, latestGuides] = await Promise.all([
    supabase.from("taxonomy_categories").select("id, slug").is("parent_id", null),
    getLatestPublishedContent(6),
    getLatestPublishedProducts(6),
    getLatestPublishedGuides(6),
  ]);

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
      <section className="border-b border-border-subtle bg-gradient-to-b from-accent-soft/60 to-white">
        <div className="mx-auto max-w-6xl px-6 py-20 sm:py-28">
          <p className="text-xs font-semibold uppercase tracking-widest text-accent mb-4">{SITE_NAME}</p>
          <h1 className="font-display max-w-2xl text-4xl sm:text-5xl font-bold tracking-tight text-zinc-900">
            {SITE_TAGLINE}
          </h1>
          <p className="mt-5 max-w-xl text-lg text-zinc-600">
            Reviews, guides, and comparisons built on real testing and real sourcing — cameras, drones, computing,
            networking, and gaming, explained without the noise.
          </p>
          <form action="/search" method="get" className="mt-8 max-w-md">
            <input
              type="search"
              name="q"
              placeholder="Search reviews, guides, products..."
              aria-label="Search Tech Carvalho"
              className="w-full rounded-full border border-border-subtle bg-white px-5 py-3 text-sm shadow-sm focus:outline-none focus:ring-2 focus:ring-accent/30 focus:border-accent/50"
            />
          </form>
        </div>
      </section>

      <div className="mx-auto max-w-6xl px-6">
        <section className="py-16 border-b border-border-subtle">
          <SectionHeading>Subject areas</SectionHeading>
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
            {PLANNED_CATEGORIES.map((category) => {
              const isLive = liveSlugSet.has(category.slug);
              return (
                <Link
                  key={category.slug}
                  href={`/${category.slug}`}
                  id={`home-category-${category.slug}`}
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
        </section>

        <section className="py-16 border-b border-border-subtle">
          <SectionHeading
            action={
              <Link href="/articles" className="text-sm font-medium text-accent hover:underline">
                View all articles →
              </Link>
            }
          >
            Latest
          </SectionHeading>
          {latestContent.length === 0 ? (
            <EmptyState
              title="Nothing published yet"
              description="Reviews, guides, comparisons, and news will appear here as they're published — nothing is shown until it's real."
            />
          ) : (
            <ul className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
              {latestContent.map((item) => (
                <li key={item.id}>
                  <ContentCard
                    href={`/articles/${item.slug}`}
                    type={item.type}
                    title={item.title}
                    publishedAt={item.published_at}
                    excerpt={item.excerpt}
                  />
                </li>
              ))}
            </ul>
          )}
        </section>

        {showGuidesSection && (
          <section className="py-16 border-b border-border-subtle">
            <SectionHeading
              action={
                <Link href="/articles?type=guide" className="text-sm font-medium text-accent hover:underline">
                  View all guides →
                </Link>
              }
            >
              Buying guides
            </SectionHeading>
            <ul className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
              {latestGuides.map((item) => (
                <li key={item.id}>
                  <ContentCard
                    href={`/articles/${item.slug}`}
                    type={item.type}
                    title={item.title}
                    publishedAt={item.published_at}
                    excerpt={item.excerpt}
                  />
                </li>
              ))}
            </ul>
          </section>
        )}

        <section className="py-16">
          <SectionHeading
            action={
              <Link href="/products" className="text-sm font-medium text-accent hover:underline">
                View all products →
              </Link>
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
            <ul className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
              {latestProducts.map((p) => (
                <li key={p.id}>
                  <ProductCard href={`/products/${p.slug}`} name={p.name} summary={p.summary} status={p.status} />
                </li>
              ))}
            </ul>
          )}
        </section>
      </div>
    </div>
  );
}
