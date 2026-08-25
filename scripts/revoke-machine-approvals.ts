// Restore briefs that a SCRIPT marked approved to their truthful state.
//
// review_state='approved' means a human decided. Two scripts wrote it with a
// reviewed_at timestamp so their own brief rows looked settled, which recorded
// owner consent that was never given. 52 briefs carried it, stamped in
// machine-speed bursts — 9 inside one minute.
//
// WHAT THIS DOES AND DOES NOT DO
// ------------------------------
// Sets review_state back to 'pending' and writes a review_note saying exactly
// what happened. Nothing is deleted. Drafts already assembled from these briefs
// are NOT touched: they exist, they are drafts, and they remain the owner's to
// review or discard. assembled_content_id still records that a draft was built.
//
// It is deliberately conservative about WHICH rows it touches. A brief the
// owner genuinely approved through the admin UI must not be reverted, so this
// only reverts rows that carry no review_note AND were stamped inside the
// window when the scripts ran. An approval a human made through the admin
// screen is left exactly as it is.
//
//   npx tsx scripts/revoke-machine-approvals.ts            (report)
//   npx tsx scripts/revoke-machine-approvals.ts --apply

import { loadEnvLocal, createAdminClient } from "./_shared.ts";

const apply = process.argv.includes("--apply");

/**
 * The window in which the scripts ran, from the observed reviewed_at spread.
 *
 * Bounded rather than open-ended on purpose: "every approval with no note" would
 * also revert a genuine admin-UI approval that happened to carry no note.
 */
const WINDOW_START = "2026-08-25T00:00:00Z";
const WINDOW_END = "2026-08-25T23:59:59Z";

const NOTE =
  "Reverted to pending: this approval was written by a script " +
  "(entity-coverage-gaps / expand-coverage), not by a human reviewer. " +
  "review_state is the human gate and no owner had seen this brief. " +
  "Any draft already assembled from it still exists and remains for review.";

async function main(): Promise<void> {
  loadEnvLocal();
  const db = await createAdminClient();

  const { data, error } = await db
    .from("engine_briefs")
    .select("id, proposed_title, review_state, reviewed_at, review_note, assembled_content_id")
    .eq("review_state", "approved");
  if (error) throw new Error(`briefs query failed: ${error.message}`);

  const approved = (data ?? []) as {
    id: string; proposed_title: string; reviewed_at: string | null;
    review_note: string | null; assembled_content_id: string | null;
  }[];

  const machine = approved.filter(
    (b) =>
      !b.review_note &&
      b.reviewed_at !== null &&
      b.reviewed_at >= WINDOW_START &&
      b.reviewed_at <= WINDOW_END
  );
  const kept = approved.filter((b) => !machine.includes(b));

  console.log(`\n${"=".repeat(74)}\nREVOKE MACHINE APPROVALS  ${apply ? "(APPLYING)" : "(report)"}\n${"=".repeat(74)}\n`);
  console.log(`  approved briefs in production : ${approved.length}`);
  console.log(`  written by a script           : ${machine.length}`);
  console.log(`  left untouched                : ${kept.length}`);
  console.log(`  of the script ones, assembled : ${machine.filter((b) => b.assembled_content_id).length} (their drafts are NOT touched)\n`);

  for (const b of machine.slice(0, 6)) {
    console.log(`    ${String(b.reviewed_at).slice(0, 16)}  ${b.proposed_title.slice(0, 58)}`);
  }
  if (machine.length > 6) console.log(`    ... and ${machine.length - 6} more`);

  if (!apply) {
    console.log("\n  REPORT ONLY — re-run with --apply.");
    return;
  }

  let reverted = 0;
  let failed = 0;
  for (const b of machine) {
    const { error: upErr } = await db
      .from("engine_briefs")
      .update({ review_state: "pending", reviewed_at: null, review_note: NOTE })
      .eq("id", b.id);
    if (upErr) { console.error(`    failed ${b.id}: ${upErr.message}`); failed++; }
    else reverted++;
  }

  console.log(`\n  reverted ${reverted}, failed ${failed}.`);

  // Prove it, rather than asserting it.
  const { data: after, error: afterErr } = await db
    .from("engine_briefs")
    .select("review_state")
    .eq("review_state", "approved");
  if (afterErr) console.error(`  verification read failed: ${afterErr.message}`);
  else console.log(`  approved briefs remaining: ${(after ?? []).length}`);
}

main().catch((e) => { console.error(e); process.exitCode = 1; });
