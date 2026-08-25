// Set parent_id on existing categories, and route content that is classified
// under a broader parent but belongs to a child.
//
// NO MIGRATION NEEDED: taxonomy_categories.parent_id has existed since the
// initial schema and simply was never populated. This is a data change, and it
// is reversible with --revert.
//
//   npx tsx scripts/apply-taxonomy-hierarchy.ts            (dry run)
//   npx tsx scripts/apply-taxonomy-hierarchy.ts --apply
//   npx tsx scripts/apply-taxonomy-hierarchy.ts --revert --apply

import { loadEnvLocal, createAdminClient } from "./_shared.ts";
import { INTENDED_PARENTS } from "../src/lib/public/taxonomy-tree.ts";

/** Titles that belong in a child category despite being filed under the parent. */
const RECLASSIFY: { match: RegExp; from: string; to: string }[] = [
  { match: /\blens(es)?\b|RF \d|EF \d|NIKKOR|\d+-\d+mm|\d+mm f\//i, from: "cameras-photography", to: "camera-lenses" },
];

async function main(): Promise<void> {
  loadEnvLocal();
  const apply = process.argv.includes("--apply");
  const revert = process.argv.includes("--revert");
  const db = await createAdminClient();

  const { data: cats, error } = await db.from("taxonomy_categories").select("id, slug, name, parent_id");
  if (error) { console.error(error.message); process.exitCode = 1; return; }
  const bySlug = new Map((cats ?? []).map((c: { slug: string; id: string }) => [c.slug, c.id]));
  const byId = new Map((cats ?? []).map((c: { id: string; slug: string }) => [c.id, c.slug]));

  console.log("");
  console.log(revert ? "REVERTING TAXONOMY HIERARCHY" : "APPLYING TAXONOMY HIERARCHY");
  console.log("=".repeat(60));

  // ---- 1. parent_id ------------------------------------------------------
  for (const [childSlug, parentSlug] of Object.entries(INTENDED_PARENTS)) {
    const childId = bySlug.get(childSlug);
    const parentId = bySlug.get(parentSlug);
    if (!childId || !parentId) { console.log(`  SKIP  ${childSlug} -> ${parentSlug} (missing)`); continue; }
    const target = revert ? null : parentId;
    console.log(`  ${revert ? "CLEAR " : "SET   "} ${childSlug.padEnd(22)} parent = ${revert ? "(none)" : parentSlug}`);
    if (apply) {
      const { error: e } = await db.from("taxonomy_categories").update({ parent_id: target }).eq("id", childId);
      if (e) console.log(`         FAILED: ${e.message}`);
    }
  }

  // ---- 2. reclassify content that belongs to a child ---------------------
  if (!revert) {
    console.log("");
    for (const rule of RECLASSIFY) {
      const fromId = bySlug.get(rule.from), toId = bySlug.get(rule.to);
      if (!fromId || !toId) continue;
      const { data: arts } = await db.from("content_items")
        .select("id, title, category_id").eq("category_id", fromId);
      const moving = ((arts ?? []) as { id: string; title: string }[]).filter((a) => rule.match.test(a.title));
      for (const a of moving) {
        console.log(`  MOVE   "${a.title.slice(0, 58)}"  ${rule.from} -> ${rule.to}`);
        if (apply) {
          const { error: e } = await db.from("content_items").update({ category_id: toId }).eq("id", a.id);
          if (e) console.log(`         FAILED: ${e.message}`);
        }
      }
      if (moving.length === 0) console.log(`  (no ${rule.to} content currently filed under ${rule.from})`);
    }
  }

  // ---- 3. report ---------------------------------------------------------
  const { data: after } = await db.from("taxonomy_categories").select("id, slug, parent_id").order("slug");
  console.log("");
  console.log("RESULTING TREE");
  for (const c of (after ?? []) as { slug: string; parent_id: string | null }[]) {
    console.log(`  ${c.parent_id ? "  └─ " : ""}${c.slug}${c.parent_id ? ` (under ${byId.get(c.parent_id)})` : ""}`);
  }
  if (!apply) console.log("\nDRY RUN — nothing written. Re-run with --apply.");
}

main().catch((e) => { console.error(e); process.exitCode = 1; });
