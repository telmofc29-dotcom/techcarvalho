import { NextResponse, type NextRequest } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { checkCronAuth } from "@/lib/engine/cron";

// Triggered by Vercel Cron (see vercel.json) once daily. Rolls up
// *yesterday's* UTC day — never today's, which is still accumulating —
// into analytics_daily_rollups via the SECURITY DEFINER
// compute_analytics_rollup() function (see
// supabase/migrations_pending/20260821_first_party_analytics.sql), which
// is idempotent per day (delete-then-insert), so a retried cron
// invocation for the same day never double-counts.
//
// Auth: Vercel Cron sends `Authorization: Bearer ${CRON_SECRET}` when the
// CRON_SECRET env var is set (https://vercel.com/docs/cron-jobs/manage-cron-jobs#securing-cron-jobs)
// — checked here so this endpoint can't be triggered by an arbitrary
// public request to re-run (and pointlessly re-cost) the rollup.
export async function GET(request: NextRequest) {
  // Shared fail-closed cron auth (see src/lib/engine/cron.ts). This route
  // previously allowed unauthenticated calls whenever CRON_SECRET was unset;
  // it now refuses instead, so an unconfigured deployment stops doing
  // scheduled work rather than doing it for anyone who asks.
  const unauthorized = checkCronAuth(request);
  if (unauthorized) return unauthorized;

  const targetDayParam = request.nextUrl.searchParams.get("day");
  const targetDay =
    targetDayParam ?? new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString().slice(0, 10);

  // Calls the *guarded* wrapper, not compute_analytics_rollup directly.
  // This route runs as `anon` (a cron invocation carries no cookies), and
  // anon is deliberately not allowed to call the raw function — see
  // 20260821_revoke_public_execute_compute_rollup.sql. The guarded wrapper
  // is anon-callable but refuses to recompute a day computed within the
  // cooldown window, so the DoS vector that revoke closed stays closed.
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("compute_analytics_rollup_guarded", {
    target_day: targetDay,
    cooldown_minutes: 60,
  });

  if (error) {
    return NextResponse.json({ ok: false, day: targetDay, error: error.message }, { status: 500 });
  }
  // `status` distinguishes a real recomputation from a cooldown skip, so a
  // skipped run is visible in logs rather than looking identical to success.
  return NextResponse.json({ ok: true, day: targetDay, status: data });
}
