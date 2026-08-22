import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { buildMetadata } from "@/lib/seo/metadata";
import { collectionPageJsonLd, safeJsonLdString } from "@/lib/seo/jsonld";
import { getFamilyDetail } from "@/lib/public/family-detail";
import { isFamilyHubIndexable, hubHasContent } from "@/lib/public/hub-eligibility";
import { Breadcrumbs } from "@/components/public/breadcrumbs";
import { mediaFit } from "@/lib/media/presentation";
import { classifiable } from "@/lib/public/hero-image";
import { ContentCard, ProductCard, SectionHeading } from "@/components/public/cards";
import { EmptyState } from "@/components/shared/ui";
import { PageViewTracker } from "@/components/analytics/page-view-tracker";
import { InternalLinkTracker } from "@/components/analytics/internal-link-tracker";

// A product line's hub. See src/lib/public/family-detail.ts for why this is
// safe to render while most of the catalogue is unpublished: every list here
// is queried published-only, so an unpublished body is never linked and the
// page never states how many members are being withheld.

function describeFamily(detail: NonNullable<Awaited<ReturnType<typeof getFamilyDetail>>>): string | undefined {
  const { family } = detail;
  if (family.description) return family.description;
  const parts: string[] = [];
  if (detail.products.length > 0) {
    parts.push(`${detail.products.length} published ${detail.products.length === 1 ? "body" : "bodies"}`);
  }
  if (detail.articles.length > 0) {
    parts.push(`${detail.articles.length} ${detail.articles.length === 1 ? "article" : "articles"}`);
  }
  if (parts.length === 0) return undefined;
  return `Tech Carvalho's coverage of the ${family.name} line — ${parts.join(" and ")}, with specifications and comparisons.`;
}

export async function generateMetadata({ params }: { params: Promise<{ slug: string }> }): Promise<Metadata> {
  const { slug } = await params;
  const detail = await getFamilyDetail(slug);
  if (!detail) notFound();

  const material = { productCount: detail.products.length, articleCount: detail.articles.length };

  return buildMetadata({
    // "Canon EOS 5D" alone is a query this site has no business competing for
    // against Canon itself. What the page offers is the comparison across the
    // line, and the title says that.
    title: hubHasContent(material) ? `${detail.family.name} series compared` : detail.family.name,
    description: describeFamily(detail),
    path: `/families/${slug}`,
    // product_families is world-readable with no publish gating, so this route
    // renders the moment an admin creates a family row — long before anything
    // under it is published. Seven family rows exist and four of them currently
    // have nothing public at all; letting those into the index would recreate
    // the thin-brand-page cluster documented in §4. They stay crawlable
    // (`follow`) so internal links still pass, and each flips to indexable on
    // its own as products publish.
    noindex: !isFamilyHubIndexable(material),
    follow: true,
  });
}

export default async function FamilyPage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const detail = await getFamilyDetail(slug);
  if (!detail) notFound();

  const { family, category, manufacturers, products, articles } = detail;
  const material = { productCount: products.length, articleCount: articles.length };

  const collectionItems = [
    ...products.map((p) => ({ name: p.name, path: `/products/${p.slug}` })),
    ...articles.map((a) => ({ name: a.title, path: `/articles/${a.slug}` })),
  ];

  return (
    <div className="mx-auto max-w-6xl px-6 py-12">
      {/* No `entityType`: analytics_events.entity_type is a CHECK-constrained
          closed vocabulary ('product' | 'content' | 'manufacturer' |
          'category', 20260821_first_party_analytics.sql:133) with no
          'product_family' member, and adding one is a production migration
          this pass has no mandate to run. The page_view still records the
          path and the category, which is what the content-interest dashboard
          reads. */}
      <PageViewTracker categorySlug={category?.slug} />

      {/* CollectionPage + ItemList, but only once there is a real collection.
          Every entry is a page this hub actually links to, in render order. */}
      {collectionItems.length > 0 && (
        <script
          type="application/ld+json"
          dangerouslySetInnerHTML={{
            __html: safeJsonLdString(
              collectionPageJsonLd({
                name: `${family.name} series`,
                description: family.description,
                path: `/families/${slug}`,
                items: collectionItems,
                listName: `${family.name} coverage`,
              })
            ),
          }}
        />
      )}

      <Breadcrumbs
        items={[
          { name: "Home", path: "/" },
          // The category hub is the family's real semantic parent when it has
          // one; /products is the honest fallback rather than a two-item trail
          // that implies the family sits directly under the root.
          ...(category ? [{ name: category.name, path: `/${category.slug}` }] : [{ name: "Products", path: "/products" }]),
          { name: family.name, path: `/families/${slug}` },
        ]}
      />

      <p className="text-xs font-semibold uppercase tracking-wider text-accent">Product line</p>
      <h1 className="mt-1 font-display text-3xl font-bold tracking-tight text-zinc-900 sm:text-4xl">{family.name}</h1>
      {family.description && <p className="mt-3 max-w-2xl text-lg text-zinc-600">{family.description}</p>}

      {manufacturers.length > 0 && (
        <p className="mt-4 text-sm text-zinc-500">
          Made by{" "}
          {manufacturers.map((m, i) => (
            <span key={m.id}>
              {i > 0 && ", "}
              <Link href={`/manufacturers/${m.slug}`} className="text-accent hover:underline">
                {m.name}
              </Link>
            </span>
          ))}
        </p>
      )}

      {!hubHasContent(material) ? (
        <div className="mt-10">
          <EmptyState
            title="Nothing published in this line yet"
            description={`Bodies in the ${family.name} line will appear here once they're published, along with the guides and comparisons that cover them.`}
          />
        </div>
      ) : (
        <div className="mt-12 flex flex-col gap-14">
          {products.length > 0 && (
            <section>
              <SectionHeading note="In release order, oldest first — the order that makes generational differences readable.">
                In this line
              </SectionHeading>
              <InternalLinkTracker linkPosition="family_page" categorySlug={category?.slug}>
                <ul className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
                  {products.map((p) => (
                    <li key={p.id} data-entity-type="product" data-entity-id={p.id}>
                      <ProductCard
                        href={`/products/${p.slug}`}
                        name={p.name}
                        summary={p.summary}
                        status={p.status}
                        // A real release date off the product row — never a
                        // price, never a rating.
                        meta={
                          p.release_date
                            ? `Released ${new Date(p.release_date).toLocaleDateString(undefined, {
                                year: "numeric",
                                month: "long",
                              })}`
                            : null
                        }
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

          {articles.length > 0 && (
            <section>
              <SectionHeading>Coverage of this line</SectionHeading>
              <InternalLinkTracker linkPosition="family_page" categorySlug={category?.slug}>
                <ul className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
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
            </section>
          )}
        </div>
      )}

      {category && (
        <div className="mt-12">
          <Link href={`/${category.slug}`} className="text-sm text-accent hover:underline">
            ← All {category.name}
          </Link>
        </div>
      )}
    </div>
  );
}
