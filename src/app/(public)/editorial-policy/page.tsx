import type { Metadata } from "next";
import Link from "next/link";
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
        used to write it. Nothing is published as tested, reviewed, or sourced unless it genuinely is.
      </p>

      <h2 className="font-display text-lg font-semibold text-zinc-900 mt-6">Sources and verification</h2>
      <p>
        Where a piece cites specifications, pricing, or claims from a manufacturer or third party, that source is
        recorded internally alongside the content it supports. Product pages track when their details were last
        verified; articles carry the same freshness record. This is an internal editorial process, not something
        exposed as raw evidence to readers — but the intent is that every fact is traceable back to a source.
      </p>

      <h2 className="font-display text-lg font-semibold text-zinc-900 mt-6">Corrections</h2>
      <p>
        Articles are living documents: when a correction is needed, the piece is updated and its freshness record
        reflects the review. A formal, public-facing correction log has not been built yet — this page will be
        updated once one exists.
      </p>

      <h2 className="font-display text-lg font-semibold text-zinc-900 mt-6">Affiliate independence</h2>
      <p>
        Editorial judgments — what to review, what to recommend, how something is scored — are not influenced by
        whether a product link happens to be an affiliate link. See the{" "}
        <Link href="/affiliate-disclosure" className="text-accent hover:underline">
          Affiliate Disclosure
        </Link>{" "}
        page for current status.
      </p>

      <h2 className="font-display text-lg font-semibold text-zinc-900 mt-6">AI transparency</h2>
      <p>
        Some imagery may be AI-generated where noted; this is tracked per asset in the media system rather than
        left ambiguous. Article text is written and edited by people. If that changes for any specific piece, it
        will be disclosed on that piece.
      </p>

      <p className="mt-6">
        A complete, formal editorial standards document will be published here as the first content goes live.
      </p>
    </LegalPage>
  );
}
