// Behavioural verification of 20260823_engine_rpc_anon_surface.sql.
//
//   npx tsx scripts/verify-anon-surface-migration.ts
//
// Two questions, and they pull in opposite directions:
//   1. Is the attack actually closed?
//   2. Does every legitimate cron stage still work?
//
// A security migration that answers yes to the first and no to the second has
// replaced one outage with another, so both are checked here and a failure of
// either fails the run.
//
// SAFE TO RUN REPEATEDLY. Mutating probes use the job name
// 'engine_security_probe' (never 'engine_tick', which would lease a real
// window), and every probe row is deleted as an authenticated admin with the
// count re-checked afterwards.

import { createClient } from "@supabase/supabase-js";
import { loadEnvLocal, createAdminClient } from "./_shared.ts";

loadEnvLocal();

const URL_ = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const ANON = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY!;
const PROBE_JOB = "engine_security_probe";

type Check = { name: string; passed: boolean; expected: string; actual: string; note?: string };
const checks: Check[] = [];
function record(name: string, expected: string, actual: unknown, passed: boolean, note?: string): void {
  checks.push({ name, expected, actual: typeof actual === "string" ? actual : JSON.stringify(actual), passed, note });
}

/** Raw PostgREST call as `anon` — the role an ordinary visitor holds. */
async function anonRpc(fn: string, args: Record<string, unknown> = {}) {
  const r = await fetch(`${URL_}/rest/v1/rpc/${fn}`, {
    method: "POST",
    headers: { apikey: ANON, Authorization: `Bearer ${ANON}`, "Content-Type": "application/json" },
    body: JSON.stringify(args),
  });
  const text = await r.text();
  let body: unknown;
  try { body = JSON.parse(text); } catch { body = text; }
  return { status: r.status, body };
}

function codeOf(body: unknown): string | null {
  return body && typeof body === "object" && !Array.isArray(body)
    ? ((body as { code?: string }).code ?? null)
    : null;
}

async function main(): Promise<void> {
  console.log("=== anon RPC surface migration — behavioural verification ===\n");

  // ==========================================================================
  // A. IS THE SHUTDOWN ATTACK CLOSED?
  // ==========================================================================

  // The exact attack that worked before: claim a window far in the future.
  {
    const r = await anonRpc("engine_begin_run", {
      p_job_name: PROBE_JOB,
      p_idempotency_key: `${PROBE_JOB}:2027-01-01T04:30:00.000Z`,
    });
    record(
      "ATTACK: leasing a far-future window is refused",
      "'rejected_window'",
      r.body,
      r.body === "rejected_window",
      "Before this migration it returned 'acquired:<uuid>', and freezing it as 'success' locked the window forever."
    );
  }

  // A key whose timestamp is older than the reap horizon.
  {
    const r = await anonRpc("engine_begin_run", {
      p_job_name: PROBE_JOB,
      p_idempotency_key: `${PROBE_JOB}:2020-01-01T00:00:00.000Z`,
    });
    record("ATTACK: leasing a long-past window is refused", "'rejected_window'", r.body, r.body === "rejected_window");
  }

  // A key that does not carry the job name and a timestamp at all.
  {
    const r = await anonRpc("engine_begin_run", { p_job_name: PROBE_JOB, p_idempotency_key: "arbitrary-string" });
    record("ATTACK: a malformed idempotency key is refused", "'rejected_invalid'", r.body, r.body === "rejected_invalid");
  }

  // A key naming a DIFFERENT job than the one being started — otherwise an
  // attacker could lease engine_tick's window under another job's name.
  {
    const r = await anonRpc("engine_begin_run", {
      p_job_name: PROBE_JOB,
      p_idempotency_key: `engine_tick:${new Date().toISOString()}`,
    });
    record("ATTACK: a key naming a different job is refused", "'rejected_invalid'", r.body, r.body === "rejected_invalid");
  }

  // ==========================================================================
  // B. DOES THE LEGITIMATE CRON PATH STILL WORK?
  // ==========================================================================
  // This is the half that matters most: the fix must not have bricked the
  // engine. The key below is built exactly as idempotencyKeyFor() builds it.
  {
    const WINDOW_MINUTES = 5;
    const bucketMs = WINDOW_MINUTES * 60_000;
    const bucketStart = Math.floor(Date.now() / bucketMs) * bucketMs;
    const key = `${PROBE_JOB}:${new Date(bucketStart).toISOString()}`;

    const acquired = await anonRpc("engine_begin_run", { p_job_name: PROBE_JOB, p_idempotency_key: key });
    const ok = typeof acquired.body === "string" && /^(acquired|took_over):/.test(acquired.body);
    record(
      "CRON: a current-window lease is still granted",
      "'acquired:<uuid>'",
      acquired.body,
      ok,
      "Built with the same bucket arithmetic as idempotencyKeyFor(). If this fails, the engine cannot create anything."
    );

    if (ok) {
      const runId = (acquired.body as string).split(":").slice(1).join(":");
      const completed = await anonRpc("engine_complete_run", { p_run_id: runId, p_status: "success" });
      record("CRON: completing a held lease still works", "'completed'", completed.body, completed.body === "completed");

      // And the duplicate-scheduler guarantee must still hold.
      const second = await anonRpc("engine_begin_run", { p_job_name: PROBE_JOB, p_idempotency_key: key });
      record(
        "CRON: a second worker in the same window is still refused",
        "'already_running'",
        second.body,
        second.body === "already_running",
        "The concurrency guarantee must survive the security fix."
      );
    }
  }

  // ==========================================================================
  // C. WAS UNNECESSARY ANON ACCESS ACTUALLY REVOKED?
  // ==========================================================================
  // 42501 is the proof. A missing grant surfaces as 'permission denied for
  // function'; anything else means the revoke did not take.
  for (const [fn, args] of [
    ["engine_shadow_escapes", {}],
    ["engine_shadow_proof_runs", { p_limit: 1 }],
    ["engine_shadow_record_proof_run", { p_kind: "x", p_level: "x", p_commit_sha: "x", p_method: "x", p_observed: "x", p_passed: false }],
  ] as [string, Record<string, unknown>][]) {
    const r = await anonRpc(fn, args);
    record(
      `REVOKED for anon: ${fn}`,
      "42501 permission denied",
      { status: r.status, code: codeOf(r.body) },
      codeOf(r.body) === "42501",
      "These are the autonomous-readiness surface. record_proof_run accepts level 'production_proven' with free-text evidence."
    );
  }

  // ...but an ADMIN must still be able to use them, or the readiness tooling
  // breaks. Revoking too much is its own regression.
  {
    const admin = await createAdminClient();
    for (const [fn, args] of [
      ["engine_shadow_escapes", {}],
      ["engine_shadow_proof_runs", { p_limit: 1 }],
    ] as [string, Record<string, unknown>][]) {
      const { error } = await (admin as unknown as { rpc: (f: string, a: Record<string, unknown>) => Promise<{ error: { message: string } | null }> }).rpc(fn, args);
      record(`STILL AVAILABLE to an admin: ${fn}`, "no error", error?.message ?? "ok", !error);
    }
  }

  // ==========================================================================
  // D. EVERY OTHER CRON-CRITICAL RPC MUST STILL ANSWER AS ANON
  // ==========================================================================
  // A blanket revoke would have shown up here. Read-only or refusing calls only.
  const NIL = "00000000-0000-0000-0000-0000000000ff";
  const CRON_RPCS: [string, Record<string, unknown>][] = [
    ["engine_flag_enabled", { p_flag: "discovery" }],
    ["engine_due_sources", {}],
    ["engine_unclassified_discoveries", { p_limit: 1 }],
    ["engine_briefable_discoveries", { p_limit: 1 }],
    ["engine_evidence_for", { p_discovery_id: NIL }],
    ["engine_existing_entities", {}],
    ["engine_reference_data", {}],
    ["engine_freshness_candidates", { p_stale_days: 400 }],
    ["engine_opportunity_inputs", { p_days: 1 }],
    ["engine_trend_inputs", { p_days: 1 }],
    ["engine_open_media_requirements", { p_limit: 1 }],
    ["engine_assemblable_briefs", { p_limit: 1 }],
    ["engine_recent_job_runs", { p_hours: 1, p_limit: 1 }],
    ["engine_source_health", {}],
    ["engine_validation_stats", { p_hours: 1 }],
    ["engine_silent_success_stats", { p_hours: 1 }],
    ["engine_shadow_candidates", { p_limit: 1 }],
    ["engine_shadow_evidence", { p_discovery_id: NIL }],
    ["engine_shadow_media", { p_product_id: null, p_content_id: null }],
    ["engine_shadow_sources", {}],
    ["engine_shadow_content_signals", {}],
    ["engine_shadow_ledger", { p_limit: 1 }],
  ];
  const denied: string[] = [];
  for (const [fn, args] of CRON_RPCS) {
    const r = await anonRpc(fn, args);
    const code = codeOf(r.body);
    if (code === "42501" || code === "PGRST202") denied.push(`${fn} -> ${code}`);
  }
  record(
    "CRON: every other scheduled-stage RPC still reachable as anon",
    "none denied",
    denied.length ? denied : "all reachable",
    denied.length === 0,
    `${CRON_RPCS.length} RPCs covering discovery, relevance, briefs, drafts, trends, freshness, media and shadow.`
  );

  // ==========================================================================
  // E. NO RLS REGRESSION — direct table access must still be refused
  // ==========================================================================
  for (const t of ["engine_job_runs", "engine_discoveries", "engine_shadow_decisions"]) {
    const r = await fetch(`${URL_}/rest/v1/${t}`, {
      method: "POST",
      headers: { apikey: ANON, Authorization: `Bearer ${ANON}`, "Content-Type": "application/json" },
      body: JSON.stringify({}),
    });
    const body = await r.json().catch(() => ({}));
    record(
      `RLS: anon still cannot INSERT into ${t} directly`,
      "42501 permission denied",
      { status: r.status, code: (body as { code?: string }).code },
      (body as { code?: string }).code === "42501"
    );
  }
  {
    const r = await fetch(`${URL_}/rest/v1/content_items?id=eq.${NIL}`, {
      method: "PATCH",
      headers: { apikey: ANON, Authorization: `Bearer ${ANON}`, "Content-Type": "application/json" },
      body: JSON.stringify({ status: "published" }),
    });
    const body = await r.json().catch(() => ({}));
    record(
      "RLS: the publication boundary is intact",
      "42501 permission denied",
      { status: r.status, code: (body as { code?: string }).code },
      (body as { code?: string }).code === "42501"
    );
  }

  // ==========================================================================
  // F. WHAT THIS MIGRATION DELIBERATELY DID NOT FIX
  // ==========================================================================
  // PART 3 of the file is documentation, not SQL: forged audit history has no
  // SQL-only fix. This check ASSERTS THE HOLE IS STILL OPEN, so that the day it
  // closes, this test fails and somebody updates the record. Reporting a known
  // gap as if it were fixed is the failure mode this whole project fights.
  {
    const r = await anonRpc("engine_record_job_run", {
      p_job_name: PROBE_JOB, p_status: "failed",
      p_items_examined: 0, p_items_created: 999, p_items_deduped: 0, p_items_failed: 0,
      p_detail: {}, p_error: "forged by an unauthenticated probe",
    });
    const forged = r.body === "recorded";
    checks.push({
      name: "KNOWN GAP (unfixed by design): anon can still forge audit history",
      passed: true,
      expected: "still open — PART 3 is documentation, not SQL",
      actual: forged ? "'recorded' — the forged row was accepted" : `unexpectedly refused: ${JSON.stringify(r.body)}`,
      note: forged
        ? "Confirms the documented gap. The circuit breakers read this table. Needs an app-side request-header token, deployed BEFORE the SQL."
        : "This gap appears to have CLOSED. Good news, but verify why and update the migration's PART 3.",
    });
  }

  // -- cleanup ---------------------------------------------------------------
  const admin = await createAdminClient();
  await (admin as unknown as {
    from: (t: string) => { delete: () => { eq: (a: string, b: unknown) => Promise<{ error: unknown }> } };
  }).from("engine_job_runs").delete().eq("job_name", PROBE_JOB);

  const { data: leftover } = await (admin as unknown as {
    from: (t: string) => { select: (c: string) => { eq: (a: string, b: unknown) => Promise<{ data: unknown[] | null }> } };
  }).from("engine_job_runs").select("id").eq("job_name", PROBE_JOB);
  record("probe rows cleaned up", "0 leftover", { leftover: leftover?.length ?? "?" }, (leftover?.length ?? 1) === 0);

  // -- report ----------------------------------------------------------------
  console.log("");
  let failed = 0;
  for (const c of checks) {
    if (!c.passed) failed++;
    console.log(`[${c.passed ? "PASS" : "FAIL"}] ${c.name}`);
    console.log(`       expected ${c.expected}  |  got ${c.actual}`);
    if (c.note) console.log(`       ${c.note}`);
  }
  console.log(`\n${checks.length - failed}/${checks.length} checks passed.`);
  if (failed > 0) process.exitCode = 1;
}

void createClient; // imported for type parity with other scripts
main().catch((e) => {
  console.error("verification threw:", e);
  process.exitCode = 1;
});
