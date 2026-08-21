"use client";

// TechCarvalho's own first-party session/event system. Complements GA4 and
// is entirely separate from src/lib/analytics/first-party.ts's
// recordOutboundClick() (which writes to the older, consent-INDEPENDENT
// outbound_click_events table — see that table's own migration for why it
// stays that way). This module is consent-DEPENDENT by design: it
// correlates events into sessions/visitors via a client-held identifier,
// and reading/writing any per-visitor identifier from the browser for
// measurement purposes requires analytics consent under PECR, the same
// reasoning already applied to gating GA4 — see
// supabase/migrations_pending/20260821_first_party_analytics.sql's header
// for the fuller explanation of why three privacy tiers coexist here.
//
// Definitions (kept in sync with that migration's own header comment):
// session = 30-minute-inactivity-gated id in sessionStorage; visitor =
// long-lived id in localStorage, only ever created once consent is
// granted.

import { hasAnalyticsConsent } from "@/lib/consent/consent-context";
import { SITE_URL } from "@/lib/seo/site";
import type { EventName, EventParams } from "./events";

const SESSION_KEY = "tc-analytics-session";
const VISITOR_KEY = "tc-analytics-visitor";
const SESSION_GAP_MS = 30 * 60 * 1000;

type StoredSession = { id: string; lastSeenAt: number };

function isProductionHostname(): boolean {
  try {
    return window.location.hostname === new URL(SITE_URL).hostname;
  } catch {
    return false;
  }
}

function deviceType(): "mobile" | "tablet" | "desktop" {
  const w = window.innerWidth;
  if (w < 640) return "mobile";
  if (w < 1024) return "tablet";
  return "desktop";
}

function getOrCreateVisitorId(): string {
  try {
    const existing = window.localStorage.getItem(VISITOR_KEY);
    if (existing) return existing;
    const id = crypto.randomUUID();
    window.localStorage.setItem(VISITOR_KEY, id);
    return id;
  } catch {
    // Storage unavailable — fall back to a per-call id (won't persist, but
    // never throws and never blocks the event from being sent).
    return crypto.randomUUID();
  }
}

// Returns the current session id, and — only on the very first call of a
// new session (fresh id, not a reused one) — the session-init fields the
// ingestion endpoint needs to create the analytics_sessions row. Every
// later call in the same session returns { init: null }, since those
// fields only make sense captured once, at session start.
function getOrCreateSession(): { id: string; init: SessionInit | null } {
  const now = Date.now();
  try {
    const raw = window.sessionStorage.getItem(SESSION_KEY);
    if (raw) {
      const stored = JSON.parse(raw) as StoredSession;
      if (now - stored.lastSeenAt < SESSION_GAP_MS) {
        window.sessionStorage.setItem(SESSION_KEY, JSON.stringify({ id: stored.id, lastSeenAt: now }));
        return { id: stored.id, init: null };
      }
    }
  } catch {
    // Fall through to creating a fresh session below.
  }

  const id = crypto.randomUUID();
  try {
    window.sessionStorage.setItem(SESSION_KEY, JSON.stringify({ id, lastSeenAt: now }));
  } catch {
    // Non-persisting session — still usable for this single call.
  }

  const params = new URLSearchParams(window.location.search);
  let referrerHost: string | undefined;
  try {
    if (document.referrer) {
      const referrerUrl = new URL(document.referrer);
      if (referrerUrl.hostname !== window.location.hostname) referrerHost = referrerUrl.hostname;
    }
  } catch {
    referrerHost = undefined;
  }

  return {
    id,
    init: {
      entryPath: window.location.pathname,
      referrerHost,
      utmSource: params.get("utm_source") ?? undefined,
      utmMedium: params.get("utm_medium") ?? undefined,
      utmCampaign: params.get("utm_campaign") ?? undefined,
      deviceType: deviceType(),
    },
  };
}

type SessionInit = {
  entryPath: string;
  referrerHost?: string;
  utmSource?: string;
  utmMedium?: string;
  utmCampaign?: string;
  deviceType: "mobile" | "tablet" | "desktop";
};

type IngestPayload = {
  sessionId: string;
  visitorId: string;
  eventType: string;
  path: string;
  entityType?: string;
  productId?: string;
  contentId?: string;
  manufacturerId?: string;
  categorySlug?: string;
  metadata?: Record<string, unknown>;
  sessionInit?: SessionInit;
};

// Fire-and-forget, resilient by construction: sendBeacon (survives page
// unload, which fetch does not reliably) where available, fetch with
// keepalive as the fallback. Never throws, never awaited by callers, and a
// failure here must never be visible to the visitor or affect navigation —
// wrapped defensively for exactly that reason.
function postEvent(payload: IngestPayload) {
  try {
    const body = JSON.stringify(payload);
    if (navigator.sendBeacon) {
      const blob = new Blob([body], { type: "application/json" });
      const ok = navigator.sendBeacon("/api/analytics/track", blob);
      if (ok) return;
    }
    void fetch("/api/analytics/track", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body,
      keepalive: true,
    }).catch(() => {});
  } catch {
    // Never let a tracking failure surface anywhere.
  }
}

// Maps a subset of the shared TechCarvalhoEventMap event names/params onto
// the ingestion payload shape. Only events meaningful to first-party
// session/journey analysis are sent here — ad_impression/ad_click are
// deliberately excluded (inert, no ad network wired up yet).
export function sendFirstPartyEvent<N extends EventName>(name: N, params: EventParams<N>): void {
  if (typeof window === "undefined") return;
  if (!hasAnalyticsConsent() || !isProductionHostname()) return;

  const p = params as Record<string, unknown>;
  const path = typeof p.path === "string" ? p.path : window.location.pathname;

  const { id: sessionId, init } = getOrCreateSession();
  const visitorId = getOrCreateVisitorId();

  // Two ways an event can carry entity context: dedicated product_id/
  // content_id/manufacturer_id fields (internal_link_click,
  // outbound_link_click, affiliate_click, related_content_click all have
  // these directly per their ContentContext/ProductContext shape in
  // events.ts) or entity_type+entity_id (page_view only, since a single
  // page view is exactly one entity, not potentially several). Both are
  // reconciled here so the ingestion payload always uses the same three
  // concrete columns regardless of which shape the source event used.
  const entityType = typeof p.entity_type === "string" ? p.entity_type : undefined;
  const entityId = typeof p.entity_id === "string" ? p.entity_id : undefined;
  const productId = (typeof p.product_id === "string" ? p.product_id : undefined) ?? (entityType === "product" ? entityId : undefined);
  const contentId = (typeof p.content_id === "string" ? p.content_id : undefined) ?? (entityType === "content" ? entityId : undefined);
  const manufacturerId =
    (typeof p.manufacturer_id === "string" ? p.manufacturer_id : undefined) ?? (entityType === "manufacturer" ? entityId : undefined);

  postEvent({
    sessionId,
    visitorId,
    eventType: name,
    path,
    entityType,
    productId,
    contentId,
    manufacturerId,
    categorySlug: typeof p.category_slug === "string" ? p.category_slug : undefined,
    metadata: p,
    sessionInit: init ?? undefined,
  });
}
