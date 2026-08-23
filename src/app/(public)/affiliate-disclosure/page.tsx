import type { Metadata } from "next";
import Link from "next/link";
import { buildMetadata } from "@/lib/seo/metadata";
import { LegalPage } from "@/components/public/legal-page";
import { SITE_NAME } from "@/lib/seo/site";
import { AFFILIATE_DISCLOSURE_LABEL } from "@/lib/monetisation/affiliate";
import { EDITORIAL_PRACTICE } from "@/lib/seo/publisher";
import { getAffiliateStatus } from "@/lib/public/affiliate-status";

export const metadata: Metadata = buildMetadata({ title: "Affiliate Disclosure", path: "/affiliate-disclosure" });

// The old page was one sentence and it was accurate. What it lacked was any
// reason for a reader to believe it, and any protection against becoming false
// the moment somebody adds an affiliate offer in the admin UI.
//
// This version states the standing position AND shows the live count from the
// catalogue, so the page cannot quietly go stale. It also describes the
// labelling machinery that already exists in the code (OutboundLink /
// AFFILIATE_DISCLOSURE_LABEL), which is a checkable promise rather than an
// intention.
export default async function AffiliateDisclosurePage() {
  const status = await getAffiliateStatus();
  const checkRan = status.activeOffers !== null && status.affiliateOffers !== null;
  const hasAffiliateLinks = checkRan && status.affiliateOffers! > 0;

  return (
    <LegalPage
      title="Affiliate Disclosure"
      crumbLabel="Affiliate Disclosure"
      crumbPath="/affiliate-disclosure"
      // Not provisional: this is the complete, current position, and it is
      // checked against the catalogue every time the page is rendered.
      provisional={false}
    >
      <p>
        {/* Same constant the terms page and /about read from — see
            EDITORIAL_PRACTICE in src/lib/seo/publisher.ts. */}
        {EDITORIAL_PRACTICE.noAffiliate} No article, product entry, or recommendation on this site has been paid for,
        sponsored, supplied, or approved by a company.
      </p>

      <h2 className="font-display text-base font-semibold text-zinc-900 mt-4">Checked, not just asserted</h2>
      {hasAffiliateLinks ? (
        <p>
          Checked against the site&apos;s own catalogue as this page loaded: {status.affiliateOffers} of{" "}
          {status.activeOffers} retailer links on this site are affiliate links
          {status.affiliateRetailers.length > 0 && <> ({status.affiliateRetailers.join(", ")})</>}. The paragraph above
          is out of date and should be corrected.
        </p>
      ) : checkRan && status.activeOffers === 0 ? (
        <p>
          Checked against the site&apos;s own catalogue as this page loaded: there are no retailer or
          &ldquo;where to buy&rdquo; links anywhere on {SITE_NAME} at all — affiliate or otherwise. The only outbound
          links on the site go to manufacturers&apos; own pages and to the sources cited in articles, and neither pays
          anything.
        </p>
      ) : checkRan ? (
        <p>
          Checked against the site&apos;s own catalogue as this page loaded: {status.activeOffers} retailer links exist
          on this site and none of them is an affiliate link.
        </p>
      ) : (
        <p>
          The live check against the catalogue could not run when this page loaded, so no count is shown rather than a
          count that might be wrong. The statement above stands.
        </p>
      )}

      <h2 className="font-display text-base font-semibold text-zinc-900 mt-4">If that ever changes</h2>
      <p>
        The mechanism for disclosing an affiliate link is already built and is not optional: every link the site marks
        as an affiliate link renders the words &ldquo;{AFFILIATE_DISCLOSURE_LABEL}&rdquo; beside it, in the text, at
        the point you would click it — not in a banner at the top of the page or a line in the footer — and carries
        <code className="text-sm"> rel=&quot;sponsored&quot;</code> so search engines are told the same thing. A link
        that is being set up but is not yet live is never shown as an affiliate link. This page will name the programmes
        involved before any such link goes live, and the count above will change on its own.
      </p>

      <h2 className="font-display text-base font-semibold text-zinc-900 mt-4">Advertising</h2>
      <p>
        {SITE_NAME} has a Google AdSense account, and the AdSense library loads only if you grant advertising consent.
        There are currently no ad placements anywhere on the site. Advertising, if it appears, is sold by Google and
        never buys anyone editorial coverage or influence over what is published here. See the{" "}
        <Link href="/cookies" className="text-accent hover:underline">
          cookie policy
        </Link>{" "}
        for what that consent controls.
      </p>

      <h2 className="font-display text-base font-semibold text-zinc-900 mt-4">Independence</h2>
      <p>
        {SITE_NAME} does not receive review units, loaner hardware, or press samples, and does not publish hands-on
        testing of any kind — the{" "}
        <Link href="/editorial-policy" className="text-accent hover:underline">
          editorial policy
        </Link>{" "}
        says so in its own words and lists what the site does instead. If any of that changes, the piece it affects
        will say so on the page, not only here.
      </p>
    </LegalPage>
  );
}
