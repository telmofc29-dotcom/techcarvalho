// Load a research dataset into the catalogue.
//
//   TC_ADMIN_EMAIL=... TC_ADMIN_PASSWORD=... npx tsx scripts/import-research.ts <dir> [--apply]
//
//   npx tsx scripts/import-research.ts research/canon            # plan only
//   npx tsx scripts/import-research.ts research/canon --apply    # write
//
// DRY RUN BY DEFAULT. Without --apply it reads the files, validates every
// record, resolves every slug against the live catalogue and prints exactly
// what it WOULD write, without touching anything. Run it that way first; the
// plan is the review.
//
// WHAT IT WILL NOT DO
// -------------------
// * It never sets is_published. Everything arrives unpublished and is published
//   by a person through the normal editorial route. Nothing in this file can
//   publish, and there is no flag that makes it.
// * It never writes a spec the research did not state. Absence is written as
//   absence — see research-schema.ts, where that rule is enforced and tested.
// * It never writes a manufacturer's performance claim as a specification.
//   Claims go to product_claims, which exists precisely so a spec table cannot
//   contain "up to 8 stops".
// * It never writes a relationship without a basis.
//
// IDEMPOTENT. Everything is keyed by slug and upserted, so re-running after a
// research fix updates rather than duplicating.
//
// CAPABILITY-AWARE. The knowledge-graph migration may not be applied yet. This
// probes for each table and column, imports what it can, and says loudly what it
// skipped and why. It does NOT silently drop data — a skipped concept is
// reported per record, not summarised as "0 imported".

import { readFileSync, existsSync } from "node:fs";
import { join } from "node:path";
import { loadEnvLocal, createAdminClient } from "./_shared.ts";
import {
  validateProduct,
  validateRelationship,
  LENS_SPEC_FIELDS,
  PRINTER_SPEC_FIELDS,
  CAMERA_BODY_SPEC_FIELDS,
  type SpecField,
  type ValidatedProduct,
} from "../src/lib/catalogue/research-schema.ts";

loadEnvLocal();

const dir = process.argv[2];
const APPLY = process.argv.includes("--apply");

// A single-brand research directory does not repeat the manufacturer on every
// record. Passing it once is explicit; inferring it from the directory name
// would silently attach products to the wrong maker the first time a directory
// is renamed.
const mfrArg = process.argv.find((a) => a.startsWith("--manufacturer="));
const DEFAULT_MANUFACTURER = mfrArg ? mfrArg.split("=")[1] : undefined;
if (!dir) {
  console.error("usage: import-research.ts <research-dir> [--apply]");
  process.exit(1);
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Db = { from: (t: string) => any };

function readJson<T>(path: string): T[] {
  if (!existsSync(path)) return [];
  const text = readFileSync(path, "utf8").trim();
  if (!text) return [];
  const parsed: unknown = JSON.parse(text);
  if (!Array.isArray(parsed)) throw new Error(`${path} is not a JSON array`);
  return parsed as T[];
}

type Counts = Record<string, number>;
const counts: Counts = {};
const bump = (k: string, n = 1) => { counts[k] = (counts[k] ?? 0) + n; };
const problems: string[] = [];

async function main(): Promise<void> {
  const db = (await createAdminClient()) as unknown as Db;

  // ---- capability probe ---------------------------------------------------
  // A REAL select, not a head request.
  //
  // The first version of this used `.select("*", { head: true }).limit(1)`, and
  // that returns NO ERROR for a table which cannot possibly exist — verified by
  // probing `definitely_not_a_table_xyz`, which came back clean. Every
  // capability therefore reported `true`, and the importer would have tried to
  // write to tables that are not there.
  //
  // A probe that cannot fail is not a probe. This one asks for a column and
  // reads the error code: PGRST205 for a missing table, 42703 for a missing
  // column.
  // Probes a column the table actually HAS. Selecting "id" everywhere was
  // wrong for join tables: product_technologies has a composite primary key and
  // no id column at all, so the probe errored and the capability reported
  // MISSING — silently discarding all 44 body-to-mount edges while the table
  // was sitting there working.
  const PROBE_COLUMN: Record<string, string> = {
    product_technologies: "product_id",
    content_technologies: "content_id",
  };
  async function tableExists(t: string): Promise<boolean> {
    const { error } = await db.from(t).select(PROBE_COLUMN[t] ?? "id").limit(1);
    return !error;
  }
  async function columnExists(t: string, c: string): Promise<boolean> {
    const { error } = await db.from(t).select(c).limit(1);
    return !error;
  }

  // Anti-vacuity: prove the prober can still say NO before trusting any yes.
  // Without this, a future change that makes tableExists always-true would make
  // every run above silently wrong again, exactly as it already was once.
  if (await tableExists("tc_table_that_must_never_exist")) {
    throw new Error(
      "capability probe is broken: it reported a nonexistent table as present. " +
      "Refusing to import, because every other capability answer is now untrustworthy."
    );
  }

  const can = {
    concepts: await tableExists("technology_concepts"),
    productTech: await tableExists("product_technologies"),
    claims: await tableExists("product_claims"),
    maturity: await columnExists("products", "maturity"),
    relBasis: await columnExists("product_relationships", "basis"),
    sourceClass: await columnExists("source_records", "source_class"),
    datePrecision: await columnExists("products", "release_date_precision"),
  };
  console.log(`=== import-research ${dir} ${APPLY ? "(APPLYING)" : "(dry run)"} ===\n`);
  console.log("capabilities:", JSON.stringify(can));
  const missing = Object.entries(can).filter(([, v]) => !v).map(([k]) => k);
  if (missing.length) {
    console.log(
      `\nNOT AVAILABLE: ${missing.join(", ")}.\n` +
      `20260827_knowledge_graph.sql is not applied. Records needing these are\n` +
      `reported individually below and NOT written — nothing is silently dropped.\n`
    );
  }

  // ---- load ---------------------------------------------------------------
  const productFile = existsSync(join(dir, "lenses.json"))
    ? "lenses.json"
    : existsSync(join(dir, "printers.json"))
      ? "printers.json"
      : "products.json";
  // The vocabulary and category are chosen by what the directory actually
  // holds. Getting this wrong is not a small mistake: a first pass sent 32
  // camera bodies through the PRINTER spec vocabulary — nothing matched, so
  // they landed with ZERO specifications, in the "computing" category, looking
  // like a successful import.
  const isLenses = productFile === "lenses.json";
  const isPrinters = productFile === "printers.json";
  const isCameraBodies = dir.includes("camera-bodies");
  const fields: SpecField[] = isLenses
    ? LENS_SPEC_FIELDS
    : isPrinters
      ? PRINTER_SPEC_FIELDS
      : isCameraBodies
        ? CAMERA_BODY_SPEC_FIELDS
        : PRINTER_SPEC_FIELDS;
  const categorySlug = isLenses
    ? "camera-lenses"
    : isPrinters
      ? "3d-printing"
      : isCameraBodies
        ? "cameras-photography"
        : "computing";
  if (!isLenses && !isPrinters && !isCameraBodies) {
    console.log(
      `WARNING: ${productFile} in ${dir} matches no known vocabulary. Falling back to
` +
      `printer specs and the 'computing' category, which is almost certainly wrong.
`
    );
  }

  const rawProducts = readJson<Record<string, unknown>>(join(dir, productFile));
  const rawTech = readJson<Record<string, unknown>>(join(dir, "technologies.json"));
  const rawFamilies = readJson<Record<string, unknown>>(join(dir, "families.json"));
  const rawRels = readJson<Record<string, unknown>>(join(dir, "relationships.json"));
  console.log(
    `loaded: ${rawProducts.length} products (${productFile}), ${rawTech.length} technologies, ` +
    `${rawFamilies.length} families, ${rawRels.length} relationships\n`
  );
  if (rawProducts.length === 0) {
    console.log("Nothing to import. (Research not written yet?)");
    return;
  }

  // ---- validate -----------------------------------------------------------
  const products: ValidatedProduct[] = [];
  const researchSlugToFinal = new Map<string, string>();
  for (const raw of rawProducts) {
    const r = validateProduct(raw, fields, { manufacturerSlug: DEFAULT_MANUFACTURER });
    if ("rejected" in r) { problems.push(`REJECTED product: ${r.rejected}`); bump("product.rejected"); continue; }
    for (const i of r.issues) problems.push(`  spec issue ${i.slug}.${i.field}: ${i.problem}`);
    bump("spec.issues", r.issues.length);
    // Brand-prefix the slug so catalogue URLs are readable and globally unique.
    // Research files use maker-local slugs ("rf50mm-f1-8-stm"); the catalogue
    // holds many makers, and /products/rf50mm-f1-8-stm tells a reader nothing.
    // Deterministic and idempotent: a slug already carrying its prefix is left
    // alone, so re-importing does not double it.
    const researchSlug = r.product.slug;
    if (!r.product.slug.startsWith(`${r.product.manufacturerSlug}-`)) {
      r.product.slug = `${r.product.manufacturerSlug}-${r.product.slug}`;
    }
    // Remember what the research called it. Relationship files reference the
    // maker-local slug, and a two-brand directory has no single prefix to guess
    // with — resolving by DEFAULT_MANUFACTURER worked for research/canon and
    // would silently fail to resolve every edge in research/nikon-sony.
    researchSlugToFinal.set(researchSlug, r.product.slug);
    products.push(r.product);
  }

  // ---- resolve the category ----------------------------------------------
  const { data: catRow, error: catErr } = await db
    .from("taxonomy_categories").select("id").eq("slug", categorySlug).maybeSingle();
  if (catErr) throw new Error(`reading taxonomy_categories: ${catErr.message}`);
  if (!catRow) {
    console.log(
      `\nCategory '${categorySlug}' does not exist. Create it first (it also needs a\n` +
      `PLANNED_CATEGORIES entry in src/lib/public/categories.ts to get a hub page).\n` +
      `Nothing written.`
    );
    return;
  }
  const categoryId = catRow.id as string;

  // ---- manufacturers ------------------------------------------------------
  const mfrSlugs = [...new Set(products.map((p) => p.manufacturerSlug))];
  const { data: mfrRows, error: mfrErr } = await db.from("manufacturers").select("id,slug").in("slug", mfrSlugs);
  if (mfrErr) throw new Error(`reading manufacturers: ${mfrErr.message}`);
  const mfrBySlug = new Map((mfrRows as { id: string; slug: string }[]).map((m) => [m.slug, m.id]));
  const missingMfrs = mfrSlugs.filter((s) => !mfrBySlug.has(s));
  for (const slug of missingMfrs) {
    const name = slug.split("-").map((w) => w[0].toUpperCase() + w.slice(1)).join(" ");
    if (APPLY) {
      const { data, error } = await db.from("manufacturers").insert({ name, slug }).select("id").single();
      if (error) { problems.push(`manufacturer ${slug}: ${error.message}`); continue; }
      mfrBySlug.set(slug, data.id);
    } else {
      // A dry run must model the creation, or every product belonging to a
      // not-yet-created manufacturer reports as "unresolved" and the plan
      // understates itself — which is exactly as misleading as overstating it.
      mfrBySlug.set(slug, `dry-run:${slug}`);
    }
    bump("manufacturer.created");
    console.log(`  + manufacturer ${slug} (${name})`);
  }

  // ---- spec definitions ---------------------------------------------------
  const neededSpecs = new Map<string, SpecField>();
  for (const p of products) for (const s of p.specs) neededSpecs.set(s.field.slug, s.field);
  const { data: specRows, error: specErr } = await db
    .from("spec_definitions").select("id,slug").in("slug", [...neededSpecs.keys()]);
  if (specErr) throw new Error(`reading spec_definitions: ${specErr.message}`);
  const specBySlug = new Map((specRows as { id: string; slug: string }[]).map((s) => [s.slug, s.id]));
  for (const [slug, field] of neededSpecs) {
    if (specBySlug.has(slug)) continue;
    if (APPLY) {
      const { data, error } = await db.from("spec_definitions").insert({
        category_id: categoryId, name: field.name, slug, data_type: field.dataType, unit: field.unit,
      }).select("id").single();
      if (error) { problems.push(`spec_definition ${slug}: ${error.message}`); continue; }
      specBySlug.set(slug, data.id);
    }
    bump("spec_definition.created");
  }

  // ---- families -----------------------------------------------------------
  const famBySlug = new Map<string, string>();
  if (rawFamilies.length) {
    const slugs = rawFamilies.map((f) => String(f.slug)).filter(Boolean);
    const { data: famRows, error } = await db.from("product_families").select("id,slug").in("slug", slugs);
    if (error) throw new Error(`reading product_families: ${error.message}`);
    for (const f of famRows as { id: string; slug: string }[]) famBySlug.set(f.slug, f.id);
    for (const f of rawFamilies) {
      const slug = String(f.slug ?? "");
      if (!slug || famBySlug.has(slug)) continue;
      // product_families is scoped by CATEGORY, not by manufacturer — a family
      // is "RF L-series", which belongs to the lens category. The research
      // carries manufacturer_slug for readability; it is not a column here.
      if (APPLY) {
        const { data, error: e } = await db.from("product_families")
          .insert({
            slug, name: String(f.name ?? slug),
            category_id: categoryId,
            description: typeof f.note === "string" ? f.note : null,
          }).select("id").single();
        if (e) { problems.push(`family ${slug}: ${e.message}`); continue; }
        famBySlug.set(slug, data.id);
      } else {
        famBySlug.set(slug, `dry-run:${slug}`);
      }
      bump("family.created");
    }
  }

  // ---- products -----------------------------------------------------------
  const { data: existingRows, error: exErr } = await db
    .from("products").select("id,slug").in("slug", products.map((p) => p.slug));
  if (exErr) throw new Error(`reading products: ${exErr.message}`);
  const productBySlug = new Map((existingRows as { id: string; slug: string }[]).map((p) => [p.slug, p.id]));

  for (const p of products) {
    const mid = mfrBySlug.get(p.manufacturerSlug);
    if (!mid) { problems.push(`${p.slug}: manufacturer '${p.manufacturerSlug}' unresolved`); bump("product.skipped"); continue; }

    const row: Record<string, unknown> = {
      manufacturer_id: mid,
      category_id: categoryId,
      family_id: p.familySlug ? (famBySlug.get(p.familySlug) ?? null) : null,
      name: p.name,
      slug: p.slug,
      release_date: p.announced,
      status: p.status,
      summary: p.summary,
    };
    // Publication state is set ONLY when creating. On UPDATE it is left
    // untouched.
    //
    // Setting it unconditionally cost 10 already-published camera bodies their
    // publication: re-importing to fix their specifications silently
    // unpublished them, and the plan reported "42 product.updated" as though
    // nothing else had happened. An importer must never be able to unpublish.
    //
    // It is still never set TRUE. Publication is an editorial act, not an
    // import side effect.
    if (can.maturity) row.maturity = p.maturity;
    if (can.datePrecision) row.release_date_precision = p.announcedPrecision;

    const existing = productBySlug.get(p.slug);
    if (!existing) row.is_published = false;
    if (APPLY) {
      if (existing) {
        const { error } = await db.from("products").update(row).eq("id", existing);
        if (error) { problems.push(`${p.slug}: ${error.message}`); continue; }
        bump("product.updated");
      } else {
        const { data, error } = await db.from("products").insert(row).select("id").single();
        if (error) { problems.push(`${p.slug}: ${error.message}`); continue; }
        productBySlug.set(p.slug, data.id);
        bump("product.created");
      }
    } else {
      bump(existing ? "product.updated" : "product.created");
    }

    const pid = productBySlug.get(p.slug);
    if (!pid) continue;

    // specs
    for (const s of p.specs) {
      const defId = specBySlug.get(s.field.slug);
      if (!defId) { bump("spec.skipped_no_definition"); continue; }
      if (APPLY) {
        const { error } = await db.from("product_specs")
          .upsert({ product_id: pid, spec_definition_id: defId, value: s.value },
                  { onConflict: "product_id,spec_definition_id" });
        if (error) { problems.push(`${p.slug} spec ${s.field.slug}: ${error.message}`); continue; }
      }
      bump("spec.written");
    }

    // sources — every one classified as what it is, not merely how much it weighs
    //
    // source_records has NO unique constraint on (product_id, url), so an
    // insert is not idempotent and relying on a "duplicate" error to catch it
    // does nothing. The first re-import produced 72 duplicated pairs. Existing
    // urls are therefore read first and skipped.
    let existingUrls = new Set<string>();
    if (p.sourceUrls.length) {
      const { data: sr, error: srErr } = await db
        .from("source_records").select("url").eq("product_id", pid);
      if (srErr) { problems.push(`${p.slug} reading sources: ${srErr.message}`); }
      else existingUrls = new Set((sr as { url: string }[]).map((r) => r.url));
    }
    for (const url of p.sourceUrls) {
      if (existingUrls.has(url)) { bump("source.already_present"); continue; }
      if (APPLY) {
        const rowS: Record<string, unknown> = {
          product_id: pid, url, publisher: p.manufacturerSlug,
          reliability_tier: "primary",
          retrieved_at: p.retrievedAt ? new Date(p.retrievedAt).toISOString() : new Date().toISOString(),
        };
        if (can.sourceClass) rowS.source_class = "manufacturer_official";
        const { error } = await db.from("source_records").insert(rowS);
        if (error && !/duplicate/i.test(error.message)) problems.push(`${p.slug} source: ${error.message}`);
      }
      bump("source.written");
    }

    // claims — never specs
    //
    // product_claims has no unique constraint on (product_id, claim), so an
    // insert is not idempotent. The first re-import duplicated all 190 claims.
    // Existing claim text is read once per product and skipped, the same fix
    // source_records needed.
    let existingClaims = new Set<string>();
    if (can.claims && p.claims.length) {
      const { data: cl, error: clErr } = await db
        .from("product_claims").select("claim").eq("product_id", pid);
      if (clErr) problems.push(`${p.slug} reading claims: ${clErr.message}`);
      else existingClaims = new Set((cl as { claim: string }[]).map((r) => r.claim));
    }
    for (const c of p.claims) {
      if (!can.claims) { bump("claim.skipped_no_table"); continue; }
      if (existingClaims.has(c.claim)) { bump("claim.already_present"); continue; }
      if (APPLY) {
        const { error } = await db.from("product_claims").insert({
          product_id: pid, claim: c.claim, claim_kind: c.kind,
          source_url: c.sourceUrl, retrieved_at: p.retrievedAt ?? null,
        });
        if (error) { problems.push(`${p.slug} claim: ${error.message}`); continue; }
      }
      bump("claim.written");
    }
  }

  // ---- technology concepts -----------------------------------------------
  const techBySlug = new Map<string, string>();
  // EVERY concept, not only the ones in this dataset. A camera-body dataset
  // links to mount concepts created by the LENS dataset, and keying only on
  // this run's technologies.json silently discarded all 44 of those edges.
  if (can.concepts) {
    for (let from = 0; ; from += 1000) {
      const { data, error } = await db.from("technology_concepts").select("id,slug").range(from, from + 999);
      if (error) throw new Error(`reading technology_concepts failed: ${error.message}`);
      for (const c of data as { id: string; slug: string }[]) techBySlug.set(c.slug, c.id);
      if ((data as unknown[]).length < 1000) break;
    }
  }
  if (rawTech.length) {
    if (!can.concepts) {
      bump("concept.skipped_no_table", rawTech.length);
      for (const t of rawTech.slice(0, 5)) problems.push(`  concept '${t.slug}' not written: technology_concepts missing`);
      if (rawTech.length > 5) problems.push(`  …and ${rawTech.length - 5} more concepts`);
    } else {
      const slugs = rawTech.map((t) => String(t.slug)).filter(Boolean);
      const { data: rows, error } = await db.from("technology_concepts").select("id,slug").in("slug", slugs);
      if (error) throw new Error(`reading technology_concepts: ${error.message}`);
      for (const r of rows as { id: string; slug: string }[]) techBySlug.set(r.slug, r.id);
      for (const t of rawTech) {
        const slug = String(t.slug ?? "");
        if (!slug) continue;
        const row = {
          slug, name: String(t.name ?? slug),
          kind: String(t.kind ?? "other"),
          summary: typeof t.summary === "string" ? t.summary : null,
          manufacturer_id: mfrBySlug.get(String(t.manufacturer_slug ?? "")) ?? null,
          category_id: categoryId,
          is_published: false,
        };
        if (APPLY) {
          if (techBySlug.has(slug)) {
            const { error: e } = await db.from("technology_concepts").update(row).eq("id", techBySlug.get(slug));
            if (e) { problems.push(`concept ${slug}: ${e.message}`); continue; }
            bump("concept.updated");
          } else {
            const { data, error: e } = await db.from("technology_concepts").insert(row).select("id").single();
            if (e) { problems.push(`concept ${slug}: ${e.message}`); continue; }
            techBySlug.set(slug, data.id);
            bump("concept.created");
          }
        } else bump(techBySlug.has(slug) ? "concept.updated" : "concept.created");
      }
    }
  }

  // ---- relationships ------------------------------------------------------
  if (rawRels.length && !can.relBasis) {
    // An edge without its justification is precisely what the basis column
    // exists to prevent. Writing them now and backfilling "later" means a
    // catalogue of unexplained successor claims that nobody can review, so
    // they are held rather than imported bare.
    problems.push(
      `${rawRels.length} relationships NOT imported: product_relationships.basis does not exist yet. ` +
      `An edge without its basis is an unreviewable assertion. Apply 20260827_knowledge_graph.sql and re-run.`
    );
    bump("relationship.held_no_basis_column", rawRels.length);
  }
  for (const raw of can.relBasis ? rawRels : []) {
    const r = validateRelationship(raw);
    if ("rejected" in r) { problems.push(`REJECTED relationship: ${r.rejected}`); bump("relationship.rejected"); continue; }
    // Relationship endpoints reference the slug the RESEARCH used. Look it up in
    // the map built while validating, which knows each record's real
    // manufacturer — so a directory holding two brands resolves correctly.
    const resolve = (sl: string) =>
      productBySlug.get(researchSlugToFinal.get(sl) ?? sl) ?? productBySlug.get(sl);
    const from = resolve(r.fromSlug);
    const to = resolve(r.toSlug);

    // A product -> CONCEPT edge is not a product relationship, and discarding
    // it loses the most useful link in the whole camera-body dataset: 44 edges
    // pointing each body at its lens mount, which is the hook from a body page
    // into the 185-lens catalogue. Routed to product_technologies instead.
    if (from && !to && can.productTech) {
      // Datasets disagree on concept slugs: the camera-body research writes
      // "canon-rf-mount" where the lens research wrote "rf-mount". Try the exact
      // slug, then the same slug without a leading manufacturer prefix. This is
      // slug normalisation, not fuzzy matching — nothing is matched on
      // similarity, only on an exact string after a known prefix is removed.
      const conceptId =
        techBySlug.get(r.toSlug) ??
        techBySlug.get(r.toSlug.replace(/^(canon|nikon|sony|sigma|tamron|fujifilm)-/, ""));
      if (conceptId) {
        if (APPLY) {
          const { error } = await db.from("product_technologies").upsert(
            { product_id: from, technology_id: conceptId, note: `${r.type}: ${r.basis ?? ""}`.slice(0, 400) },
            { onConflict: "product_id,technology_id" }
          );
          if (error) { problems.push(`concept link ${r.fromSlug} -> ${r.toSlug}: ${error.message}`); continue; }
        }
        bump("relationship.routed_to_concept");
        continue;
      }
    }

    if (!from || !to) {
      problems.push(`relationship ${r.fromSlug} -> ${r.toSlug}: endpoint not in catalogue`);
      bump("relationship.skipped_unknown_endpoint");
      continue;
    }
    if (APPLY) {
      const row: Record<string, unknown> = {
        product_id: from, related_product_id: to, relationship_type: r.type,
      };
      if (can.relBasis) { row.basis = r.basis; row.source_url = r.sourceUrl; }
      const { error } = await db.from("product_relationships").insert(row);
      if (error) {
        // A unique constraint rejecting a repeat is the NORMAL idempotent path
        // and must be reported as such. Counting it as "written" made the
        // second run look identical to the first and hid the fact that the
        // claims table — which has no such constraint — really was duplicating.
        if (/duplicate|23505/i.test(`${error.code} ${error.message}`)) {
          bump("relationship.already_present");
          continue;
        }
        problems.push(`relationship ${r.fromSlug}->${r.toSlug}: ${error.message}`);
        bump("relationship.failed");
        continue;
      }
    }
    bump("relationship.written");
  }

  // ---- report -------------------------------------------------------------
  console.log("\n--- PLAN ---");
  for (const [k, v] of Object.entries(counts).sort()) console.log(`  ${String(v).padStart(5)}  ${k}`);
  if (problems.length) {
    console.log(`\n--- ${problems.length} PROBLEMS / SKIPS ---`);
    for (const p of problems.slice(0, 60)) console.log("  " + p);
    if (problems.length > 60) console.log(`  …and ${problems.length - 60} more`);
  }
  console.log(
    APPLY
      ? "\nApplied. Everything is UNPUBLISHED — publication is a separate editorial act."
      : "\nDry run. Nothing was written. Re-run with --apply once the plan looks right."
  );
}

main().catch((e) => {
  console.error("import failed:", e instanceof Error ? e.message : e);
  process.exitCode = 1;
});
