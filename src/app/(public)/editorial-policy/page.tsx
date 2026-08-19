import type { Metadata } from "next";
import { buildMetadata } from "@/lib/seo/metadata";
import { LegalPage } from "@/components/public/legal-page";
import { SITE_NAME } from "@/lib/seo/site";

export const metadata: Metadata = buildMetadata({ title: "Editorial Policy", path: "/editorial-policy" });

export default function EditorialPolicyPage() {
  return (
    <LegalPage title="Editorial Policy" crumbLabel="Editorial Policy" crumbPath="/editorial-policy">
      <p>
        {SITE_NAME}&apos;s content is built around real testing, sourcing, and freshness records — every review
        or guide is expected to carry evidence and cited sources before publication, tracked in the same system
        used to write it.
      </p>
      <p>
        Nothing is published as tested, reviewed, or sourced unless it genuinely is. A complete editorial
        standards document will be published here as the first content goes live.
      </p>
    </LegalPage>
  );
}
