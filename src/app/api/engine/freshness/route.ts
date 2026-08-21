import { NextResponse, type NextRequest } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { checkCronAuth } from "@/lib/engine/cron";
import { runFreshness } from "@/lib/engine/jobs/freshness-job";

// Individually-callable freshness pass. See /api/engine/tick for the scheduled
// path. This pass only ever emits recommendations — it has no write path
// capable of altering published content.
export async function GET(request: NextRequest) {
  const unauthorized = checkCronAuth(request);
  if (unauthorized) return unauthorized;
  const supabase = await createClient();
  const result = await runFreshness(supabase);
  return NextResponse.json({ ok: result.status !== "failed", ...result });
}
