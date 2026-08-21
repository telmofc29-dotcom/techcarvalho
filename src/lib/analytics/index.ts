"use client";

// Central analytics abstraction. Every call is a no-op until
// NEXT_PUBLIC_GA_MEASUREMENT_ID is set AND analytics consent has been
// granted (see AnalyticsScripts, which only loads gtag under those same
// conditions) — so importing and calling this module is always safe, even
// with nothing configured yet.
//
// All event names/shapes come from the central taxonomy in ./events.ts —
// this file is deliberately just plumbing, not where new event types get
// invented.

import type { EventName, EventParams } from "./events";

declare global {
  interface Window {
    gtag?: (...args: unknown[]) => void;
    dataLayer?: unknown[];
  }
}

export const GA_MEASUREMENT_ID = process.env.NEXT_PUBLIC_GA_MEASUREMENT_ID;

export function isAnalyticsConfigured(): boolean {
  return Boolean(GA_MEASUREMENT_ID);
}

// Typed event tracking — the only supported way to send a custom event.
// Silently no-ops if gtag isn't loaded (not configured, or consent not
// granted yet), so call sites never need to guard this themselves.
export function track<N extends EventName>(name: N, params: EventParams<N>): void {
  if (typeof window === "undefined" || !window.gtag) return;
  window.gtag("event", name, params as Record<string, unknown>);
}

// Only used by the route-change listener in analytics-scripts.tsx — GA4's
// own gtag.js already sends an initial page_view on load, so this is
// exclusively for client-side (App Router) navigations, never called twice
// for the same navigation.
export function trackPageview(path: string): void {
  if (typeof window === "undefined" || !window.gtag || !GA_MEASUREMENT_ID) return;
  window.gtag("event", "page_view", { page_path: path });
}
