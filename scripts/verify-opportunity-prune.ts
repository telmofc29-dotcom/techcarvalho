// Verify engine_prune_watchlist_opportunities in PRODUCTION, semantically.
//
// "Success. No rows returned." says the SQL parsed. This asserts the guards
// that matter, WITHOUT deleting anything legitimate:
//
//   - a null cutoff is refused (-1), not treated as "delete everything"
//   - a future cutoff is refused (-1), same reason
//   - an ancient cutoff deletes nothing, proving it is time-scoped
//   - category opportunities are never in scope
//
// The real prune runs inside the entity_coverage stage, which captures its own
// start time first. Calling it here with now() would delete every watchlist row
// before the stage could refresh them, so this deliberately never does that.
import { loadEnvLocal, createAdminClient } from "./_shared.ts";

let passed = 0, failed = 0;
function check(l: string, ok: boolean, d = ""): void {
  if (ok) { passed++; console.log(`  PASS  ${l}`); } else { failed++; console.log(`  FAIL  ${l}${d ? ` — ${d}` : ""}`); }
}

async function main(): Promise<void> {
  loadEnvLocal();
  const db = await createAdminClient();

  const count = async () => {
    const { data } = await db.from("engine_opportunities").select("subject_key");
    const rows = (data ?? []) as { subject_key: string }[];
    return {
      total: rows.length,
      watchlist: rows.filter((r) => r.subject_key.startsWith("watchlist:")).length,
      category: rows.filter((r) => !r.subject_key.startsWith("watchlist:")).length,
    };
  };

  const before = await count();
  console.log(`\n  before: total=${before.total} watchlist=${before.watchlist} category=${before.category}\n`);

  // 1. The function exists at all.
  const ancient = await db.rpc("engine_prune_watchlist_opportunities", { p_before: "2000-01-01T00:00:00Z" });
  check("the function exists and is callable", !ancient.error, ancient.error?.message);
  check("an ancient cutoff deletes nothing (time-scoped)", ancient.data === 0, `returned ${String(ancient.data)}`);

  // 2. A future cutoff must be REFUSED, not treated as "everything is stale".
  const future = new Date(Date.now() + 86_400_000).toISOString();
  const fut = await db.rpc("engine_prune_watchlist_opportunities", { p_before: future });
  check("a future cutoff is refused with -1", fut.data === -1, `returned ${String(fut.data)}`);

  // 3. A null cutoff likewise.
  const nul = await db.rpc("engine_prune_watchlist_opportunities", { p_before: null as unknown as string });
  check("a null cutoff is refused with -1", nul.data === -1, `returned ${String(nul.data)}`);

  // 4. Nothing was deleted by any of the above.
  const after = await count();
  check("no rows were removed by the refused calls", after.total === before.total, `${before.total} -> ${after.total}`);
  check("category opportunities untouched", after.category === before.category, `${before.category} -> ${after.category}`);

  console.log(`\n  ${passed} passed, ${failed} failed`);
  process.exitCode = failed > 0 ? 1 : 0;
}
main().catch((e) => { console.error(e); process.exitCode = 1; });
