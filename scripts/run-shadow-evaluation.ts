// Run the SHADOW evaluation against real production candidates.
//
//   npx tsx scripts/run-shadow-evaluation.ts              # evaluate, persist nothing
//   npx tsx scripts/run-shadow-evaluation.ts --persist    # also attempt to record decisions
//   npx tsx scripts/run-shadow-evaluation.ts --limit 25
//
// WHY THIS EXISTS ALONGSIDE THE CRON JOB
// --------------------------------------
// src/lib/engine/jobs/shadow-job.ts is the real path: it runs as `anon` inside
// the tick and reaches the database only through the SECURITY DEFINER RPCs in
// 20260822_engine_shadow_evaluation.sql.
//
// STATUS 2026-08-22: that migration IS APPLIED. Verified behaviourally, not
// from the filename — engine_shadow_ledger/_candidates/_escapes/_sources/
// _content_signals/_proof_runs all answer 200 as anon, and
// engine_shadow_record_decision executes its body. The file is still sitting in
// migrations_pending/, which is what made the header below wrong for a while.
//
// This script exists so the evaluation can be run TODAY, against genuine
// current candidates, without applying anything. It authenticates as a real
// admin (the same signInWithPassword/RLS path scripts/_shared.ts already uses),
// reads the source tables directly, and hands the rows to the SAME pure
// builders and the SAME pure pipeline the job uses. That matters: if the script
// did its own mapping, the numbers it produced would be evidence about the
// script rather than about the engine.
//
// IT PUBLISHES NOTHING, AND CANNOT
// --------------------------------
// Every table read here is a SELECT. The only write it will ever attempt is
// `engine_shadow_record_decision`, and only under --persist. That function
// writes three engine_shadow_* tables and has no parameter naming a content
// item or a product. There is no code path from this script to
// content_items.status or products.is_published.
//
// WHAT IT REPORTS
// ---------------
// Decisions attempted, decisions actually reached, the three-way outcome split,
// pipeline FAILURES counted separately from decisions, and the composition of
// the evaluation set. The composition report is the important half: it is what
// stops a large number of easy decisions reading as readiness.

import { writeFileSync } from "node:fs";
import { loadEnvLocal, createAdminClient, type IngestClient } from "./_shared.ts";
import { runShadowPipeline } from "../src/lib/engine/shadow-pipeline.ts";
import { tallyShadowRun, type ShadowDecision } from "../src/lib/engine/shadow-decision.ts";
import {
  buildShadowCandidate,
  buildShadowContext,
  buildSourceIndex,
  serialiseDecision,
  type RawCandidateRow,
  type RawContentSignalRow,
  type RawEntityRow,
  type RawEvidenceRow,
  type RawManufacturerRow,
  type RawMediaRow,
  type RawSourceRow,
} from "../src/lib/engine/shadow-io.ts";
import { assessComposition, type CompositionEntry } from "../src/lib/engine/shadow-composition.ts";
import { assessShadowReadiness, type LedgerRow } from "../src/lib/engine/shadow-readiness.ts";
import { loadProofRecords } from "../src/lib/engine/proof-store.ts";

loadEnvLocal();

type Args = { persist: boolean; limit: number; out: string | null };

function parseArgs(argv: string[]): Args {
  const limitIndex = argv.indexOf("--limit");
  const outIndex = argv.indexOf("--out");
  return {
    persist: argv.includes("--persist"),
    limit: limitIndex >= 0 ? Number(argv[limitIndex + 1]) || 500 : 500,
    out: outIndex >= 0 ? argv[outIndex + 1] ?? null : null,
  };
}

/** Read a whole table in pages. Supabase caps a single response at 1000 rows. */
async function readAll<T>(client: IngestClient, table: string, columns: string): Promise<T[]> {
  const rows: T[] = [];
  const page = 1000;
  for (let from = 0; ; from += page) {
    const { data, error } = await (client as never as {
      from: (t: string) => {
        select: (c: string) => { range: (a: number, b: number) => Promise<{ data: T[] | null; error: { message: string } | null }> };
      };
    })
      .from(table)
      .select(columns)
      .range(from, from + page - 1);
    // A failed read is never an empty result. This is the 2026-08 lesson: the
    // whole run would otherwise report an honest-looking zero.
    if (error) throw new Error(`Reading ${table} failed: ${error.message}`);
    const batch = data ?? [];
    rows.push(...batch);
    if (batch.length < page) return rows;
  }
}

async function main(): Promise<void> {
  const args = parseArgs(process.argv.slice(2));
  const client = await createAdminClient();

  console.log("=== SHADOW EVALUATION ===");
  console.log(`mode: SHADOW  |  persistence: ${args.persist ? "attempted" : "not attempted"}  |  publishes: NOTHING\n`);

  // --- Read production, read-only -----------------------------------------
  const [discoveries, evidenceRows, sources, mediaRows, contentRows, productRows, manufacturerRows] = await Promise.all([
    readAll<RawCandidateRow & { first_seen_at: string }>(
      client,
      "engine_discoveries",
      "id,dedupe_key,title,summary,discovery_type,category_slug,claim_status,state,sighting_count,first_seen_at,relevance_overridden_by_admin,product_id,content_id"
    ),
    readAll<{
      id: string; discovery_id: string; source_id: string | null; url: string; publisher: string | null;
      excerpt: string | null; claim_status: string; trust_level: string; originates_from_url: string | null;
      retrieved_at: string | null;
    }>(
      client,
      "engine_discovery_evidence",
      "id,discovery_id,source_id,url,publisher,excerpt,claim_status,trust_level,originates_from_url,retrieved_at"
    ),
    readAll<RawSourceRow>(
      client,
      "engine_sources",
      "id,url,organisation,source_type,discovery_permitted,media_republication_permitted,media_rights_status,attribution_required,editorial_use_only,registration_required"
    ),
    readAll<RawMediaRow & { product_id: string | null; content_id: string | null; source_id: string | null }>(
      client,
      "engine_media_candidates",
      "id,product_id,content_id,source_id,source_organisation,source_url,asset_url,asset_type,potential_licence,attribution_required,attribution_text,rights_status,requires_human_review,state"
    ),
    readAll<{ id: string; title: string; slug: string; primary_query: string | null; intent_fingerprint: string | null; type: string | null; category_id: string | null; status: string }>(
      client,
      "content_items",
      "id,title,slug,primary_query,intent_fingerprint,type,category_id,status"
    ),
    readAll<{ id: string; name: string; slug: string; is_published: boolean | null }>(
      client,
      "products",
      "id,name,slug,is_published"
    ),
    readAll<{ id: string; name: string; slug: string }>(client, "manufacturers", "id,name,slug"),
  ]);

  console.log(
    `read: ${discoveries.length} discoveries, ${evidenceRows.length} evidence rows, ${sources.length} sources, ` +
      `${mediaRows.length} media candidates, ${contentRows.length} content items, ${productRows.length} products\n`
  );

  const sourceById = new Map(sources.map((s) => [s.id, s]));
  const sourceIndex = buildSourceIndex(sources);
  const orphanedEvidence = evidenceRows.filter((e) => !e.source_id).length;
  if (orphanedEvidence > 0) {
    console.log(
      `WARNING: ${orphanedEvidence} of ${evidenceRows.length} evidence rows have source_id = NULL.\n` +
        "  engine_upsert_discovery has no p_source_id parameter, so the link from evidence back to the\n" +
        "  source registry that authorised it is never written. Provenance is being recovered by host\n" +
        "  match against engine_sources.url, which fails closed on an unmatched host.\n"
    );
  }
  const evidenceByDiscovery = new Map<string, RawEvidenceRow[]>();
  for (const e of evidenceRows) {
    const source = e.source_id ? sourceById.get(e.source_id) : undefined;
    const row: RawEvidenceRow = {
      id: e.id,
      url: e.url,
      publisher: e.publisher,
      organisation: source?.organisation ?? null,
      excerpt: e.excerpt,
      claim_status: e.claim_status,
      trust_level: e.trust_level,
      originates_from_url: e.originates_from_url,
      retrieved_at: e.retrieved_at,
      source_type: source?.source_type ?? null,
      discovery_permitted: source?.discovery_permitted ?? null,
      media_republication_permitted: source?.media_republication_permitted ?? null,
      media_rights_status: source?.media_rights_status ?? null,
      attribution_required: source?.attribution_required ?? null,
      editorial_use_only: source?.editorial_use_only ?? null,
      registration_required: source?.registration_required ?? null,
    };
    const bucket = evidenceByDiscovery.get(e.discovery_id) ?? [];
    bucket.push(row);
    evidenceByDiscovery.set(e.discovery_id, bucket);
  }

  const mediaFor = (productId: string | null, contentId: string | null): RawMediaRow[] =>
    mediaRows
      .filter((m) => (productId && m.product_id === productId) || (contentId && m.content_id === contentId))
      .map((m) => {
        const source = m.source_id ? sourceById.get(m.source_id) : undefined;
        return {
          ...m,
          registry_media_republication_permitted: source?.media_republication_permitted ?? null,
          registry_media_rights_status: source?.media_rights_status ?? null,
          registry_attribution_required: source?.attribution_required ?? null,
          registry_editorial_use_only: source?.editorial_use_only ?? null,
          registry_registration_required: source?.registration_required ?? null,
          registry_organisation: source?.organisation ?? m.source_organisation ?? null,
        };
      });

  const contentSignals: RawContentSignalRow[] = contentRows
    .filter((c) => c.status === "published")
    .map((c) => ({
      id: c.id,
      title: c.title,
      slug: c.slug,
      primary_query: c.primary_query,
      intent_fingerprint: c.intent_fingerprint,
      content_type: c.type,
      category_id: c.category_id,
    }));

  const entities: RawEntityRow[] = [
    ...productRows.map((p) => ({ kind: "product", id: p.id, name: p.name, slug: p.slug, is_published: p.is_published })),
    ...contentRows.map((c) => ({ kind: "content", id: c.id, name: c.title, slug: c.slug, is_published: c.status === "published" })),
  ];
  const reference: RawManufacturerRow[] = manufacturerRows.map((m) => ({ kind: "manufacturer", ...m }));

  const context = buildShadowContext({
    now: new Date().toISOString(),
    contentSignals,
    entities,
    reference,
  });

  // --- Is persistence available? ------------------------------------------
  const ledgerProbe = await client.rpc("engine_shadow_ledger", { p_limit: 20000 });
  const ledgerAvailable = !ledgerProbe.error;
  if (!ledgerAvailable) {
    console.log(
      `PERSISTENCE UNAVAILABLE: ${ledgerProbe.error?.message}\n` +
        "  supabase/migrations_pending/20260822_engine_shadow_evaluation.sql has not been applied.\n" +
        "  Decisions below are REAL and were genuinely computed, but NONE of them is recorded,\n" +
        "  and therefore NONE of them counts toward readiness. Readiness stays 0/500.\n"
    );
  }
  const alreadyRecorded = new Set(
    ((ledgerProbe.data ?? []) as { candidate_identity: string }[]).map((r) => r.candidate_identity)
  );

  // --- Run -----------------------------------------------------------------
  const decisions: ShadowDecision[] = [];
  const entries: CompositionEntry[] = [];
  const persistResults: Record<string, number> = {};
  let attempted = 0;
  let skippedAlreadyRecorded = 0;

  for (const row of discoveries.slice(0, args.limit)) {
    const candidateEvidence = evidenceByDiscovery.get(row.id) ?? [];
    const candidate = buildShadowCandidate(
      row,
      candidateEvidence,
      mediaFor(row.product_id, row.content_id),
      sourceIndex
    );
    if (alreadyRecorded.has(`discovery:${(row.dedupe_key ?? row.id).toLowerCase()}`)) {
      skippedAlreadyRecorded++;
      continue;
    }

    attempted++;
    const record = runShadowPipeline(candidate, context);
    decisions.push(record.decision);
    entries.push({
      identity: record.identity,
      title: record.title,
      publisher: record.publisher,
      dimensions: record.dimensions,
      day: record.day,
      complete: record.decision.kind === "decision" && record.decision.outcome !== null,
      terminalStage: record.decision.terminalStage,
      reachedGate: record.decision.reachedGate,
    });

    if (args.persist) {
      const { data, error } = await client.rpc("engine_shadow_record_decision", serialiseDecision(record));
      const key = error ? `error: ${error.code ?? error.message}` : String(data);
      persistResults[key] = (persistResults[key] ?? 0) + 1;
    }
  }

  // --- Report --------------------------------------------------------------
  const tally = tallyShadowRun(decisions);
  const composition = assessComposition(entries);

  console.log("--- DECISIONS ---");
  console.log(`candidates available        ${discoveries.length}`);
  console.log(`skipped (already recorded)  ${skippedAlreadyRecorded}`);
  console.log(`decisions attempted         ${attempted}`);
  console.log(`complete decisions          ${tally.decisions}`);
  console.log(`pipeline FAILURES           ${tally.failures}   (counted separately — a crash is not a decision)`);
  console.log(`reached the publication gate ${tally.reachedGate}`);
  console.log("");
  console.log("--- OUTCOME SPLIT ---");
  for (const [outcome, count] of Object.entries(tally.outcomes)) {
    console.log(`${outcome.padEnd(26)} ${count}`);
  }
  console.log("");
  console.log("--- TERMINAL STAGE ---");
  for (const [stage, count] of Object.entries(tally.terminalStages).sort((a, b) => b[1] - a[1])) {
    console.log(`${stage.padEnd(26)} ${count}`);
  }
  console.log("");
  console.log("--- TOP REASON CODES ---");
  for (const [code, count] of Object.entries(tally.reasonCodes).sort((a, b) => b[1] - a[1]).slice(0, 20)) {
    console.log(`${code.padEnd(40)} ${count}`);
  }
  console.log("");
  console.log("--- EVALUATION-SET COMPOSITION ---");
  console.log(`records                     ${composition.totalRecords}`);
  console.log(`complete                    ${composition.completeRecords}`);
  console.log(`CREDITED toward readiness   ${composition.creditedDecisions}`);
  console.log(`  refused: duplicate id     ${composition.duplicateIdentitiesRefused}`);
  console.log(`  refused: incomplete       ${composition.incompleteRefused}`);
  console.log(`  refused: family cap       ${composition.familyCapRefused}`);
  console.log(`distinct families           ${composition.distinctFamilies}`);
  console.log(`distinct days               ${composition.distinctDays}`);
  console.log(`largest family share        ${(composition.largestFamilyShare * 100).toFixed(1)}%`);
  console.log(`terminated before the gate  ${(composition.earlyTerminationShare * 100).toFixed(1)}%`);
  console.log("");
  console.log("dimension                          credited / required");
  for (const c of composition.coverage) {
    console.log(`  ${c.dimension.padEnd(32)} ${String(c.credited).padStart(4)} / ${c.required}  ${c.met ? "OK" : "GAP"}`);
  }
  console.log("");

  if (args.persist) {
    console.log("--- PERSISTENCE ---");
    for (const [result, count] of Object.entries(persistResults)) console.log(`${result.padEnd(50)} ${count}`);
    console.log("");
  }

  // --- Readiness, from what is actually RECORDED ---------------------------
  //
  // RE-READ. The earlier probe at the top of this function is a BEFORE picture:
  // it exists to find which candidates were already recorded so this run does
  // not re-attempt them. Reusing it here was a real bug — the first --persist
  // run against the applied schema recorded 118 decisions and then reported
  // "0/500 credited", because readiness was computed from a snapshot taken
  // before those writes. The section was labelled "from what is RECORDED",
  // which made the wrong number look authoritative rather than stale.
  //
  // It failed in the conservative direction, which is why it survived review:
  // an understated readiness number does not unlock anything. It is still a
  // reporting bug, and a readiness figure that cannot see today's work is not
  // measuring readiness.
  const ledgerAfter = await client.rpc("engine_shadow_ledger", { p_limit: 20000 });
  if (ledgerAfter.error) {
    console.log(
      `LEDGER RE-READ FAILED: ${ledgerAfter.error.message}\n` +
        "  Readiness below is computed from the PRE-RUN snapshot and therefore excludes " +
        "anything recorded by this run.\n"
    );
  }
  const ledgerSource = ledgerAfter.error ? ledgerProbe : ledgerAfter;

  const ledger: LedgerRow[] = ((ledgerSource.data ?? []) as {
    candidate_identity: string; title: string; publisher: string | null; decided_on: string;
    record_kind: string; outcome: string | null; terminal_stage: string; reached_gate: boolean; dimensions: string[];
  }[]).map((r) => ({
    candidateIdentity: r.candidate_identity,
    title: r.title,
    publisher: r.publisher,
    decidedOn: r.decided_on,
    recordKind: r.record_kind === "decision" ? "decision" : "failure",
    outcome: r.outcome as LedgerRow["outcome"],
    terminalStage: r.terminal_stage,
    reachedGate: r.reached_gate,
    dimensions: r.dimensions ?? [],
  }));

  const escapesProbe = await client.rpc("engine_shadow_escapes");
  // The `.error` here was DISCARDED, and the seven `?? 0` defaults below then
  // reported zero fabricated-claim escapes, zero unlicensed-media escapes and
  // zero bypassed hard blockers — the three zero-tolerance criteria — to the
  // readiness assessor as though they had been measured. Every other unknown in
  // this pipeline fails closed; this one failed OPEN, toward unlocking autonomy.
  if (escapesProbe.error) {
    console.log(
      `ESCAPE COUNTS UNREADABLE: ${escapesProbe.error.message}\n` +
        "  A spotless escape record was NOT observed — nothing was observed. Readiness is blocked.\n"
    );
  }
  const escapeRow = (escapesProbe.data ?? [])[0] as
    | { would_publish: number; fabricated_claim_escapes: number; unlicensed_media_escapes: number; bypassed_hard_blockers: number; duplicate_leakage: number; human_reviewed: number; human_disagreed: number }
    | undefined;

  const readiness = assessShadowReadiness({
    ledger,
    escapes: {
      wouldPublish: escapeRow?.would_publish ?? 0,
      fabricatedClaimEscapes: escapeRow?.fabricated_claim_escapes ?? 0,
      unlicensedMediaEscapes: escapeRow?.unlicensed_media_escapes ?? 0,
      bypassedHardBlockers: escapeRow?.bypassed_hard_blockers ?? 0,
      duplicateLeakage: escapeRow?.duplicate_leakage ?? 0,
      humanReviewed: escapeRow?.human_reviewed ?? 0,
      humanDisagreed: escapeRow?.human_disagreed ?? 0,
    },
    // The repository's proof records, NOT an empty list and NOT the
    // engine_shadow_proof_runs table.
    //
    // Empty was wrong: it made every proof read "Never exercised" here while
    // /admin/engine/autonomy — reading the same records — correctly showed one
    // proven. Two readiness figures that disagree are worse than one that is
    // merely conservative, because it is no longer clear which to believe.
    //
    // The database table is deliberately NOT the source. A security audit of
    // the anon RPC surface found engine_shadow_record_proof_run is executable
    // by any holder of the publishable key, with p_level accepting
    // 'production_proven' and free-text evidence. Proof records live in the
    // repository precisely so that changing one takes a reviewable commit
    // rather than an HTTP request.
    proofRecords: loadProofRecords(),
    ledgerAvailable,
    ledgerUnavailableReason: ledgerProbe.error?.message,
    escapesAvailable: !escapesProbe.error,
    escapesUnavailableReason: escapesProbe.error?.message,
  });

  console.log("--- READINESS (from what is RECORDED, not from what was computed) ---");
  console.log(readiness.summary);
  console.log(`autonomous unlocked: ${readiness.autonomousUnlocked}`);
  console.log(`highest justified mode: ${readiness.highestJustifiedMode}`);
  console.log(`blockers: ${readiness.blockers.length}`);
  for (const b of readiness.blockers.slice(0, 12)) {
    console.log(`  - ${b.criterion}: required ${b.required}, actual ${b.actual}`);
  }
  if (readiness.blockers.length > 12) console.log(`  ... and ${readiness.blockers.length - 12} more`);
  console.log("");
  console.log("published by this run: 0 (SHADOW has no publishing call to make)");

  if (args.out) {
    writeFileSync(
      args.out,
      JSON.stringify({ tally, composition, readiness, persistResults, ledgerAvailable }, null, 2)
    );
    console.log(`\nfull report written to ${args.out}`);
  }
}

main().catch((e) => {
  console.error(e instanceof Error ? e.stack : e);
  process.exit(1);
});
