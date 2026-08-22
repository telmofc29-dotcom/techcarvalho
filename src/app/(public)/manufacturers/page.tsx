import type { Metadata } from "next";
import Link from "next/link";
import { buildMetadata } from "@/lib/seo/metadata";
import { itemListJsonLd, safeJsonLdString } from "@/lib/seo/jsonld";
import { getManufacturerList } from "@/lib/public/manufacturer-list";
import { Breadcrumbs } from "@/components/public/breadcrumbs";
import { Badge, EmptyState } from "@/components/shared/ui";

export const metadata: Metadata = buildMetadata({
  title: "Manufacturers",
  description:
    "Every brand covered by Tech Carvalho, with the published products and specifications recorded for each.",
  path: "/manufacturers",
});

export default async function ManufacturersIndexPage() {
  const manufacturers = await getManufacturerList();
  // Only brands with published products. A brand row with nothing behind it
  // renders a noindex page (see manufacturers/[slug]/page.tsx), and listing a
  // noindex URL in this page's ItemList would point crawlers straight at it.
  const listed = manufacturers.filter((m) => m.productCount > 0);

  return (
    <div className="mx-auto max-w-6xl px-6 py-12">
      {listed.length > 0 && (
        <script
          type="application/ld+json"
          dangerouslySetInnerHTML={{
            __html: safeJsonLdString(
              itemListJsonLd(
                listed.map((m) => ({ name: m.name, path: `/manufacturers/${m.slug}` })),
                { name: "Manufacturers" }
              )
            ),
          }}
        />
      )}
      <Breadcrumbs items={[{ name: "Home", path: "/" }, { name: "Manufacturers", path: "/manufacturers" }]} />
      <h1 className="font-display text-3xl font-bold tracking-tight text-zinc-900 mb-2">Manufacturers</h1>
      <p className="text-zinc-500 mb-10">
        {manufacturers.length > 0 ? `${manufacturers.length} manufacturer${manufacturers.length === 1 ? "" : "s"}` : "None yet."}
      </p>

      {manufacturers.length === 0 ? (
        <EmptyState title="No manufacturers yet" description="Manufacturers will appear here as they're added to the catalog." />
      ) : (
        <ul className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
          {manufacturers.map((m) => (
            <li key={m.id}>
              <Link
                href={`/manufacturers/${m.slug}`}
                className="group flex flex-col gap-2 rounded-xl border border-border-subtle bg-white p-5 transition-colors hover:border-accent/40"
              >
                <div className="flex items-center justify-between gap-2">
                  <h2 className="font-display text-lg font-semibold text-zinc-900 group-hover:text-accent">{m.name}</h2>
                  <Badge tone={m.productCount > 0 ? "green" : "neutral"}>
                    {m.productCount} product{m.productCount === 1 ? "" : "s"}
                  </Badge>
                </div>
                {m.description && <p className="text-sm text-zinc-600 line-clamp-2">{m.description}</p>}
              </Link>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
