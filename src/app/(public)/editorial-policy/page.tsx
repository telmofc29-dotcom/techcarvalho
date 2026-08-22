import type { Metadata } from "next";
import Link from "next/link";
import { buildMetadata } from "@/lib/seo/metadata";
import { LegalPage } from "@/components/public/legal-page";
import { SITE_NAME } from "@/lib/seo/site";

export const metadata: Metadata = buildMetadata({ title: "Editorial Policy", path: "/editorial-policy" });

export default function EditorialPolicyPage() {
  return (
    <LegalPage
      title="Editorial Policy"
      crumbLabel="Editorial Policy"
      crumbPath="/editorial-policy"
      // Not provisional: this page now describes what the site actually does,
      // including the parts that are absent. A page that is honest about its
      // gaps is finished, not a placeholder.
      provisional={false}
    >
      <p>
        This page describes how {SITE_NAME} actually works today, not how it is intended to work
        eventually. Where something is not yet in place, it says so.
      </p>

      <h2 className="font-display text-lg font-semibold text-zinc-900 mt-6">
        We do not test hardware
      </h2>
      <p>
        {SITE_NAME} does not currently publish hands-on reviews, benchmarks, or test results. Nothing
        on this site is written from having used the product. Articles are researched from
        manufacturer documentation, technical standards, and published reporting, and they are
        written to explain rather than to rate. If first-hand testing is ever part of a piece, that
        piece will say so explicitly and will show what was tested.
      </p>

      <h2 className="font-display text-lg font-semibold text-zinc-900 mt-6">How pieces are produced</h2>
      <p>
        Research and drafting are assisted by automated systems that gather candidate stories from a
        registry of sources and record where each claim came from. Nothing is published
        automatically: a person reviews and publishes every piece, and automated publishing is
        switched off at the level of the database rather than by a setting. Article text is edited by
        a person before it goes live.
      </p>

      <h2 className="font-display text-lg font-semibold text-zinc-900 mt-6">Sources</h2>
      <p>
        Where an article cites specifications, standards, or claims from a manufacturer or third
        party, those sources are recorded and listed at the foot of the article. Coverage is not
        uniform: some explanatory pieces are written from public standards documentation and carry no
        source list, and an article with nothing listed is showing you exactly that rather than
        implying sources it does not have.
      </p>

      <h2 className="font-display text-lg font-semibold text-zinc-900 mt-6">Corrections</h2>
      <p>
        Articles are updated in place when something is wrong or has changed. There is no public
        correction log yet, and no article on this site has been through a formal re-verification
        review — that process exists in the system but has not yet been used. This paragraph will be
        replaced when that changes.
      </p>

      <h2 className="font-display text-lg font-semibold text-zinc-900 mt-6">Images</h2>
      <p>
        Most illustrations on this site are original diagrams and title graphics made by{" "}
        {SITE_NAME}. Photographs of products are, at present, freely licensed images from Wikimedia
        Commons, credited to their photographer with a link to the licence. Any asset that was
        generated rather than photographed is recorded as generated, and a generated image is never
        presented as a photograph of a real product, a screenshot, or evidence of a test.
      </p>

      <h2 className="font-display text-lg font-semibold text-zinc-900 mt-6">Affiliate independence</h2>
      <p>
        Editorial judgments are not influenced by whether a product link happens to be an affiliate
        link. See the{" "}
        <Link href="/affiliate-disclosure" className="text-accent hover:underline">
          Affiliate Disclosure
        </Link>{" "}
        page for current status.
      </p>

    </LegalPage>
  );
}
