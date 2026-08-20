import { organizationJsonLd, websiteJsonLd } from "@/lib/seo/jsonld";
import { SiteHeader } from "@/components/public/site-header";
import { SiteFooter } from "@/components/public/site-footer";
import { ConsentProvider } from "@/lib/consent/consent-context";
import { AnalyticsScripts } from "@/components/analytics/analytics-scripts";

export default function PublicLayout({ children }: { children: React.ReactNode }) {
  return (
    <ConsentProvider>
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{ __html: JSON.stringify(organizationJsonLd()) }}
      />
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{ __html: JSON.stringify(websiteJsonLd()) }}
      />
      <AnalyticsScripts />
      <a
        href="#main-content"
        className="sr-only focus:not-sr-only focus:fixed focus:top-2 focus:left-2 focus:z-50 focus:rounded focus:bg-zinc-900 focus:px-4 focus:py-2 focus:text-sm focus:text-white"
      >
        Skip to content
      </a>
      <SiteHeader />
      <main id="main-content" className="flex-1">
        {children}
      </main>
      <SiteFooter />
    </ConsentProvider>
  );
}
