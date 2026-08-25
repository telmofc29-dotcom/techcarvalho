// Re-file drafts whose section was chosen from the COMPANY rather than the
// SUBJECT.
//
// The scanner used entity.categories[0], so every Mac, Mac mini, MacBook and
// iPad development was filed under smartphones — Apple's first listed
// category. The scanner is fixed; this repairs the rows it already wrote.
//
// Drafts only. A published article's section is a decision someone made and is
// never overwritten here.
//
//   npx tsx scripts/recategorise-drafts.ts            (report)
//   npx tsx scripts/recategorise-drafts.ts --apply

import { loadEnvLocal, createAdminClient } from "./_shared.ts";
import { categoryForSubject } from "../src/lib/engine/subject-category.ts";
import { PRIORITY_ENTITIES } from "../src/lib/engine/priority-entities.ts";

const apply = process.argv.includes("--apply");
const SUFFIX = ": what has been reported so far";

async function main(): Promise<void> {
  loadEnvLocal();
  const db = await createAdminClient();

  const [{ data: cats, error: catErr }, { data: drafts, error: draftErr }] = await Promise.all([
    db.from("taxonomy_categories").select("id, slug"),
    db.from("content_items").select("id, title, category_id").eq("status", "draft"),
  ]);
  if (catErr) throw new Error(`categories query failed: ${catErr.message}`);
  if (draftErr) throw new Error(`drafts query failed: ${draftErr.message}`);

  const idBySlug = new Map(((cats ?? []) as { id: string; slug: string }[]).map((c) => [c.slug, c.id]));
  const slugById = new Map(((cats ?? []) as { id: string; slug: string }[]).map((c) => [c.id, c.slug]));

  let changed = 0;
  let unknownCategory = 0;

  for (const d of (drafts ?? []) as { id: string; title: string; category_id: string | null }[]) {
    const subject = d.title.replace(SUFFIX, "").trim();
    const current = d.category_id ? (slugById.get(d.category_id) ?? null) : null;

    // The company only supplies candidate categories and the last-resort
    // fallback; the subject decides.
    const entity = PRIORITY_ENTITIES.find((e) =>
      e.aliases.some((a) => new RegExp(`(^|[^a-z0-9])${a.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}([^a-z0-9]|$)`, "i").test(subject))
    );
    const choice = categoryForSubject(subject, entity?.categories ?? []);

    // Only move a draft when the subject ITSELF says where it belongs. A
    // fallback guess is not a good enough reason to overwrite an existing
    // filing.
    if (choice.basis !== "subject") continue;
    if (choice.category === current) continue;

    const targetId = idBySlug.get(choice.category);
    if (!targetId) {
      // The taxonomy has no such section. Report it rather than silently
      // leaving the draft where it was.
      console.log(`  NO SECTION '${choice.category}' for: ${subject.slice(0, 52)}`);
      unknownCategory++;
      continue;
    }

    console.log(`  ${(current ?? "(none)").padEnd(20)} -> ${choice.category.padEnd(20)} ${subject.slice(0, 46)}`);
    console.log(`      matched on "${choice.matched}"`);
    changed++;
    if (apply) {
      const { error } = await db.from("content_items").update({ category_id: targetId }).eq("id", d.id);
      if (error) console.error(`      update failed: ${error.message}`);
    }
  }

  console.log(`\n  ${changed} draft(s) ${apply ? "re-filed" : "would move"}; ${unknownCategory} with no matching section.`);
  if (!apply) console.log("  re-run with --apply");
}

main().catch((e) => { console.error(e); process.exitCode = 1; });
