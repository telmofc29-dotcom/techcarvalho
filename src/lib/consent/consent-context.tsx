"use client";

import { createContext, useContext, useMemo, useState, type ReactNode } from "react";

// Minimal consent-management stub. No real CMP is integrated yet — this
// exists so analytics/ad code has a single, real gate to check rather than
// firing unconditionally. Defaults to "not granted" until a CMP sets it.
export type ConsentCategory = "analytics" | "advertising";

export type ConsentState = Record<ConsentCategory, boolean>;

const DEFAULT_CONSENT: ConsentState = { analytics: false, advertising: false };

type ConsentContextValue = {
  consent: ConsentState;
  setConsent: (next: Partial<ConsentState>) => void;
};

const ConsentContext = createContext<ConsentContextValue | null>(null);

export function ConsentProvider({ children }: { children: ReactNode }) {
  const [consent, setConsentState] = useState<ConsentState>(DEFAULT_CONSENT);

  const value = useMemo<ConsentContextValue>(
    () => ({
      consent,
      setConsent: (next) => setConsentState((prev) => ({ ...prev, ...next })),
    }),
    [consent]
  );

  return <ConsentContext.Provider value={value}>{children}</ConsentContext.Provider>;
}

export function useConsent(): ConsentContextValue {
  const ctx = useContext(ConsentContext);
  if (!ctx) throw new Error("useConsent must be used within a ConsentProvider");
  return ctx;
}
