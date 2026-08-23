import type { Metadata } from "next";
import Link from "next/link";
import { TOUCH_INLINE } from "@/components/shared/ui";
import { buildMetadata } from "@/lib/seo/metadata";
import { Breadcrumbs } from "@/components/public/breadcrumbs";
import { SITE_NAME, SITE_TAGLINE } from "@/lib/seo/site";
import { PUBLISHER_NAME, PUBLISHER_ROLE, PUBLISHER_ROLE_LINE } from "@/lib/seo/publisher";
import { publisherPersonJsonLd, safeJsonLdString } from "@/lib/seo/jsonld";

export const metadata: Metadata = buildMetadata({ title: "About", path: "/about" });

export default function AboutPage() {
  return (
    <div className="mx-auto max-w-2xl px-6 py-16">
      {/* The Person node lives on the page whose subject IS the person, and
          links back to the one Organization node the layout already emits.
          Name, role, and the URL of this page — nothing else. No sameAs, no
          credentials, no expertise claim: none of that is known. */}
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{ __html: safeJsonLdString(publisherPersonJsonLd()) }}
      />
      <Breadcrumbs items={[{ name: "Home", path: "/" }, { name: "About", path: "/about" }]} />
      <h1 className="font-display text-2xl font-bold text-zinc-900 mb-6">About {SITE_NAME}</h1>
      <div className="prose text-base leading-relaxed text-zinc-700 flex flex-col gap-4">
        <p>
          {SITE_NAME} — {SITE_TAGLINE} — is a technology publication and product database covering cameras and
          photography, astrophotography, drones and FPV, action cameras, computing, networking, and gaming, with
          more subject areas planned.
        </p>
        <p>
          {/* "Reviews" was in this sentence and is now not. content_items has
              zero rows of type 'review' — the site advertised a format it does
              not publish, on the page a reader checks to find out what it
              publishes. The four named below are the four types that exist. */}
          The site pairs a structured product catalogue (specifications, generations, relationships between
          products) with editorial content — guides, comparisons, troubleshooting walkthroughs, and news. See our{" "}
          <Link href="/editorial-policy" className={`text-accent hover:underline ${TOUCH_INLINE}`}>
            editorial policy
          </Link>{" "}
          for how facts are verified, what the site deliberately does not do, and how automation is used.
        </p>

        <h2 className="font-display text-lg font-semibold text-zinc-900 mt-6">Who publishes this</h2>
        <p>{PUBLISHER_ROLE_LINE}</p>
        <p>
          This is a one-person publication: {PUBLISHER_NAME} is the {PUBLISHER_ROLE.toLowerCase()}, and there is no
          newsroom or staff behind it. If something here is wrong, he is the person who fixes it, and the{" "}
          <Link href="/contact" className={`text-accent hover:underline ${TOUCH_INLINE}`}>
            contact form
          </Link>{" "}
          reaches him directly.
        </p>

        <p>
          {SITE_NAME} is a new publication and is actively building out its catalogue and article library — the
          site will look sparser than an established outlet while that work is in progress. Nothing is published
          here to make the site look more complete than it is; empty sections mean exactly that.
        </p>
      </div>
    </div>
  );
}
