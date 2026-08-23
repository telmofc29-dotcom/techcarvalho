// Connect products to the technology concepts they actually use.
//
//   TC_ADMIN_EMAIL=... TC_ADMIN_PASSWORD=... npx tsx scripts/link-product-technologies.ts [--apply]
//
// DRY RUN BY DEFAULT. Idempotent.
//
// WHY THIS EXISTS
// ---------------
// 64 concepts were imported and NONE were linked to a product, so
// product_technologies was empty and the readiness audit reported "no
// technology concepts linked" against 168 of 170 unpublished products. The
// knowledge graph had nodes and no edges, which is a filing cabinet rather than
// a graph.
//
// THIS IS DERIVATION, NOT INFERENCE
// ---------------------------------
// Nothing here guesses. Every link is read from a specification the product
// already holds, sourced from the manufacturer:
//
//   focus-motor      = "Nano USM"  -> the Nano USM concept
//   lens-mount-type  = "RF"        -> the RF mount concept
//   lens-stabilisation = "IS"      -> the Image Stabilizer concept
//   print-kinematics = "CoreXY"    -> the CoreXY concept
//
// A spec value with no matching concept produces NO link and is reported, never
// force-matched to something similar. "USM" on a lens whose exact motor Canon
// does not state stays unlinked, because Ring USM and Nano USM are different
// things and picking one would invent a fact.

import { loadEnvLocal, createAdminClient } from "./_shared.ts";

loadEnvLocal();
const APPLY = process.argv.includes("--apply");
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Db = { from: (t: string) => any };

async function all(db: Db, table: string, cols: string): Promise<Record<string, unknown>[]> {
  const out: Record<string, unknown>[] = [];
  for (let from = 0; ; from += 1000) {
    const { data, error } = await db.from(table).select(cols).range(from, from + 999);
    if (error) throw new Error(`reading ${table} failed: ${error.message}`);
    if (data === null) throw new Error(`${table} returned null rather than rows`);
    out.push(...(data as Record<string, unknown>[]));
    if ((data as unknown[]).length < 1000) break;
  }
  return out;
}

/**
 * Spec value -> concept slug, per spec definition.
 *
 * Keys are matched case-insensitively against the WHOLE value, not as a
 * substring: "USM" must not match "Nano USM", because a lens whose motor Canon
 * declines to specify would then be credited with a motor it may not have.
 */
const VALUE_TO_CONCEPT: Record<string, Record<string, string>> = {
  "focus-motor": {
    "ring usm": "ring-usm",
    "micro usm": "micro-usm",
    "nano usm": "nano-usm",
    "stm": "stm",
    "vcm": "vcm",
    "af-s": "nikon-af-s",
    "af-p": "nikon-af-p",
    "af-d": "nikon-af-and-af-d",
    "af": "nikon-af-and-af-d",
    "ssm": "sony-ssm",
    "sam": "sony-sam",
    "xd linear": "sony-xd-linear-motor",
    "xd linear motor": "sony-xd-linear-motor",
  },
  "lens-mount-type": {
    "rf": "rf-mount",
    "rf-s": "rf-s-mount",
    "ef": "ef-mount",
    "ef-s": "ef-s-mount",
    "ef-m": "ef-m-mount",
    "z": "nikon-z-mount",
    "f": "nikon-f-mount",
    "e": "sony-e-mount",
    "fe": "sony-e-mount",
    "a": "sony-a-mount",
  },
  "lens-stabilisation": {
    "is": "image-stabilizer",
    "image stabilizer": "image-stabilizer",
    "hybrid is": "hybrid-is",
    "vr": "nikon-vr",
    "oss": "sony-oss",
  },
  "print-kinematics": {
    "corexy": "corexy",
    "bedslinger": "bedslinger-cartesian",
    "cartesian": "bedslinger-cartesian",
  },
  "print-technology": {
    "fdm": "fdm-fff",
    "fff": "fdm-fff",
    "resin": "resin-msla",
  },
};

/** Boolean specs whose TRUE value implies a concept. */
const BOOLEAN_TO_CONCEPT: Record<string, string> = {
  "control-ring": "control-ring",
  "input-shaping": "input-shaping",
  "auto-bed-levelling": "automatic-bed-levelling",
  "heated-chamber": "heated-chamber",
  "direct-drive": "direct-drive-vs-bowden",
  "multi-material": "multi-material-systems",
  "extender-compatible": "extenders",
};

async function main(): Promise<void> {
  const db = (await createAdminClient()) as unknown as Db;

  const concepts = await all(db, "technology_concepts", "id,slug");
  const conceptBySlug = new Map(concepts.map((c) => [String(c.slug), String(c.id)]));

  const defs = await all(db, "spec_definitions", "id,slug");
  const defById = new Map(defs.map((d) => [String(d.id), String(d.slug)]));

  const specs = await all(db, "product_specs", "product_id,spec_definition_id,value");
  const existing = await all(db, "product_technologies", "product_id,technology_id");
  const already = new Set(existing.map((e) => `${e.product_id}|${e.technology_id}`));

  const wanted = new Map<string, { productId: string; conceptId: string; note: string }>();
  const unmatched = new Map<string, number>();

  for (const s of specs) {
    const defSlug = defById.get(String(s.spec_definition_id));
    if (!defSlug) continue;
    const raw = s.value;

    // Boolean-implied concepts.
    if (raw === true && BOOLEAN_TO_CONCEPT[defSlug]) {
      const cid = conceptBySlug.get(BOOLEAN_TO_CONCEPT[defSlug]);
      if (cid) {
        wanted.set(`${s.product_id}|${cid}`, {
          productId: String(s.product_id), conceptId: cid,
          note: `${defSlug} = true`,
        });
      }
      continue;
    }

    const map = VALUE_TO_CONCEPT[defSlug];
    if (!map || typeof raw !== "string") continue;
    const key = raw.trim().toLowerCase();
    const slug = map[key];
    if (!slug) {
      // Reported, never force-matched. A value the vocabulary does not cover is
      // a research or vocabulary gap, and quietly picking the nearest concept
      // would put a motor on a lens the manufacturer never claimed.
      unmatched.set(`${defSlug}="${raw}"`, (unmatched.get(`${defSlug}="${raw}"`) ?? 0) + 1);
      continue;
    }
    const cid = conceptBySlug.get(slug);
    if (!cid) {
      unmatched.set(`${defSlug}="${raw}" -> concept '${slug}' missing`, (unmatched.get(`${defSlug}="${raw}" -> concept '${slug}' missing`) ?? 0) + 1);
      continue;
    }
    wanted.set(`${s.product_id}|${cid}`, {
      productId: String(s.product_id), conceptId: cid, note: `${defSlug} = ${raw}`,
    });
  }

  const toCreate = [...wanted.entries()].filter(([k]) => !already.has(k));

  console.log(`=== link-product-technologies ${APPLY ? "(APPLYING)" : "(dry run)"} ===\n`);
  console.log(`concepts ${concepts.length}  |  existing links ${existing.length}`);
  console.log(`derivable links ${wanted.size}  |  new ${toCreate.length}\n`);

  if (unmatched.size) {
    console.log("SPEC VALUES WITH NO CONCEPT — reported, never force-matched:");
    for (const [k, n] of [...unmatched].sort((a, b) => b[1] - a[1]).slice(0, 15)) {
      console.log(`  ${String(n).padStart(4)}  ${k}`);
    }
    console.log("");
  }

  if (!APPLY) { console.log("Dry run. Nothing written."); return; }

  let written = 0;
  const failures: string[] = [];
  for (let i = 0; i < toCreate.length; i += 200) {
    const batch = toCreate.slice(i, i + 200).map(([, v]) => ({
      product_id: v.productId, technology_id: v.conceptId, note: v.note,
    }));
    const { error } = await db.from("product_technologies").upsert(batch, { onConflict: "product_id,technology_id" });
    if (error) { failures.push(error.message); continue; }
    written += batch.length;
  }

  const after = await all(db, "product_technologies", "product_id");
  const distinctProducts = new Set(after.map((r) => String(r.product_id))).size;
  console.log(`written ${written}  |  product_technologies now ${after.length} rows across ${distinctProducts} products`);
  if (failures.length) for (const f of failures.slice(0, 5)) console.log(`  FAIL ${f}`);
}

main().catch((e) => { console.error("failed:", e instanceof Error ? e.message : e); process.exitCode = 1; });
