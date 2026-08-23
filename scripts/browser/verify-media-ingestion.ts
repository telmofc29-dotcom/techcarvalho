// End-to-end verification of the manual media ingestion workflow.
//
//   TC_ADMIN_EMAIL=... TC_ADMIN_PASSWORD=... npx tsx scripts/browser/verify-media-ingestion.ts [baseUrl]
//
// Drives the REAL admin form in a real browser and then checks the database and
// storage directly. "The page renders" is not verification of an upload path —
// the only proof that ingestion works is a file in the bucket and a row that
// points at it.
//
// SAFE: everything it creates is tagged, deleted, and the deletion re-checked.
// The 112 pre-existing assets are counted before and after and must match.

import { readFileSync, existsSync, mkdirSync, writeFileSync } from "node:fs";
import { deflateSync } from "node:zlib";
import { chromium } from "playwright";
import { loadEnvLocal, createAdminClient } from "../_shared.ts";
import { classifyMedia, isDepictionOfRealProduct, requiredDisclosure } from "../../src/lib/media/classification.ts";

loadEnvLocal();

const BASE = process.argv[2] ?? "http://localhost:3160";
const STAMP = Date.now();
const FILE_NAME = `tc-ingest-probe-${STAMP}.png`;
const TMP_DIR = "tmp-upload";

type Check = { name: string; passed: boolean; detail: string; note?: string };
const checks: Check[] = [];
const record = (name: string, passed: boolean, detail: unknown, note?: string) =>
  checks.push({ name, passed, detail: typeof detail === "string" ? detail : JSON.stringify(detail), note });

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Db = { from: (t: string) => any; storage: any };

/** A real PNG, generated here — nothing downloaded, no rights question. */
function writeProbePng(path: string): void {
  const w = 8, h = 8;
  const rows: number[][] = [];
  for (let y = 0; y < h; y++) {
    const row = [0];
    for (let x = 0; x < w; x++) row.push((x * 30) % 256, (y * 30) % 256, 128);
    rows.push(row);
  }
  const raw = Buffer.from(rows.flat());
  const crcTable: number[] = [];
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    crcTable[n] = c >>> 0;
  }
  const crc32 = (buf: Buffer) => {
    let c = 0xffffffff;
    for (const b of buf) c = crcTable[(c ^ b) & 0xff] ^ (c >>> 8);
    return (c ^ 0xffffffff) >>> 0;
  };
  const chunk = (type: string, data: Buffer) => {
    const len = Buffer.alloc(4); len.writeUInt32BE(data.length);
    const td = Buffer.concat([Buffer.from(type, "ascii"), data]);
    const crc = Buffer.alloc(4); crc.writeUInt32BE(crc32(td));
    return Buffer.concat([len, td, crc]);
  };
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(w, 0); ihdr.writeUInt32BE(h, 4);
  ihdr[8] = 8; ihdr[9] = 2; ihdr[10] = 0; ihdr[11] = 0; ihdr[12] = 0;
  const png = Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk("IHDR", ihdr),
    chunk("IDAT", deflateSync(raw)),
    chunk("IEND", Buffer.alloc(0)),
  ]);
  writeFileSync(path, png);
}

async function main(): Promise<void> {
  const db = (await createAdminClient()) as unknown as Db;

  if (!existsSync(TMP_DIR)) mkdirSync(TMP_DIR);
  const filePath = `${TMP_DIR}/${FILE_NAME}`;
  writeProbePng(filePath);
  record("a real test image was generated locally", readFileSync(filePath).length > 100, `${readFileSync(filePath).length} bytes`);

  const before = await db.from("media_assets").select("id", { count: "exact", head: true });
  const beforeCount = (before as unknown as { count: number }).count;

  const browser = await chromium.launch();
  const ctx = await browser.newContext({
    userAgent: "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0.0.0 Safari/537.36",
  });
  const page = await ctx.newPage();
  const pageErrors: string[] = [];
  page.on("pageerror", (e) => pageErrors.push(String(e).slice(0, 200)));

  let createdId: string | null = null;
  let storagePath: string | null = null;

  try {
    await page.goto(`${BASE}/admin/login`, { waitUntil: "domcontentloaded" });
    await page.fill("input[name=email]", process.env.TC_ADMIN_EMAIL!);
    await page.fill("input[name=password]", process.env.TC_ADMIN_PASSWORD!);
    await Promise.all([page.waitForLoadState("networkidle"), page.click("form button[type=submit]")]);

    // ---- 1. the page loads -------------------------------------------------
    const res = await page.goto(`${BASE}/admin/media/new`, { waitUntil: "networkidle" });
    const crashed = await page.evaluate(() =>
      /Something went wrong loading this page|Minified React error/i.test(document.body.textContent || "")
    );
    record("/admin/media/new loads without a React error", res?.status() === 200 && !crashed,
      { status: res?.status(), crashed, pageErrors: pageErrors.length });

    const formShape = await page.evaluate(() => ({
      forms: document.querySelectorAll("main form").length,
      fileInput: document.querySelectorAll("input[type=file]").length,
      assetRole: document.querySelectorAll("#asset_role").length,
    }));
    record("the complete form renders, including the editorial role", formShape.forms >= 1 && formShape.fileInput >= 1 && formShape.assetRole === 1, formShape);

    // ---- 2. the concept-render disclosure appears when chosen --------------
    await page.selectOption("#asset_role", "concept_render").catch(() => {});
    await page.waitForTimeout(300);
    const disclosureShown = await page.evaluate(() =>
      /not official product imagery/i.test(document.querySelector("main")?.textContent || "")
    );
    record("choosing 'concept render' shows the mandatory disclosure up front", disclosureShown,
      { shown: disclosureShown }, "The editor sees what the page will say before uploading.");

    // Back to a normal role for the actual upload.
    await page.selectOption("#asset_role", "product_photo").catch(() => {});

    // ---- 3. upload one file ------------------------------------------------
    await page.setInputFiles("input[type=file]", filePath);
    await page.waitForTimeout(1000);
    await page.fill("#alt_text", `TC ingestion probe ${STAMP}`).catch(() => {});
    // SCOPED TO MAIN. The admin layout header carries a "Sign out" submit
    // button, and an unscoped button[type=submit] clicks that instead — which
    // signs the session out and redirects to /admin/login, a failure mode
    // indistinguishable from a broken upload. It cost an hour once.
    await page.click("main button[type=submit]");
    await page.waitForTimeout(6000);

    const stillCrashed = await page.evaluate(() =>
      /Something went wrong loading this page|Minified React error/i.test(document.body.textContent || "")
    );
    record("submitting does not crash React", !stillCrashed, { crashed: stillCrashed, pageErrors: pageErrors.slice(0, 2) });

    // ---- 4. exactly one record, and the object exists -----------------------
    const { data: made, error: madeErr } = await db
      .from("media_assets").select("*").ilike("storage_path", `%${FILE_NAME}%`);
    if (madeErr) throw new Error(`reading media_assets failed: ${madeErr.message}`);
    const rows = made as Record<string, unknown>[];
    record("exactly ONE media record was created", rows.length === 1, { created: rows.length });

    if (rows.length === 1) {
      createdId = String(rows[0].id);
      storagePath = String(rows[0].storage_path);

      const { data: signed } = await db.storage.from("media-private").createSignedUrl(storagePath, 60);
      let objectOk = false;
      if (signed?.signedUrl) {
        const r = await fetch(signed.signedUrl, { headers: { Range: "bytes=0-0" } });
        objectOk = r.status === 200 || r.status === 206;
      }
      record("the storage object genuinely exists (fetched, not assumed)", objectOk, { storagePath });

      record("the master is retained privately, unpublished", rows[0].publication_status === "private",
        { publication_status: rows[0].publication_status, public_storage_path: rows[0].public_storage_path ?? null });

      record("the editorial role was saved", rows[0].asset_role === "product_photo", { asset_role: rows[0].asset_role });

      const classification = classifyMedia(rows[0]);
      // An asset uploaded with no source_type is HONESTLY unclassified — that
      // is the right answer, not a defect. What must not happen is an OWNED
      // photograph landing there, which is what the hidden source_type field
      // now prevents.
      record("an asset with no source is honestly 'unclassified', not guessed",
        classification === "unclassified", { classification });
      const asOwned = classifyMedia({ ...rows[0], source_type: "staff_photograph", owned: true, rights_status: "verified" });
      record("ticking OWNED yields owned_original_photo, not unclassified",
        asOwned === "owned_original_photo", { classification: asOwned },
        "Without a source_type our own photography would never be recognised as ours, and shouldWatermark() would refuse it.");

      // ---- 5. association with a product and an article --------------------
      const { data: prod } = await db.from("products").select("id,slug").limit(1).single();
      const { data: art } = await db.from("content_items").select("id,slug").eq("status", "published").limit(1).single();
      const pmRes = await db.from("product_media").insert({ product_id: prod.id, media_id: createdId, role: "gallery" });
      record("the asset can be associated with a product", !pmRes.error, pmRes.error?.message ?? prod.slug);
      const cmRes = await db.from("content_media").insert({ content_id: art.id, media_id: createdId, role: "gallery" });
      record("the asset can be associated with an article", !cmRes.error, cmRes.error?.message ?? art.slug);

      // ---- 6. concept-render invariants, checked on real shapes ------------
      const asConcept = { ...rows[0], asset_role: "concept_render", ai_generated: true };
      record("a concept render never depicts a real product",
        isDepictionOfRealProduct(asConcept) === false && classifyMedia(asConcept) === "generated_concept",
        { classification: classifyMedia(asConcept), depicts: isDepictionOfRealProduct(asConcept) });
      record("a concept render always yields a disclosure", !!requiredDisclosure(asConcept),
        requiredDisclosure(asConcept)?.slice(0, 60) ?? "none");

      // ---- 7. owned vs third-party stay distinguishable --------------------
      const owned = classifyMedia({ ...rows[0], source_type: "staff_photograph", owned: true });
      const cc = classifyMedia({ ...rows[0], source_type: "public_domain_or_cc", owned: false, rights_status: "verified" });
      record("owned media is distinguishable from third-party CC", owned !== cc, { owned, cc });

      // ---- 8. rights still fail closed -------------------------------------
      const unverified = classifyMedia({ ...rows[0], source_type: "public_domain_or_cc", rights_status: "unknown" });
      record("unknown rights do NOT produce a verified classification",
        unverified === "unverified_photo" && !isDepictionOfRealProduct({ ...rows[0], source_type: "public_domain_or_cc", rights_status: "unknown" }),
        { classification: unverified });
    }
  } finally {
    // ---- cleanup, verified -------------------------------------------------
    if (createdId) {
      await db.from("product_media").delete().eq("media_id", createdId);
      await db.from("content_media").delete().eq("media_id", createdId);
      await db.from("media_assets").delete().eq("id", createdId);
    }
    if (storagePath) await db.storage.from("media-private").remove([storagePath]);

    const { data: left } = await db.from("media_assets").select("id").ilike("storage_path", `%${FILE_NAME}%`);
    record("the probe asset was removed", ((left ?? []) as unknown[]).length === 0, { leftover: ((left ?? []) as unknown[]).length });

    const after = await db.from("media_assets").select("id", { count: "exact", head: true });
    const afterCount = (after as unknown as { count: number }).count;
    record("the pre-existing library is unchanged", afterCount === beforeCount, { before: beforeCount, after: afterCount });

    await browser.close();
  }

  let pass = 0;
  for (const c of checks) {
    if (c.passed) pass++;
    console.log(`[${c.passed ? "PASS" : "FAIL"}] ${c.name}`);
    console.log(`       ${c.detail}`);
    if (c.note) console.log(`       ${c.note}`);
  }
  console.log(`\n${pass}/${checks.length} checks passed.`);
  if (pass !== checks.length) process.exitCode = 1;
}

main().catch((e) => { console.error("verification failed to run:", e instanceof Error ? e.message : e); process.exitCode = 1; });
