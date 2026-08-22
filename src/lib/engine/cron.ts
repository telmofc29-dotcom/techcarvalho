import "server-only";
import { NextResponse, type NextRequest } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { logQueryError } from "@/lib/log/query-error";

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

/**
 * Appends to the engine_job_runs audit log. Never throws — logging must not be
 * the thing that fails a job.
 *
 * But "never throws" was doing more than that: the RPC's `error` was never even
 * destructured, so a denied or missing engine_record_job_run wrote no row and
 * said nothing. That is the worst possible place for this failure class to
 * live. Every downstream safety mechanism — health.ts, the circuit breakers,
 * the SILENT_SUCCESS detector — reads engine_job_runs, so an audit write that
 * silently does nothing does not just lose a log line: it starves the entire
 * safety layer while every job continues to report success.
 *
 * The control flow is unchanged (a job still does not fail because its audit
 * row would not write) but the failure is now DISCOVERABLE in server logs, the
 * same posture src/lib/log/query-error.ts established for public pages.
 */
/**
 * The four postcondition counts a run can report about its own mutations.
 *
 * Deliberately `number | null` rather than defaulting to 0. A run that was not
 * instrumented must record NULL, because "0 silent no-ops" and "nobody looked"
 * are opposite facts and writing 0 for both is how an absence of measurement
 * becomes a clean bill of health.
 */
export type WriteCounts = {
  verified: number | null;
  silentNoOps: number | null;
  unverified: number | null;
  blind: number | null;
};

/** Statuses engine_record_job_run returns once the telemetry migration lands. */
const RECORDED = "recorded";

export async function recordJobRun(
  supabase: SupabaseServerClient,
  jobName: string,
  status: "success" | "partial" | "failed" | "skipped",
  counters: JobCounters,
  detail: Record<string, unknown> = {},
  error?: string,
  writes?: WriteCounts
): Promise<void> {
  const base = {
    p_job_name: jobName,
    p_status: status,
    p_items_examined: counters.examined,
    p_items_created: counters.created,
    p_items_deduped: counters.deduped,
    p_items_failed: counters.failed,
    p_detail: detail,
    p_error: error ?? null,
  };
  const withTelemetry = {
    ...base,
    p_verified_writes: writes?.verified ?? null,
    p_silent_no_ops: writes?.silentNoOps ?? null,
    p_unverified_writes: writes?.unverified ?? null,
    p_blind_writes: writes?.blind ?? null,
  };

  try {
    // Attempt the instrumented shape first, then fall back.
    //
    // WHY A FALLBACK RATHER THAN JUST CALLING THE NEW SIGNATURE: the telemetry
    // migration is applied by hand, out of band from a deploy. If this code
    // shipped assuming the 12-argument function exists, then between deploy and
    // migration EVERY call would answer PGRST202 and no job would record an
    // audit row at all — starving health.ts, the breakers and the SILENT_SUCCESS
    // detector simultaneously. That is a far worse outcome than losing four
    // counters, so the audit row is written either way.
    //
    // The fallback is NOT silent. Losing the counters is itself reported, so
    // "telemetry is missing" cannot be mistaken for "telemetry says zero".
    let { data, error: writeError } = await supabase.rpc("engine_record_job_run", withTelemetry);

    if (writeError && writeError.code === "PGRST202") {
      const legacy = await supabase.rpc("engine_record_job_run", base);
      data = legacy.data;
      writeError = legacy.error;
      if (!writeError) {
        logQueryError(
          `engine_record_job_run(${jobName}) — audit row written WITHOUT postcondition telemetry. ` +
            `The 12-argument signature does not exist yet, so verified/silent/unverified/blind ` +
            `counts for this run are NULL (unmeasured), not zero. Apply ` +
            `supabase/migrations_pending/20260822_silent_success_telemetry.sql`,
          { message: "telemetry_signature_absent" }
        );
      }
    }

    logQueryError(
      `engine_record_job_run(${jobName}) — the audit row was NOT written. health.ts, the circuit ` +
        `breakers and the SILENT_SUCCESS detector all read engine_job_runs, so they are now ` +
        `missing this run entirely`,
      writeError
    );
    if (writeError) return;

    // INSPECT THE ANSWER. Before the telemetry migration this RPC returned void,
    // so `data` was null and there was nothing to check — the audit writer was
    // itself a blind write. Now it reports, and an unrecorded run must not pass
    // as a recorded one just because no error came back. `null` is the pre-
    // migration shape and is tolerated; any other non-'recorded' value is the
    // function telling us it threw the row away.
    if (data !== null && data !== RECORDED) {
      logQueryError(
        `engine_record_job_run(${jobName}) answered '${String(data)}' — it REFUSED the audit row ` +
          `and no error was raised. This run is absent from engine_job_runs`,
        { message: `engine_record_job_run=${String(data)}` }
      );
    }
  } catch (e) {
    logQueryError(
      `engine_record_job_run(${jobName}) threw; this run is absent from the audit log`,
      { message: e instanceof Error ? e.message : String(e) }
    );
  }
}

/** Whether a specific engine capability is switched on. Fails closed. */
export type EngineFlag =
  | "discovery"
  | "research"
  | "freshness"
  | "opportunity"
  | "autonomous_publishing";

export type FlagRead = {
  /** Whether the stage may run. False when off AND when unreadable. */
  enabled: boolean;
  /** Whether we actually LEARNED the flag's value. */
  readable: boolean;
  /** The reason to record, distinguishing the two cases by name. */
  reason: string;
  error?: string;
};

/**
 * Read a kill-switch, distinguishing "off" from "could not ask".
 *
 * THE BUG THIS REPLACES. `isFlagEnabled` was:
 *
 *     const { data, error } = await supabase.rpc("engine_flag_enabled", ...);
 *     if (error) return false;
 *
 * Failing closed is right — a stage must not run when we cannot confirm it is
 * allowed to. But the two cases were INDISTINGUISHABLE downstream, and that is
 * where it turned into a silent success:
 *
 *   1. One denied or failed RPC makes every stage return `false`.
 *   2. Each stage records status 'skipped' with reason "<flag>_disabled" — a
 *      reason that is simply untrue, because the flag was never read.
 *   3. silent-success.ts filters 'skipped' rows out of its analysis entirely,
 *      and with zero measured runs its `detection_unavailable` guard cannot
 *      fire either. The detector then reports `clean: true`.
 *
 * So a single database problem switches the whole engine off, labels it as a
 * deliberate configuration choice, and produces a clean bill of health. The
 * engine does nothing, and every signal says that is fine.
 *
 * The verdict is unchanged — unreadable still means do not run. Only the
 * REPORTING changes, which is the entire point: a stage can now record
 * 'failed' with reason "discovery_flag_unreadable" instead of 'skipped' with a
 * fabricated one, and the failure becomes visible to everything downstream.
 */
export async function readFlag(
  supabase: SupabaseServerClient,
  flag: EngineFlag
): Promise<FlagRead> {
  const { data, error } = await supabase.rpc("engine_flag_enabled", { p_flag: flag });

  if (error) {
    logQueryError(
      `engine_flag_enabled(${flag}) could not be read, so the stage is refused. This is NOT the ` +
        `flag being switched off — it is not knowing, and it fails closed`,
      error
    );
    return {
      enabled: false,
      readable: false,
      reason: `${flag}_flag_unreadable`,
      error: error.message,
    };
  }

  // A non-boolean answer is also "we do not know". Treating anything truthy as
  // enabled is how a schema change quietly re-enables a stage.
  if (typeof data !== "boolean") {
    logQueryError(
      `engine_flag_enabled(${flag}) returned ${JSON.stringify(data)} rather than a boolean; ` +
        `refusing the stage rather than guessing`,
      { message: "non_boolean_flag" }
    );
    return {
      enabled: false,
      readable: false,
      reason: `${flag}_flag_unreadable`,
      error: `expected a boolean, got ${typeof data}`,
    };
  }

  return {
    enabled: data,
    readable: true,
    reason: data ? `${flag}_enabled` : `${flag}_disabled`,
  };
}

/**
 * Boolean form, kept for call sites that genuinely only need yes/no.
 *
 * Prefer `readFlag`. This deliberately cannot tell a caller that the flag was
 * unreadable, so anything that RECORDS an outcome should not use it.
 */
export async function isFlagEnabled(
  supabase: SupabaseServerClient,
  flag: EngineFlag
): Promise<boolean> {
  return (await readFlag(supabase, flag)).enabled;
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
