import type { Metadata } from "next";
import Image from "next/image";
import Link from "next/link";
import { notFound } from "next/navigation";
import { buildMetadata } from "@/lib/seo/metadata";
import { collectionPageJsonLd, itemListJsonLd, safeJsonLdString } from "@/lib/seo/jsonld";
import { getManufacturerDetail } from "@/lib/public/manufacturer-detail";
import { listFamiliesWithPublishedMaterial } from "@/lib/public/family-detail";
import { isManufacturerHubIndexable, hubHasContent } from "@/lib/public/hub-eligibility";
import { Breadcrumbs } from "@/components/public/breadcrumbs";
import { mediaFit } from "@/lib/media/presentation";
import { classifiable } from "@/lib/public/hero-image";
import { ContentCard, ProductCard, SectionHeading } from "@/components/public/cards";
import { EmptyState } from "@/components/shared/ui";
import { OutboundLink } from "@/components/public/outbound-link";
import { destinationDomainOf } from "@/lib/monetisation/affiliate";
import { PageViewTracker } from "@/components/analytics/page-view-tracker";
import { InternalLinkTracker } from "@/components/analytics/internal-link-tracker";

// Describes only what the page actually renders. Never "N products" when the
// catalogue holds more unpublished — the counts are of published rows, which
// is what a visitor and a crawler will both find here.
function describeCoverage(name: string, { productCount, articleCount }: { productCount: number; articleCount: number }): string {
  const parts: string[] = [];
  if (productCount > 0) parts.push(`${productCount} published product${productCount === 1 ? "" : "s"} with specifications`);
  if (articleCount > 0) parts.push(`${articleCount} published article${articleCount === 1 ? "" : "s"}`);
  return `Tech Carvalho's ${name} coverage: ${parts.join(", plus ")}.`;
}

export async function generateMetadata({
  params,
}: {
  params: Promise<{ slug: string }>;
}): Promise<Metadata> {
  const { slug } = await params;
  const detail = await getManufacturerDetail(slug);
  if (!detail) notFound();

  const { manufacturer, products, articles } = detail;
  const material = { productCount: products.length, articleCount: articles.length };

  return buildMetadata({
    // Distinct from a bare brand name, which on its own is a query this site
    // has no business competing for. What the page actually offers is the
    // published coverage of that brand, and the title should say so.
    title: hubHasContent(material) ? `${manufacturer.name} products and coverage` : manufacturer.name,
    description:
      manufacturer.description ??
      (hubHasContent(material)
        ? describeCoverage(manufacturer.name, material)
        : undefined),
    path: `/manufacturers/${slug}`,
    // manufacturers is world-readable reference data with no publish gating,
    // so a row exists — and this route renders — the moment an admin adds a
    // brand, long before any of its products are published. That page is an
    // empty state: a heading, maybe a description, and "No published products
    // yet". Letting it into the index is a thin-content page per brand, so it
    // is noindex until it has something to show. `follow` stays on so the
    // "All manufacturers" link still passes.
    //
    // The gate now counts published ARTICLES as well as published products
    // (see hub-eligibility.ts). The previous products-only rule treated a
    // brand with a real body of coverage and an unpublished catalogue as
    // thin, which it is not: against production that mislabelled NVIDIA (6
    // published articles, 0 published products) and AMD (5 and 0) as empty
    // shells. The threshold lives in one place so sitemap.ts cannot disagree
    // with the page.
    noindex: !isManufacturerHubIndexable(material),
    follow: true,
    // Deliberately no page-specific OG image. The only image this page owns is
    // the brand logo, which is a transparent, wide, non-16:9 asset — pushed
    // into a summary_large_image card it renders as a letterboxed smear. The
    // site-wide opengraph-image.tsx fallback is the better card here, and
    // "use the default" is a real choice, not a missing one.
  });
}

export default async function ManufacturerPage({
  params,
}: {
  params: Promise<{ slug: string }>;
}) {
  const { slug } = await params;
  const [detail, familiesWithMaterial] = await Promise.all([
    getManufacturerDetail(slug),
    listFamiliesWithPublishedMaterial(),
  ]);
  if (!detail) notFound();

  const { manufacturer, logo, products, families, articles } = detail;
  const material = { productCount: products.length, articleCount: articles.length };

  // Only families that genuinely have something public to show get a link.
  // Linking a family whose members are all unpublished would hand a visitor
  // (and a crawler) a page that renders nothing but an empty state.
  const linkableFamilySlugs = new Set(familiesWithMaterial.map((f) => f.slug));

  return (
    <div className="mx-auto max-w-6xl px-6 py-12">
      <PageViewTracker entityType="manufacturer" entityId={manufacturer.id} />
      {/* The brand hub is a collection page: it exists to gather this brand's
          products and coverage. Emitted only when there is a real collection,
          and every entry is a link the page actually renders. */}
      {hubHasContent(material) && (
        <script
          type="application/ld+json"
          dangerouslySetInnerHTML={{
            __html: safeJsonLdString(
              collectionPageJsonLd({
                name: `${manufacturer.name} products and coverage`,
                description: manufacturer.description,
                path: `/manufacturers/${slug}`,
                items: [
                  ...products.map((p) => ({ name: p.name, path: `/products/${p.slug}` })),
                  ...articles.map((a) => ({ name: a.title, path: `/articles/${a.slug}` })),
                ],
                listName: `${manufacturer.name} coverage`,
              })
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
                { name: `${manufacturer.name} products` }
              )
            ),
          }}
        />
      )}
      <Breadcrumbs
        items={[
          { name: "Home", path: "/" },
          { name: "Manufacturers", path: "/manufacturers" },
          { name: manufacturer.name, path: `/manufacturers/${slug}` },
        ]}
      />

      {logo && (
        <div className="relative h-16 w-40 mb-4">
          {/* `sizes` was missing entirely, so this 160x64 slot inherited the
              100vw default and downloaded a viewport-wide rendition of the
              logo. Already correctly `object-contain` — a logo trimmed to fill
              a box is a broken logo. */}
          <Image
            src={logo.url}
            alt={logo.alt ?? `${manufacturer.name} logo`}
            fill
            sizes="160px"
            className="object-contain object-left"
          />
        </div>
      )}

      <h1 className="font-display text-3xl sm:text-4xl font-bold tracking-tight text-zinc-900 mb-3">
        {manufacturer.name}
      </h1>
      {manufacturer.description && <p className="text-lg text-zinc-600 max-w-2xl mb-2">{manufacturer.description}</p>}
      {manufacturer.website && (
        <OutboundLink
          href={manufacturer.website}
          destinationDomain={destinationDomainOf(manufacturer.website)}
          linkPosition="manufacturer_page"
          kind="outbound"
          className="text-sm text-accent hover:underline"
        >
          {manufacturer.website.replace(/^https?:\/\//, "")}
        </OutboundLink>
      )}

      {/* Families were previously rendered as inert <span> chips — the family
          name was visible on this page and on every product page, and was a
          link from neither. Each one that has published material now points at
          its hub; the rest stay as plain chips rather than becoming links to
          an empty page. */}
      {families.length > 0 && (
        <div className="mt-8">
          <p className="text-xs font-semibold uppercase tracking-wider text-zinc-400 mb-2">Product lines</p>
          <div className="flex flex-wrap gap-2">
            {families.map((f) =>
              linkableFamilySlugs.has(f.slug) ? (
                <Link
                  key={f.id}
                  href={`/families/${f.slug}`}
                  className="inline-flex min-h-11 items-center rounded-full border border-border-subtle bg-white px-3 text-sm font-medium text-zinc-700 hover:border-accent/40 hover:text-accent"
                >
                  {f.name}
                </Link>
              ) : (
                <span key={f.id} className="inline-flex min-h-11 items-center rounded-full border border-border-subtle bg-white px-3 text-sm text-zinc-600">
                  {f.name}
                </span>
              )
            )}
          </div>
        </div>
      )}

      <div className="mt-10">
        <SectionHeading>Products</SectionHeading>
        {products.length === 0 ? (
          <EmptyState
            title="No published products yet"
            description={
              articles.length > 0
                ? `${manufacturer.name} products will appear here once they're published. The coverage below is live now.`
                : `Products from ${manufacturer.name} will appear here once they're published.`
            }
          />
        ) : (
          <InternalLinkTracker linkPosition="manufacturer_page">
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
        )}
      </div>

      {/* The half of a brand hub that was missing. Sourced from the brand tag,
          not from content_products — see getBrandArticles() for why that is
          the only source visible to an anonymous visitor today. */}
      {articles.length > 0 && (
        <div className="mt-14">
          <SectionHeading note={`Published ${manufacturer.name} coverage, newest first.`}>
            {manufacturer.name} coverage
          </SectionHeading>
          <InternalLinkTracker linkPosition="manufacturer_page">
            <ul className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
              {articles.map((a) => (
                <li key={a.id} data-entity-type="content" data-entity-id={a.id}>
                  <ContentCard
                    href={`/articles/${a.slug}`}
                    type={a.type}
                    title={a.title}
                    publishedAt={a.published_at}
                    excerpt={a.excerpt}
                    imageUrl={a.heroImage?.url}
                    imageAlt={a.heroImage?.alt}
                    imageFit={mediaFit(classifiable(a.heroImage))}
                  />
                </li>
              ))}
            </ul>
          </InternalLinkTracker>
        </div>
      )}

      <div className="mt-12">
        <Link href="/manufacturers" className="text-sm text-accent hover:underline">
          ← All manufacturers
        </Link>
      </div>
    </div>
  );
}
