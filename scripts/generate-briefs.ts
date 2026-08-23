// Propose article briefs from the catalogue.
//
//   TC_ADMIN_EMAIL=... TC_ADMIN_PASSWORD=... npx tsx scripts/generate-briefs.ts [--apply] [--limit=N]
//
// DRY RUN BY DEFAULT. Briefs are written to engine_briefs with
// review_state = 'pending' — they are PROPOSALS. Nothing writes an article and
// nothing publishes; engine_assemble_draft refuses any brief that is not
// explicitly approved by a person, and that guard is verified in production.
//
// The rules about what deserves a page live in
// src/lib/catalogue/brief-generator.ts and are unit-tested there. This script
// only fetches, maps and writes.

import { loadEnvLocal, createAdminClient } from "./_shared.ts";
import {
  generateBriefs,
  type BriefProduct,
  type BriefConcept,
  type ExistingCoverage,
} from "../src/lib/catalogue/brief-generator.ts";

loadEnvLocal();
const APPLY = process.argv.includes("--apply");
const limitArg = process.argv.find((a) => a.startsWith("--limit="));
const LIMIT = limitArg ? Number(limitArg.split("=")[1]) : Infinity;

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Db = { from: (t: string) => any };

async function main(): Promise<void> {
  const db = (await createAdminClient()) as unknown as Db;

  const [catsRes, prodRes, specDefRes, specRes, mfrRes, contentRes, briefRes] = await Promise.all([
    db.from("taxonomy_categories").select("id,slug"),
    db.from("products").select("id,slug,name,category_id,manufacturer_id"),
    db.from("spec_definitions").select("id,slug"),
    db.from("product_specs").select("product_id,spec_definition_id,value"),
    db.from("manufacturers").select("id,slug"),
    db.from("content_items").select("title,slug,primary_query,intent_fingerprint"),
    db.from("engine_briefs").select("proposed_slug,proposed_title,primary_query"),
  ]);
  for (const [label, res] of [
    ["taxonomy_categories", catsRes], ["products", prodRes], ["spec_definitions", specDefRes],
    ["product_specs", specRes], ["manufacturers", mfrRes], ["content_items", contentRes],
    ["engine_briefs", briefRes],
  ] as const) {
    if (res.error) throw new Error(`reading ${label} failed: ${res.error.message}`);
    if (res.data === null) throw new Error(`${label} returned null rather than rows`);
  }

  const catById = new Map((catsRes.data as { id: string; slug: string }[]).map((c) => [c.id, c.slug]));
  const mfrById = new Map((mfrRes.data as { id: string; slug: string }[]).map((m) => [m.id, m.slug]));
  const defById = new Map((specDefRes.data as { id: string; slug: string }[]).map((d) => [d.id, d.slug]));

  const specsByProduct = new Map<string, Record<string, string | number | boolean>>();
  for (const s of specRes.data as { product_id: string; spec_definition_id: string; value: unknown }[]) {
    const slug = defById.get(s.spec_definition_id);
    if (!slug) continue;
    const v = s.value;
    if (typeof v !== "string" && typeof v !== "number" && typeof v !== "boolean") continue;
    const bag = specsByProduct.get(s.product_id) ?? {};
    bag[slug] = v;
    specsByProduct.set(s.product_id, bag);
  }

  const products: BriefProduct[] = (prodRes.data as {
    id: string; slug: string; name: string; category_id: string; manufacturer_id: string;
  }[]).map((p) => ({
    slug: p.slug,
    name: p.name,
    categorySlug: catById.get(p.category_id) ?? "?",
    manufacturerSlug: mfrById.get(p.manufacturer_id) ?? "?",
    specs: specsByProduct.get(p.id) ?? {},
  }));

  // Concepts, when the knowledge-graph migration has been applied. Absence is
  // reported rather than quietly producing zero concept briefs.
  let concepts: BriefConcept[] = [];
  const productsByConcept = new Map<string, string[]>();
  const conceptProbe = await db.from("technology_concepts").select("id").limit(1);
  const conceptsAvailable = !conceptProbe.error;
  if (conceptsAvailable) {
    const { data, error } = await db
      .from("technology_concepts").select("id,slug,name,kind,manufacturer_id,category_id,summary");
    if (error) throw new Error(`reading technology_concepts failed: ${error.message}`);
    concepts = (data as Record<string, unknown>[]).map((c) => ({
      slug: String(c.slug), name: String(c.name), kind: String(c.kind),
      manufacturerSlug: c.manufacturer_id ? (mfrById.get(String(c.manufacturer_id)) ?? null) : null,
      categorySlug: c.category_id ? (catById.get(String(c.category_id)) ?? "?") : "?",
      hasSummary: typeof c.summary === "string" && c.summary.trim().length > 40,
    }));
    const link = await db.from("product_technologies").select("product_id,technology_id");
    if (!link.error) {
      const conceptById = new Map((data as { id: string; slug: string }[]).map((c) => [c.id, c.slug]));
      const prodById = new Map((prodRes.data as { id: string; slug: string }[]).map((p) => [p.id, p.slug]));
      for (const l of link.data as { product_id: string; technology_id: string }[]) {
        const cs = conceptById.get(l.technology_id);
        const ps = prodById.get(l.product_id);
        if (!cs || !ps) continue;
        productsByConcept.set(cs, [...(productsByConcept.get(cs) ?? []), ps]);
      }
    }
  }

  // Existing coverage — published articles AND briefs already proposed, so a
  // second run does not re-propose everything.
  const existing: ExistingCoverage = { subjectKeys: new Set(), primaryQueries: new Set() };
  for (const c of contentRes.data as { title: string; primary_query: string | null }[]) {
    if (c.primary_query) existing.primaryQueries.add(c.primary_query.toLowerCase());
    existing.primaryQueries.add(c.title.toLowerCase());
  }
  for (const b of briefRes.data as { proposed_title: string; primary_query: string | null }[]) {
    if (b.primary_query) existing.primaryQueries.add(b.primary_query.toLowerCase());
    existing.primaryQueries.add(b.proposed_title.toLowerCase());
  }

  const briefs = generateBriefs({ concepts, productsByConcept, products, existing });
  const selected = briefs.slice(0, LIMIT);

  console.log(`=== generate-briefs ${APPLY ? "(APPLYING)" : "(dry run)"} ===\n`);
  console.log(`catalogue: ${products.length} products, ${concepts.length} concepts` +
    (conceptsAvailable ? "" : "  (technology_concepts NOT AVAILABLE — no concept explainers generated)"));
  console.log(`existing coverage: ${existing.primaryQueries.size} claimed queries`);
  console.log(`generated: ${briefs.length}${selected.length < briefs.length ? `, taking ${selected.length}` : ""}\n`);

  const byKind = new Map<string, number>();
  for (const b of briefs) byKind.set(b.kind, (byKind.get(b.kind) ?? 0) + 1);
  console.log("by kind:", Object.fromEntries(byKind));

  const byCat = new Map<string, number>();
  for (const b of briefs) byCat.set(b.categorySlug, (byCat.get(b.categorySlug) ?? 0) + 1);
  console.log("by category:", Object.fromEntries(byCat), "\n");

  for (const b of selected.slice(0, 15)) {
    console.log(`  [${b.kind}] ${b.title}`);
    console.log(`     q: ${b.primaryQuery}`);
  }
  if (selected.length > 15) console.log(`  …and ${selected.length - 15} more`);

  if (!APPLY) { console.log("\nDry run. Nothing written."); return; }

  let written = 0;
  const failures: string[] = [];
  for (const b of selected) {
    const { error } = await db.from("engine_briefs").insert({
      proposed_title: b.title,
      proposed_slug: b.slug,
      content_type: b.contentType,
      primary_query: b.primaryQuery,
      category_slug: b.categorySlug,
      rationale: b.rationale,
      related_product_slugs: b.relatedProductSlugs,
      state: "planned",
      // PENDING. engine_assemble_draft refuses anything not explicitly approved
      // by a person, verified against production.
      review_state: "pending",
    });
    if (error) { failures.push(`${b.slug}: ${error.message}`); continue; }
    written++;
  }
  console.log(`\nwritten: ${written} briefs, review_state='pending'`);
  if (failures.length) {
    console.log(`failures: ${failures.length}`);
    for (const f of failures.slice(0, 10)) console.log("  " + f);
  }
  console.log("No article was written and nothing was published.");
}

main().catch((e) => { console.error("failed:", e instanceof Error ? e.message : e); process.exitCode = 1; });
