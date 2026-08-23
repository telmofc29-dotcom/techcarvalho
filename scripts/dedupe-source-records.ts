// Remove duplicate (product_id, url) source records.
//
//   TC_ADMIN_EMAIL=... TC_ADMIN_PASSWORD=... npx tsx scripts/dedupe-source-records.ts [--apply]
//
// source_records has no unique constraint on (product_id, url), and
// import-research.ts relied on a "duplicate" error that never came. Re-running
// the Canon import therefore inserted all 72 of its sources a second time.
//
// Keeps the OLDEST row of each group — it carries the original retrieved_at,
// which is the honest one — and deletes the rest. Dry run by default.

import { loadEnvLocal, createAdminClient } from "./_shared.ts";
loadEnvLocal();
const APPLY = process.argv.includes("--apply");

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Db = { from: (t: string) => any };

async function main(): Promise<void> {
  const db = (await createAdminClient()) as unknown as Db;
  const { data, error } = await db
    .from("source_records").select("id,product_id,url,created_at").not("product_id", "is", null);
  if (error) throw new Error(`reading source_records failed: ${error.message}`);

  const groups = new Map<string, { id: string; created_at: string }[]>();
  for (const r of data as { id: string; product_id: string; url: string; created_at: string }[]) {
    const k = `${r.product_id}|${r.url}`;
    groups.set(k, [...(groups.get(k) ?? []), { id: r.id, created_at: r.created_at }]);
  }

  const toDelete: string[] = [];
  for (const rows of groups.values()) {
    if (rows.length < 2) continue;
    rows.sort((a, b) => a.created_at.localeCompare(b.created_at));
    for (const extra of rows.slice(1)) toDelete.push(extra.id);
  }

  console.log(`product-scoped source rows: ${(data as unknown[]).length}`);
  console.log(`distinct (product, url) pairs: ${groups.size}`);
  console.log(`duplicates to remove: ${toDelete.length}`);

  if (!APPLY) { console.log("\nDry run. Re-run with --apply."); return; }

  for (let i = 0; i < toDelete.length; i += 100) {
    const batch = toDelete.slice(i, i + 100);
    const { error: delErr } = await db.from("source_records").delete().in("id", batch);
    if (delErr) throw new Error(`delete failed: ${delErr.message}`);
  }

  const { data: after, error: afterErr } = await db
    .from("source_records").select("product_id,url").not("product_id", "is", null);
  if (afterErr) throw new Error(`re-reading failed: ${afterErr.message}`);
  const seen = new Set<string>();
  let stillDup = 0;
  for (const r of after as { product_id: string; url: string }[]) {
    const k = `${r.product_id}|${r.url}`;
    if (seen.has(k)) stillDup++;
    seen.add(k);
  }
  console.log(`\nafter: ${(after as unknown[]).length} rows, ${seen.size} pairs, ${stillDup} still duplicated`);
  if (stillDup !== 0) throw new Error("duplicates remain after cleanup");
}

main().catch((e) => { console.error("failed:", e instanceof Error ? e.message : e); process.exitCode = 1; });
