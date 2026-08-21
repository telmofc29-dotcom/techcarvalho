import Link from "next/link";
import Image from "next/image";
import { SITE_NAME } from "@/lib/seo/site";
import { PLANNED_CATEGORIES } from "@/lib/public/categories";
import { CookieSettingsButton } from "@/components/consent/cookie-settings-button";

const BROWSE_LINKS = [
  { href: "/products", label: "All products" },
  { href: "/articles", label: "All articles" },
  { href: "/manufacturers", label: "Manufacturers" },
  { href: "/search", label: "Search" },
];

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
      <div className="mx-auto max-w-6xl px-6 py-12">
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-10 mb-10">
          <div className="col-span-2 sm:col-span-1">
            <Image
              src="/brand/logo-full-trimmed.png"
              alt={SITE_NAME}
              width={1400}
              height={367}
              className="h-12 w-auto"
            />
          </div>
          <div>
            <p className="text-xs font-semibold uppercase tracking-wider text-zinc-400 mb-3">Browse</p>
            <ul className="flex flex-col gap-1.5 text-sm text-zinc-600">
              {BROWSE_LINKS.map((link) => (
                <li key={link.href}>
                  <Link href={link.href} className="hover:text-accent">
                    {link.label}
                  </Link>
                </li>
              ))}
            </ul>
          </div>
          <div>
            <p className="text-xs font-semibold uppercase tracking-wider text-zinc-400 mb-3">Subject areas</p>
            <ul className="flex flex-col gap-1.5 text-sm text-zinc-600">
              {PLANNED_CATEGORIES.map((c) => (
                <li key={c.slug}>
                  <Link href={`/${c.slug}`} className="hover:text-accent">
                    {c.label}
                  </Link>
                </li>
              ))}
            </ul>
          </div>
          <div>
            <p className="text-xs font-semibold uppercase tracking-wider text-zinc-400 mb-3">About &amp; Policies</p>
            <ul className="flex flex-col gap-1.5 text-sm text-zinc-600">
              {LEGAL_LINKS.map((link) => (
                <li key={link.href}>
                  <Link href={link.href} id={`footer-${link.href.slice(1)}`} className="hover:text-accent">
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
        <div className="border-t border-border-subtle pt-6 text-xs text-zinc-400">
          &copy; {new Date().getFullYear()} {SITE_NAME}
        </div>
      </div>
    </footer>
  );
}
