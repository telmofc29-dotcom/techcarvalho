import { NextResponse, type NextRequest } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { getCurrentAdmin } from "@/lib/dal";
import { sanitizeEventText, sanitizeSlug } from "@/lib/analytics/events";
import type { AnalyticsDeviceType, AnalyticsEntityType } from "@/lib/types/database";

// Ingestion endpoint for src/lib/analytics/session-events.ts. Deliberately
// a server route rather than the client inserting into Supabase directly
// (as outbound_click_events' simpler anon-insert-only RLS allows) — this
// table's richer shape is worth validating/sanitizing/rate-limiting
// server-side first, even though the underlying RLS still has to permit
// anon insert (no service-role key exists in this codebase, so there is
// no more-privileged write path available — same accepted tradeoff
// outbound_click_events' own migration already documents: RLS can't
// rate-limit, so the insert endpoint is responsible for that layer).
//
// Every response is 200 with a small JSON body, even on rejection — this
// is a fire-and-forget beacon endpoint; a visitor's navigation must never
// be affected by, or even aware of, how their analytics event was
// handled. Malformed/rejected/bot/admin requests are silently accepted
// (or silently dropped) rather than surfaced as an error the client-side
// beacon call would otherwise log.

const VALID_EVENT_TYPES = new Set([
  "page_view",
  "internal_link_click",
  "related_content_click",
  "navigation_click",
  "search",
  "search_result_click",
  "scroll_depth",
  "cta_click",
  "outbound_link_click",
  "affiliate_click",
]);
const VALID_ENTITY_TYPES = new Set(["product", "content", "manufacturer", "category"]);
const VALID_DEVICE_TYPES = new Set(["mobile", "tablet", "desktop"]);

function isValidDeviceType(value: string): value is AnalyticsDeviceType {
  return VALID_DEVICE_TYPES.has(value);
}
function isValidEntityType(value: string): value is AnalyticsEntityType {
  return VALID_ENTITY_TYPES.has(value);
}
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

// Best-effort only — not a substitute for real bot management, matching
// this codebase's existing "app-layer mitigation, not airtight" stance
// (see outbound_click_events' own migration comment). Catches the
// overwhelming majority of non-browser traffic (search engine crawlers,
// SEO tools, scripts) without needing an external service.
const BOT_UA_PATTERN =
  /bot|spider|crawl|slurp|curl|wget|python-requests|python-urllib|headlesschrome|phantomjs|puppeteer|playwright|scrapy|ahrefs|semrush|mj12bot|dotbot/i;

const MAX_EVENTS_PER_SESSION_PER_MINUTE = 60;

function isUuid(value: unknown): value is string {
  return typeof value === "string" && UUID_RE.test(value);
}

function ok(body: Record<string, unknown> = { ok: true }) {
  return NextResponse.json(body, { status: 200 });
}

// Caps object size/depth before it ever reaches jsonb storage — Postgres
// has no byte-size CHECK primitive suitable for a jsonb column, so this is
// the app-layer equivalent, same pattern as every length-capped text
// column in the migration. Only string/number/boolean leaf values are
// kept; anything else (nested objects/arrays, functions) is dropped rather
// than deeply sanitized, since no current event shape needs them.
function sanitizeMetadata(input: unknown): Record<string, string | number | boolean> {
  const out: Record<string, string | number | boolean> = {};
  if (!input || typeof input !== "object") return out;
  let count = 0;
  for (const [key, value] of Object.entries(input as Record<string, unknown>)) {
    if (count >= 20) break;
    if (key.length > 60) continue;
    if (typeof value === "string") {
      out[key] = sanitizeEventText(value, 300);
      count++;
    } else if (typeof value === "number" && Number.isFinite(value)) {
      out[key] = value;
      count++;
    } else if (typeof value === "boolean") {
      out[key] = value;
      count++;
    }
  }
  return out;
}

export async function POST(request: NextRequest) {
  try {
    const ua = request.headers.get("user-agent") ?? "";
    if (!ua || BOT_UA_PATTERN.test(ua)) {
      return ok({ ok: true, skipped: "bot" });
    }

    // A signed-in admin browsing the public site (e.g. previewing a draft,
    // checking a live page) must not inflate visitor/session/content
    // metrics — this is the "admin traffic" exclusion the dashboard's
    // numbers depend on being real.
    const admin = await getCurrentAdmin();
    if (admin) {
      return ok({ ok: true, skipped: "admin" });
    }

    let body: Record<string, unknown>;
    try {
      body = await request.json();
    } catch {
      return ok({ ok: false, skipped: "invalid_json" });
    }

    const eventType = String(body.eventType ?? "");
    const sessionId = body.sessionId;
    const visitorId = body.visitorId;
    const path = String(body.path ?? "").trim();

    if (!VALID_EVENT_TYPES.has(eventType) || !isUuid(sessionId) || !isUuid(visitorId) || !path) {
      return ok({ ok: false, skipped: "invalid_payload" });
    }

    const supabase = await createClient();
    const nowIso = new Date().toISOString();

    // Per-session rate limit — the one abuse mitigation available without
    // storing an IP address (deliberately not done, per this batch's
    // privacy requirement). Bounds how much a single compromised/malicious
    // session can write; does not (and structurally cannot, without an IP
    // or similar) stop many distinct fabricated sessions. Vercel's own
    // platform-level request limits are the outer layer for that, exactly
    // as already relied on for outbound_click_events.
    //
    // Goes through a SECURITY DEFINER RPC (analytics_session_under_rate_limit,
    // see supabase/migrations_pending/20260821_first_party_analytics_rate_limit_fn.sql)
    // rather than a direct SELECT against analytics_events — anon was
    // deliberately never granted SELECT on that table (raw analytics rows
    // must never be publicly readable), so a direct count query here would
    // fail outright and take the whole request down with it, which is
    // exactly what happened before this fix: every real event silently
    // failed with {"ok":false}, confirmed via a live production test. The
    // RPC returns only a boolean, never the rows it counted.
    const { data: underLimit, error: rateLimitError } = await supabase.rpc("analytics_session_under_rate_limit", {
      p_session_id: sessionId,
      p_max_per_minute: MAX_EVENTS_PER_SESSION_PER_MINUTE,
    });
    if (rateLimitError) {
      return ok({ ok: false, skipped: "rate_limit_check_failed" });
    }
    if (!underLimit) {
      return ok({ ok: false, skipped: "rate_limited" });
    }

    await supabase.from("analytics_visitors").upsert({ id: visitorId, last_seen_at: nowIso }, { onConflict: "id" });

    const sessionInit = body.sessionInit as Record<string, unknown> | undefined;
    if (sessionInit && typeof sessionInit === "object") {
      const deviceType = String(sessionInit.deviceType ?? "");
      await supabase.from("analytics_sessions").upsert(
        {
          id: sessionId,
          visitor_id: visitorId,
          entry_path: sanitizeEventText(String(sessionInit.entryPath ?? path), 512) || path,
          referrer_host: sessionInit.referrerHost ? sanitizeEventText(String(sessionInit.referrerHost), 255) : null,
          utm_source: sessionInit.utmSource ? sanitizeEventText(String(sessionInit.utmSource), 100) : null,
          utm_medium: sessionInit.utmMedium ? sanitizeEventText(String(sessionInit.utmMedium), 100) : null,
          utm_campaign: sessionInit.utmCampaign ? sanitizeEventText(String(sessionInit.utmCampaign), 100) : null,
          device_type: isValidDeviceType(deviceType) ? deviceType : null,
          is_admin: false,
          last_seen_at: nowIso,
        },
        { onConflict: "id" }
      );
    } else {
      await supabase.from("analytics_sessions").update({ last_seen_at: nowIso }).eq("id", sessionId);
    }

    const entityType = typeof body.entityType === "string" && isValidEntityType(body.entityType) ? body.entityType : null;
    const categorySlug = typeof body.categorySlug === "string" ? sanitizeSlug(body.categorySlug) || null : null;

    const { error: insertError } = await supabase.from("analytics_events").insert({
      session_id: sessionId,
      event_type: eventType,
      path: sanitizeEventText(path, 512),
      entity_type: entityType,
      product_id: isUuid(body.productId) ? body.productId : null,
      content_id: isUuid(body.contentId) ? body.contentId : null,
      manufacturer_id: isUuid(body.manufacturerId) ? body.manufacturerId : null,
      category_slug: categorySlug,
      metadata: sanitizeMetadata(body.metadata),
    } as never);

    return ok({ ok: !insertError });
  } catch {
    // A tracking-endpoint failure must never surface to the visitor —
    // always 200, always a benign body.
    return ok({ ok: false, skipped: "error" });
  }
}
