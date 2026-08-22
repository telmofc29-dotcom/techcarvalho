// INTEGRATION PROOF: rollback restores the exact previous state.
//
//   TC_ADMIN_EMAIL=... TC_ADMIN_PASSWORD=... npx tsx scripts/proof-rollback.ts
//
// THE SHAPE OF THE PROOF
//   1. capture a representative state (real tables, real columns, byte-for-byte)
//   2. perform a controlled mutation (an engine-shaped assembly: a draft plus
//      its dependent rows, and an UPDATE to an existing row)
//   3. invoke rollback
//   4. prove the exact previous state is restored — every captured value
//      compared individually, not a row count
//
// WHY IT RUNS AGAINST PRODUCTION, AND WHY THAT IS SAFE
// ----------------------------------------------------
// There is no second database. Every row this script touches it CREATED, in
// tables it then empties again; the one pre-existing row it modifies is an
// engine_briefs row whose exact prior values are captured first and asserted
// restored at the end. It refuses to run if it cannot find a brief it may
// safely borrow, and it verifies its own cleanup rather than assuming it.
//
// It also proves the REFUSALS, which are the actual safety argument: a
// published row, and a row edited after the engine wrote it, must both make the
// whole plan refuse rather than half-reverse.
//
// Authenticates as a real admin — the same signInWithPassword/RLS path the web
// app uses. Rollback is deliberately not reachable as `anon`; see rollback.ts.

import { loadEnvLocal, createAdminClient } from "./_shared.ts";
import {
  planRollback,
  mayExecute,
  type RecordedChange,
  type CurrentRowState,
} from "../src/lib/engine/rollback.ts";

loadEnvLocal();

const RUN = `proof-rollback-${Date.now()}`;
const MARKER = `TC ROLLBACK PROOF ${Date.now()}`;

type Client = {
  from: (t: string) => {
    select: (c: string) => Record<string, (...a: unknown[]) => unknown>;
    insert: (v: Record<string, unknown>) => Record<string, (...a: unknown[]) => unknown>;
    update: (v: Record<string, unknown>) => Record<string, (...a: unknown[]) => unknown>;
    delete: () => Record<string, (...a: unknown[]) => unknown>;
  };
};

/** Read the live state of every row this proof touches. Shared so the refusal
 *  arms and the clean arm are looking at the database the same way. */
async function readCurrent(
  q: { from: (t: string) => any }, // eslint-disable-line @typescript-eslint/no-explicit-any
  contentId: string,
  sourceId: string,
  mediaReqId: string,
  briefId: string,
  briefAfter: Record<string, unknown>
): Promise<CurrentRowState[]> {
  const out: CurrentRowState[] = [];
  const { data: c } = await q.from("content_items").select("id,title,slug,status").eq("id", contentId).maybeSingle();
  out.push({
    table: "content_items",
    rowId: contentId,
    present: !!c,
    published: c?.status === "published",
    columns: c ? { title: c.title, slug: c.slug, status: c.status } : {},
  });
  for (const [table, id] of [["source_records", sourceId], ["media_requirements", mediaReqId]] as const) {
    const { data } = await q.from(table).select("id").eq("id", id).maybeSingle();
    out.push({ table, rowId: id, present: !!data, published: false, columns: {} });
  }
  const { data: b } = await q.from("engine_briefs").select("state,review_state").eq("id", briefId).maybeSingle();
  out.push({
    table: "engine_briefs",
    rowId: briefId,
    present: !!b,
    published: false,
    columns: { state: b?.state, review_state: b?.review_state },
  });
  void briefAfter;
  return out;
}

const checks: { name: string; passed: boolean; detail: string }[] = [];
function record(name: string, passed: boolean, detail: string): void {
  checks.push({ name, passed, detail });
}

async function main(): Promise<void> {
  const db = (await createAdminClient()) as unknown as Client;
  const q = db as unknown as {
    from: (t: string) => any; // eslint-disable-line @typescript-eslint/no-explicit-any
  };

  console.log("=== ROLLBACK — INTEGRATION PROOF ===");
  console.log(`run id: ${RUN}\n`);

  const createdContentIds: string[] = [];
  let borrowedBriefId: string | null = null;
  let briefBefore: Record<string, unknown> | null = null;

  try {
    // ---------------------------------------------------------------------
    // 1. CAPTURE A REPRESENTATIVE STATE
    // ---------------------------------------------------------------------
    const { data: briefs, error: briefErr } = await q
      .from("engine_briefs")
      .select("id,state,review_state,rationale")
      .limit(1);
    if (briefErr) throw new Error(`could not read engine_briefs: ${briefErr.message}`);
    if (!briefs || briefs.length === 0) {
      throw new Error("no engine_briefs row exists to borrow; cannot prove the UPDATE arm honestly");
    }
    borrowedBriefId = briefs[0].id as string;
    briefBefore = { state: briefs[0].state, review_state: briefs[0].review_state };

    const { count: contentBefore } = await q
      .from("content_items")
      .select("id", { count: "exact", head: true });

    console.log("CAPTURED:");
    console.log(`  engine_briefs ${borrowedBriefId} = ${JSON.stringify(briefBefore)}`);
    console.log(`  content_items count = ${contentBefore}`);

    // ---------------------------------------------------------------------
    // 2. CONTROLLED MUTATION — the shape engine_assemble_draft actually writes
    // ---------------------------------------------------------------------
    const slug = `tc-rollback-proof-${Date.now()}`;
    const { data: inserted, error: insErr } = await q
      .from("content_items")
      .insert({
        type: "news",
        title: MARKER,
        slug,
        body: "Created by scripts/proof-rollback.ts. Deleted by the rollback under test.",
        status: "draft",
      })
      .select("id,title,slug,status")
      .single();
    if (insErr) throw new Error(`could not create the probe draft: ${insErr.message}`);
    const contentId = inserted.id as string;
    createdContentIds.push(contentId);

    const { data: source, error: srcErr } = await q
      .from("source_records")
      .insert({
        content_id: contentId,
        url: "https://example.invalid/tc-rollback-proof",
        reliability_tier: "secondary",
      })
      .select("id")
      .single();
    if (srcErr) throw new Error(`could not create the probe source record: ${srcErr.message}`);

    const { data: mediaReq, error: mrErr } = await q
      .from("media_requirements")
      .insert({
        content_id: contentId,
        sourcing_status: "needed",
        notes: "Created by the rollback proof.",
      })
      .select("id")
      .single();
    if (mrErr) throw new Error(`could not create the probe media requirement: ${mrErr.message}`);

    // ...and the UPDATE arm: move the borrowed brief, exactly as assembly does.
    //
    // The target value is chosen to DIFFER from what is already there. An
    // earlier run of this proof happened to borrow a brief that was already in
    // 'drafting', so the mutation changed nothing and the "restore" restored a
    // value that had never moved — 10/10 green, proving nothing about the
    // update arm at all. A proof that can accidentally become a no-op is not a
    // proof, so the difference is now asserted rather than assumed.
    const targetState = briefBefore.state === "drafting" ? "planned" : "drafting";
    if (targetState === briefBefore.state) {
      throw new Error("the mutation would not change anything; the update arm would prove nothing");
    }
    const briefAfter = { state: targetState, review_state: briefBefore.review_state };
    const { error: updErr } = await q
      .from("engine_briefs")
      .update({ state: targetState })
      .eq("id", borrowedBriefId);
    if (updErr) throw new Error(`could not update the borrowed brief: ${updErr.message}`);

    console.log("\nMUTATED:");
    console.log(`  content_items      + ${contentId}`);
    console.log(`  source_records     + ${source.id}`);
    console.log(`  media_requirements + ${mediaReq.id}`);
    console.log(`  engine_briefs      ${borrowedBriefId}.state ${JSON.stringify(briefBefore.state)} -> ${JSON.stringify(targetState)}`);

    const { data: midBrief } = await q.from("engine_briefs").select("state").eq("id", borrowedBriefId).maybeSingle();
    record(
      "the controlled mutation actually changed the row before rollback ran",
      midBrief?.state === targetState && targetState !== briefBefore.state,
      `state is now ${JSON.stringify(midBrief?.state)}, was ${JSON.stringify(briefBefore.state)} — a real change to reverse`
    );

    const changes: RecordedChange[] = [
      { runId: RUN, sequence: 1, table: "content_items", rowId: contentId, operation: "insert", before: null, after: { title: MARKER, slug, status: "draft" } },
      { runId: RUN, sequence: 2, table: "source_records", rowId: source.id as string, operation: "insert", before: null, after: null },
      { runId: RUN, sequence: 3, table: "media_requirements", rowId: mediaReq.id as string, operation: "insert", before: null, after: null },
      { runId: RUN, sequence: 4, table: "engine_briefs", rowId: borrowedBriefId, operation: "update", before: briefBefore, after: briefAfter },
    ];

    // ---------------------------------------------------------------------
    // 3a. REFUSAL, GENUINELY INDUCED: a PUBLISHED row
    // ---------------------------------------------------------------------
    // The row is really set to status='published' in the database — not
    // simulated in memory — with published_at deliberately in the FUTURE.
    // Public RLS is `status = 'published' and published_at <= now()`, so the
    // row is genuinely published as far as the rollback guard is concerned and
    // is never visible on the site for a single moment. Verified below rather
    // than asserted.
    const FUTURE = new Date(Date.now() + 365 * 24 * 3600 * 1000).toISOString();
    const { error: pubErr } = await q
      .from("content_items")
      .update({ status: "published", published_at: FUTURE })
      .eq("id", contentId);
    if (pubErr) throw new Error(`could not induce the published state: ${pubErr.message}`);

    const anonSees = await fetch(
      `${process.env.NEXT_PUBLIC_SUPABASE_URL}/rest/v1/content_items?id=eq.${contentId}&select=id`,
      {
        headers: {
          apikey: process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY!,
          Authorization: `Bearer ${process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY!}`,
        },
      }
    );
    const anonRows = (await anonSees.json().catch(() => [])) as unknown[];
    record(
      "inducing 'published' with a future date is invisible to the public",
      Array.isArray(anonRows) && anonRows.length === 0,
      `anon sees ${Array.isArray(anonRows) ? anonRows.length : "?"} row(s) — the induced state never reaches a reader`
    );

    const publishedNow = await readCurrent(q, contentId, source.id as string, mediaReq.id as string, borrowedBriefId, briefAfter);
    const refusedPlan = planRollback(changes, publishedNow, { runId: RUN });
    record(
      "a genuinely PUBLISHED row refuses the entire plan, not just its own row",
      !mayExecute(refusedPlan).allowed && refusedPlan.refusals.some((r) => r.code === "row_published"),
      `complete=${refusedPlan.complete} refusals=${refusedPlan.refusals.map((r) => r.code).join(",")} ` +
        `— and note the source_records row was NOT deleted, so a published article never loses its sources`
    );

    // Put it back to draft so the run can continue.
    await q.from("content_items").update({ status: "draft", published_at: null }).eq("id", contentId);

    // ---------------------------------------------------------------------
    // 3b. REFUSAL, GENUINELY INDUCED: a human edit landing after the engine
    // ---------------------------------------------------------------------
    await q.from("content_items").update({ title: "An editor rewrote this by hand" }).eq("id", contentId);
    const editedNow = await readCurrent(q, contentId, source.id as string, mediaReq.id as string, borrowedBriefId, briefAfter);
    const editedPlan = planRollback(changes, editedNow, { runId: RUN });
    record(
      "a genuinely EDITED row refuses the entire plan",
      !mayExecute(editedPlan).allowed && editedPlan.refusals.some((r) => r.code === "row_modified_since"),
      `refusals=${editedPlan.refusals.map((r) => r.code).join(",")} — the editor's title is not discarded`
    );

    // Restore the engine's own title so the clean-run arm is a fair test.
    await q.from("content_items").update({ title: MARKER }).eq("id", contentId);

    // ---------------------------------------------------------------------
    // 3c. THE REAL ROLLBACK — current state read from the database
    // ---------------------------------------------------------------------
    const current = await readCurrent(q, contentId, source.id as string, mediaReq.id as string, borrowedBriefId, briefAfter);

    const plan = planRollback(changes, current, { runId: RUN });
    const gate = mayExecute(plan);
    console.log(`\nPLAN: ${plan.summary}`);
    record("the plan for a clean run is complete and executable", gate.allowed, gate.why);
    if (!gate.allowed) throw new Error(`rollback refused unexpectedly: ${gate.why}`);

    for (const action of plan.actions) {
      if (action.kind === "restore") {
        const { error } = await q.from(action.table).update(action.columns).eq("id", action.rowId);
        if (error) throw new Error(`restore ${action.table}/${action.rowId} failed: ${error.message}`);
        console.log(`  restored ${action.table}/${action.rowId} -> ${JSON.stringify(action.columns)}`);
      } else {
        const { error } = await q.from(action.table).delete().eq("id", action.rowId);
        if (error) throw new Error(`delete ${action.table}/${action.rowId} failed: ${error.message}`);
        console.log(`  deleted  ${action.table}/${action.rowId}`);
      }
    }

    // ---------------------------------------------------------------------
    // 4. PROVE THE EXACT PREVIOUS STATE IS RESTORED
    // ---------------------------------------------------------------------
    const { data: goneContent } = await q.from("content_items").select("id").eq("id", contentId).maybeSingle();
    record("the created draft is gone", !goneContent, goneContent ? "STILL PRESENT" : "absent");
    if (!goneContent) createdContentIds.length = 0;

    for (const [table, id] of [["source_records", source.id], ["media_requirements", mediaReq.id]] as const) {
      const { data } = await q.from(table).select("id").eq("id", id).maybeSingle();
      record(`the created ${table} row is gone`, !data, data ? "STILL PRESENT" : "absent");
    }

    const { data: restoredBrief } = await q.from("engine_briefs").select("state,review_state,rationale").eq("id", borrowedBriefId).maybeSingle();
    const exact =
      restoredBrief?.state === briefBefore.state && restoredBrief?.review_state === briefBefore.review_state;
    record(
      "the updated row holds EXACTLY its previous values",
      exact,
      `before=${JSON.stringify(briefBefore)} after-rollback=${JSON.stringify({ state: restoredBrief?.state, review_state: restoredBrief?.review_state })}`
    );
    record(
      "a column the engine never wrote was not touched",
      typeof restoredBrief?.rationale === "string" && restoredBrief.rationale === briefs[0].rationale,
      "rationale is byte-identical; only the columns the engine wrote were restored"
    );
    briefBefore = null; // restored; no cleanup needed

    const { count: contentAfter } = await q.from("content_items").select("id", { count: "exact", head: true });
    record(
      "the content_items count is exactly what it was before",
      contentAfter === contentBefore,
      `before=${contentBefore} after=${contentAfter}`
    );
  } finally {
    // Belt and braces: if anything threw before the rollback ran, undo by hand.
    for (const id of createdContentIds) {
      await q.from("source_records").delete().eq("content_id", id);
      await q.from("media_requirements").delete().eq("content_id", id);
      await q.from("content_items").delete().eq("id", id);
      console.log(`\ncleanup: removed leftover probe content ${id}`);
    }
    if (borrowedBriefId && briefBefore) {
      await q.from("engine_briefs").update(briefBefore).eq("id", borrowedBriefId);
      console.log(`cleanup: restored borrowed brief ${borrowedBriefId}`);
    }
  }

  console.log("\n--- RESULT ---");
  let failed = 0;
  for (const c of checks) {
    if (!c.passed) failed++;
    console.log(`[${c.passed ? "PASS" : "FAIL"}] ${c.name}`);
    console.log(`       ${c.detail}`);
  }
  console.log(`\n${checks.length - failed}/${checks.length} checks passed.`);
  if (failed > 0) process.exitCode = 1;
}

main().catch((e) => {
  console.error("\nproof threw:", e instanceof Error ? e.message : e);
  process.exitCode = 1;
});
