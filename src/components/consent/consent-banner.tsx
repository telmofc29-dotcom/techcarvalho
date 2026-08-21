"use client";

import Link from "next/link";
import { useConsent } from "@/lib/consent/consent-context";

// Homemade consent banner — the UI half of the consent foundation described
// in consent-context.tsx. Not a certified CMP; see that file's header for
// why that distinction matters and what it's not yet suitable for
// (trusted ad-personalization signals for AdSense/Ad Manager in UK/EEA).
//
// `hasChosen` starts false on both the server render and the client's first
// render (see consent-context.tsx), so this banner is present in the
// initial HTML and only disappears once the post-mount effect confirms a
// prior choice was stored — a brief flash for returning visitors is the
// accepted trade-off of doing this without a cookie-based SSR read.
export function ConsentBanner() {
  const { hasChosen, acceptAll, rejectAll } = useConsent();

  if (hasChosen) return null;

  return (
    <div
      role="dialog"
      aria-modal="false"
      aria-labelledby="consent-banner-heading"
      className="fixed inset-x-0 bottom-0 z-50 border-t border-zinc-200 bg-white px-6 py-5 shadow-[0_-4px_16px_rgba(0,0,0,0.08)]"
    >
      <div className="mx-auto flex max-w-5xl flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
        <div className="max-w-2xl">
          <h2 id="consent-banner-heading" className="font-display text-sm font-semibold text-zinc-900">
            Your privacy choices
          </h2>
          <p className="mt-1 text-sm text-zinc-500">
            We use essential cookies to run this site. With your consent we&apos;d also like to use analytics to
            understand how the site is used. Read our{" "}
            <Link href="/cookies" className="underline hover:text-zinc-900">
              Cookie Policy
            </Link>{" "}
            or{" "}
            <Link href="/privacy" className="underline hover:text-zinc-900">
              Privacy Policy
            </Link>
            .
          </p>
        </div>
        <div className="flex shrink-0 gap-3">
          <button
            type="button"
            onClick={rejectAll}
            className="rounded-full border border-zinc-300 px-4 py-2 text-sm font-medium text-zinc-700 hover:bg-zinc-50 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-zinc-900"
          >
            Reject non-essential
          </button>
          <button
            type="button"
            onClick={acceptAll}
            className="rounded-full bg-zinc-900 px-4 py-2 text-sm font-medium text-white hover:bg-zinc-700 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-zinc-900"
          >
            Accept all
          </button>
        </div>
      </div>
    </div>
  );
}
