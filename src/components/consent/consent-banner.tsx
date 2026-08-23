"use client";

import { useEffect, useId, useRef, useState } from "react";
import Link from "next/link";
import { useConsent, type ConsentCategory, type ConsentState } from "@/lib/consent/consent-context";
import { TOUCH_INLINE } from "@/components/shared/ui";

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
//
// SIZE IS A UX REQUIREMENT HERE, NOT A COSMETIC ONE. This is fixed to the
// bottom of a 568px-tall viewport on the smallest phones still in use; at
// 320px wide the previous layout occupied 317px (56%) of it, which left
// 186px of readable page under the 65px sticky header — a first-time
// visitor on /articles saw no content at all. The rules that keep that from
// coming back:
//   - one short paragraph, three buttons on ONE row at every width;
//   - the three buttons are the same size and share one grid track, so
//     Reject is never made smaller, greyer or harder to hit than Accept
//     (a dark pattern, and unlawful under GDPR/EDPB guidance);
//   - the visible short labels are prefixes of their aria-labels, which
//     satisfies WCAG 2.5.3 Label in Name while fitting a 320px row;
//   - `min-h-11` (44px) on every button — the policy links stay inline in
//     the sentence (WCAG 2.5.8's inline exception) with vertical padding
//     that grows the hit box without changing the line box.
// The consent VALUES and when they are written are untouched: every button
// still calls the same acceptAll/rejectAll/setConsent from
// consent-context.tsx and nothing here reads or writes storage itself.

const BUTTON_BASE =
  "inline-flex min-h-11 items-center justify-center rounded-full px-2 text-center text-sm leading-tight sm:px-4 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-zinc-900";
// CHOICE buttons — reject and accept. Deliberately the SAME class, so the
// two opposing answers are identical in size, weight, colour and contrast.
// Do not give accept a filled treatment "for hierarchy": under EDPB/CNIL
// guidance the rejection path must be as easy and as prominent as the
// acceptance path, and a filled-vs-outlined pair is the exact pattern
// regulators cite when they find otherwise.
const BUTTON_CHOICE = `${BUTTON_BASE} border-2 border-zinc-900 bg-white font-semibold text-zinc-900 hover:bg-zinc-100`;
// The route to the per-category panel — a different kind of action, not a
// third answer, so it is allowed (and helpful) to read as secondary.
const BUTTON_SECONDARY = `${BUTTON_BASE} border border-zinc-300 font-medium text-zinc-600 hover:bg-zinc-50`;
// Inline policy links. The earlier `-my-1 py-1` trick got these to 26px —
// better than the original 18px, still short of the project's 44px standard,
// because padding-derived height is a function of the inherited line-height
// and this paragraph is text-sm/leading-snug. TOUCH_INLINE replaces it with a
// fixed 44px ::before overlay, which does not depend on type size and does
// not touch the line box, so the sentence still reads as one sentence.
// These are consent controls in a control surface, not body prose, so the
// WCAG 2.5.8 inline-text exemption is not being leaned on here.
const INLINE_LINK = `${TOUCH_INLINE} rounded underline hover:text-zinc-900`;

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
      className="fixed inset-x-0 bottom-0 z-50 border-t border-zinc-200 bg-white px-4 py-3 shadow-[0_-4px_16px_rgba(0,0,0,0.08)] sm:px-6 sm:py-4"
    >
      <div className="mx-auto flex max-w-5xl flex-col gap-3 sm:flex-row sm:items-center sm:justify-between sm:gap-6">
        <div className="max-w-2xl">
          <h2 id="consent-banner-heading" className="font-display text-sm font-semibold text-zinc-900">
            Your privacy choices
          </h2>
          {/* One sentence, not three. It still names what is used without
              consent (essential), what is not (analytics), and links both
              policies — the legally load-bearing parts — in the space the
              old three-line version spent restating them. */}
          <p className="mt-0.5 text-sm leading-snug text-zinc-500">
            Essential cookies keep this site running. Analytics cookies are used only if you accept.{" "}
            <Link href="/cookies" className={INLINE_LINK}>
              Cookie Policy
            </Link>
            {" · "}
            <Link href="/privacy" className={INLINE_LINK}>
              Privacy Policy
            </Link>
          </p>
        </div>
        {/* Equal thirds: identical width, height and weight for reject and
            accept, with manage between them. Never collapse this to a
            "prominent Accept, small Reject" arrangement. */}
        <div className="grid shrink-0 grid-cols-3 gap-2 sm:flex sm:gap-3">
          <button type="button" onClick={rejectAll} aria-label="Reject non-essential cookies" className={BUTTON_CHOICE}>
            Reject
          </button>
          <button
            type="button"
            onClick={openPreferences}
            aria-label="Manage cookie preferences"
            className={BUTTON_SECONDARY}
          >
            Manage
          </button>
          <button type="button" onClick={acceptAll} aria-label="Accept all cookies" className={BUTTON_CHOICE}>
            Accept
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
    <div className="fixed inset-0 z-50 flex items-end justify-center bg-black/30 px-3 pb-3 sm:items-center sm:px-4 sm:pb-0">
      <div
        ref={panelRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby={headingId}
        tabIndex={-1}
        className="flex max-h-[85vh] w-full max-w-lg flex-col gap-4 overflow-y-auto rounded-2xl bg-white p-4 shadow-xl focus:outline-none sm:gap-5 sm:p-6"
      >
        <div className="flex items-start justify-between gap-3">
          <h2 id={headingId} className="font-display text-base font-semibold text-zinc-900">
            Manage your privacy preferences
          </h2>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close"
            // -m-2 pulls the 44px hit area back out of the layout so the
            // close control gains touch size without gaining visual weight.
            className="-m-2 flex h-11 w-11 shrink-0 items-center justify-center rounded-full text-zinc-400 hover:bg-zinc-100 hover:text-zinc-700 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-zinc-900"
          >
            <svg viewBox="0 0 20 20" className="h-5 w-5" fill="none" aria-hidden="true">
              <path d="M5 5l10 10M15 5L5 15" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
            </svg>
          </button>
        </div>

        <p className="text-sm text-zinc-500">
          Read our{" "}
          <Link href="/cookies" className={INLINE_LINK}>
            Cookie Policy
          </Link>{" "}
          for exactly what each category involves.
        </p>

        <div className="flex flex-col gap-1">
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

        {/* Same equal-prominence rule as the banner: reject, save and accept
            are one grid of identical buttons. */}
        <div className="grid grid-cols-3 gap-2 border-t border-zinc-100 pt-4 sm:flex sm:justify-end sm:gap-3">
          <button type="button" onClick={rejectAll} aria-label="Reject non-essential cookies" className={BUTTON_CHOICE}>
            Reject
          </button>
          <button type="button" onClick={() => setConsent(draft)} aria-label="Save preferences" className={BUTTON_CHOICE}>
            Save
          </button>
          <button type="button" onClick={acceptAll} aria-label="Accept all cookies" className={BUTTON_CHOICE}>
            Accept
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
    // The <label> wraps the checkbox, so the whole row — not the 16px box —
    // is the target; py-2 gives it a comfortably-over-44px height.
    <label className={`-mx-2 flex items-start gap-3 rounded-lg px-2 py-2 ${disabled ? "" : "cursor-pointer hover:bg-zinc-50"}`}>
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
