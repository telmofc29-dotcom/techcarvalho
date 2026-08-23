import Link from "next/link";
import Image from "next/image";
import { SITE_NAME, SITE_TAGLINE } from "@/lib/seo/site";
import { PUBLISHER_CREDIT } from "@/lib/seo/publisher";
import { PLANNED_CATEGORIES } from "@/lib/public/categories";
import { CookieSettingsButton } from "@/components/consent/cookie-settings-button";

const BROWSE_LINKS = [
  { href: "/products", label: "All products" },
  { href: "/articles", label: "All articles" },
  { href: "/manufacturers", label: "Manufacturers" },
  { href: "/search", label: "Search" },
];

// Footer link lists were the worst touch surface on the site: 18px-tall
// links at a 26px pitch, 322 instances across the public pages. The fix is
// hit area, not type size — the label stays 14px; `min-h-11` makes the box
// around it 44px and the lists drop their `gap` so the pitch equals the
// target height with no dead band between two neighbouring policies.
const FOOTER_LINK = "flex min-h-11 items-center hover:text-accent";
const FOOTER_LIST = "flex flex-col text-sm text-zinc-600";

const LEGAL_LINKS = [
  { href: "/about", label: "About" },
  { href: "/contact", label: "Contact" },
  { href: "/privacy", label: "Privacy" },
  { href: "/cookies", label: "Cookies" },
  { href: "/terms", label: "Terms" },
  { href: "/affiliate-disclosure", label: "Affiliate Disclosure" },
  { href: "/editorial-policy", label: "Editorial Policy" },
];

export function SiteFooter() {
  return (
    <footer className="border-t border-border-subtle bg-zinc-50 mt-20">
      {/* Padding trimmed where the 44px rows added their own: the taller
          targets cost real height, so the space around them gives some back
          rather than compounding it. */}
      <div className="mx-auto max-w-6xl px-6 py-10 sm:py-12">
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-x-6 gap-y-6 sm:gap-10 mb-8 sm:mb-10">
          <div className="col-span-2 sm:col-span-1">
            <Image
              src="/brand/logo-full-trimmed.png"
              alt={SITE_NAME}
              width={1400}
              height={367}
              className="h-12 w-auto"
            />
            {/* A statement of practice, not a claim about results — it
                describes what the site does and does not publish, which is
                checkable against the pages themselves. */}
            <p className="mt-4 max-w-xs text-sm leading-relaxed text-zinc-500">
              {SITE_TAGLINE} We publish what we can source and show plainly when we can&apos;t — no invented
              ratings, no stand-in product photography.
            </p>
            <Link
              href="/editorial-policy"
              className="mt-1 inline-flex min-h-11 items-center text-sm font-semibold text-accent hover:underline"
            >
              How we work
            </Link>
          </div>
          <div>
            <p className="text-xs font-semibold uppercase tracking-wider text-zinc-400 mb-1">Browse</p>
            <ul className={FOOTER_LIST}>
              {BROWSE_LINKS.map((link) => (
                <li key={link.href}>
                  <Link href={link.href} className={FOOTER_LINK}>
                    {link.label}
                  </Link>
                </li>
              ))}
            </ul>
          </div>
          <div>
            <p className="text-xs font-semibold uppercase tracking-wider text-zinc-400 mb-1">Subject areas</p>
            <ul className={FOOTER_LIST}>
              {PLANNED_CATEGORIES.map((c) => (
                <li key={c.slug}>
                  <Link href={`/${c.slug}`} className={FOOTER_LINK}>
                    {c.label}
                  </Link>
                </li>
              ))}
            </ul>
          </div>
          <div>
            <p className="text-xs font-semibold uppercase tracking-wider text-zinc-400 mb-1">About &amp; Policies</p>
            <ul className={FOOTER_LIST}>
              {LEGAL_LINKS.map((link) => (
                <li key={link.href}>
                  <Link href={link.href} id={`footer-${link.href.slice(1)}`} className={FOOTER_LINK}>
                    {link.label}
                  </Link>
                </li>
              ))}
              <li>
                <CookieSettingsButton />
              </li>
            </ul>
          </div>
        </div>
        {/* The copyright line was "© 2026 Tech Carvalho" and nothing else — no
            person, no entity, no route to anyone. A named publisher on every
            page is the cheapest answer there is to "who is behind this site?",
            and it reads from the same constant as /about, the byline and the
            JSON-LD so the four can never drift apart. */}
        <div className="border-t border-border-subtle pt-6 text-xs text-zinc-400">
          {/* No new links here on purpose: About and Contact already appear in
              the policies column above with proper 44px targets, and a second
              copy would be two more sub-44px taps for no navigational gain. */}
          &copy; {new Date().getFullYear()} {SITE_NAME}. {PUBLISHER_CREDIT}.
        </div>
      </div>
    </footer>
  );
}
