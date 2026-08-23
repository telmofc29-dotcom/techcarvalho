// Create the taxonomy categories the catalogue expansion needs.
//
//   TC_ADMIN_EMAIL=... TC_ADMIN_PASSWORD=... npx tsx scripts/create-categories.ts [--apply]
//
// Idempotent. Dry run by default.
//
// A category is TWO things in this codebase and both are required for a working
// hub page:
//   1. a taxonomy_categories row, which products attach to
//   2. a PLANNED_CATEGORIES entry in src/lib/public/categories.ts, which gives
//      the hub its label and blurb and makes /<slug> render as a real page
// This script does (1). (2) is a code change and is in the same commit.
//
// A category with no published products renders as an honest empty state rather
// than a stub — see hub-eligibility. Creating these before the products land is
// therefore safe, and the alternative (importing products with nowhere to put
// them) is not.

import { loadEnvLocal, createAdminClient } from "./_shared.ts";

loadEnvLocal();
const APPLY = process.argv.includes("--apply");

const CATEGORIES = [
  {
    slug: "camera-lenses",
    name: "Camera Lenses",
    // Deliberately its own top-level category rather than a child of
    // cameras-photography. Lenses are the deepest vertical this site is
    // building, the questions readers ask about them ("EF or RF?", "what does
    // USM mean?") are lens questions rather than camera questions, and a hub of
    // several hundred lenses buried under a camera hub is a hub nobody finds.
    sort_order: 15,
  },
  {
    slug: "3d-printing",
    name: "3D Printing",
    sort_order: 60,
  },
];

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Db = { from: (t: string) => any };

async function main(): Promise<void> {
  const db = (await createAdminClient()) as unknown as Db;

  const { data: existing, error } = await db
    .from("taxonomy_categories").select("id,slug,name")
    .in("slug", CATEGORIES.map((c) => c.slug));
  if (error) throw new Error(`reading taxonomy_categories failed: ${error.message}`);
  const bySlug = new Map((existing as { slug: string; name: string }[]).map((c) => [c.slug, c]));

  for (const cat of CATEGORIES) {
    if (bySlug.has(cat.slug)) {
      console.log(`  = ${cat.slug} already exists (${bySlug.get(cat.slug)!.name})`);
      continue;
    }
    if (APPLY) {
      const { error: e } = await db.from("taxonomy_categories").insert({
        slug: cat.slug, name: cat.name, sort_order: cat.sort_order, parent_id: null,
      });
      if (e) throw new Error(`creating ${cat.slug} failed: ${e.message}`);
      console.log(`  + ${cat.slug} created`);
    } else {
      console.log(`  + ${cat.slug} WOULD be created (${cat.name})`);
    }
  }

  const { data: after, error: afterErr } = await db
    .from("taxonomy_categories").select("slug").order("slug");
  if (afterErr) throw new Error(`re-reading taxonomy_categories failed: ${afterErr.message}`);
  console.log(`\ncategories now: ${(after as { slug: string }[]).map((c) => c.slug).join(", ")}`);
  if (!APPLY) console.log("\nDry run. Re-run with --apply to write.");
}

main().catch((e) => {
  console.error("failed:", e instanceof Error ? e.message : e);
  process.exitCode = 1;
});
