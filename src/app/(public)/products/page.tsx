import type { Metadata } from "next";
import Link from "next/link";
import { buildMetadata } from "@/lib/seo/metadata";
import { getPublishedProductsPage, getProductFilterOptions } from "@/lib/public/product-list";
import { Breadcrumbs } from "@/components/public/breadcrumbs";
import { ProductCard } from "@/components/public/cards";
import { PublicPagination } from "@/components/public/pagination";
import { FilterSelect } from "@/components/public/filter-select";
import { EmptyState } from "@/components/shared/ui";

export const metadata: Metadata = buildMetadata({
  title: "Products",
  description: "Every product published across Tech Carvalho's subject areas.",
  path: "/products",
});

export default async function ProductsIndexPage({
  searchParams,
}: {
  searchParams: Promise<{ page?: string; manufacturer?: string; category?: string }>;
}) {
  const { page: rawPage, manufacturer, category } = await searchParams;
  const page = Math.max(1, Number(rawPage) || 1);
  const [{ products, total, pageCount }, { manufacturers, categories }] = await Promise.all([
    getPublishedProductsPage(page, { manufacturerSlug: manufacturer, categorySlug: category }),
    getProductFilterOptions(),
  ]);

  const activeFilters = { manufacturer, category };
  const hasFilters = Boolean(manufacturer || category);

  return (
    <div className="mx-auto max-w-6xl px-6 py-12">
      <Breadcrumbs items={[{ name: "Home", path: "/" }, { name: "Products", path: "/products" }]} />
      <h1 className="font-display text-3xl font-bold tracking-tight text-zinc-900 mb-2">Products</h1>
      <p className="text-zinc-500 mb-6">{total > 0 ? `${total} published product${total === 1 ? "" : "s"}` : "Nothing published yet."}</p>

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
          <ul className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
            {products.map((p) => (
              <li key={p.id}>
                <ProductCard
                  href={`/products/${p.slug}`}
                  name={p.name}
                  manufacturerName={p.manufacturerName}
                  summary={p.summary}
                  status={p.status}
                />
              </li>
            ))}
          </ul>
          <PublicPagination page={page} pageCount={pageCount} basePath="/products" searchParams={activeFilters} />
        </>
      )}
    </div>
  );
}
