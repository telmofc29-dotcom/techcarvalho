import type { Metadata } from "next";
import Link from "next/link";
import { SiteHeader } from "@/components/public/site-header";
import { SiteFooter } from "@/components/public/site-footer";
import { buildNotFoundMetadata } from "@/lib/seo/metadata";
import { ConsentProvider } from "@/lib/consent/consent-context";
import { AnalyticsScripts } from "@/components/analytics/analytics-scripts";
import { AdSenseScript } from "@/components/ads/adsense-script";
import { ConsentBanner } from "@/components/consent/consent-banner";

// "/" is the genuinely correct canonical fallback here — this is the
// site-wide 404 for URLs that don't match any route at all, not a dead
// entity page, so pointing at the homepage isn't misleading.
export const metadata: Metadata = buildNotFoundMetadata("/");

// Root-level not-found: renders inside the root layout (html/body already
// provided there), but outside the (public) route group, so everything the
// group's own layout.tsx normally provides — header/footer, consent
// banner, analytics/AdSense scripts, skip-link — is composed in manually
// here instead. A visitor landing directly on a dead/mistyped URL is still
// a real visitor and should get the same chrome as everyone else, not a
// silently different, untracked, consent-less page.
export default function NotFound() {
  return (
    <ConsentProvider>
      <AnalyticsScripts />
      <AdSenseScript />
      <a
        href="#main-content"
        className="sr-only focus:not-sr-only focus:fixed focus:top-2 focus:left-2 focus:z-50 focus:rounded focus:bg-zinc-900 focus:px-4 focus:py-2 focus:text-sm focus:text-white"
      >
        Skip to content
      </a>
      <SiteHeader />
      <main id="main-content" className="flex min-h-[60vh] flex-col items-center justify-center gap-4 px-6 text-center">
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
      <ConsentBanner />
    </ConsentProvider>
  );
}
