import type { Metadata } from "next";
import { buildMetadata } from "@/lib/seo/metadata";
import { LegalPage } from "@/components/public/legal-page";
import { SITE_NAME } from "@/lib/seo/site";

export const metadata: Metadata = buildMetadata({ title: "Cookie Policy", path: "/cookies" });

export default function CookiesPage() {
  return (
    <LegalPage
      title="Cookie Policy"
      crumbLabel="Cookies"
      crumbPath="/cookies"
      // Not provisional. This page names the actual storage mechanisms
      // category by category — the admin session cookie, GA4's own cookies,
      // the sessionStorage session id and the localStorage visitor id, and the
      // consent-independent outbound click counter. That is a finished
      // description of real behaviour, and the placeholder banner was untrue
      // of it. See the note on /privacy for why the banner mattered.
      provisional={false}
    >
      <p>
        {SITE_NAME} uses a small number of cookies and similar browser storage. Some are required for the site to
        function; others are only used after you grant consent through the consent banner. You can change your
        choice at any time using the &quot;Cookie settings&quot; link in the footer of every page, which lets you
        review and adjust each category individually.
      </p>
      <h2 className="font-display text-base font-semibold text-zinc-900 mt-2">Strictly necessary</h2>
      <p>
        A session cookie is used to keep an administrator signed in to the {SITE_NAME} admin area. This is required
        for the admin app to work and is exempt from consent requirements — it is never set for ordinary visitors
        browsing the public site.
      </p>
      <h2 className="font-display text-base font-semibold text-zinc-900 mt-2">Analytics — only after consent</h2>
      <p>
        With your consent, {SITE_NAME} uses Google Analytics (GA4), which sets its own cookies, and its own
        first-party analytics: a random session identifier stored in your browser&apos;s <em>session storage</em>{" "}
        (cleared automatically when you close the tab or after 30 minutes of inactivity) and a random visitor
        identifier stored in <em>local storage</em> (kept until you clear it) so we can distinguish new and
        returning visits. Neither identifier is linked to your name, email, or any account, and neither is ever
        shared outside {SITE_NAME}&apos;s own database except with Google for the GA4 portion. We do not store your
        IP address or full browser user-agent string for analytics purposes.
      </p>
      <p>
        Separately, when you click a link that leaves the site — today that means a manufacturer&apos;s own page; it
        would also cover a retailer link if one were ever added — we record that a click happened (which page, which
        destination) without any visitor or session identifier attached at all. This anonymous count exists regardless
        of your cookie choice, since it cannot be linked to you or your browsing across the site.
      </p>
      <h2 className="font-display text-base font-semibold text-zinc-900 mt-2">Advertising — only after consent</h2>
      <p>
        With your consent, the Google AdSense library loads so {SITE_NAME}&apos;s advertising account can be
        verified. No individual ad placements are live on the site yet.
      </p>
    </LegalPage>
  );
}
