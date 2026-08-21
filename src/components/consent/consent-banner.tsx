"use client";

import { useEffect, useId, useRef, useState } from "react";
import Link from "next/link";
import { useConsent, type ConsentCategory, type ConsentState } from "@/lib/consent/consent-context";

// Homemade consent banner — the UI half of the consent foundation described
// in consent-context.tsx. Not a certified CMP; see that file's header for
// why that distinction matters and what it's not yet suitable for
// (trusted ad-personalization signals for AdSense/Ad Manager in UK/EEA).
//
// Two distinct surfaces sharing one component, matched to the two ways a
// visitor reaches this: the simple accept/reject/manage prompt on first
// visit (`!hasChosen`), and the full per-category panel reopened later via
// the footer's permanent "Cookie settings" control (`isPreferencesOpen`) —
// see site-footer.tsx. `hasChosen` starts false on both the server render
// and the client's first render (see consent-context.tsx), so the initial
// prompt is present in the server HTML and only disappears once the
// post-mount effect confirms a prior choice was stored — a brief flash for
// returning visitors is the accepted trade-off of doing this without a
// cookie-based SSR read.
export function ConsentBanner() {
  const { consent, hasChosen, acceptAll, rejectAll, isPreferencesOpen, openPreferences, closePreferences } =
    useConsent();

  const showPanel = isPreferencesOpen;
  const showInitialPrompt = !hasChosen && !isPreferencesOpen;

  if (!showInitialPrompt && !showPanel) return null;

  if (showPanel) {
    // ConsentBanner returns null while closed, so PreferencesPanel fully
    // unmounts on close and mounts fresh each time it reopens — its draft
    // toggles (lazy useState(() => ...) below) always start from the real,
    // currently-saved consent state this way, without an effect that would
    // otherwise need to call setState synchronously on every render where
    // the panel is visible.
    return <PreferencesPanel consent={consent} onClose={closePreferences} />;
  }

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
        <div className="flex shrink-0 flex-wrap gap-3">
          <button
            type="button"
            onClick={rejectAll}
            className="rounded-full border border-zinc-300 px-4 py-2 text-sm font-medium text-zinc-700 hover:bg-zinc-50 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-zinc-900"
          >
            Reject non-essential
          </button>
          <button
            type="button"
            onClick={openPreferences}
            className="rounded-full border border-zinc-300 px-4 py-2 text-sm font-medium text-zinc-700 hover:bg-zinc-50 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-zinc-900"
          >
            Manage preferences
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

function PreferencesPanel({ consent, onClose }: { consent: ConsentState; onClose: () => void }) {
  const { acceptAll, rejectAll, setConsent } = useConsent();
  // Lazy initial state, read once at mount — this component is remounted
  // fresh (via the `key` in ConsentBanner above) every time the panel
  // opens, so this always reflects what's actually saved, without an
  // effect syncing state after the fact.
  const [draft, setDraft] = useState<Record<ConsentCategory, boolean>>(() => ({
    analytics: consent.analytics,
    advertising: consent.advertising,
  }));
  const panelRef = useRef<HTMLDivElement>(null);
  const headingId = useId();

  // Focus the panel on mount (i.e. every time it opens) — the commonly-missed
  // half of dialog accessibility for a dialog that can appear at an
  // arbitrary point in a page's lifecycle, not just on load.
  useEffect(() => {
    panelRef.current?.focus();
  }, []);

  useEffect(() => {
    function onKeyDown(e: KeyboardEvent) {
      if (e.key === "Escape") onClose();
    }
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [onClose]);

  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center bg-black/30 px-4 pb-4 sm:items-center sm:pb-0">
      <div
        ref={panelRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby={headingId}
        tabIndex={-1}
        className="flex max-h-[85vh] w-full max-w-lg flex-col gap-5 overflow-y-auto rounded-2xl bg-white p-6 shadow-xl focus:outline-none"
      >
        <div className="flex items-start justify-between gap-4">
          <h2 id={headingId} className="font-display text-base font-semibold text-zinc-900">
            Manage your privacy preferences
          </h2>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close"
            className="shrink-0 rounded-full p-1 text-zinc-400 hover:bg-zinc-100 hover:text-zinc-700 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-zinc-900"
          >
            <svg viewBox="0 0 20 20" className="h-5 w-5" fill="none" aria-hidden="true">
              <path d="M5 5l10 10M15 5L5 15" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
            </svg>
          </button>
        </div>

        <p className="text-sm text-zinc-500">
          Read our{" "}
          <Link href="/cookies" className="underline hover:text-zinc-900">
            Cookie Policy
          </Link>{" "}
          for exactly what each category involves.
        </p>

        <div className="flex flex-col gap-4">
          <CategoryRow
            title="Essential"
            description="Required for the site and admin sign-in to function. Always on."
            checked
            disabled
          />
          <CategoryRow
            title="Analytics"
            description="Helps us understand which pages and content are actually useful, via Google Analytics and TechCarvalho's own first-party analytics."
            checked={draft.analytics}
            onChange={(v) => setDraft((d) => ({ ...d, analytics: v }))}
          />
          <CategoryRow
            title="Advertising / Marketing"
            description="Lets Google verify our AdSense account. No individual ad placements are live on the site yet."
            checked={draft.advertising}
            onChange={(v) => setDraft((d) => ({ ...d, advertising: v }))}
          />
        </div>

        <div className="flex flex-col gap-2 border-t border-zinc-100 pt-4 sm:flex-row sm:justify-end">
          <button
            type="button"
            onClick={rejectAll}
            className="rounded-full border border-zinc-300 px-4 py-2 text-sm font-medium text-zinc-700 hover:bg-zinc-50 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-zinc-900"
          >
            Reject non-essential
          </button>
          <button
            type="button"
            onClick={() => setConsent(draft)}
            className="rounded-full border border-zinc-300 px-4 py-2 text-sm font-medium text-zinc-700 hover:bg-zinc-50 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-zinc-900"
          >
            Save preferences
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

function CategoryRow({
  title,
  description,
  checked,
  disabled,
  onChange,
}: {
  title: string;
  description: string;
  checked: boolean;
  disabled?: boolean;
  onChange?: (value: boolean) => void;
}) {
  return (
    <label className={`flex items-start gap-3 ${disabled ? "" : "cursor-pointer"}`}>
      <input
        type="checkbox"
        checked={checked}
        disabled={disabled}
        onChange={(e) => onChange?.(e.target.checked)}
        className="mt-0.5 h-4 w-4 shrink-0 rounded border-zinc-300 text-zinc-900 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-zinc-900 disabled:opacity-60"
      />
      <span>
        <span className="block text-sm font-medium text-zinc-900">{title}</span>
        <span className="block text-xs text-zinc-500">{description}</span>
      </span>
    </label>
  );
}
