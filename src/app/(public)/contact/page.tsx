import type { Metadata } from "next";
import Link from "next/link";
import { buildMetadata } from "@/lib/seo/metadata";
import { Breadcrumbs } from "@/components/public/breadcrumbs";
import { SITE_NAME } from "@/lib/seo/site";

export const metadata: Metadata = buildMetadata({ title: "Contact", path: "/contact" });

export default function ContactPage() {
  return (
    <div className="mx-auto max-w-2xl px-6 py-16">
      <Breadcrumbs items={[{ name: "Home", path: "/" }, { name: "Contact", path: "/contact" }]} />
      <h1 className="font-display text-2xl font-bold text-zinc-900 mb-6">Contact</h1>
      <div className="prose text-base leading-relaxed text-zinc-700 flex flex-col gap-4">
        <p>
          {SITE_NAME} does not yet have a monitored contact address or contact form set up — this page will be
          updated with a real way to reach the editorial team as soon as one exists, rather than publishing an
          inbox that isn&apos;t actually checked.
        </p>
        <p>
          For corrections, sourcing questions, or anything else related to a specific piece of content, see that
          page&apos;s sourcing information and our{" "}
          <Link href="/editorial-policy" className="text-accent hover:underline">
            editorial policy
          </Link>
          .
        </p>
      </div>
    </div>
  );
}
