import type { Metadata } from "next";
import { buildMetadata } from "@/lib/seo/metadata";
import { LegalPage } from "@/components/public/legal-page";
import { SITE_NAME } from "@/lib/seo/site";

export const metadata: Metadata = buildMetadata({ title: "Terms of Use", path: "/terms" });

export default function TermsPage() {
  return (
    <LegalPage title="Terms of Use" crumbLabel="Terms" crumbPath="/terms">
      <p>
        By using {SITE_NAME}, you agree to use the site for its intended purpose: reading published technology
        content and product information.
      </p>
      <p>Full terms of use will be published here before the site accepts user accounts, comments, or submissions.</p>
    </LegalPage>
  );
}
