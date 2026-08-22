// Behavioural verification of the two 2026-08-23 migrations.
//
//   TC_ADMIN_EMAIL=... TC_ADMIN_PASSWORD=... npx tsx scripts/verify-changelog-queueprobe.ts
//
// The SQL editor's result message is not evidence. Two migrations in this
// project have already reported one thing and done another, and a third failed
// outright after reporting nothing wrong.
//
// SAFE TO RUN REPEATEDLY. Every mutating probe either targets a
// deliberately-nonexistent id so the function must refuse it, or writes a
// clearly-marked probe row that is deleted again with the remaining count
// re-checked.

import { loadEnvLocal, createAdminClient } from "./_shared.ts";

loadEnvLocal();

const URL_ = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const ANON = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY!;
const NIL = "00000000-0000-0000-0000-0000000000ff";
const PROBE_JOB = "engine_changelog_probe";

type Check = { name: string; passed: boolean; expected: string; actual: string; note?: string };
const checks: Check[] = [];
function record(name: string, expected: string, actual: unknown, passed: boolean, note?: string): void {
  checks.push({
    name,
    expected,
    actual: typeof actual === "string" ? actual : JSON.stringify(actual),
    passed,
    note,
  });
}

/** Raw call as `anon` — the role the engine actually runs as. */
async function anonRpc(fn: string, args: Record<string, unknown> = {}) {
  const r = await fetch(`${URL_}/rest/v1/rpc/${fn}`, {
    method: "POST",
    headers: { apikey: ANON, Authorization: `Bearer ${ANON}`, "Content-Type": "application/json" },
    body: JSON.stringify(args),
  });
  const text = await r.text();
  let body: unknown;
  try {
    body = JSON.parse(text);
  } catch {
    body = text;
  }
  return { status: r.status, body };
}

function codeOf(body: unknown): string | null {
  return body && typeof body === "object" && !Array.isArray(body)
    ? ((body as { code?: string }).code ?? null)
    : null;
}

async function main(): Promise<void> {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const db = (await createAdminClient()) as unknown as { from: (t: string) => any; rpc: (f: string, a?: Record<string, unknown>) => Promise<{ data: unknown; error: { message: string; code?: string } | null }> };

  console.log("=== 20260823 migrations — behavioural verification ===\n");

  // =====================================================================
  // A. engine_change_log — does the SCHEMA exist and behave?
  // =====================================================================
  let probeRunId: string | null = null;
  {
    // A real engine_job_runs row to hang the probe changes off. The FK is the
    // point of the design: a change can only belong to a run that happened.
    const { data: runs } = await db
      .from("engine_job_runs")
      .select("id")
      .order("started_at", { ascending: false })
      .limit(1);
    probeRunId = (runs?.[0]?.id as string) ?? null;
    record(
      "an engine_job_runs row exists to anchor changes to",
      "a run id",
      probeRunId ?? "none",
      probeRunId !== null,
      "engine_change_log.run_id is a FK — a change cannot belong to a run that never happened."
    );
  }

  {
    const { data, error } = await db.rpc("engine_record_change", {
      p_run_id: NIL,
      p_job_name: "probe",
      p_sequence: 1,
      p_table_name: "content_items",
      p_row_id: NIL,
      p_operation: "insert",
      p_before: null,
      p_after: {},
    });
    record(
      "engine_record_change refuses an unknown run",
      "'rejected_unknown_run'",
      error ? `ERROR ${error.code ?? ""} ${error.message}` : data,
      !error && data === "rejected_unknown_run"
    );
  }

  if (probeRunId) {
    const { data, error } = await db.rpc("engine_record_change", {
      p_run_id: probeRunId,
      p_job_name: PROBE_JOB,
      p_sequence: 9001,
      p_table_name: "content_items",
      p_row_id: NIL,
      p_operation: "update",
      p_before: null,
      p_after: { status: "draft" },
    });
    record(
      "an UPDATE with no before-image is refused at record time",
      "'rejected_missing_before_image'",
      error ? `ERROR ${error.message}` : data,
      !error && data === "rejected_missing_before_image",
      "Better to refuse the log entry than to discover the gap at rollback time, when the information is gone."
    );
  }

  let recordedId: string | null = null;
  if (probeRunId) {
    const { data, error } = await db.rpc("engine_record_change", {
      p_run_id: probeRunId,
      p_job_name: PROBE_JOB,
      p_sequence: 9002,
      p_table_name: "content_items",
      p_row_id: NIL,
      p_operation: "insert",
      p_before: null,
      p_after: { title: "probe" },
    });
    const isUuid = typeof data === "string" && /^[0-9a-f-]{36}$/i.test(data);
    recordedId = isUuid ? (data as string) : null;
    record(
      "a valid change is recorded and returns its row id",
      "a uuid",
      error ? `ERROR ${error.message}` : data,
      isUuid,
      "Returns text rather than void: a rollback log that silently failed to record would make a run look reversible when it is not."
    );

    // Idempotency: the same step twice must not produce two entries that would
    // then be reversed twice.
    const again = await db.rpc("engine_record_change", {
      p_run_id: probeRunId,
      p_job_name: PROBE_JOB,
      p_sequence: 9002,
      p_table_name: "content_items",
      p_row_id: NIL,
      p_operation: "insert",
      p_before: null,
      p_after: { title: "probe" },
    });
    record(
      "recording the same step twice is deduped, not duplicated",
      "'deduped'",
      again.error ? `ERROR ${again.error.message}` : again.data,
      !again.error && again.data === "deduped"
    );
  }

  {
    const { data, error } = await db.rpc("engine_changes_for_run", { p_run_id: probeRunId ?? NIL });
    const rows = Array.isArray(data) ? data : [];
    record(
      "an admin can read a run's changes back",
      "the recorded probe rows",
      error ? `ERROR ${error.message}` : `${rows.length} row(s)`,
      !error && rows.length > 0
    );
  }

  {
    const r = await anonRpc("engine_changes_for_run", { p_run_id: NIL });
    record(
      "anon CANNOT read the change log",
      "42501 permission denied",
      { status: r.status, code: codeOf(r.body) },
      codeOf(r.body) === "42501",
      "It is a map of unpublished editorial work."
    );
  }

  {
    // The engine runs as anon and must be able to WRITE its own changes.
    const r = await anonRpc("engine_record_change", {
      p_run_id: NIL, p_job_name: "probe", p_sequence: 1, p_table_name: "content_items",
      p_row_id: NIL, p_operation: "insert", p_before: null, p_after: {},
    });
    record(
      "anon CAN write a change (the engine runs as anon)",
      "'rejected_unknown_run', i.e. the body executed",
      { status: r.status, body: r.body },
      r.body === "rejected_unknown_run",
      "A 42501 here would mean the engine could never record anything."
    );
  }

  // =====================================================================
  // B. engine_queue_probe — the six outcomes
  // =====================================================================
  const QUEUES = [
    "engine_assemblable_briefs",
    "engine_briefable_discoveries",
    "engine_unclassified_discoveries",
    "engine_open_media_requirements",
    "engine_freshness_candidates",
    "engine_due_sources",
  ];
  const probeResults: Record<string, { total: number; eligible: number; eligibility: string } | string> = {};
  for (const queue of QUEUES) {
    const { data, error } = await db.rpc("engine_queue_probe", { p_queue: queue });
    const row = Array.isArray(data) ? (data[0] as Record<string, unknown> | undefined) : undefined;
    if (error) {
      probeResults[queue] = `ERROR ${error.code ?? ""} ${error.message}`;
      continue;
    }
    probeResults[queue] = row
      ? {
          total: Number(row.total),
          eligible: Number(row.eligible),
          eligibility: String(row.eligibility),
        }
      : "no row";
  }
  const answered = Object.values(probeResults).filter((v) => typeof v === "object").length;
  record(
    "engine_queue_probe answers for every engine queue",
    `${QUEUES.length} queues`,
    probeResults,
    answered === QUEUES.length,
    "total vs eligible is what separates 'genuinely empty' from 'rows present but filtered'."
  );

  {
    const { data, error } = await db.rpc("engine_queue_probe", { p_queue: "not_a_real_queue" });
    const rows = Array.isArray(data) ? data : [];
    record(
      "an unknown queue name returns NOTHING rather than a reassuring zero",
      "no rows (or an error)",
      error ? `ERROR ${error.message}` : `${rows.length} row(s)`,
      error !== null || rows.length === 0,
      "A zero row for a queue nobody knows about would be a fabricated measurement."
    );
  }

  {
    const r = await anonRpc("engine_queue_probe", { p_queue: "engine_due_sources" });
    const rows = Array.isArray(r.body) ? r.body : [];
    record(
      "anon CAN call engine_queue_probe (the engine runs as anon)",
      "rows, not 42501",
      { status: r.status, rows: rows.length },
      r.status === 200 && rows.length > 0
    );
  }

  // =====================================================================
  // C. engine_job_runs gained the stage-outcome columns
  // =====================================================================
  {
    const { data, error } = await db
      .from("engine_job_runs")
      .select("id,stage_outcome,outcome_ambiguity")
      .limit(1);
    const row = (data as Record<string, unknown>[] | null)?.[0];
    record(
      "engine_job_runs carries stage_outcome and outcome_ambiguity",
      "both columns readable",
      error ? `ERROR ${error.code ?? ""} ${error.message}` : row ? Object.keys(row) : "no rows",
      !error && !!row && "stage_outcome" in row && "outcome_ambiguity" in row
    );
  }

  {
    // The migration's own header leaves this as an explicit TODO. Asserted so
    // the gap is recorded rather than assumed closed.
    const { data, error } = await db.rpc("engine_recent_job_runs", { p_hours: 720, p_limit: 1 });
    const row = Array.isArray(data) ? (data[0] as Record<string, unknown> | undefined) : undefined;
    const exposed = !!row && "stage_outcome" in row;
    checks.push({
      name: "KNOWN GAP: engine_recent_job_runs does NOT yet expose stage_outcome",
      passed: true,
      expected: "not exposed — the migration leaves this an explicit TODO",
      actual: error ? `ERROR ${error.message}` : exposed ? "EXPOSED (gap closed)" : "not exposed",
      note: exposed
        ? "The gap appears closed. Verify why and update the record."
        : "Confirms the documented gap: the columns exist but no reader can see them, so nothing downstream can use them yet.",
    });
  }

  // -- cleanup ---------------------------------------------------------------
  if (recordedId) {
    await db.from("engine_change_log").delete().eq("job_name", PROBE_JOB);
    const { data: leftover } = await db
      .from("engine_change_log")
      .select("id")
      .eq("job_name", PROBE_JOB);
    record(
      "probe change rows cleaned up",
      "0 leftover",
      { leftover: (leftover as unknown[] | null)?.length ?? "?" },
      ((leftover as unknown[] | null)?.length ?? 1) === 0
    );
  }

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

main().catch((e) => {
  console.error("verification threw:", e instanceof Error ? e.message : e);
  process.exitCode = 1;
});
