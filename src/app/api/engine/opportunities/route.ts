import { NextResponse, type NextRequest } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { checkCronAuth } from "@/lib/engine/cron";
import { runOpportunityScoring } from "@/lib/engine/jobs/opportunity-job";

// Individually-callable opportunity-scoring pass. See /api/engine/tick for the
// scheduled path.
export async function GET(request: NextRequest) {
  const unauthorized = checkCronAuth(request);
  if (unauthorized) return unauthorized;
  const supabase = await createClient();
  const result = await runOpportunityScoring(supabase);
  return NextResponse.json({ ok: result.status !== "failed", ...result });
}
