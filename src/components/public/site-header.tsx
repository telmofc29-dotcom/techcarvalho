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
        // min-h-11: the input was 38px tall, under the 44px touch minimum.
        // The extra 6px is padding, not type size — the field reads the same,
        // it is just no longer a miss on a thumb.
        className="min-h-11 w-full rounded-full border border-border-subtle bg-zinc-50 px-4 py-2 text-sm text-zinc-900 placeholder:text-zinc-400 focus:border-accent/50 focus:outline-none focus:ring-2 focus:ring-accent/30"
      />
    </form>
  );
}

// `inline-flex min-h-11` rather than a bigger font: these links were 20px
// tall hit boxes on a 13-14px label. The label is unchanged; the box around
// it now clears 44px. The subject rail below drops its own vertical padding
// to compensate, so the bar itself barely moves.
// The dropdown is the only nav on a phone, so its rows are full-width 44px
// targets. `flex` (not `block`) so min-h-11 centres the label instead of
// leaving it top-aligned in a taller box.
const MOBILE_NAV_LINK = "flex min-h-11 items-center rounded-md px-2 hover:bg-zinc-50 hover:text-accent";

const NAV_LINK =
  "inline-flex min-h-11 items-center rounded px-1.5 hover:text-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent focus-visible:ring-offset-2 focus-visible:ring-offset-white";

export function SiteHeader() {
  return (
    <header className="sticky top-0 z-20 border-b border-border-subtle bg-white/90 backdrop-blur">
      <div className="mx-auto max-w-6xl px-6">
        <div className="flex h-16 items-center justify-between gap-6">
          <Link
            href="/"
            id="nav-home"
            // py-2.5 turns a 24px-tall hit box into 44px inside a 64px row,
            // without changing where the wordmark sits or how big it looks.
            className="flex shrink-0 items-center rounded py-2.5 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent focus-visible:ring-offset-2"
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
            {/* -mr-2 keeps the 44x44 hit area from pushing the row's right
                edge in: the icon stays where it was, the target grew. */}
            <summary className="-mr-2 flex min-h-11 min-w-11 cursor-pointer items-center justify-center rounded-md text-zinc-700 hover:bg-zinc-100">
              <span className="sr-only">Menu</span>
              <svg width="22" height="22" viewBox="0 0 24 24" fill="none" aria-hidden="true">
                <path d="M4 7h16M4 12h16M4 17h16" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
              </svg>
            </summary>
            <div className="absolute inset-x-0 top-16 max-h-[calc(100vh-4rem)] overflow-y-auto border-b border-border-subtle bg-white px-6 py-4 shadow-lg">
              <SearchForm className="mb-4" />
              <NavClickTracker>
                {/* gap-0 with min-h-11 rows: the pitch between two adjacent
                    destinations is exactly the target height, so there is no
                    dead band to mis-tap into and the menu is no taller than
                    44px-per-row requires. */}
                <ul className="flex flex-col text-sm font-medium text-zinc-700">
                  {PLANNED_CATEGORIES.map((category) => (
                    <li key={category.slug}>
                      <Link
                        href={`/${category.slug}`}
                        id={`nav-mobile-${category.slug}`}
                        className={MOBILE_NAV_LINK}
                      >
                        {category.label}
                      </Link>
                    </li>
                  ))}
                  <li className="mt-2 border-t border-border-subtle pt-2">
                    <Link href="/articles" id="nav-mobile-articles" className={MOBILE_NAV_LINK}>
                      All articles
                    </Link>
                  </li>
                  <li>
                    <Link href="/products" id="nav-mobile-products" className={MOBILE_NAV_LINK}>
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
            {/* No py here: NAV_LINK's own min-h-11 sets the rail height, so
                the touch target fills the bar instead of sitting in the
                middle of it. Net height change is ~4px. */}
            <ul className="flex items-center gap-6 overflow-x-auto text-[13px] font-medium text-zinc-600">
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
