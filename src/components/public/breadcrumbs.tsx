import Link from "next/link";
import { breadcrumbJsonLd } from "@/lib/seo/jsonld";

export type BreadcrumbItem = { name: string; path: string };

export function Breadcrumbs({ items }: { items: BreadcrumbItem[] }) {
  if (items.length === 0) return null;

  return (
    <nav aria-label="Breadcrumb" className="text-sm text-zinc-500 mb-6">
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{ __html: JSON.stringify(breadcrumbJsonLd(items)) }}
      />
      <ol className="flex flex-wrap items-center gap-1.5">
        {items.map((item, index) => (
          <li key={item.path} className="flex items-center gap-1.5">
            {index > 0 && (
              <span aria-hidden="true" className="text-zinc-300">
                /
              </span>
            )}
            {index === items.length - 1 ? (
              <span className="text-zinc-800" aria-current="page">
                {item.name}
              </span>
            ) : (
              <Link href={item.path} className="hover:text-accent">
                {item.name}
              </Link>
            )}
          </li>
        ))}
      </ol>
    </nav>
  );
}
