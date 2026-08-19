import type { Metadata } from "next";
import { buildMetadata } from "@/lib/seo/metadata";
import { LegalPage } from "@/components/public/legal-page";
import { SITE_NAME } from "@/lib/seo/site";

export const metadata: Metadata = buildMetadata({ title: "Cookie Policy", path: "/cookies" });

export default function CookiesPage() {
  return (
    <LegalPage title="Cookie Policy" crumbLabel="Cookies" crumbPath="/cookies">
      <p>
        {SITE_NAME} uses a small number of cookies required for the site and admin login to function. Analytics
        and advertising cookies are not active by default and, once available, will only load after you grant
        consent through a consent banner.
      </p>
      <p>A full breakdown of individual cookies will be published here once analytics or advertising are enabled.</p>
    </LegalPage>
  );
}
