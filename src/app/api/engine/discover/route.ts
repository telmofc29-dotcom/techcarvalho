import { NextResponse, type NextRequest } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { checkCronAuth } from "@/lib/engine/cron";
import { runDiscovery } from "@/lib/engine/jobs/discovery";

// Individually-callable discovery pass. The scheduled path is
// /api/engine/tick (one cron runs all three stages in order); this route stays
// for manual operation and debugging. Logic lives in lib/engine/jobs/discovery.ts
// so both entry points behave identically.
export async function GET(request: NextRequest) {
  const unauthorized = checkCronAuth(request);
  if (unauthorized) return unauthorized;
  const supabase = await createClient();
  const result = await runDiscovery(supabase);
  return NextResponse.json({ ok: result.status !== "failed", ...result });
}
