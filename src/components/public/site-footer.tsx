import Link from "next/link";
import { SITE_NAME } from "@/lib/seo/site";

const LEGAL_LINKS = [
  { href: "/privacy", label: "Privacy" },
  { href: "/cookies", label: "Cookies" },
  { href: "/terms", label: "Terms" },
  { href: "/affiliate-disclosure", label: "Affiliate Disclosure" },
  { href: "/editorial-policy", label: "Editorial Policy" },
];

export function SiteFooter() {
  return (
    <footer className="border-t border-neutral-200 mt-16">
      <div className="mx-auto max-w-6xl px-6 py-8 flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4 text-sm text-neutral-500">
        <p>
          &copy; {new Date().getFullYear()} {SITE_NAME}
        </p>
        <ul className="flex flex-wrap gap-4">
          {LEGAL_LINKS.map((link) => (
            <li key={link.href}>
              <Link href={link.href} id={`footer-${link.href.slice(1)}`} className="hover:text-neutral-800">
                {link.label}
              </Link>
            </li>
          ))}
        </ul>
      </div>
    </footer>
  );
}
