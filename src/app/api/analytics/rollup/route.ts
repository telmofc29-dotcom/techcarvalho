import { NextResponse, type NextRequest } from "next/server";
import { createClient } from "@/lib/supabase/server";

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
  const secret = process.env.CRON_SECRET;
  if (secret) {
    const auth = request.headers.get("authorization");
    if (auth !== `Bearer ${secret}`) {
      return NextResponse.json({ ok: false, error: "unauthorized" }, { status: 401 });
    }
  }

  const targetDayParam = request.nextUrl.searchParams.get("day");
  const targetDay =
    targetDayParam ?? new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString().slice(0, 10);

  const supabase = await createClient();
  const { error } = await supabase.rpc("compute_analytics_rollup", { target_day: targetDay });

  if (error) {
    return NextResponse.json({ ok: false, day: targetDay, error: error.message }, { status: 500 });
  }
  return NextResponse.json({ ok: true, day: targetDay });
}
