// Generates original TechCarvalho editorial GRAPHICS — comparison graphics,
// labelled spec diagrams, charts and timelines — from spec files.
//
// Companion to scripts/generate-editorial-heroes.mjs, which covers article
// hero title cards. That script derives its content (title, type, category)
// from the database; this one cannot, because the things it draws are FACTS,
// and a generator that made up facts to fill a canvas would be worse than no
// generator at all. So the data model is inverted: every value rendered here
// must be handed to the script in a spec file, and the script refuses to run
// if the spec is incomplete, ragged, undated or unsourced.
//
// WHY THIS IS SAFE TO RUN AT SCALE
//   * src/lib/media/graphics/validate.ts is a fail-closed gate. One bad spec
//     aborts the whole batch — a half-rendered batch looks like a whole one.
//   * A missing figure is written `null` in the spec and drawn as a visible
//     "not published" gap. It is never zero, never interpolated, never dropped.
//   * Rights metadata is a frozen literal (TC_ORIGINAL_GRAPHIC_RIGHTS). Spec
//     files are REJECTED if they so much as mention a rights field, so nobody
//     can assert rights the generator has not established. What it has
//     established is narrow and true: it drew the SVG itself, so the work is
//     owned, verified, attribution-free, and not AI-generated.
//   * Output is abstract and diagrammatic — geometric primitives, type and
//     rules. There is no code path that accepts a bitmap, path or silhouette,
//     so nothing here can pass for product photography. Each canvas is stamped
//     "original diagram, not a photograph".
//   * Deterministic: seeded from spec.slug, and the seed only reaches the
//     background texture.
//
// Usage:
//   # render only (default) — writes PNG + a sidecar .meta.json for review
//   node scripts/generate-editorial-graphics.mjs --spec specs/ --out ./out
//
//   # validate specs without launching a browser
//   node scripts/generate-editorial-graphics.mjs --spec specs/ --check
//
//   # ingest into Supabase (explicit opt-in; requires admin credentials)
//   TC_ADMIN_EMAIL=... TC_ADMIN_PASSWORD=... \
//     node scripts/generate-editorial-graphics.mjs --spec specs/ --out ./out --ingest

import { readFileSync, writeFileSync, mkdirSync, readdirSync, statSync } from "node:fs";
import { join, resolve, basename } from "node:path";
import { tmpdir } from "node:os";
import { randomUUID } from "node:crypto";

import { validateGraphicSpec, buildAltText } from "../src/lib/media/graphics/validate.ts";
import { renderGraphicSvg, CANVAS_W, CANVAS_H } from "../src/lib/media/graphics/svg.ts";
import { ASSET_ROLE_BY_KIND, TC_ORIGINAL_GRAPHIC_RIGHTS } from "../src/lib/media/graphics/types.ts";
import { evaluatePublishEligibility } from "../src/lib/media/rights.ts";

// ---------------------------------------------------------------- arguments

const argv = process.argv.slice(2);
function flagValues(name) {
  const out = [];
  for (let i = 0; i < argv.length; i++) if (argv[i] === name && argv[i + 1]) out.push(argv[i + 1]);
  return out;
}

const SPEC_PATHS = flagValues("--spec");
const CHECK_ONLY = argv.includes("--check");
const INGEST = argv.includes("--ingest");
const SVG_ONLY = argv.includes("--svg-only");
const OUT = resolve(flagValues("--out")[0] ?? join(tmpdir(), "tc-editorial-graphics"));

if (SPEC_PATHS.length === 0) {
  console.error("usage: node scripts/generate-editorial-graphics.mjs --spec <file-or-dir> [--out <dir>] [--check] [--svg-only] [--ingest]");
  process.exit(2);
}

// ------------------------------------------------------------- load + verify

function collectSpecFiles(paths) {
  const files = [];
  for (const p of paths) {
    const abs = resolve(p);
    const st = statSync(abs);
    if (st.isDirectory()) {
      for (const f of readdirSync(abs).sort()) {
        if (f.endsWith(".json")) files.push(join(abs, f));
      }
    } else {
      files.push(abs);
    }
  }
  return files;
}

const specFiles = collectSpecFiles(SPEC_PATHS);
if (specFiles.length === 0) {
  console.error("no .json spec files found");
  process.exit(2);
}

const loaded = [];
const problems = [];
const seenSlugs = new Map();

for (const file of specFiles) {
  let raw;
  try {
    raw = JSON.parse(readFileSync(file, "utf8"));
  } catch (err) {
    problems.push(`${basename(file)}: not valid JSON — ${err.message}`);
    continue;
  }
  // A file may hold one spec or an array of them.
  const items = Array.isArray(raw) ? raw : [raw];
  items.forEach((item, i) => {
    const where = Array.isArray(raw) ? `${basename(file)}[${i}]` : basename(file);
    const result = validateGraphicSpec(item);
    if (!result.ok) {
      for (const e of result.errors) problems.push(`${where}: ${e}`);
      return;
    }
    const prev = seenSlugs.get(result.spec.slug);
    if (prev) {
      problems.push(`${where}: duplicate slug '${result.spec.slug}' (also in ${prev})`);
      return;
    }
    seenSlugs.set(result.spec.slug, where);
    loaded.push({ file: where, spec: result.spec });
  });
}

// Fail closed for the whole batch. A batch that silently skipped its two
// broken specs is indistinguishable from a batch that worked.
if (problems.length > 0) {
  console.error(`\n${problems.length} spec problem(s) — nothing was generated:\n`);
  for (const p of problems) console.error(`  ✗ ${p}`);
  process.exit(1);
}

console.log(`${loaded.length} valid spec(s):`);
for (const { file, spec } of loaded) console.log(`  · ${spec.kind.padEnd(12)} ${spec.slug}  (${file})`);

if (CHECK_ONLY) {
  console.log("\n--check: specs valid, nothing rendered.");
  process.exit(0);
}

// ------------------------------------------------------------------- render

mkdirSync(OUT, { recursive: true });
console.log(`\noutput: ${OUT}`);

const rendered = [];
for (const { spec } of loaded) {
  const svg = renderGraphicSvg(spec);
  const svgPath = join(OUT, `${spec.kind}-${spec.slug}.svg`);
  writeFileSync(svgPath, svg, "utf8");
  rendered.push({ spec, svg, svgPath });
}

if (SVG_ONLY) {
  console.log(`\nwrote ${rendered.length} SVG file(s). --svg-only: no rasterisation, no ingest.`);
  process.exit(0);
}

const { chromium } = await import("playwright");
const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: CANVAS_W, height: CANVAS_H } });

for (const item of rendered) {
  const pngPath = join(OUT, `${item.spec.kind}-${item.spec.slug}.png`);
  await page.setContent(`<html><body style="margin:0">${item.svg}</body></html>`, { waitUntil: "load" });
  await page.screenshot({ path: pngPath });
  item.pngPath = pngPath;

  // The exact media_assets row this asset would get. Written next to the PNG
  // so the rights metadata is reviewable BEFORE anything is ingested.
  item.assetRow = {
    media_type: "image",
    alt_text: buildAltText(item.spec),
    caption: `${item.spec.title} — original Tech Carvalho graphic. Source: ${item.spec.provenance.sourceLabel} (as of ${item.spec.provenance.asOf}).`,
    width: CANVAS_W,
    height: CANVAS_H,
    asset_role: ASSET_ROLE_BY_KIND[item.spec.kind],
    ...TC_ORIGINAL_GRAPHIC_RIGHTS,
    publication_status: "private",
  };
  writeFileSync(join(OUT, `${item.spec.kind}-${item.spec.slug}.meta.json`), JSON.stringify(item.assetRow, null, 2), "utf8");
  console.log(`  ✓ ${basename(pngPath)}`);
}

await browser.close();

if (!INGEST) {
  console.log(`\nrendered ${rendered.length} graphic(s). No database writes (pass --ingest to upload).`);
  process.exit(0);
}

// ------------------------------------------------------------------- ingest

const { createClient } = await import("@supabase/supabase-js");
const sharp = (await import("sharp")).default;

const env = {};
for (const line of readFileSync(".env.local", "utf8").split("\n")) {
  const m = line.match(/^([A-Z_0-9]+)=(.*)$/);
  if (m) env[m[1]] = m[2].trim();
}

const admin = createClient(env.NEXT_PUBLIC_SUPABASE_URL, env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY);
const { data: auth, error: authErr } = await admin.auth.signInWithPassword({
  email: process.env.TC_ADMIN_EMAIL,
  password: process.env.TC_ADMIN_PASSWORD,
});
if (authErr) {
  console.error("sign-in failed:", authErr.message);
  process.exit(1);
}
const userId = auth.user.id;

let ingested = 0, skipped = 0, failed = 0;

for (const item of rendered) {
  const { spec, assetRow, pngPath } = item;

  // Resolve the attachment target first — an asset with nowhere to go should
  // not be uploaded at all.
  let target = null;
  if (spec.attach) {
    const table = spec.attach.contentSlug ? "content_items" : "products";
    const slug = spec.attach.contentSlug ?? spec.attach.productSlug;
    const { data: row, error } = await admin.from(table).select("id").eq("slug", slug).maybeSingle();
    if (error) { failed++; console.log(`  LOOKUP FAIL ${spec.slug}: ${error.message}`); continue; }
    if (!row) { skipped++; console.log(`  skip (no ${table} row for '${slug}'): ${spec.slug}`); continue; }
    target = { table: spec.attach.contentSlug ? "content_media" : "product_media", column: spec.attach.contentSlug ? "content_id" : "product_id", id: row.id, role: spec.attach.role };

    if (target.role === "hero") {
      const { data: existing } = await admin
        .from(target.table).select("media_id").eq(target.column, row.id).eq("role", "hero").maybeSingle();
      if (existing) { skipped++; console.log(`  skip (already has a hero): ${spec.slug}`); continue; }
    }
  }

  // Belt and braces: the same gate the admin Server Action uses. If the rights
  // literals ever drifted, this stops the publish rather than the RLS layer
  // having to.
  const eligibility = evaluatePublishEligibility(assetRow);
  if (!eligibility.allowed) { failed++; console.log(`  RIGHTS BLOCK ${spec.slug}: ${eligibility.reason}`); continue; }

  const buf = readFileSync(pngPath);
  const meta = await sharp(buf).metadata();
  const storagePath = `image/${randomUUID()}-${spec.kind}-${spec.slug}.png`;

  const { error: upErr } = await admin.storage.from("media-private").upload(storagePath, buf, { contentType: "image/png" });
  if (upErr) { failed++; console.log(`  UPLOAD FAIL ${spec.slug}: ${upErr.message}`); continue; }

  const { data: asset, error: insErr } = await admin.from("media_assets").insert({
    ...assetRow,
    storage_path: storagePath,
    width: meta.width,
    height: meta.height,
  }).select().single();
  if (insErr) { failed++; console.log(`  INSERT FAIL ${spec.slug}: ${insErr.message}`); continue; }

  // Publish = copy the private original into the public bucket, then flip the
  // status. The private object stays as the permanent archive record.
  const { error: copyErr } = await admin.storage.from("media-private").copy(storagePath, storagePath, { destinationBucket: "media-public" });
  if (copyErr) { failed++; console.log(`  COPY FAIL ${spec.slug}: ${copyErr.message}`); continue; }

  await admin.from("media_assets").update({
    publication_status: "published",
    public_storage_path: storagePath,
    published_at: new Date().toISOString(),
    published_by: userId,
  }).eq("id", asset.id);

  if (target) {
    await admin.from(target.table).insert({ [target.column]: target.id, media_id: asset.id, role: target.role, sort_order: 0 });
  }

  ingested++;
  console.log(`  ✓ ingested ${spec.slug}`);
}

console.log(`\ningested=${ingested} skipped=${skipped} failed=${failed}`);
console.log("NOTE: content/product publication status is NOT changed here. That stays a human decision.");
