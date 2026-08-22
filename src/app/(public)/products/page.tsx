import type { Metadata } from "next";
import Link from "next/link";
import { buildMetadata, canonicalPathWithParams } from "@/lib/seo/metadata";
import { itemListJsonLd, safeJsonLdString } from "@/lib/seo/jsonld";
import { getPublishedProductsPage, getProductFilterOptions } from "@/lib/public/product-list";
import { Breadcrumbs } from "@/components/public/breadcrumbs";
import { mediaFit } from "@/lib/media/presentation";
import { classifiable } from "@/lib/public/hero-image";
import { ProductCard } from "@/components/public/cards";
import { PublicPagination } from "@/components/public/pagination";
import { FilterSelect } from "@/components/public/filter-select";
import { EmptyState } from "@/components/shared/ui";
import { PageViewTracker } from "@/components/analytics/page-view-tracker";
import { InternalLinkTracker } from "@/components/analytics/internal-link-tracker";

type ProductsSearchParams = { page?: string; manufacturer?: string; category?: string };

export async function generateMetadata({
  searchParams,
}: {
  searchParams: Promise<ProductsSearchParams>;
}): Promise<Metadata> {
  const { page: rawPage, manufacturer, category } = await searchParams;
  const page = Math.max(1, Number(rawPage) || 1);
  const filtered = Boolean(manufacturer || category);

  return buildMetadata({
    title: page > 1 ? `Products — page ${page}` : "Products",
    description: "Every product published across Tech Carvalho's subject areas.",
    // Self-referencing and normalized: junk/tracking params are dropped so a
    // shared /products?utm_source=… link cannot spawn a crawlable duplicate.
    path: canonicalPathWithParams("/products", { manufacturer, category, page }, [
      "manufacturer",
      "category",
      "page",
    ]),
    // CANNIBALISATION FIX. /products?manufacturer=canon lists exactly the
    // published Canon products that /manufacturers/canon already lists, and
    // /products?category=computing lists exactly what /computing already
    // lists — two dedicated, richer routes that are the intended home for
    // those two intents. Leaving the facets indexable meant three URLs
    // competing for one query with the thinnest of the three (no brand
    // description, no product families, no editorial rails) fully eligible
    // to win.
    //
    // `noindex` with `follow: true`, not nofollow: these views are a real
    // browsing affordance and their product links are worth crawling. The
    // canonical stays self-referencing rather than cross-pointing at the
    // dedicated hub, because the filtered list is a subset view rather than
    // a true duplicate of that hub's page, and a cross-canonical Google
    // rejects would leave the page with no canonical signal at all.
    noindex: filtered,
    follow: true,
  });
}

export default async function ProductsIndexPage({
  searchParams,
}: {
  searchParams: Promise<ProductsSearchParams>;
}) {
  const { page: rawPage, manufacturer, category } = await searchParams;
  const page = Math.max(1, Number(rawPage) || 1);
  const [{ products, total, pageCount }, { manufacturers, categories }] = await Promise.all([
    getPublishedProductsPage(page, { manufacturerSlug: manufacturer, categorySlug: category }),
    getProductFilterOptions(),
  ]);

  const activeFilters = { manufacturer, category };
  const hasFilters = Boolean(manufacturer || category);

  // Resolved against the real filter options so the "go to the full hub"
  // links below are only offered for a slug that actually exists — a junk
  // ?manufacturer=nonsense gets no link rather than a link to a 404.
  const activeCategory = category ? categories.find((c) => c.slug === category) : undefined;
  const activeManufacturer = manufacturer ? manufacturers.find((m) => m.slug === manufacturer) : undefined;
  const categorySlugToPath = activeCategory ? `/${activeCategory.slug}` : null;
  const categoryLabel = activeCategory?.name ?? "";
  const manufacturerPath = activeManufacturer ? `/manufacturers/${activeManufacturer.slug}` : null;
  const manufacturerLabel = activeManufacturer?.name ?? "";

  return (
    <div className="mx-auto max-w-6xl px-6 py-12">
      <PageViewTracker />
      {/* Only emitted on the canonical, indexable view. An ItemList on a
          noindex facet is markup for a page that is not in the index. */}
      {products.length > 0 && !hasFilters && (
        <script
          type="application/ld+json"
          dangerouslySetInnerHTML={{
            __html: safeJsonLdString(
              itemListJsonLd(
                products.map((p) => ({ name: p.name, path: `/products/${p.slug}` })),
                { name: "Products" }
              )
            ),
          }}
        />
      )}
      <Breadcrumbs items={[{ name: "Home", path: "/" }, { name: "Products", path: "/products" }]} />
      <h1 className="font-display text-3xl font-bold tracking-tight text-zinc-900 mb-2">Products</h1>
      <p className="text-zinc-500 mb-6">
        {total > 0
          ? `${total} published product${total === 1 ? "" : "s"}${pageCount > 1 ? ` · page ${page} of ${pageCount}` : ""}`
          : "Nothing published yet."}
      </p>

      {/* The filtered view is deliberately noindex (see generateMetadata), so
          it must hand both crawlers and visitors a real route to the indexable
          hub that owns this intent, rather than being a dead end. */}
      {hasFilters && (
        <p className="text-sm text-zinc-500 mb-6">
          {categorySlugToPath && (
            <>
              Browsing a subject area?{" "}
              <Link href={categorySlugToPath} className="text-accent hover:underline">
                Go to the full {categoryLabel} hub
              </Link>
              {manufacturerPath ? " · " : "."}
            </>
          )}
          {manufacturerPath && (
            <>
              <Link href={manufacturerPath} className="text-accent hover:underline">
                See everything from {manufacturerLabel}
              </Link>
              .
            </>
          )}
        </p>
      )}

      {(manufacturers.length > 0 || categories.length > 0) && (
        <div className="flex flex-col sm:flex-row sm:items-center gap-3 mb-10">
          {manufacturers.length > 0 && (
            <FilterSelect
              label="Manufacturer"
              paramName="manufacturer"
              value={manufacturer}
              options={manufacturers.map((m) => ({ value: m.slug, label: m.name }))}
              otherParams={{ category }}
              action="/products"
            />
          )}
          {categories.length > 0 && (
            <FilterSelect
              label="Category"
              paramName="category"
              value={category}
              options={categories.map((c) => ({ value: c.slug, label: c.name }))}
              otherParams={{ manufacturer }}
              action="/products"
            />
          )}
          {hasFilters && (
            <Link href="/products" className="text-sm text-accent hover:underline">
              Clear filters
            </Link>
          )}
        </div>
      )}

      {products.length === 0 ? (
        <EmptyState
          title={hasFilters ? "No products match these filters" : "No products published yet"}
          description={
            hasFilters
              ? undefined
              : "Products will appear here as they're reviewed and published — nothing is shown until it's real."
          }
        />
      ) : (
        <>
          <InternalLinkTracker linkPosition="category_page">
            <ul className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
              {products.map((p) => (
                <li key={p.id} data-entity-type="product" data-entity-id={p.id}>
                  <ProductCard
                    href={`/products/${p.slug}`}
                    name={p.name}
                    manufacturerName={p.manufacturerName}
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
          <PublicPagination page={page} pageCount={pageCount} basePath="/products" searchParams={activeFilters} />
        </>
      )}
    </div>
  );
}
