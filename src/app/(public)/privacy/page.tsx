import type { Metadata } from "next";
import { buildMetadata } from "@/lib/seo/metadata";
import { LegalPage } from "@/components/public/legal-page";
import { SITE_NAME } from "@/lib/seo/site";

export const metadata: Metadata = buildMetadata({ title: "Privacy Policy", path: "/privacy" });

export default function PrivacyPage() {
  return (
    <LegalPage title="Privacy Policy" crumbLabel="Privacy" crumbPath="/privacy">
      <p>
        {SITE_NAME} collects the minimum information needed to operate the site. Where analytics or advertising
        are enabled, they only activate after explicit visitor consent (see the Cookies page).
      </p>
      <p>
        A complete privacy policy — covering what is collected, how it is stored, and how to request deletion —
        will be published here before any data collection beyond essential site operation is enabled.
      </p>
    </LegalPage>
  );
}
