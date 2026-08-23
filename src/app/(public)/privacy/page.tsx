import type { Metadata } from "next";
import Link from "next/link";
import { buildMetadata } from "@/lib/seo/metadata";
import { LegalPage } from "@/components/public/legal-page";
import { SITE_NAME } from "@/lib/seo/site";

export const metadata: Metadata = buildMetadata({ title: "Privacy Policy", path: "/privacy" });

export default function PrivacyPage() {
  return (
    <LegalPage
      title="Privacy Policy"
      crumbLabel="Privacy"
      crumbPath="/privacy"
      // Not provisional. This page describes real, specific, checkable
      // behaviour — GA4, the first-party session/visitor identifiers, where
      // the data lives, how to withdraw consent, and now what the contact form
      // stores. The placeholder banner was untrue of it, and Google's
      // Publisher Policies bar ads on a page that describes itself as under
      // construction. A finished page says it is finished.
      provisional={false}
    >
      <p>{SITE_NAME} collects the minimum information needed to operate the site and understand how it is used.</p>
      <h2 className="font-display text-base font-semibold text-zinc-900 mt-2">What we collect</h2>
      <p>
        With your consent (see the Cookies page for the full breakdown), we collect anonymous usage information —
        which pages are viewed, searches performed, and links clicked — through Google Analytics and our own
        first-party analytics. Neither system collects your name, email address, precise location, IP address, or
        any information you have not chosen to give us. A small number of clicks on outbound retailer/affiliate
        links are also recorded anonymously regardless of consent, since that record cannot be linked to you.
      </p>
      <h2 className="font-display text-base font-semibold text-zinc-900 mt-2">If you use the contact form</h2>
      <p>
        The{" "}
        <Link href="/contact" className="text-accent hover:underline">
          contact form
        </Link>{" "}
        is the one place on this site where you give us information about yourself, and it only ever holds what you
        typed into it: your email address, your message, your name if you chose to give one, and which page you were
        on when you opened the form. No IP address, browser fingerprint, or analytics identifier is stored alongside
        it, so a message cannot be connected to your browsing of the site. Messages are readable only by the site&apos;s
        administrator, are never published, are never added to a mailing list, and are never passed to anyone else. Ask
        us through the form and we will delete yours.
      </p>
      <h2 className="font-display text-base font-semibold text-zinc-900 mt-2">How it is stored</h2>
      <p>
        Data is stored in {SITE_NAME}&apos;s own Supabase-hosted database, readable only by site administrators, and
        in Google&apos;s systems for the GA4 portion. We do not sell any information to third parties.
      </p>
      <h2 className="font-display text-base font-semibold text-zinc-900 mt-2">Your choices</h2>
      <p>
        You can review or withdraw analytics/advertising consent at any time using the &quot;Cookie settings&quot;
        link in the footer of every page, which stops any future collection in the category you disable immediately.
        Because our first-party analytics is not linked to your name, email, or any account, we have no way to
        identify and delete one specific visitor&apos;s past records on request — withdrawing consent is the
        effective equivalent, since it prevents any future record from being connected to your prior visits.
      </p>
      <p>
        Questions about this policy, or a request to delete a message you sent us, can go through the{" "}
        <Link href="/contact" className="text-accent hover:underline">
          contact form
        </Link>
        .
      </p>
    </LegalPage>
  );
}
