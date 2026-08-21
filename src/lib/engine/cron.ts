import "server-only";
import { NextResponse, type NextRequest } from "next/server";
import { createClient } from "@/lib/supabase/server";

// Shared plumbing for Growth Engine scheduled jobs (requirement 10:
// idempotent, rate-limited, observable, retryable, inexpensive, safe when a
// source disappears or changes format).
//
// These routes run as `anon` — a Vercel Cron invocation carries no cookies.
// That is deliberate and safe: every database interaction goes through a
// narrow SECURITY DEFINER RPC (see 20260821_growth_engine_rpcs.sql) which
// re-checks the engine kill switch itself, so hitting an endpoint directly
// cannot bypass the switch.

/** Same CRON_SECRET convention the analytics rollup already uses. */
/**
 * Constant-time string comparison. A plain `!==` on a secret leaks length and
 * prefix information through timing; negligible over the public internet, but
 * free to avoid.
 */
function timingSafeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

/**
 * Cron authentication. FAILS CLOSED.
 *
 * Previously this returned null (i.e. allowed the request) when CRON_SECRET
 * was unset, which meant every scheduled endpoint was publicly callable in
 * production — anyone could trigger engine passes and burn function budget.
 * Now a missing secret in production refuses the request with 503 rather than
 * silently running: an unconfigured deployment stops doing scheduled work,
 * which is visible and safe, instead of doing it for anyone who asks.
 *
 * Vercel Cron sends `Authorization: Bearer ${CRON_SECRET}` automatically once
 * the env var exists, so configuring it is the only step needed.
 *
 * Outside production (local dev) the check is skipped so the endpoints stay
 * usable without secret plumbing.
 */
export function checkCronAuth(request: NextRequest): NextResponse | null {
  const secret = process.env.CRON_SECRET;
  const isProduction = process.env.NODE_ENV === "production";

  if (!secret) {
    if (!isProduction) return null;
    return NextResponse.json(
      {
        ok: false,
        error: "cron_secret_not_configured",
        detail:
          "CRON_SECRET is not set in this environment. Scheduled endpoints refuse to run rather than being publicly callable.",
      },
      { status: 503 }
    );
  }

  const auth = request.headers.get("authorization") ?? "";
  const expected = `Bearer ${secret}`;
  if (!timingSafeEqual(auth, expected)) {
    return NextResponse.json({ ok: false, error: "unauthorized" }, { status: 401 });
  }
  return null;
}

export type JobCounters = {
  examined: number;
  created: number;
  deduped: number;
  failed: number;
};

export function newCounters(): JobCounters {
  return { examined: 0, created: 0, deduped: 0, failed: 0 };
}

type SupabaseServerClient = Awaited<ReturnType<typeof createClient>>;

/** Appends to the engine_job_runs audit log. Never throws — logging must not
 *  be the thing that fails a job. */
export async function recordJobRun(
  supabase: SupabaseServerClient,
  jobName: string,
  status: "success" | "partial" | "failed" | "skipped",
  counters: JobCounters,
  detail: Record<string, unknown> = {},
  error?: string
): Promise<void> {
  try {
    await supabase.rpc("engine_record_job_run", {
      p_job_name: jobName,
      p_status: status,
      p_items_examined: counters.examined,
      p_items_created: counters.created,
      p_items_deduped: counters.deduped,
      p_items_failed: counters.failed,
      p_detail: detail,
      p_error: error ?? null,
    });
  } catch {
    // Swallow: an unwritable audit row is worth a lost log line, not a
    // failed job. The HTTP response still reports the real outcome.
  }
}

/** Whether a specific engine capability is switched on. Fails closed. */
export async function isFlagEnabled(
  supabase: SupabaseServerClient,
  flag: "discovery" | "research" | "freshness" | "opportunity" | "autonomous_publishing"
): Promise<boolean> {
  const { data, error } = await supabase.rpc("engine_flag_enabled", { p_flag: flag });
  if (error) return false;
  return data === true;
}

/**
 * Fetch with a hard timeout and a declared User-Agent. Bounded so one slow or
 * hostile source cannot hang a scheduled job, and never throws — callers get
 * null and record a source failure rather than crashing the whole run.
 */
export async function safeFetchText(url: string, timeoutMs = 10_000): Promise<string | null> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetch(url, {
      signal: controller.signal,
      headers: {
        // Identify ourselves honestly rather than impersonating a browser.
        "user-agent": "TechCarvalhoBot/1.0 (+https://www.techcarvalho.com)",
        accept: "application/rss+xml, application/atom+xml, application/xml, text/xml, */*",
      },
      cache: "no-store",
    });
    if (!res.ok) return null;
    const text = await res.text();
    // Cap payload size — a source that starts returning something enormous
    // shouldn't be able to blow up the function's memory.
    return text.slice(0, 2_000_000);
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }
}
