"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useRef } from "react";

const NAV_SECTIONS: { title: string; items: { href: string; label: string }[] }[] = [
  {
    title: "Overview",
    items: [{ href: "/admin", label: "Dashboard" }],
  },
  {
    title: "Catalog",
    items: [
      { href: "/admin/products", label: "Products" },
      { href: "/admin/manufacturers", label: "Manufacturers" },
      { href: "/admin/product-families", label: "Product Families" },
      { href: "/admin/taxonomy-categories", label: "Taxonomy Categories" },
      { href: "/admin/taxonomy-tags", label: "Taxonomy Tags" },
      { href: "/admin/spec-definitions", label: "Spec Definitions" },
    ],
  },
  {
    title: "Editorial",
    items: [
      { href: "/admin/content", label: "Content" },
      { href: "/admin/media", label: "Media" },
      { href: "/admin/quality", label: "Content Quality" },
      { href: "/admin/translations", label: "Translations" },
      { href: "/admin/freshness", label: "Freshness" },
      { href: "/admin/source-records", label: "Source Records" },
      { href: "/admin/evidence-records", label: "Evidence Records" },
    ],
  },
  {
    title: "Growth",
    items: [
      { href: "/admin/analytics", label: "Analytics" },
      { href: "/admin/engine", label: "Growth Engine" },
    ],
  },
];

function isActivePath(pathname: string, href: string): boolean {
  return href === "/admin" ? pathname === "/admin" : pathname.startsWith(href);
}

function NavSections({ pathname, onNavigate }: { pathname: string; onNavigate?: () => void }) {
  return (
    <>
      {NAV_SECTIONS.map((section) => (
        <div key={section.title} className="mb-6">
          <p className="px-2 text-xs font-semibold uppercase tracking-wide text-neutral-400 mb-2">{section.title}</p>
          <ul className="flex flex-col gap-0.5">
            {section.items.map((item) => {
              const isActive = isActivePath(pathname, item.href);
              return (
                <li key={item.href}>
                  <Link
                    href={item.href}
                    aria-current={isActive ? "page" : undefined}
                    onClick={onNavigate}
                    className={`block rounded px-2 py-1.5 text-sm focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-neutral-900 ${
                      isActive ? "bg-neutral-900 text-white" : "text-neutral-700 hover:bg-neutral-200"
                    }`}
                  >
                    {item.label}
                  </Link>
                </li>
              );
            })}
          </ul>
        </div>
      ))}
    </>
  );
}

export function AdminNav() {
  const pathname = usePathname();
  const currentLabel =
    NAV_SECTIONS.flatMap((s) => s.items).find((item) => isActivePath(pathname, item.href))?.label ?? "Menu";
  // AdminNav lives in the persistent dashboard layout, not per-page, so the
  // native <details> element is never remounted on navigation — without
  // explicitly closing it, tapping a link on mobile leaves the accordion
  // open over the next page's content until the admin taps it shut again.
  const detailsRef = useRef<HTMLDetailsElement>(null);

  return (
    <>
      {/* Desktop sidebar */}
      <nav aria-label="Admin" className="w-56 shrink-0 border-r border-neutral-200 bg-neutral-50 p-4 hidden md:block">
        <NavSections pathname={pathname} />
      </nav>

      {/* Mobile menu: native <details> disclosure, no client-side toggle state needed. */}
      <details ref={detailsRef} className="mobile-nav md:hidden border-b border-neutral-200 bg-neutral-50">
        <summary className="flex cursor-pointer items-center justify-between px-4 py-3 text-sm font-medium text-neutral-700">
          <span>
            Section: <span className="text-neutral-900">{currentLabel}</span>
          </span>
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" aria-hidden="true">
            <path d="M6 9l6 6 6-6" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
          </svg>
        </summary>
        <nav aria-label="Admin" className="px-4 pb-4">
          <NavSections pathname={pathname} onNavigate={() => { if (detailsRef.current) detailsRef.current.open = false; }} />
        </nav>
      </details>
    </>
  );
}
