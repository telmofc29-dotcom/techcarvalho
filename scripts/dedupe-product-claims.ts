// Remove duplicate (product_id, claim) rows from product_claims.
//
//   TC_ADMIN_EMAIL=... TC_ADMIN_PASSWORD=... npx tsx scripts/dedupe-product-claims.ts [--apply]
//
// product_claims has no unique constraint on (product_id, claim), and
// import-research.ts inserted without checking, so re-running an import wrote
// every claim a second time. Keeps the OLDEST row of each group and re-counts
// afterwards rather than trusting the delete. Dry run by default.

import { loadEnvLocal, createAdminClient } from "./_shared.ts";
loadEnvLocal();
const APPLY = process.argv.includes("--apply");
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Db = { from: (t: string) => any };

async function main(): Promise<void> {
  const db = (await createAdminClient()) as unknown as Db;
  const { data, error } = await db.from("product_claims").select("id,product_id,claim,created_at");
  if (error) throw new Error(`reading product_claims failed: ${error.message}`);

  const groups = new Map<string, { id: string; created_at: string }[]>();
  for (const r of data as { id: string; product_id: string; claim: string; created_at: string }[]) {
    const k = `${r.product_id}|${r.claim}`;
    groups.set(k, [...(groups.get(k) ?? []), { id: r.id, created_at: r.created_at }]);
  }
  const toDelete: string[] = [];
  for (const rows of groups.values()) {
    if (rows.length < 2) continue;
    rows.sort((a, b) => a.created_at.localeCompare(b.created_at));
    for (const extra of rows.slice(1)) toDelete.push(extra.id);
  }
  console.log(`rows: ${(data as unknown[]).length}, distinct (product, claim): ${groups.size}, duplicates: ${toDelete.length}`);
  if (!APPLY) { console.log("\nDry run. Re-run with --apply."); return; }

  for (let i = 0; i < toDelete.length; i += 100) {
    const { error: e } = await db.from("product_claims").delete().in("id", toDelete.slice(i, i + 100));
    if (e) throw new Error(`delete failed: ${e.message}`);
  }
  const { data: after, error: afterErr } = await db.from("product_claims").select("product_id,claim");
  if (afterErr) throw new Error(`re-reading failed: ${afterErr.message}`);
  const seen = new Set<string>();
  let still = 0;
  for (const r of after as { product_id: string; claim: string }[]) {
    const k = `${r.product_id}|${r.claim}`;
    if (seen.has(k)) still++;
    seen.add(k);
  }
  console.log(`after: ${(after as unknown[]).length} rows, ${seen.size} distinct, ${still} still duplicated`);
  if (still !== 0) throw new Error("duplicates remain");
}
main().catch((e) => { console.error("failed:", e instanceof Error ? e.message : e); process.exitCode = 1; });
