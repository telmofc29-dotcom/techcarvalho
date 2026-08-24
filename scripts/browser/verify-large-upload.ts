/**
 * Upload a file that the OLD architecture could not have accepted.
 *
 * WHY THIS EXISTS SEPARATELY
 * Every upload probe in this repo used a 1x1 PNG of 68 bytes. Next caps a
 * Server Action body at 1 MB by default, so a 68-byte fixture can never reach
 * that limit — which is exactly why four consecutive "16/16 passed" runs
 * reported a working upload path while real photographs failed with a masked
 * React #441. The fixture was the blind spot, so the fixture is the test.
 *
 * 3 MB is chosen deliberately: comfortably above Next's 1 MB Server Action cap
 * AND below Vercel's 4.5 MB function payload ceiling, so a pass proves the
 * bytes genuinely bypass the function rather than merely fitting inside a
 * raised limit.
 *
 * Creates one asset and deletes it, verifying the library returns to its exact
 * prior size. Nothing is published.
 *
 *   npx tsx scripts/browser/verify-large-upload.ts https://www.techcarvalho.com
 */
import { chromium } from "playwright";
import { createHash, randomBytes } from "node:crypto";
import { writeFileSync, unlinkSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { loadEnvLocal, createAdminClient } from "../_shared.ts";

const BASE = process.argv[2] ?? "https://www.techcarvalho.com";
const TARGET_BYTES = 3 * 1024 * 1024;
const STAMP = Date.now();
const FILE_NAME = `tc-large-probe-${STAMP}.png`;

const results: { ok: boolean; label: string; detail?: unknown }[] = [];
function record(label: string, ok: boolean, detail?: unknown) {
  results.push({ ok, label, detail });
  console.log(`[${ok ? "PASS" : "FAIL"}] ${label}`);
  if (detail !== undefined) console.log(`       ${JSON.stringify(detail).slice(0, 220)}`);
}

/** A valid PNG padded to `size` with an ancillary chunk full of random bytes. */
function makePng(size: number): Buffer {
  const sig = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);
  const ihdrData = Buffer.alloc(13);
  ihdrData.writeUInt32BE(1, 0);
  ihdrData.writeUInt32BE(1, 4);
  ihdrData[8] = 8;
  ihdrData[9] = 6;
  const chunk = (type: string, data: Buffer) => {
    const len = Buffer.alloc(4);
    len.writeUInt32BE(data.length, 0);
    const body = Buffer.concat([Buffer.from(type, "ascii"), data]);
    const crc = Buffer.alloc(4);
    crc.writeUInt32BE(crc32(body) >>> 0, 0);
    return Buffer.concat([len, body, crc]);
  };
  const idat = chunk("IDAT", Buffer.from([0x78, 0x9c, 0x62, 0x00, 0x00, 0x00, 0x02, 0x00, 0x01]));
  const head = Buffer.concat([sig, chunk("IHDR", ihdrData), idat]);
  const tail = chunk("IEND", Buffer.alloc(0));
  const padNeeded = Math.max(0, size - head.length - tail.length - 12);
  return Buffer.concat([head, chunk("teXt", randomBytes(padNeeded)), tail]);
}

let table: number[] | null = null;
function crc32(buf: Buffer): number {
  if (!table) {
    table = [];
    for (let n = 0; n < 256; n++) {
      let c = n;
      for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
      table[n] = c;
    }
  }
  let c = 0xffffffff;
  for (const b of buf) c = table[(c ^ b) & 0xff] ^ (c >>> 8);
  return c ^ 0xffffffff;
}

async function main() {
  loadEnvLocal();
  const db = (await createAdminClient()) as never as {
    from: (t: string) => any;
    storage: { from: (b: string) => any };
  };

  const before = await db.from("media_assets").select("id", { count: "exact", head: true });
  const beforeCount = before.count as number;

  const filePath = join(tmpdir(), FILE_NAME);
  const bytes = makePng(TARGET_BYTES);
  writeFileSync(filePath, bytes);
  const sentHash = createHash("sha256").update(bytes).digest("hex");
  record("built a fixture far above the old 1 MB Server Action cap", bytes.length > 1024 * 1024, {
    megabytes: +(bytes.length / 1024 / 1024).toFixed(2),
  });

  const browser = await chromium.launch();
  const context = await browser.newContext({
    userAgent:
      "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0.0.0 Safari/537.36",
  });
  const page = await context.newPage();
  const pageErrors: string[] = [];
  page.on("pageerror", (e) => pageErrors.push(String(e)));

  await page.goto(`${BASE}/admin/login`, { waitUntil: "domcontentloaded" });
  await page.fill("input[name=email]", process.env.TC_ADMIN_EMAIL!);
  await page.fill("input[name=password]", process.env.TC_ADMIN_PASSWORD!);
  // Scoped to main — an unscoped submit hits the header's "Sign out".
  await page.click("main button[type=submit]");
  await page.waitForURL((u) => !u.pathname.includes("/login"), { timeout: 30_000 });

  await page.goto(`${BASE}/admin/media/new`, { waitUntil: "domcontentloaded" });
  await page.setInputFiles("input[type=file]", filePath);
  await page.waitForTimeout(1500);
  await page.fill("#alt_text", `TC large probe ${STAMP}`).catch(() => {});
  await page.click("main button[type=submit]");
  await page.waitForTimeout(25_000);

  const body = (await page.textContent("body")) ?? "";
  record("no React #441 / error boundary", !/Minified React error|Something went wrong loading this page/i.test(body), {
    pageErrors: pageErrors.slice(0, 2),
  });
  record("no body-size rejection", !/Body exceeded|too large|PAYLOAD_TOO_LARGE|413/i.test(body));

  const { data: made } = await db.from("media_assets").select("*").ilike("storage_path", `%${FILE_NAME}%`);
  const rows = (made ?? []) as Record<string, unknown>[];
  record("exactly one row was created", rows.length === 1, { created: rows.length });

  let id: string | null = null;
  let storagePath: string | null = null;
  if (rows.length === 1) {
    id = String(rows[0].id);
    storagePath = String(rows[0].storage_path);
    record("it was NOT published by uploading", rows[0].publication_status === "private", {
      publication_status: rows[0].publication_status,
    });

    // The decisive check: the stored bytes must be the bytes we sent.
    const signed = await db.storage.from("media-private").createSignedUrl(storagePath, 120);
    let storedHash = "";
    let storedLen = 0;
    if (signed.data?.signedUrl) {
      const buf = Buffer.from(await (await fetch(signed.data.signedUrl)).arrayBuffer());
      storedHash = createHash("sha256").update(buf).digest("hex");
      storedLen = buf.length;
    }
    record("the stored object is byte-identical to what was sent", storedHash === sentHash, {
      sentBytes: bytes.length,
      storedBytes: storedLen,
      match: storedHash === sentHash,
    });
  }

  // ---- cleanup ------------------------------------------------------------
  if (id) {
    await db.from("product_media").delete().eq("media_id", id);
    await db.from("content_media").delete().eq("media_id", id);
    await db.from("media_assets").delete().eq("id", id);
  }
  if (storagePath) await db.storage.from("media-private").remove([storagePath]);
  unlinkSync(filePath);

  const after = await db.from("media_assets").select("id", { count: "exact", head: true });
  record("the library returned to its exact prior size", after.count === beforeCount, {
    before: beforeCount,
    after: after.count,
  });

  await browser.close();
  const passed = results.filter((r) => r.ok).length;
  console.log(`\n${passed}/${results.length} checks passed.`);
  if (passed !== results.length) process.exitCode = 1;
}

main().catch((e) => {
  console.error(e);
  process.exitCode = 1;
});
