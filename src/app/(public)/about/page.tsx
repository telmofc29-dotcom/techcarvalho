import type { Metadata } from "next";
import Link from "next/link";
import { buildMetadata } from "@/lib/seo/metadata";
import { Breadcrumbs } from "@/components/public/breadcrumbs";
import { SITE_NAME, SITE_TAGLINE } from "@/lib/seo/site";

export const metadata: Metadata = buildMetadata({ title: "About", path: "/about" });

export default function AboutPage() {
  return (
    <div className="mx-auto max-w-2xl px-6 py-16">
      <Breadcrumbs items={[{ name: "Home", path: "/" }, { name: "About", path: "/about" }]} />
      <h1 className="font-display text-2xl font-bold text-zinc-900 mb-6">About {SITE_NAME}</h1>
      <div className="prose text-base leading-relaxed text-zinc-700 flex flex-col gap-4">
        <p>
          {SITE_NAME} — {SITE_TAGLINE} — is a technology publication and product database covering cameras and
          photography, astrophotography, drones and FPV, action cameras, computing, networking, and gaming, with
          more subject areas planned.
        </p>
        <p>
          The site pairs a structured product catalogue (specifications, generations, relationships between
          products) with editorial content — reviews, guides, comparisons, and news — built on real sourcing rather
          than guesswork. See our{" "}
          <Link href="/editorial-policy" className="text-accent hover:underline">
            editorial policy
          </Link>{" "}
          for how facts are verified and how affiliate relationships are disclosed.
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
