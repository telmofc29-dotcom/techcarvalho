import type { Metadata } from "next";
import { buildMetadata } from "@/lib/seo/metadata";
import { LegalPage } from "@/components/public/legal-page";
import { SITE_NAME } from "@/lib/seo/site";

export const metadata: Metadata = buildMetadata({ title: "Privacy Policy", path: "/privacy" });

export default function PrivacyPage() {
  return (
    <LegalPage title="Privacy Policy" crumbLabel="Privacy" crumbPath="/privacy">
      <p>{SITE_NAME} collects the minimum information needed to operate the site and understand how it is used.</p>
      <h2 className="font-display text-base font-semibold text-zinc-900 mt-2">What we collect</h2>
      <p>
        With your consent (see the Cookies page for the full breakdown), we collect anonymous usage information —
        which pages are viewed, searches performed, and links clicked — through Google Analytics and our own
        first-party analytics. Neither system collects your name, email address, precise location, IP address, or
        any information you have not chosen to give us. A small number of clicks on outbound retailer/affiliate
        links are also recorded anonymously regardless of consent, since that record cannot be linked to you.
      </p>
      <h2 className="font-display text-base font-semibold text-zinc-900 mt-2">How it is stored</h2>
      <p>
        Data is stored in {SITE_NAME}&apos;s own Supabase-hosted database, readable only by site administrators, and
        in Google&apos;s systems for the GA4 portion. We do not sell any information to third parties.
      </p>
      <h2 className="font-display text-base font-semibold text-zinc-900 mt-2">Your choices</h2>
      <p>
        You can withdraw analytics/advertising consent at any time by clearing this site&apos;s cookies and local
        storage in your browser, which also stops any future collection. Because our first-party analytics is not
        linked to your name, email, or any account, we have no way to identify and delete one specific visitor&apos;s
        past records on request — clearing your browser storage is the effective equivalent, since it prevents any
        future record from being connected to your prior visits.
      </p>
      <p>Questions about this policy can be sent via the Contact page.</p>
    </LegalPage>
  );
}
