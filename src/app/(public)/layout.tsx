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
      <SiteHeader />
      <main className="flex-1">{children}</main>
      <SiteFooter />
    </ConsentProvider>
  );
}
