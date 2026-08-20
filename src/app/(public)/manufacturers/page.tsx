import type { Metadata } from "next";
import Link from "next/link";
import { buildMetadata } from "@/lib/seo/metadata";
import { getManufacturerList } from "@/lib/public/manufacturer-list";
import { Breadcrumbs } from "@/components/public/breadcrumbs";
import { Badge, EmptyState } from "@/components/shared/ui";

export const metadata: Metadata = buildMetadata({
  title: "Manufacturers",
  description: "Brands covered by Tech Carvalho.",
  path: "/manufacturers",
});

export default async function ManufacturersIndexPage() {
  const manufacturers = await getManufacturerList();

  return (
    <div className="mx-auto max-w-6xl px-6 py-12">
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
