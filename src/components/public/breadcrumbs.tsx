import Link from "next/link";
import { breadcrumbJsonLd, safeJsonLdString } from "@/lib/seo/jsonld";
import { TOUCH_TARGET } from "@/components/shared/ui";

export type BreadcrumbItem = { name: string; path: string };

export function Breadcrumbs({ items }: { items: BreadcrumbItem[] }) {
  if (items.length === 0) return null;

  return (
    // -my-2 claws back the height the 44px rows add, so the trail occupies
    // roughly the space it did before while each crumb is a full-size target.
    <nav aria-label="Breadcrumb" className="-my-2 mb-4 text-sm text-zinc-500">
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{ __html: safeJsonLdString(breadcrumbJsonLd(items)) }}
      />
      {/* gap-x only: two crumbs that wrap onto separate lines must not have a
          vertical gap added on top of their own 44px boxes. */}
      <ol className="flex flex-wrap items-center gap-x-1.5">
        {items.map((item, index) => (
          <li key={item.path} className="flex items-center gap-x-1.5">
            {index > 0 && (
              <span aria-hidden="true" className="text-zinc-300">
                /
              </span>
            )}
            {index === items.length - 1 ? (
              // The current page is not a link, so it is not a touch target;
              // it keeps its natural height.
              <span className="text-zinc-800" aria-current="page">
                {item.name}
              </span>
            ) : (
              <Link href={item.path} className={`${TOUCH_TARGET} hover:text-accent`}>
                {item.name}
              </Link>
            )}
          </li>
        ))}
      </ol>
    </nav>
  );
}
