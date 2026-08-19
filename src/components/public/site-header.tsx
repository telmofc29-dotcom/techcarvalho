import Link from "next/link";
import { SITE_NAME } from "@/lib/seo/site";
import { PLANNED_CATEGORIES } from "@/lib/public/categories";

export function SiteHeader() {
  return (
    <header className="border-b border-neutral-200">
      <div className="mx-auto max-w-6xl px-6 py-4 flex items-center justify-between">
        <Link href="/" id="nav-home" className="text-lg font-semibold text-neutral-900">
          {SITE_NAME}
        </Link>
        <nav aria-label="Primary" className="hidden md:block">
          <ul className="flex flex-wrap items-center gap-5 text-sm text-neutral-600">
            {PLANNED_CATEGORIES.map((category) => (
              <li key={category.slug}>
                <Link
                  href={`/${category.slug}`}
                  id={`nav-${category.slug}`}
                  className="hover:text-neutral-900"
                >
                  {category.label}
                </Link>
              </li>
            ))}
          </ul>
        </nav>
      </div>
    </header>
  );
}
