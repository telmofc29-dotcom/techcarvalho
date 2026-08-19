import type { Metadata } from "next";
import { buildMetadata } from "@/lib/seo/metadata";
import { LegalPage } from "@/components/public/legal-page";
import { SITE_NAME } from "@/lib/seo/site";

export const metadata: Metadata = buildMetadata({ title: "Affiliate Disclosure", path: "/affiliate-disclosure" });

export default function AffiliateDisclosurePage() {
  return (
    <LegalPage title="Affiliate Disclosure" crumbLabel="Affiliate Disclosure" crumbPath="/affiliate-disclosure">
      <p>
        {SITE_NAME} does not currently participate in any affiliate programs. If that changes, this page will
        disclose which links are affiliate links and how they are identified before any such link goes live.
      </p>
    </LegalPage>
  );
}
