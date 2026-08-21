import type { Metadata } from "next";
import Image from "next/image";
import Link from "next/link";
import { notFound } from "next/navigation";
import { buildMetadata } from "@/lib/seo/metadata";
import { getManufacturerDetail } from "@/lib/public/manufacturer-detail";
import { Breadcrumbs } from "@/components/public/breadcrumbs";
import { ProductCard, SectionHeading } from "@/components/public/cards";
import { EmptyState } from "@/components/shared/ui";
import { OutboundLink } from "@/components/public/outbound-link";
import { destinationDomainOf } from "@/lib/monetisation/affiliate";

export async function generateMetadata({
  params,
}: {
  params: Promise<{ slug: string }>;
}): Promise<Metadata> {
  const { slug } = await params;
  const detail = await getManufacturerDetail(slug);
  if (!detail) notFound();

  return buildMetadata({
    title: detail.manufacturer.name,
    description: detail.manufacturer.description ?? undefined,
    path: `/manufacturers/${slug}`,
  });
}

export default async function ManufacturerPage({
  params,
}: {
  params: Promise<{ slug: string }>;
}) {
  const { slug } = await params;
  const detail = await getManufacturerDetail(slug);
  if (!detail) notFound();

  const { manufacturer, logo, products, families } = detail;

  return (
    <div className="mx-auto max-w-6xl px-6 py-12">
      <Breadcrumbs
        items={[
          { name: "Home", path: "/" },
          { name: "Manufacturers", path: "/manufacturers" },
          { name: manufacturer.name, path: `/manufacturers/${slug}` },
        ]}
      />

      {logo && (
        <div className="relative h-16 w-40 mb-4">
          <Image src={logo.url} alt={logo.alt ?? `${manufacturer.name} logo`} fill className="object-contain object-left" />
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

      {families.length > 0 && (
        <div className="mt-8">
          <p className="text-xs font-semibold uppercase tracking-wider text-zinc-400 mb-2">Product families</p>
          <div className="flex flex-wrap gap-2">
            {families.map((f) => (
              <span key={f.id} className="rounded-full border border-border-subtle bg-white px-3 py-1 text-sm text-zinc-600">
                {f.name}
              </span>
            ))}
          </div>
        </div>
      )}

      <div className="mt-10">
        <SectionHeading>Products</SectionHeading>
        {products.length === 0 ? (
          <EmptyState
            title="No published products yet"
            description={`Products from ${manufacturer.name} will appear here once they're published.`}
          />
        ) : (
          <ul className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
            {products.map((p) => (
              <li key={p.id}>
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
        )}
      </div>

      <div className="mt-12">
        <Link href="/manufacturers" className="text-sm text-accent hover:underline">
          ← All manufacturers
        </Link>
      </div>
    </div>
  );
}
