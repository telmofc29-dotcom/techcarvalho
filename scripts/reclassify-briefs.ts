// Reclassify every pending brief through the Phase C quality gate.
//
// READ-ONLY BY DESIGN. This script writes NOTHING. `review_state` is the
// record of a decision a human made, and a script that rewrote it would be
// manufacturing owner decisions — exactly what the brief forbids. Quality is
// derived, so the report below is what the admin UI will show, computed from
// the same pure module (src/lib/engine/brief-quality.ts) the UI calls.
//
// Its purpose is to answer the owner's question — "of the 47 pending briefs,
// which genuinely deserve my attention?" — without asking anyone to read 47
// rows by hand.
//
//   npx tsx scripts/reclassify-briefs.ts
//   npx tsx scripts/reclassify-briefs.ts --all      (include non-pending)
//   npx tsx scripts/reclassify-briefs.ts --verbose  (per-brief reasons)

import { loadEnvLocal, createAdminClient } from "./_shared.ts";
import {
  classifyBriefQuality,
  summariseQuality,
  BRIEF_QUALITY_STATES,
  BRIEF_QUALITY_LABELS,
  type BriefQualityInput,
  type BriefQualityVerdict,
} from "../src/lib/engine/brief-quality.ts";

type Row = {
  id: string;
  proposed_title: string;
  brief_kind: string | null;
  content_type: string | null;
  verified_facts: string[] | null;
  uncertainties: string[] | null;
  source_urls: string[] | null;
  freshness_sensitivity: "breaking" | "time_sensitive" | "evergreen" | null;
  discovery_id: string | null;
  opportunity_id: string | null;
  review_state: string;
  state: string;
  created_at: string;
};

async function main(): Promise<void> {
  loadEnvLocal();
  const includeAll = process.argv.includes("--all");
  const verbose = process.argv.includes("--verbose");
  const db = await createAdminClient();

  let query = db
    .from("engine_briefs")
    .select(
      "id, proposed_title, brief_kind, content_type, verified_facts, uncertainties, source_urls, " +
        "freshness_sensitivity, discovery_id, opportunity_id, review_state, state, created_at"
    )
    .order("created_at", { ascending: true });
  if (!includeAll) query = query.eq("review_state", "pending");

  const { data, error } = await query;

  // An empty result is never reported as "no briefs" without checking `error`
  // first — the 2026-08 incident was exactly this shape.
  if (error) {
    console.error(`QUERY FAILED: ${error.message}`);
    console.error("This is NOT the same as an empty queue. Nothing below can be trusted.");
    process.exitCode = 1;
    return;
  }
  const rows = (data ?? []) as Row[];

  // Published titles for the cannibalisation check. Fetched once; the
  // classifier is pure and takes them as input.
  const { data: published, error: pubError } = await db
    .from("content_items")
    .select("title")
    .eq("status", "published");
  if (pubError) {
    console.error(`Published-content read failed: ${pubError.message}`);
    console.error("Refusing to report duplicate-risk verdicts computed against an unknown corpus.");
    process.exitCode = 1;
    return;
  }
  const existingTitles = (published ?? []).map((c: { title: string }) => c.title);

  const verdicts: { row: Row; verdict: BriefQualityVerdict }[] = rows.map((row) => {
    const input: BriefQualityInput = {
      id: row.id,
      title: row.proposed_title,
      briefKind: row.brief_kind,
      contentType: row.content_type,
      verifiedFacts: row.verified_facts ?? [],
      uncertainties: row.uncertainties ?? [],
      sourceUrls: row.source_urls ?? [],
      freshnessSensitivity: row.freshness_sensitivity,
      hasDiscovery: row.discovery_id !== null,
      hasOpportunity: row.opportunity_id !== null,
      createdAt: row.created_at,
      existingTitles,
    };
    return { row, verdict: classifyBriefQuality(input) };
  });

  const summary = summariseQuality(verdicts.map((v) => v.verdict));

  console.log("");
  console.log("BRIEF RECLASSIFICATION");
  console.log("======================");
  console.log(`Scope:              ${includeAll ? "all briefs" : "review_state = 'pending'"}`);
  console.log(`Briefs examined:    ${summary.total}`);
  console.log(`Published corpus:   ${existingTitles.length} titles (cannibalisation reference)`);
  console.log("");

  for (const state of BRIEF_QUALITY_STATES) {
    const n = summary.counts[state];
    const bar = "#".repeat(Math.min(n, 60));
    console.log(`  ${BRIEF_QUALITY_LABELS[state].padEnd(32)} ${String(n).padStart(3)}  ${bar}`);
  }

  console.log("");
  console.log(`  -> DEMANDS OWNER ATTENTION:      ${summary.ownerQueueCount}`);
  console.log(`  -> ENGINE KEEPS RESEARCHING:     ${summary.researchBacklogCount}`);
  console.log(
    `  -> PARKED (needs a human only if you want it): ` +
      `${summary.total - summary.ownerQueueCount - summary.researchBacklogCount}`
  );
  console.log("");

  const ready = verdicts.filter((v) => v.verdict.entersOwnerQueue);
  if (ready.length > 0) {
    console.log("READY FOR OWNER REVIEW");
    console.log("----------------------");
    for (const { row, verdict } of ready) {
      console.log(`  ${row.proposed_title}`);
      console.log(
        `      ${verdict.factCount} facts · ${verdict.sourceCount} sources · ` +
          `${verdict.independentDomains} independent publishers · ${verdict.uncertaintyCount} open questions`
      );
    }
    console.log("");
  } else {
    console.log("READY FOR OWNER REVIEW: none.");
    console.log(
      "  Not an error — it means no pending brief currently clears the evidence bar. The engine\n" +
        "  should keep researching the backlog rather than the owner reading weak briefs.\n"
    );
  }

  if (verbose) {
    console.log("PER-BRIEF DETAIL");
    console.log("----------------");
    for (const { row, verdict } of verdicts) {
      console.log(`  [${verdict.state}] ${row.proposed_title}`);
      console.log(`      review_state=${row.review_state} state=${row.state} created=${row.created_at.slice(0, 10)}`);
      for (const r of verdict.reasons) console.log(`      - ${r}`);
      console.log("");
    }
  }

  console.log("No rows were modified. review_state is only ever set by a human.");
}

main().catch((err) => {
  console.error(err);
  process.exitCode = 1;
});
