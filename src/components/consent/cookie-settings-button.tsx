"use client";

import { useConsent } from "@/lib/consent/consent-context";

// The permanent way to reopen the consent preferences panel after the
// initial choice — lives in the footer (site-footer.tsx) on every page, so
// a visitor is never asked again on every page load (persisted via
// consent-context.tsx) but can always change their mind. A <button>, not a
// <Link>, since it doesn't navigate — it opens ConsentBanner's
// manage-preferences panel in place.
export function CookieSettingsButton() {
  const { openPreferences } = useConsent();
  return (
    <button
      type="button"
      onClick={openPreferences}
      className="text-sm text-zinc-600 hover:text-accent text-left"
    >
      Cookie settings
    </button>
  );
}
