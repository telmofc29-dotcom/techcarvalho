import type { Metadata } from "next";
import Link from "next/link";
import { buildMetadata } from "@/lib/seo/metadata";
import { searchSite } from "@/lib/public/search";
import { Breadcrumbs } from "@/components/public/breadcrumbs";
import { mediaFit } from "@/lib/media/presentation";
import { classifiable } from "@/lib/public/hero-image";
import { ContentCard, ProductCard, SectionHeading } from "@/components/public/cards";
import { SearchTracker } from "@/components/public/search-tracker";
import { PageViewTracker } from "@/components/analytics/page-view-tracker";
import { EmptyState } from "@/components/shared/ui";

export async function generateMetadata({
  searchParams,
}: {
  searchParams: Promise<{ q?: string }>;
}): Promise<Metadata> {
  const { q } = await searchParams;
  return buildMetadata({ title: q ? `Search: ${q}` : "Search", path: "/search", noindex: true });
}

export default async function SearchPage({
  searchParams,
}: {
  searchParams: Promise<{ q?: string }>;
}) {
  const { q } = await searchParams;
  const results = q ? await searchSite(q) : null;
  const resultCount = results
    ? results.products.length + results.content.length + results.manufacturers.length + results.categories.length
    : 0;
  const hasResults = results && resultCount > 0;
  // Running rank across the whole result set (content, then products, then
  // manufacturers/categories) rather than restarting per section, so
  // search_result_click's position reflects what a visitor actually sees
  // top-to-bottom on the page.
  let resultPosition = 0;

  return (
    <div className="mx-auto max-w-6xl px-6 py-12">
      <PageViewTracker />
      <Breadcrumbs items={[{ name: "Home", path: "/" }, { name: "Search", path: "/search" }]} />

      <form action="/search" method="get" className="max-w-md mb-10">
        <input
          type="search"
          name="q"
          defaultValue={q}
          placeholder="Search reviews, guides, products..."
          aria-label="Search Tech Carvalho"
          className="w-full rounded-full border border-border-subtle bg-white px-5 py-3 text-sm shadow-sm focus:outline-none focus:ring-2 focus:ring-accent/30 focus:border-accent/50"
        />
      </form>

      {!q ? (
        <EmptyState title="Search Tech Carvalho" description="Find reviews, guides, products, and manufacturers." />
      ) : (
        <SearchTracker query={q} resultCount={resultCount}>
          {!hasResults ? (
            <EmptyState title={`No results for "${q}"`} description="Try a different term, or browse a subject area from the navigation." />
          ) : (
            <div className="flex flex-col gap-12">
              {results!.content.length > 0 && (
                <section>
                  <SectionHeading>Content</SectionHeading>
                  <ul className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
                    {results!.content.map((item) => (
                      <li key={item.id} data-result-type="content" data-result-position={++resultPosition}>
                        <ContentCard
                          href={`/articles/${item.slug}`}
                          type={item.type}
                          title={item.title}
                          excerpt={item.excerpt}
                          imageUrl={item.heroImage?.url}
                          imageAlt={item.heroImage?.alt}
                          imageFit={mediaFit(classifiable(item.heroImage))}
                        />
                      </li>
                    ))}
                  </ul>
                </section>
              )}

              {results!.products.length > 0 && (
                <section>
                  <SectionHeading>Products</SectionHeading>
                  <ul className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
                    {results!.products.map((p) => (
                      <li key={p.id} data-result-type="product" data-result-position={++resultPosition}>
                        <ProductCard
                          href={`/products/${p.slug}`}
                          name={p.name}
                          summary={p.summary}
                          imageUrl={p.heroImage?.url}
                          imageAlt={p.heroImage?.alt}
                          imageFit={mediaFit(classifiable(p.heroImage))}
                        />
                      </li>
                    ))}
                  </ul>
                </section>
              )}

              {(results!.manufacturers.length > 0 || results!.categories.length > 0) && (
                <section>
                  <SectionHeading>More</SectionHeading>
                  <ul className="flex flex-wrap gap-3">
                    {results!.categories.map((c) => (
                      <li key={c.id} data-result-type="category" data-result-position={++resultPosition}>
                        <Link
                          href={`/${c.slug}`}
                          className="inline-flex min-h-11 items-center rounded-full border border-border-subtle bg-white px-4 text-sm hover:border-accent/40"
                        >
                          {c.name} <span className="text-zinc-400">· category</span>
                        </Link>
                      </li>
                    ))}
                    {results!.manufacturers.map((m) => (
                      <li key={m.id} data-result-type="manufacturer" data-result-position={++resultPosition}>
                        <Link
                          href={`/manufacturers/${m.slug}`}
                          className="inline-flex min-h-11 items-center rounded-full border border-border-subtle bg-white px-4 text-sm hover:border-accent/40"
                        >
                          {m.name} <span className="text-zinc-400">· manufacturer</span>
                        </Link>
                      </li>
                    ))}
                  </ul>
                </section>
              )}
            </div>
          )}
        </SearchTracker>
      )}
    </div>
  );
}
