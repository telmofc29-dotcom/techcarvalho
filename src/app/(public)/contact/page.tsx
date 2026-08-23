import type { Metadata } from "next";
import Link from "next/link";
import { buildMetadata } from "@/lib/seo/metadata";
import { Breadcrumbs } from "@/components/public/breadcrumbs";
import { SITE_NAME } from "@/lib/seo/site";
import { PUBLISHER_NAME, PUBLISHER_ROLE } from "@/lib/seo/publisher";
import { ContactForm } from "./contact-form";
import { getContactAvailability } from "@/lib/contact/availability";

export const metadata: Metadata = buildMetadata({ title: "Contact", path: "/contact" });

// This page previously offered no contact method of any kind. It was honest
// about it — "does not yet have a monitored contact address or contact form set
// up ... rather than publishing an inbox that isn't actually checked" — which
// was the right call at the time and is no longer necessary: the form below
// writes to a real table an admin reads (/admin/messages).
//
// A form rather than a published address, deliberately. The alternative was
// printing the owner's personal email on a page in the sitemap, which is
// irreversible the moment it is crawled and scraped, and which cannot be
// rate-limited or filtered afterwards.
export default async function ContactPage() {
  const contact = await getContactAvailability();

  return (
    <div className="mx-auto max-w-2xl px-6 py-16">
      <Breadcrumbs items={[{ name: "Home", path: "/" }, { name: "Contact", path: "/contact" }]} />
      <h1 className="font-display text-2xl font-bold text-zinc-900 mb-6">Contact</h1>
      <div className="prose text-base leading-relaxed text-zinc-700 flex flex-col gap-4 mb-10">
        <p>
          Messages sent here go to {PUBLISHER_NAME}, {SITE_NAME}&apos;s {PUBLISHER_ROLE.toLowerCase()}. Corrections
          are the most useful thing you can send: if something on this site is wrong, it gets fixed on the page.
        </p>
        <p>
          {SITE_NAME} publishes no email address. That is not a way of avoiding contact — this form reaches the
          same person a published inbox would, and an address on a crawled page is one that cannot be taken back.
        </p>
      </div>

      {/* The form renders only when the backend it posts to actually exists.
          Until 20260825_contact_messages.sql is applied, a visitor would type a
          message, press send, and be told it could not be delivered — which is
          honest and still worse than the page saying plainly that there is no
          contact route yet. This makes deploying the code and applying the
          migration independent events, safe in either order. */}
      {contact.available ? (
        <ContactForm />
      ) : (
        <div className="rounded-xl border border-amber-200 bg-amber-50/60 px-5 py-4">
          <p className="text-sm leading-relaxed text-amber-900">
            The contact form is not accepting messages at the moment. Rather than take a message
            it cannot deliver, {SITE_NAME} would rather say so. Please try again shortly.
          </p>
        </div>
      )}

      <div className="prose mt-10 flex flex-col gap-4 border-t border-border-subtle pt-6 text-sm leading-relaxed text-zinc-600">
        <p>
          <strong className="font-semibold text-zinc-800">What happens to your message.</strong> Your name (if you
          give one), your email address, your message and the page you sent it from are stored in {SITE_NAME}&apos;s
          own database, readable only by the site&apos;s administrator. No IP address, browser fingerprint or
          analytics identifier is recorded with it, and it is never added to a mailing list or shared with anyone.
          See the{" "}
          <Link href="/privacy" className="text-accent hover:underline">
            privacy policy
          </Link>
          .
        </p>
        <p>
          <strong className="font-semibold text-zinc-800">Replies.</strong> There is no automatic acknowledgement
          and no guaranteed response time. This is a one-person publication and messages are read and answered by
          hand.
        </p>
        <p>
          <strong className="font-semibold text-zinc-800">Before you write about sourcing.</strong> How claims are
          researched, which pieces carry source lists and why some do not is set out in the{" "}
          <Link href="/editorial-policy" className="text-accent hover:underline">
            editorial policy
          </Link>
          .
        </p>
      </div>
    </div>
  );
}
