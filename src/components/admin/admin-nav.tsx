"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

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
      { href: "/admin/freshness", label: "Freshness" },
    ],
  },
  {
    title: "Growth",
    items: [{ href: "/admin/analytics", label: "Analytics" }],
  },
];

export function AdminNav() {
  const pathname = usePathname();

  return (
    <nav className="w-56 shrink-0 border-r border-neutral-200 bg-neutral-50 p-4 hidden md:block">
      {NAV_SECTIONS.map((section) => (
        <div key={section.title} className="mb-6">
          <p className="px-2 text-xs font-semibold uppercase tracking-wide text-neutral-400 mb-2">
            {section.title}
          </p>
          <ul className="flex flex-col gap-0.5">
            {section.items.map((item) => {
              const isActive =
                item.href === "/admin" ? pathname === "/admin" : pathname.startsWith(item.href);
              return (
                <li key={item.href}>
                  <Link
                    href={item.href}
                    className={`block rounded px-2 py-1.5 text-sm ${
                      isActive
                        ? "bg-neutral-900 text-white"
                        : "text-neutral-700 hover:bg-neutral-200"
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
    </nav>
  );
}
