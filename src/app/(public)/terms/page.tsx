import type { Metadata } from "next";
import Link from "next/link";
import { buildMetadata } from "@/lib/seo/metadata";
import { LegalPage } from "@/components/public/legal-page";
import { SITE_NAME } from "@/lib/seo/site";
import { PUBLISHER_NAME, EDITORIAL_PRACTICE } from "@/lib/seo/publisher";

export const metadata: Metadata = buildMetadata({ title: "Terms of Use", path: "/terms" });

// This page was three sentences, one of which said the real terms would arrive
// later. It is now written to describe how this site actually operates, which
// is a much shorter job than a generic terms page because most of what such a
// page usually covers does not exist here: no accounts, no comments, no
// submissions, no subscriptions, no purchases, no affiliate links.
//
// What is deliberately NOT here: a governing-law or jurisdiction clause. That
// is a fact about the publisher, not about the codebase, and inventing one
// would be worse than omitting it. The owner should add it.
export default function TermsPage() {
  return (
    <LegalPage
      title="Terms of Use"
      crumbLabel="Terms"
      crumbPath="/terms"
      // Not provisional: it now describes the real terms on which this site is
      // published, including the parts that are simply absent.
      provisional={false}
    >
      <p>
        {SITE_NAME} is a technology publication and product database published by {PUBLISHER_NAME}. Reading it is
        free, needs no account, and these terms are the conditions on which it is offered.
      </p>

      <h2 className="font-display text-base font-semibold text-zinc-900 mt-4">What this site is, and is not</h2>
      <p>
        {/* One sentence, one source: EDITORIAL_PRACTICE is what /about, this
            page and the affiliate disclosure all read from, so the site cannot
            end up describing its own practice three slightly different ways. */}
        Everything here is general information. {EDITORIAL_PRACTICE.noTesting} Nothing on this site is written from
        having used the product — the{" "}
        <Link href="/editorial-policy" className="text-accent hover:underline">
          editorial policy
        </Link>{" "}
        sets out how pieces are researched instead. Specifications, prices, and availability are taken from
        manufacturer documentation and published reporting at the time of writing and change without notice. Nothing
        here is professional, financial, legal, or safety advice. Before you act on something that matters — a
        purchase, a compatibility question, anything involving warranty or safety — check it against the
        manufacturer&apos;s own current documentation.
      </p>

      <h2 className="font-display text-base font-semibold text-zinc-900 mt-4">No accounts, comments, or uploads</h2>
      <p>
        {EDITORIAL_PRACTICE.noUserContent} There is no way to upload anything here, and the{" "}
        <Link href="/contact" className="text-accent hover:underline">
          contact form
        </Link>{" "}
        is not a submission channel — do not send confidential material through it. If you send a correction or a suggestion and it leads to a change on the site, that change becomes
        part of the site and no payment is due for it; you keep the copyright in the words you wrote to us, and we do
        not publish them.
      </p>

      <h2 className="font-display text-base font-semibold text-zinc-900 mt-4">Using what is published here</h2>
      <p>
        The articles, product descriptions, and original diagrams on this site are the publisher&apos;s copyright. You
        may quote a short extract with a clear credit and a link back to the page it came from. You may not republish
        whole articles, or copy the product database, without permission — ask through the contact form.
      </p>
      <p>
        Photographs are a separate matter: most product photography here is licensed from third parties, chiefly
        Wikimedia Commons, and is credited to its photographer with a link to its licence on the page it appears on.
        Those images are governed by their own licences, not by these terms, and a credit on this site is not
        permission from us to reuse them.
      </p>

      <h2 className="font-display text-base font-semibold text-zinc-900 mt-4">Links to other sites</h2>
      <p>
        Links to manufacturers, standards bodies, and other publications are provided because they are useful or
        because they are the source of a claim. {SITE_NAME} does not control those sites and is not responsible for
        their content, their accuracy, or what they do with your data once you arrive. {SITE_NAME} earns nothing from
        any outbound link — see the{" "}
        <Link href="/affiliate-disclosure" className="text-accent hover:underline">
          affiliate disclosure
        </Link>
        .
      </p>

      <h2 className="font-display text-base font-semibold text-zinc-900 mt-4">
        Availability, accuracy, and getting things wrong
      </h2>
      <p>
        The site is offered as it is. There is no guarantee that it will be available, that every page will stay
        published, or that everything on it is correct. Articles are corrected in place when something is found to be
        wrong; there is no public correction log yet, and the editorial policy says so. If you find a mistake, the
        contact form is the fastest way to get it fixed. To the extent the law allows, {SITE_NAME} is not liable for
        loss arising from relying on what you read here.
      </p>

      <h2 className="font-display text-base font-semibold text-zinc-900 mt-4">Changes to these terms</h2>
      <p>
        These terms may be updated as the site changes — if reader accounts, comments, or affiliate links are ever
        added, this page will be rewritten before they go live rather than afterwards. There is no version history of
        this page; the version you are reading is the current one.
      </p>
    </LegalPage>
  );
}
