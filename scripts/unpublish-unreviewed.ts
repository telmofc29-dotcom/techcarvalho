// Return to draft the two articles published without a person reviewing them.
//
//   TC_ADMIN_EMAIL=... TC_ADMIN_PASSWORD=... npx tsx scripts/unpublish-unreviewed.ts [--apply]
//   ...                                      npx tsx scripts/unpublish-unreviewed.ts --restore
//
// WHY
// ---
// A background agent spawned in an earlier phase completed ~43 hours later and
// published two articles at 20:19 and 20:22 today, after the standing
// instruction had become "nothing publishes without approval". The agent was
// probably acting within ITS original brief; the regime around it had changed.
//
// The decisive problem is not process, it is a factual claim. /about and the
// publisher identity state:
//
//   "Every piece on the site is reviewed and published by a person before it
//    goes live, and he is responsible for what appears here."
//
// That sentence is false while these two are live. They are also the only two
// of 83 with no author_id, so they correctly render no byline — the data is
// already telling the truth that nobody reviewed them.
//
// The articles themselves are fine: 1531 and 1646 words against a 600-word
// guide floor, sourced to Samsung Mobile Security, Google and the Connectivity
// Standards Alliance, no fabricated testing or ratings. Nothing here deletes
// them. They return to `draft` and can be published in one command once read.

import { loadEnvLocal, createAdminClient } from "./_shared.ts";

loadEnvLocal();
const APPLY = process.argv.includes("--apply");
const RESTORE = process.argv.includes("--restore");

const SLUGS = [
  "phone-software-support-how-long-will-it-get-updates",
  "smart-home-local-vs-cloud-control",
];

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Db = { from: (t: string) => any };

async function main(): Promise<void> {
  const db = (await createAdminClient()) as unknown as Db;

  const { data, error } = await db
    .from("content_items")
    .select("id,slug,title,status,published_at")
    .in("slug", SLUGS);
  if (error) throw new Error(`reading content_items failed: ${error.message}`);
  const rows = data as { id: string; slug: string; title: string; status: string; published_at: string | null }[];

  for (const r of rows) {
    console.log(`  ${r.status.padEnd(10)} ${r.slug}`);
  }

  const target = RESTORE ? "published" : "draft";
  const from = RESTORE ? "draft" : "published";
  const toChange = rows.filter((r) => r.status === from);
  console.log(`\n${toChange.length} article(s) would move ${from} -> ${target}`);

  if (!APPLY && !RESTORE) { console.log("\nDry run. Re-run with --apply."); return; }
  if (RESTORE && !APPLY) { console.log("\nDry run. Re-run with --restore --apply."); return; }

  for (const r of toChange) {
    const patch = RESTORE
      ? { status: "published", published_at: r.published_at ?? new Date().toISOString() }
      : { status: "draft" };
    const { error: e } = await db.from("content_items").update(patch).eq("id", r.id);
    if (e) { console.log(`  FAIL ${r.slug}: ${e.message}`); continue; }
    console.log(`  ${r.slug} -> ${target}`);
  }

  const { count } = await db
    .from("content_items").select("id", { count: "exact", head: true }).eq("status", "published") as unknown as { count: number };
  console.log(`\npublished articles now: ${count}`);
  // published_at is deliberately NOT cleared on unpublish: it records when the
  // piece first went live, which is a fact, and restoring should not invent a
  // new publication date.
}

main().catch((e) => { console.error("failed:", e instanceof Error ? e.message : e); process.exitCode = 1; });
