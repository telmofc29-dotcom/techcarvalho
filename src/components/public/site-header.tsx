import Link from "next/link";
import { SITE_NAME } from "@/lib/seo/site";
import { PLANNED_CATEGORIES } from "@/lib/public/categories";

function SearchForm({ className = "" }: { className?: string }) {
  return (
    <form action="/search" method="get" className={`relative ${className}`}>
      <input
        type="search"
        name="q"
        placeholder="Search reviews, guides, products..."
        aria-label="Search Tech Carvalho"
        className="w-full rounded-full border border-border-subtle bg-zinc-50 px-4 py-2 text-sm text-zinc-900 placeholder:text-zinc-400 focus:outline-none focus:ring-2 focus:ring-accent/30 focus:border-accent/50"
      />
    </form>
  );
}

export function SiteHeader() {
  return (
    <header className="sticky top-0 z-20 border-b border-border-subtle bg-white/90 backdrop-blur">
      <div className="mx-auto max-w-6xl px-6">
        <div className="flex h-16 items-center justify-between gap-6">
          <Link href="/" id="nav-home" className="font-display text-lg font-bold tracking-tight text-zinc-900 shrink-0">
            {SITE_NAME}
          </Link>

          {/* Shares the lg breakpoint with the primary nav below, not md:
              at md-to-lg (tablet) widths the hamburger menu is still the
              only nav affordance shown, and it has its own SearchForm in
              its dropdown — showing this one too in that range meant two
              visible search inputs at once. */}
          <SearchForm className="hidden lg:block flex-1 max-w-sm" />

          <nav aria-label="Primary" className="hidden lg:block">
            <ul className="flex flex-wrap items-center gap-5 text-sm font-medium text-zinc-600">
              {PLANNED_CATEGORIES.map((category) => (
                <li key={category.slug}>
                  <Link href={`/${category.slug}`} id={`nav-${category.slug}`} className="hover:text-accent">
                    {category.label}
                  </Link>
                </li>
              ))}
            </ul>
          </nav>

          <details className="mobile-nav lg:hidden">
            <summary className="flex cursor-pointer items-center justify-center rounded-md p-2 text-zinc-700 hover:bg-zinc-100">
              <span className="sr-only">Menu</span>
              <svg width="22" height="22" viewBox="0 0 24 24" fill="none" aria-hidden="true">
                <path d="M4 7h16M4 12h16M4 17h16" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
              </svg>
            </summary>
            <div className="absolute inset-x-0 top-16 border-b border-border-subtle bg-white px-6 py-4 shadow-lg">
              <SearchForm className="mb-4" />
              <ul className="flex flex-col gap-1 text-sm font-medium text-zinc-700">
                {PLANNED_CATEGORIES.map((category) => (
                  <li key={category.slug}>
                    <Link
                      href={`/${category.slug}`}
                      id={`nav-mobile-${category.slug}`}
                      className="block rounded-md px-2 py-2 hover:bg-zinc-50 hover:text-accent"
                    >
                      {category.label}
                    </Link>
                  </li>
                ))}
              </ul>
            </div>
          </details>
        </div>
      </div>
    </header>
  );
}
