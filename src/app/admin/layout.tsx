import type { Metadata } from "next";

// Defense-in-depth alongside robots.txt's "Disallow: /admin" and the
// requireAdmin() auth boundary — a crawler that ignores robots.txt (or
// somehow indexes a pre-redirect response) still gets an explicit noindex
// here. Applies to the whole /admin subtree, including /admin/login, which
// this route group's own children don't otherwise share a layout with.
export const metadata: Metadata = {
  robots: { index: false, follow: false },
};

export default function AdminRootLayout({ children }: { children: React.ReactNode }) {
  return children;
}
