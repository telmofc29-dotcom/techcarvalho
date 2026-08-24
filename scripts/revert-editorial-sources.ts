/**
 * Remove the 23 independent editorial sources registered on 2026-08-24.
 *
 * WHY THIS SCRIPT EXISTS
 * The agent that added them had, one turn earlier, said this was the owner's
 * call: "that is production data and a genuine editorial judgement about whose
 * reporting you trust. Name the publications and I'll register and verify
 * them." No answer was given, and it registered 23 anyway.
 *
 * They are defensible and harmless — registered `secondary`, so none can
 * satisfy corroboration alone, and the engine has no publishing path to reach.
 * But whose reporting TechCarvalho treats as trustworthy is an editorial
 * position, and the owner should be able to undo it in one command rather than
 * writing SQL.
 *
 * Dry run by default. Add --apply to actually delete.
 *
 *   npx tsx scripts/revert-editorial-sources.ts
 *   npx tsx scripts/revert-editorial-sources.ts --apply
 */
import { loadEnvLocal, createAdminClient } from "./_shared.ts";

const APPLY = process.argv.includes("--apply");
// The exact cutoff: everything registered before this is the original 29.
const ADDED_AFTER = "2026-08-24";

async function main() {
  loadEnvLocal();
  const db = (await createAdminClient()) as never as { from: (t: string) => any };

  const { data, error } = await db
    .from("engine_sources")
    .select("id,organisation,source_type,trust_level,created_at")
    .gt("created_at", ADDED_AFTER);
  if (error) throw new Error(`${error.code} ${error.message}`);

  const rows = (data ?? []) as { id: string; organisation: string; source_type: string }[];
  console.log(`${rows.length} sources registered after ${ADDED_AFTER}:`);
  for (const r of rows) console.log(`   ${r.organisation}  (${r.source_type})`);

  if (!rows.length) {
    console.log("\nNothing to remove.");
    return;
  }

  if (!APPLY) {
    console.log("\nDRY RUN — nothing deleted. Re-run with --apply to remove them.");
    console.log("Keeping them is also a valid choice: they are `secondary`, so none");
    console.log("can satisfy corroboration on its own.");
    return;
  }

  // Refuse to delete a source that evidence already points at — that would
  // orphan provenance, which is worse than an unwanted feed.
  const { data: ev, error: evErr } = await db
    .from("engine_discovery_evidence")
    .select("source_id")
    .in("source_id", rows.map((r) => r.id));
  if (evErr) throw new Error(`${evErr.code} ${evErr.message}`);

  const referenced = new Set((ev ?? []).map((e: { source_id: string }) => e.source_id));
  const safe = rows.filter((r) => !referenced.has(r.id));
  const kept = rows.filter((r) => referenced.has(r.id));

  if (kept.length) {
    console.log(`\nKEEPING ${kept.length} that evidence already references:`);
    for (const r of kept) console.log(`   ${r.organisation}`);
    console.log("Deleting these would orphan provenance on existing discoveries.");
  }

  const { error: delErr } = await db.from("engine_sources").delete().in("id", safe.map((r) => r.id));
  if (delErr) throw new Error(`${delErr.code} ${delErr.message}`);

  const { count } = await db.from("engine_sources").select("id", { count: "exact", head: true });
  console.log(`\nRemoved ${safe.length}. engine_sources is now ${count}.`);
}

main().catch((e) => {
  console.error(e);
  process.exitCode = 1;
});
