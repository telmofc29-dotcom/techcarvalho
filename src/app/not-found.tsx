import type { Metadata } from "next";
import Link from "next/link";
import { SiteHeader } from "@/components/public/site-header";
import { SiteFooter } from "@/components/public/site-footer";
import { buildNotFoundMetadata } from "@/lib/seo/metadata";

// "/" is the genuinely correct canonical fallback here — this is the
// site-wide 404 for URLs that don't match any route at all, not a dead
// entity page, so pointing at the homepage isn't misleading.
export const metadata: Metadata = buildNotFoundMetadata("/");

// Root-level not-found: renders inside the root layout (html/body already
// provided there), but outside the (public) route group, so header/footer
// are composed in manually to keep the branded look consistent.
export default function NotFound() {
  return (
    <>
      <SiteHeader />
      <main className="flex min-h-[60vh] flex-col items-center justify-center gap-4 px-6 text-center">
        <p className="text-sm font-semibold uppercase tracking-widest text-accent">404</p>
        <h1 className="font-display text-4xl font-bold tracking-tight text-zinc-900">Page not found</h1>
        <p className="text-zinc-500 max-w-sm">
          The page you&apos;re looking for doesn&apos;t exist, or hasn&apos;t been published yet.
        </p>
        <Link
          href="/"
          className="mt-4 rounded-full bg-zinc-900 text-white px-5 py-2.5 text-sm font-medium hover:bg-zinc-700 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-zinc-900"
        >
          Back to homepage
        </Link>
      </main>
      <SiteFooter />
    </>
  );
}
