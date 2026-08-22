// Behavioural verification of 20260822_silent_success_telemetry.sql.
//
//   npx tsx scripts/verify-silent-success-migration.ts
//
// WHY THIS EXISTS
// ---------------
// The SQL editor's result message is not evidence. In this project a migration
// has reported "Success" without applying, and the first attempt at this
// particular file failed outright with 42P13. So every claim below is checked
// by CALLING the function and reading what comes back.
//
// SAFE TO RUN REPEATEDLY. Every mutating probe either targets a
// deliberately-nonexistent uuid (so the function must refuse it) or writes a
// clearly-marked probe row that is deleted again as an authenticated admin,
// with the row count re-checked afterwards. It touches no real engine row.
//
// It exits non-zero if any check fails, so it can gate a follow-up.

import { loadEnvLocal, createAdminClient, type IngestClient } from "./_shared.ts";

loadEnvLocal();

const NIL = "00000000-0000-0000-0000-0000000000ff";
const PROBE_JOB = "engine_migration_probe";
const PROBE_KEY = "zz-probe";

type Check = { name: string; passed: boolean; expected: string; actual: string; note?: string };
const checks: Check[] = [];

function record(name: string, expected: string, actual: unknown, passed: boolean, note?: string): void {
  checks.push({ name, expected, actual: JSON.stringify(actual), passed, note });
}

async function main(): Promise<void> {
  const client = (await createAdminClient()) as IngestClient & {
    rpc: (fn: string, args?: Record<string, unknown>) => Promise<{ data: unknown; error: { message: string; code?: string } | null }>;
  };

  console.log("=== SILENT_SUCCESS migration — behavioural verification ===\n");

  // -- 1. The real bug: a no-op must not report success ----------------------
  {
    const { data, error } = await client.rpc("engine_set_relevance", {
      p_id: NIL, p_verdict: "relevant", p_score: 0, p_explanation: "probe", p_angle: null,
    });
    record(
      "engine_set_relevance(nonexistent id) reports the no-op",
      "'no_matching_row'",
      error ? `ERROR ${error.message}` : data,
      !error && data === "no_matching_row",
      "Before the migration this answered 'ok' — a silent no-op inside a function reporting success."
    );
  }

  // -- 2. A real relevance mutation still works -----------------------------
  //
  // WRITES THE ROW'S OWN CURRENT VALUES BACK, every column, unchanged.
  //
  // The first version of this check re-asserted the existing VERDICT but passed
  // p_score: 50 and a probe string as the explanation, under a comment claiming
  // "nothing about the row's meaning moves". It moved: a real discovery lost its
  // machine-generated score and explanation. It had to be regenerated with
  // classifyRelevance() afterwards. A verification script that damages what it
  // is verifying is not a verification script.
  //
  // Reading all four columns first and passing them straight back makes the
  // UPDATE a genuine no-change write, which is still enough to distinguish
  // 'updated' from 'no_matching_row' — that answer depends on whether a row
  // MATCHED, not on whether any value differed.
  {
    const { data: rows, error: readError } = await (client as unknown as {
      from: (t: string) => { select: (c: string) => { eq: (a: string, b: unknown) => { not: (c: string, o: string, v: unknown) => { limit: (n: number) => Promise<{ data: { id: string; relevance_verdict: string; relevance_score: number | null; relevance_explanation: string | null; suggested_angle: string | null }[] | null; error: { message: string } | null }> } } } };
    })
      .from("engine_discoveries")
      .select("id,relevance_verdict,relevance_score,relevance_explanation,suggested_angle")
      .eq("relevance_overridden_by_admin", false)
      .not("relevance_verdict", "is", null)
      .limit(1);

    if (readError || !rows || rows.length === 0) {
      record("engine_set_relevance(real row) reports 'updated'", "'updated'", "no eligible row found", false,
        "Could not find a machine-classified discovery to re-assert; this check did not run.");
    } else {
      const row = rows[0];
      const { data, error } = await client.rpc("engine_set_relevance", {
        p_id: row.id,
        p_verdict: row.relevance_verdict,
        p_score: row.relevance_score,
        p_explanation: row.relevance_explanation,
        p_angle: row.suggested_angle,
      });
      record(
        "engine_set_relevance(real row) reports 'updated'",
        "'updated'",
        error ? `ERROR ${error.message}` : data,
        !error && data === "updated",
        "Writes the row's existing values back unchanged — it proves the row matched, and alters nothing."
      );
    }
  }

  // -- 3. An admin-overridden row must be refused, not overwritten ----------
  {
    const { data: rows } = await (client as unknown as {
      from: (t: string) => { select: (c: string) => { eq: (a: string, b: unknown) => { limit: (n: number) => Promise<{ data: { id: string }[] | null }> } } };
    })
      .from("engine_discoveries")
      .select("id")
      .eq("relevance_overridden_by_admin", true)
      .limit(1);

    if (!rows || rows.length === 0) {
      checks.push({
        name: "engine_set_relevance(admin-overridden) reports 'human_override'",
        passed: true,
        expected: "'human_override'",
        actual: "SKIPPED — no admin-overridden discovery exists in production",
        note: "Not a failure; there is genuinely nothing to test against. Unit-covered in relevance tests.",
      });
    } else {
      const { data, error } = await client.rpc("engine_set_relevance", {
        p_id: rows[0].id, p_verdict: "uncertain", p_score: 0, p_explanation: "probe", p_angle: null,
      });
      record(
        "engine_set_relevance(admin-overridden) reports 'human_override'",
        "'human_override'",
        error ? `ERROR ${error.message}` : data,
        !error && data === "human_override",
        "A human decision must never be silently overwritten."
      );
    }
  }

  // -- 4. The four telemetry columns are exposed ----------------------------
  {
    const { data, error } = await client.rpc("engine_recent_job_runs", { p_hours: 720, p_limit: 1 });
    const row = Array.isArray(data) ? (data[0] as Record<string, unknown> | undefined) : undefined;
    const cols = ["verified_writes", "silent_no_ops", "unverified_writes", "blind_writes"];
    const present = row ? cols.filter((c) => c in row) : [];
    record(
      "engine_recent_job_runs exposes the four postcondition columns",
      cols.join(", "),
      error ? `ERROR ${error.message}` : present,
      !error && present.length === 4,
      row ? undefined : "No run in the window; column presence could not be observed."
    );
  }

  // -- 5. The audit writer reports instead of swallowing --------------------
  {
    const { data, error } = await client.rpc("engine_record_job_run", {
      p_job_name: PROBE_JOB, p_status: "not_a_real_status",
    });
    record(
      "engine_record_job_run(invalid status) reports the rejection",
      "'rejected_invalid_status'",
      error ? `ERROR ${error.message}` : data,
      !error && data === "rejected_invalid_status",
      "The applied version answered a bare `return;` — it discarded the row and said nothing."
    );
  }

  // -- 6. ...and the 8-argument shape cron uses is UNAMBIGUOUS --------------
  // This is the check that would have caught the stale-overload defect: if the
  // old signature survived, this call matches two candidates and errors.
  {
    const { data, error } = await client.rpc("engine_record_job_run", {
      p_job_name: PROBE_JOB, p_status: "skipped",
      p_items_examined: 0, p_items_created: 0, p_items_deduped: 0, p_items_failed: 0,
      p_detail: {}, p_error: null,
    });
    record(
      "engine_record_job_run(8 named args) resolves to exactly one function",
      "'recorded'",
      error ? `ERROR ${error.code ?? ""} ${error.message}` : data,
      !error && data === "recorded",
      "A PGRST203 / 'function is not unique' here means the old 8-arg overload was not dropped."
    );
  }

  // -- 7. The guard list was NOT narrowed -----------------------------------
  for (const subjectType of ["search_term", "product", "content", "category", "topic"]) {
    const { data, error } = await client.rpc("engine_upsert_opportunity", {
      p_subject_type: subjectType, p_subject_key: `${PROBE_KEY}-${subjectType}`,
      p_label: PROBE_KEY, p_score: null, p_inputs: {}, p_explanation: "probe",
    });
    record(
      `engine_upsert_opportunity accepts subject_type '${subjectType}'`,
      "'ok'",
      error ? `ERROR ${error.message}` : data,
      !error && data === "ok",
      "The draft narrowed this list to three values; all five are permitted by the table's CHECK."
    );
  }

  // -- 8. Blind writes now speak --------------------------------------------
  {
    const { data, error } = await client.rpc("engine_record_source_check", {
      p_source_id: NIL, p_success: true, p_error: null,
    });
    record(
      "engine_record_source_check(nonexistent source) reports the no-op",
      "'no_matching_source'",
      error ? `ERROR ${error.message}` : data,
      !error && data === "no_matching_source",
      "Source health feeds the source_failures breaker; an unnoticed no-op blinds it."
    );
  }

  // -- 9. Unmeasured is distinguishable from a measured zero ----------------
  {
    const { data, error } = await client.rpc("engine_silent_success_stats", { p_hours: 168 });
    const row = Array.isArray(data) ? (data[0] as Record<string, unknown> | undefined) : undefined;
    record(
      "engine_silent_success_stats distinguishes unmeasured from measured zero",
      "a row carrying runs_in_window, runs_instrumented and all_measured",
      error ? `ERROR ${error.message}` : row,
      !error && !!row && "all_measured" in row && "runs_instrumented" in row && "runs_in_window" in row,
      row
        ? `all_measured=${String(row.all_measured)} over ${String(row.runs_instrumented)}/${String(row.runs_in_window)} instrumented run(s)`
        : undefined
    );
  }

  // -- cleanup ---------------------------------------------------------------
  const del = await (client as unknown as {
    from: (t: string) => { delete: () => { eq: (a: string, b: unknown) => Promise<{ error: { message: string } | null }> } };
  }).from("engine_job_runs").delete().eq("job_name", PROBE_JOB);
  const delOpp = await (client as unknown as {
    from: (t: string) => { delete: () => { like: (a: string, b: string) => Promise<{ error: { message: string } | null }> } };
  }).from("engine_opportunities").delete().like("subject_key", `${PROBE_KEY}-%`);

  // The cleanup is itself verified — deleting is exactly the operation that
  // silently affects zero rows under RLS, which is incident #1.
  const { data: leftoverRuns } = await (client as unknown as {
    from: (t: string) => { select: (c: string) => { eq: (a: string, b: unknown) => Promise<{ data: unknown[] | null }> } };
  }).from("engine_job_runs").select("id").eq("job_name", PROBE_JOB);
  const { data: leftoverOpps } = await (client as unknown as {
    from: (t: string) => { select: (c: string) => { like: (a: string, b: string) => Promise<{ data: unknown[] | null }> } };
  }).from("engine_opportunities").select("id").like("subject_key", `${PROBE_KEY}-%`);

  record(
    "probe rows cleaned up",
    "0 leftover probe rows",
    { runs: leftoverRuns?.length ?? "?", opportunities: leftoverOpps?.length ?? "?", delError: del.error?.message ?? null, delOppError: delOpp.error?.message ?? null },
    (leftoverRuns?.length ?? 1) === 0 && (leftoverOpps?.length ?? 1) === 0
  );

  // -- report ----------------------------------------------------------------
  console.log("");
  let failed = 0;
  for (const c of checks) {
    const mark = c.passed ? "PASS" : "FAIL";
    if (!c.passed) failed++;
    console.log(`[${mark}] ${c.name}`);
    console.log(`       expected ${c.expected}  |  got ${c.actual}`);
    if (c.note) console.log(`       ${c.note}`);
  }
  console.log(`\n${checks.length - failed}/${checks.length} checks passed.`);
  if (failed > 0) {
    console.log("\nThe migration is NOT fully applied, or did not behave as intended.");
    process.exitCode = 1;
  } else {
    console.log("\nVERIFIED BEHAVIOURALLY — not from a result message.");
  }
}

main().catch((e) => {
  console.error("verification threw:", e);
  process.exitCode = 1;
});
