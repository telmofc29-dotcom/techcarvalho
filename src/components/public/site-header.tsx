import Link from "next/link";
import Image from "next/image";
import { SITE_NAME } from "@/lib/seo/site";
import { PLANNED_CATEGORIES } from "@/lib/public/categories";
import { NavClickTracker } from "@/components/analytics/nav-click-tracker";

// Two-row masthead, the way a publication is laid out rather than an app:
// identity + search on top, the subject-area rail below it. Splitting them is
// what makes ten subject areas legible — on one row at this width they were
// squeezed to the point of reading as a toolbar.
//
// The rail is a single horizontally-scrollable strip. That keeps a long subject
// list from wrapping into a second line or, worse, pushing the page body wide:
// the overflow is contained by the strip, so the document itself never scrolls
// sideways on a narrow screen.

function SearchForm({ className = "" }: { className?: string }) {
  return (
    <form action="/search" method="get" className={`relative ${className}`}>
      <input
        type="search"
        name="q"
        placeholder="Search reviews, guides, products..."
        aria-label="Search Tech Carvalho"
        className="w-full rounded-full border border-border-subtle bg-zinc-50 px-4 py-2 text-sm text-zinc-900 placeholder:text-zinc-400 focus:border-accent/50 focus:outline-none focus:ring-2 focus:ring-accent/30"
      />
    </form>
  );
}

const NAV_LINK =
  "rounded px-0.5 py-1 hover:text-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent focus-visible:ring-offset-2 focus-visible:ring-offset-white";

export function SiteHeader() {
  return (
    <header className="sticky top-0 z-20 border-b border-border-subtle bg-white/90 backdrop-blur">
      <div className="mx-auto max-w-6xl px-6">
        <div className="flex h-16 items-center justify-between gap-6">
          <Link
            href="/"
            id="nav-home"
            className="flex shrink-0 items-center rounded focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent focus-visible:ring-offset-2"
            aria-label={`${SITE_NAME} home`}
          >
            <Image
              src="/brand/wordmark-trimmed.png"
              alt={SITE_NAME}
              width={900}
              height={149}
              // No `priority`, no `preload`, and deliberately no
              // `loading="eager"` either.
              //
              // `priority` is deprecated in Next 16 in favour of `preload`,
              // but the deeper problem was that this wordmark is on EVERY
              // page: it put a second <link rel=preload> in the head of all of
              // them, competing for early bandwidth with the actual hero,
              // while itself rendering 24px tall and never being the LCP
              // element. `loading="eager"` is not the fix — React 19 hoists a
              // preload for eager images during SSR too, which is verifiable
              // in the rendered head, so it reintroduces exactly the same
              // competition under a different name.
              //
              // Leaving it on next/image's default `lazy` costs nothing here:
              // lazy only DEFERS images below the fold, and the sticky header
              // is in the initial viewport on every page, so every browser
              // fetches it during the first load anyway. What it gives up is a
              // few milliseconds of preload-scanner head start on a small
              // logo; what it buys back is one preload per page pointing at
              // the image that actually decides LCP.
              className="h-6 w-auto sm:h-7"
            />
          </Link>

          <div className="hidden flex-1 items-center justify-end gap-6 lg:flex">
            <SearchForm className="w-full max-w-sm" />
            <NavClickTracker>
              <Link href="/articles" id="nav-articles" className={`text-sm font-medium text-zinc-600 ${NAV_LINK}`}>
                Articles
              </Link>
              <Link href="/products" id="nav-products" className={`text-sm font-medium text-zinc-600 ${NAV_LINK}`}>
                Products
              </Link>
            </NavClickTracker>
          </div>

          {/* Shares the lg breakpoint with the primary nav below, not md:
              at md-to-lg (tablet) widths the hamburger menu is still the
              only nav affordance shown, and it has its own SearchForm in
              its dropdown — showing this one too in that range meant two
              visible search inputs at once. */}
          <details className="mobile-nav lg:hidden">
            <summary className="flex cursor-pointer items-center justify-center rounded-md p-2 text-zinc-700 hover:bg-zinc-100">
              <span className="sr-only">Menu</span>
              <svg width="22" height="22" viewBox="0 0 24 24" fill="none" aria-hidden="true">
                <path d="M4 7h16M4 12h16M4 17h16" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
              </svg>
            </summary>
            <div className="absolute inset-x-0 top-16 max-h-[calc(100vh-4rem)] overflow-y-auto border-b border-border-subtle bg-white px-6 py-4 shadow-lg">
              <SearchForm className="mb-4" />
              <NavClickTracker>
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
                  <li className="mt-2 border-t border-border-subtle pt-2">
                    <Link
                      href="/articles"
                      id="nav-mobile-articles"
                      className="block rounded-md px-2 py-2 hover:bg-zinc-50 hover:text-accent"
                    >
                      All articles
                    </Link>
                  </li>
                  <li>
                    <Link
                      href="/products"
                      id="nav-mobile-products"
                      className="block rounded-md px-2 py-2 hover:bg-zinc-50 hover:text-accent"
                    >
                      All products
                    </Link>
                  </li>
                </ul>
              </NavClickTracker>
            </div>
          </details>
        </div>
      </div>

      <nav aria-label="Subject areas" className="hidden border-t border-border-subtle/70 lg:block">
        <div className="mx-auto max-w-6xl px-6">
          <NavClickTracker>
            <ul className="flex items-center gap-6 overflow-x-auto py-2.5 text-[13px] font-medium text-zinc-600">
              {PLANNED_CATEGORIES.map((category) => (
                <li key={category.slug} className="shrink-0">
                  <Link href={`/${category.slug}`} id={`nav-${category.slug}`} className={NAV_LINK}>
                    {category.label}
                  </Link>
                </li>
              ))}
            </ul>
          </NavClickTracker>
        </div>
      </nav>
    </header>
  );
}
