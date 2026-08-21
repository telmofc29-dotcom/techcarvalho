"use client";

import { createContext, useContext, useEffect, useMemo, useState, type ReactNode } from "react";

// Minimal, homemade consent-management implementation. This is NOT a
// certified CMP (Consent Management Platform) — Google AdSense/Ad Manager
// require an IAB-registered or Google-certified CMP for consent signals to
// be trusted for ad personalization in the UK/EEA. This exists so
// analytics/ad code has a single, real gate to check now, and can be swapped
// for a certified CMP's own consent API later without touching call sites
// (they all go through useConsent()/track(), not gtag directly).
//
// Three categories, matching what's actually distinguishable here:
// - "necessary": not togglable, not really "consent" in the GDPR sense —
//   the admin auth session cookie is strictly necessary for the admin app
//   to function and is exempt from consent requirements under PECR/GDPR.
//   Included only so calling code has one consistent shape to check.
// - "analytics": gates GA4 (analytics_storage in Consent Mode terms).
// - "advertising": gates any future ad network (ad_storage/ad_user_data/
//   ad_personalization in Consent Mode terms).
export type ConsentCategory = "analytics" | "advertising";
export type ConsentState = Record<ConsentCategory, boolean> & { necessary: true };

const DEFAULT_CONSENT: ConsentState = { necessary: true, analytics: false, advertising: false };
const STORAGE_KEY = "tc-consent";

type ConsentContextValue = {
  consent: ConsentState;
  hasChosen: boolean;
  setConsent: (next: Partial<Record<ConsentCategory, boolean>>) => void;
  acceptAll: () => void;
  rejectAll: () => void;
  // Lets a control anywhere in the tree (the footer's permanent "Cookie
  // settings" link, in particular — see site-footer.tsx) reopen the
  // preferences panel on demand, independent of hasChosen. ConsentBanner
  // renders the initial prompt when !hasChosen, the full manage-preferences
  // panel when isPreferencesOpen, and nothing otherwise.
  isPreferencesOpen: boolean;
  openPreferences: () => void;
  closePreferences: () => void;
};

const ConsentContext = createContext<ConsentContextValue | null>(null);

function applyConsentModeSignal(consent: ConsentState) {
  if (typeof window === "undefined" || !window.gtag) return;
  // Google Consent Mode v2 signal names — sent regardless of whether GA is
  // actually loaded yet, since Consent Mode is designed to be called before
  // gtag.js loads (see analytics-scripts.tsx, which sets the same "denied"
  // default synchronously before the GA script tag is even injected).
  window.gtag("consent", "update", {
    analytics_storage: consent.analytics ? "granted" : "denied",
    ad_storage: consent.advertising ? "granted" : "denied",
    ad_user_data: consent.advertising ? "granted" : "denied",
    ad_personalization: consent.advertising ? "granted" : "denied",
  });
}

export function ConsentProvider({ children }: { children: ReactNode }) {
  const [consent, setConsentState] = useState<ConsentState>(DEFAULT_CONSENT);
  const [hasChosen, setHasChosen] = useState(false);
  const [isPreferencesOpen, setIsPreferencesOpen] = useState(false);

  useEffect(() => {
    // Deliberately not read during the initial render/lazy useState
    // initializer: localStorage is unavailable during SSR, and reading it
    // synchronously on the client's first render (before hydration
    // reconciles against the server HTML) would make that first render
    // diverge from what the server sent — a real hydration mismatch, since
    // AnalyticsScripts conditionally renders <Script> tags based on this
    // state. Starting from the SSR-safe default and updating only after
    // mount (this effect) is the correct, standard fix, not a bypassable
    // lint smell — hence the disable below.
    try {
      const stored = window.localStorage.getItem(STORAGE_KEY);
      if (stored) {
        const parsed = JSON.parse(stored) as Partial<Record<ConsentCategory, boolean>>;
        // eslint-disable-next-line react-hooks/set-state-in-effect
        setConsentState({ necessary: true, analytics: Boolean(parsed.analytics), advertising: Boolean(parsed.advertising) });
        setHasChosen(true);
      }
    } catch {
      // Corrupt/inaccessible storage — fall back to the default (nothing
      // granted), never fail open.
    }
  }, []);

  useEffect(() => {
    applyConsentModeSignal(consent);
  }, [consent]);

  const persist = (next: ConsentState) => {
    setConsentState(next);
    setHasChosen(true);
    setIsPreferencesOpen(false);
    try {
      window.localStorage.setItem(STORAGE_KEY, JSON.stringify(next));
    } catch {
      // If storage is unavailable, consent just doesn't persist across
      // reloads — not a functional failure, the in-memory state still
      // governs this session correctly.
    }
  };

  const value = useMemo<ConsentContextValue>(
    () => ({
      consent,
      hasChosen,
      setConsent: (next) => persist({ ...consent, ...next, necessary: true }),
      acceptAll: () => persist({ necessary: true, analytics: true, advertising: true }),
      rejectAll: () => persist({ necessary: true, analytics: false, advertising: false }),
      isPreferencesOpen,
      openPreferences: () => setIsPreferencesOpen(true),
      closePreferences: () => setIsPreferencesOpen(false),
    }),
    [consent, hasChosen, isPreferencesOpen]
  );

  return <ConsentContext.Provider value={value}>{children}</ConsentContext.Provider>;
}

export function useConsent(): ConsentContextValue {
  const ctx = useContext(ConsentContext);
  if (!ctx) throw new Error("useConsent must be used within a ConsentProvider");
  return ctx;
}

// Raw, non-hook read of the same persisted value ConsentProvider itself
// reads — for the handful of call sites (the first-party event dispatcher
// in particular) that need a consent check from plain functions, not React
// components, and therefore can't call useConsent(). Deliberately reuses
// this file's own STORAGE_KEY/shape rather than duplicating either, so the
// two can never drift out of sync. Fails closed (false) on any error,
// exactly like ConsentProvider's own read does.
export function hasAnalyticsConsent(): boolean {
  if (typeof window === "undefined") return false;
  try {
    const stored = window.localStorage.getItem(STORAGE_KEY);
    if (!stored) return false;
    const parsed = JSON.parse(stored) as Partial<Record<ConsentCategory, boolean>>;
    return Boolean(parsed.analytics);
  } catch {
    return false;
  }
}
