import type { Metadata } from "next";
import Image from "next/image";
import Link from "next/link";
import { notFound } from "next/navigation";
import { buildMetadata } from "@/lib/seo/metadata";
import { productJsonLd, safeJsonLdString } from "@/lib/seo/jsonld";
import { getProductDetail } from "@/lib/public/product-detail";
import { getPublishedGallery } from "@/lib/public/hero-image";
import { Breadcrumbs } from "@/components/public/breadcrumbs";
import { ContentCard } from "@/components/public/cards";
import { RelatedContentTracker } from "@/components/public/related-content-tracker";
import { OutboundLink } from "@/components/public/outbound-link";
import { LaunchPricingDisplay } from "@/components/public/launch-pricing";
import { outboundLinkKindFor, destinationDomainOf } from "@/lib/monetisation/affiliate";
import { Badge, EmptyState } from "@/components/shared/ui";
import { PageViewTracker } from "@/components/analytics/page-view-tracker";
import { ScrollDepthTracker } from "@/components/analytics/scroll-depth-tracker";
import { TrackedLink } from "@/components/analytics/tracked-link";

export async function generateMetadata({
  params,
}: {
  params: Promise<{ slug: string }>;
}): Promise<Metadata> {
  const { slug } = await params;
  const detail = await getProductDetail(slug);
  if (!detail) notFound();

  return buildMetadata({
    title: detail.product.name,
    description: detail.product.summary ?? undefined,
    path: `/products/${slug}`,
    image: detail.heroImage,
  });
}

export default async function ProductPage({
  params,
}: {
  params: Promise<{ slug: string }>;
}) {
  const { slug } = await params;
  const detail = await getProductDetail(slug);
  if (!detail) notFound();

  const { product, manufacturer, family, category, specs, tags, related, articles, heroImage, offers, launchPricing, freshness, sourceCount, evidenceCount } =
    detail;
  const lastVerified = freshness[0]?.reviewed_at ?? null;
  const gallery = await getPublishedGallery("product", product.id);

  const jsonLd = productJsonLd({
    name: product.name,
    slug: product.slug,
    summary: product.summary,
    manufacturerName: manufacturer?.name,
  });

  return (
    <div className="mx-auto max-w-6xl px-6 py-12">
      <PageViewTracker entityType="product" entityId={product.id} categorySlug={category?.slug} />
      <ScrollDepthTracker />
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{ __html: safeJsonLdString(jsonLd) }}
      />
      <Breadcrumbs
        items={[
          { name: "Home", path: "/" },
          ...(category ? [{ name: category.name, path: `/${category.slug}` }] : []),
          { name: product.name, path: `/products/${product.slug}` },
        ]}
      />

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-10">
        <div className="lg:col-span-2">
          {heroImage && (
            <div className="relative w-full aspect-video rounded-xl overflow-hidden bg-zinc-100 mb-3">
              <Image src={heroImage.url} alt={heroImage.alt ?? product.name} fill priority className="object-cover" />
            </div>
          )}

          {gallery.length > 0 && (
            <div className="mb-6">
              <div className="flex gap-3 overflow-x-auto pb-2 snap-x snap-mandatory">
                {gallery.map((img, i) => (
                  <div
                    key={i}
                    className="relative shrink-0 w-32 sm:w-40 aspect-[4/3] rounded-lg overflow-hidden bg-zinc-100 snap-start"
                  >
                    <Image src={img.url} alt={img.alt ?? product.name} fill sizes="160px" className="object-cover" loading="lazy" />
                  </div>
                ))}
              </div>
              {gallery.some((img) => img.attributionRequired && (img.attribution || img.creator)) && (
                <p className="mt-1 text-xs text-zinc-400">
                  Images:{" "}
                  {gallery
                    .filter((img) => img.attributionRequired && (img.attribution || img.creator))
                    .map((img) => img.attribution ?? img.creator)
                    .join(", ")}
                </p>
              )}
            </div>
          )}

          <div className="flex items-center gap-2 mb-3">
            {manufacturer && (
              <TrackedLink
                href={`/manufacturers/${manufacturer.slug}`}
                linkPosition="product_page"
                className="text-sm font-medium text-zinc-500 hover:text-accent"
              >
                {manufacturer.name}
              </TrackedLink>
            )}
            {product.status !== "active" && <Badge tone={product.status === "rumored" ? "amber" : "neutral"}>{product.status}</Badge>}
          </div>
          <h1 className="font-display text-3xl sm:text-4xl font-bold tracking-tight text-zinc-900 mb-4">
            {product.name}
          </h1>
          {product.summary && <p className="text-lg text-zinc-600 mb-3">{product.summary}</p>}
          <LaunchPricingDisplay pricing={launchPricing} />
          <div className="mb-3" />
          {lastVerified && (
            <p className="text-xs text-zinc-400 mb-3">
              Last verified{" "}
              {new Date(lastVerified).toLocaleDateString(undefined, { year: "numeric", month: "long", day: "numeric" })}
            </p>
          )}
          <div className="mb-5" />

          {specs.length > 0 && (
            <section className="mb-10">
              <h2 className="font-display text-sm font-semibold uppercase tracking-wider text-zinc-500 mb-4">
                Specifications
              </h2>
              <dl className="grid grid-cols-1 sm:grid-cols-2 gap-x-8 gap-y-3 rounded-xl border border-border-subtle bg-white p-5">
                {specs.map((s) => (
                  <div key={s.name} className="flex justify-between border-b border-zinc-100 pb-2 text-sm">
                    <dt className="text-zinc-500">{s.name}</dt>
                    <dd className="font-medium text-zinc-900">
                      {typeof s.value === "boolean" ? (s.value ? "Yes" : "No") : String(s.value)}
                      {s.unit ? ` ${s.unit}` : ""}
                    </dd>
                  </div>
                ))}
              </dl>
            </section>
          )}

          {offers.length > 0 && (
            <section className="mb-10">
              <h2 className="font-display text-sm font-semibold uppercase tracking-wider text-zinc-500 mb-4">
                Where to buy
              </h2>
              <ul className="flex flex-col gap-2 rounded-xl border border-border-subtle bg-white p-5">
                {offers.map((offer) => {
                  const kind = outboundLinkKindFor(offer.affiliate_status);
                  const linkProps =
                    kind === "affiliate"
                      ? ({ kind: "affiliate" as const, retailer: offer.retailer })
                      : ({ kind: "outbound" as const });
                  return (
                    <li key={offer.id} className="flex items-center justify-between gap-4 text-sm">
                      <OutboundLink
                        href={offer.url}
                        destinationDomain={destinationDomainOf(offer.url)}
                        linkPosition="product_page"
                        productId={product.id}
                        {...linkProps}
                        className="font-medium text-zinc-900 hover:text-accent"
                      >
                        {offer.retailer}
                      </OutboundLink>
                      {offer.price_note && <span className="text-zinc-500">{offer.price_note}</span>}
                    </li>
                  );
                })}
              </ul>
            </section>
          )}

          {articles.length > 0 && (
            <section className="mb-10">
              <h2 className="font-display text-sm font-semibold uppercase tracking-wider text-zinc-500 mb-4">
                Related articles
              </h2>
              <RelatedContentTracker>
                <ul className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                  {articles.map((a) => (
                    <li key={a.id}>
                      <ContentCard
                        href={`/articles/${a.slug}`}
                        type={a.type}
                        title={a.title}
                        imageUrl={a.heroImage?.url}
                        imageAlt={a.heroImage?.alt}
                      />
                    </li>
                  ))}
                </ul>
              </RelatedContentTracker>
            </section>
          )}

          {(sourceCount > 0 || evidenceCount > 0) && (
            <div className="rounded-xl border border-border-subtle bg-zinc-50 p-4 text-xs text-zinc-500">
              {[
                sourceCount > 0 ? `${sourceCount} source${sourceCount === 1 ? "" : "s"} cited` : null,
                evidenceCount > 0 ? `${evidenceCount} evidence record${evidenceCount === 1 ? "" : "s"}` : null,
              ]
                .filter(Boolean)
                .join(" · ")}{" "}
              — see our{" "}
              <Link href="/editorial-policy" className="underline hover:text-accent">
                editorial policy
              </Link>{" "}
              for how we verify facts.
            </div>
          )}
        </div>

        <aside className="flex flex-col gap-6">
          <div className="rounded-xl border border-border-subtle bg-white p-5">
            <h2 className="font-display text-sm font-semibold uppercase tracking-wider text-zinc-500 mb-3">
              Details
            </h2>
            <dl className="flex flex-col gap-2 text-sm">
              {manufacturer && (
                <div className="flex justify-between">
                  <dt className="text-zinc-500">Manufacturer</dt>
                  <dd className="font-medium text-zinc-900">
                    <Link href={`/manufacturers/${manufacturer.slug}`} className="hover:text-accent">
                      {manufacturer.name}
                    </Link>
                  </dd>
                </div>
              )}
              {family && (
                <div className="flex justify-between">
                  <dt className="text-zinc-500">Family</dt>
                  <dd className="font-medium text-zinc-900">{family.name}</dd>
                </div>
              )}
              {product.model_number && (
                <div className="flex justify-between">
                  <dt className="text-zinc-500">Model</dt>
                  <dd className="font-medium text-zinc-900">{product.model_number}</dd>
                </div>
              )}
              {product.release_date && (
                <div className="flex justify-between">
                  <dt className="text-zinc-500">Released</dt>
                  <dd className="font-medium text-zinc-900">
                    {new Date(product.release_date).toLocaleDateString(undefined, { year: "numeric", month: "long" })}
                  </dd>
                </div>
              )}
              <div className="flex justify-between">
                <dt className="text-zinc-500">Status</dt>
                <dd className="font-medium text-zinc-900 capitalize">{product.status}</dd>
              </div>
            </dl>
          </div>

          {tags.length > 0 && (
            <div className="rounded-xl border border-border-subtle bg-white p-5">
              <h2 className="font-display text-sm font-semibold uppercase tracking-wider text-zinc-500 mb-3">Tags</h2>
              <div className="flex flex-wrap gap-2">
                {tags.map((t) => (
                  <Badge key={t.slug}>{t.name}</Badge>
                ))}
              </div>
            </div>
          )}

          {related.length > 0 && (
            <div className="rounded-xl border border-border-subtle bg-white p-5">
              <h2 className="font-display text-sm font-semibold uppercase tracking-wider text-zinc-500 mb-3">
                Related products
              </h2>
              <ul className="flex flex-col gap-3">
                {related.map((r) => (
                  <li key={`${r.label}-${r.product.id}`}>
                    <p className="text-xs text-zinc-400 mb-0.5">{r.label}</p>
                    <Link href={`/products/${r.product.slug}`} className="text-sm font-medium text-zinc-900 hover:text-accent">
                      {r.product.name}
                    </Link>
                  </li>
                ))}
              </ul>
            </div>
          )}
        </aside>
      </div>

      {specs.length === 0 && articles.length === 0 && related.length === 0 && offers.length === 0 && (
        <div className="mt-10">
          <EmptyState
            title="More coming soon"
            description="Specifications, related articles, and comparisons for this product will appear here as they're added."
          />
        </div>
      )}
    </div>
  );
}
