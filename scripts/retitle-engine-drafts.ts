// Repair titles on engine-created drafts after a subjectNoun fix.
//
// Non-destructive: recomputes each draft's title from the ORIGINAL discovery
// headline using the current pipeline logic, and updates only where the result
// differs. Nothing is deleted; published items are never touched.
import { loadEnvLocal, createAdminClient } from "./_shared.ts";
import { subjectNoun } from "../src/lib/engine/research/research-pipeline.ts";
import { slugify } from "../src/lib/admin/slugify.ts";

const apply = process.argv.includes("--apply");

async function main() {
  loadEnvLocal();
  const db = await createAdminClient();

  const { data: briefs, error } = await db
    .from("engine_briefs")
    .select("id,assembled_content_id,proposed_title,discovery_id")
    .not("assembled_content_id", "is", null);
  if (error) throw error;

  const rows = (briefs ?? []) as any[];
  const ids = rows.map((b) => b.assembled_content_id);
  if (!ids.length) { console.log("no engine-authored content"); return; }

  const { data: items, error: ie } = await db
    .from("content_items").select("id,title,slug,status").in("id", ids);
  if (ie) throw ie;
  const byId = new Map(((items ?? []) as any[]).map((i) => [i.id, i]));

  const discIds = rows.map((b) => b.discovery_id).filter(Boolean);
  const { data: discs } = await db
    .from("engine_discoveries").select("id,title").in("id", discIds);
  const discTitle = new Map(((discs ?? []) as any[]).map((d) => [d.id, d.title]));

  let changed = 0, skipped = 0;
  const why = { published: 0, noHeadline: 0, noItem: 0 };
  for (const b of rows) {
    const item = byId.get(b.assembled_content_id);
    if (!item) { why.noItem++; continue; }
    // Never rewrite something the public can already see.
    if (item.status !== "draft") { skipped++; why.published++; continue; }
    const suffix = item.title.includes(": what has been reported so far")
      ? ": what has been reported so far" : "";

    // Prefer the original discovery headline. The gap scanner does not link a
    // discovery, so fall back to re-cleaning the stored title: trimming only
    // ever removes a dangling tail, so a second pass is safe and idempotent.
    const headline = discTitle.get(b.discovery_id) ?? item.title.replace(suffix, "");
    if (!headline) { skipped++; why.noHeadline++; continue; }

    const rebuilt = `${subjectNoun(headline, null)}${suffix}`;
    if (rebuilt === item.title) continue;

    console.log(`  OLD  ${item.title}`);
    console.log(`  NEW  ${rebuilt}\n`);
    changed++;
    if (apply) {
      const { error: ue } = await db.from("content_items")
        .update({ title: rebuilt, slug: slugify(rebuilt).slice(0, 90) })
        .eq("id", item.id);
      if (ue) console.error(`    update failed: ${ue.message}`);
    }
  }
  console.log(`${changed} title(s) ${apply ? "updated" : "would change"}; ${skipped} skipped (published or no source headline)`);
  console.log(`   skip reasons: ${JSON.stringify(why)}`);
  if (!apply) console.log("re-run with --apply");
}
main().catch((e) => { console.error(e); process.exitCode = 1; });
