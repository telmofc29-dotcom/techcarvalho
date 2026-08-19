"use client";

// Central analytics abstraction. Every call is a no-op until
// NEXT_PUBLIC_GA_MEASUREMENT_ID is set and consent has been granted (see
// AnalyticsScripts, which only loads gtag under those same conditions) — so
// importing this module is always safe, even with no analytics configured.

declare global {
  interface Window {
    gtag?: (...args: unknown[]) => void;
  }
}

export const GA_MEASUREMENT_ID = process.env.NEXT_PUBLIC_GA_MEASUREMENT_ID;

export function isAnalyticsConfigured(): boolean {
  return Boolean(GA_MEASUREMENT_ID);
}

export function trackEvent(name: string, params?: Record<string, unknown>): void {
  if (typeof window === "undefined" || !window.gtag) return;
  window.gtag("event", name, params);
}

export function trackPageview(path: string): void {
  if (typeof window === "undefined" || !window.gtag || !GA_MEASUREMENT_ID) return;
  window.gtag("config", GA_MEASUREMENT_ID, { page_path: path });
}
