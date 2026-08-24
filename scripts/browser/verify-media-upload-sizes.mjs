// Acceptance test for /admin/media/new at REAL file sizes.
//
// WHY THIS EXISTS
// ---------------
// Every previous upload fixture was a 1x1 PNG of 68 bytes. That is why an
// automated suite reported the route healthy while every real photograph the
// owner tried died with "Body exceeded 1 MB limit" (413), masked as React #441.
// A test that only uploads something tiny cannot discover a size limit.
//
// This drives the actual form with actual megabytes, including the boundary on
// both sides, and fails if the browser ever receives a 413 or a 500.
//
// Usage:
//   TC_ADMIN_EMAIL=... TC_ADMIN_PASSWORD=... \
//     node scripts/browser/verify-media-upload-sizes.mjs [baseUrl]

import { chromium } from "playwright";
import { createHash } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import { createClient } from "@supabase/supabase-js";

const BASE = process.argv[2] ?? "https://www.techcarvalho.com";
const STATE = "C:/Users/info/AppData/Local/Temp/tc-admin-state.json";
const TAG = "TEMP size-verification asset";
const MB = 1024 * 1024;
const LIMIT = 20 * MB;

const env = {};
for (const line of readFileSync(".env.local", "utf8").split("\n")) {
  const m = line.match(/^([A-Z_0-9]+)=(.*)$/);
  if (m) env[m[1]] = m[2].trim();
}
const db = createClient(env.NEXT_PUBLIC_SUPABASE_URL, env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY);
const { error: authErr } = await db.auth.signInWithPassword({
  email: process.env.TC_ADMIN_EMAIL,
  password: process.env.TC_ADMIN_PASSWORD,
});
if (authErr) { console.error("supabase sign-in failed:", authErr.message); process.exit(1); }

const results = [];
function check(name, ok, detail) {
  results.push({ name, ok });
  console.log((ok ? "PASS  " : "FAIL  ") + name + (detail ? "  — " + detail : ""));
}

async function counts() {
  const { data, error } = await db.from("media_assets").select("id").order("id");
  if (error) throw new Error("count query failed: " + error.message);
  const priv = await db.storage.from("media-private").list("image", { limit: 2000 });
  if (priv.error) throw new Error("private listing failed: " + priv.error.message);
  const pub = await db.storage.from("media-public").list("image", { limit: 2000 });
  if (pub.error) throw new Error("public listing failed: " + pub.error.message);
  return { rows: (data ?? []).length, priv: (priv.data ?? []).length, pub: (pub.data ?? []).length };
}

// A real PNG header followed by deterministic filler. Valid enough for every
// path under test (nothing decodes it server-side) and exactly the size asked
// for, which is the property that matters here.
const PNG_HEAD = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==",
  "base64"
);
function makeFile(bytes) {
  const filler = Buffer.alloc(Math.max(0, bytes - PNG_HEAD.length), 0x5a);
  return Buffer.concat([PNG_HEAD, filler]).subarray(0, bytes);
}
const sha = (buf) => createHash("sha256").update(buf).digest("hex");

const CASES = [
  { label: "~500 KB", bytes: Math.round(0.5 * MB), expect: "accept" },
  { label: "~2 MB", bytes: 2 * MB, expect: "accept" },
  { label: "~5 MB", bytes: 5 * MB, expect: "accept" },
  { label: "~10 MB", bytes: 10 * MB, expect: "accept" },
  { label: "just below the limit (19.5 MB)", bytes: Math.round(19.5 * MB), expect: "accept" },
  { label: "just above the limit (21 MB)", bytes: 21 * MB, expect: "reject" },
];

const baseline = await counts();
console.log(`baseline: ${baseline.rows} rows, ${baseline.priv} private, ${baseline.pub} public\n`);

const browser = await chromium.launch();
const ctx = existsSync(STATE) ? await browser.newContext({ storageState: STATE }) : await browser.newContext();
const page = await ctx.newPage();

const badResponses = [];
page.on("response", (r) => {
  if (r.status() === 413 || r.status() >= 500) badResponses.push(`${r.status()} ${new URL(r.url()).pathname}`);
});
const consoleErrors = [];
page.on("pageerror", (e) => consoleErrors.push("PAGEERROR " + e.message));

await page.goto(BASE + "/admin/media", { waitUntil: "domcontentloaded" });
if (page.url().includes("/login")) {
  await page.fill("input[type=email]", process.env.TC_ADMIN_EMAIL);
  await page.fill("input[type=password]", process.env.TC_ADMIN_PASSWORD);
  await Promise.all([
    page.waitForURL((u) => !u.pathname.includes("/login"), { timeout: 30000 }).catch(() => {}),
    page.locator("form button[type=submit]").first().click(),
  ]);
  await ctx.storageState({ path: STATE });
}

const uploaded = [];

for (const testCase of CASES) {
  const buf = makeFile(testCase.bytes);
  const digest = sha(buf);
  const before = await counts();
  badResponses.length = 0;

  await page.goto(BASE + "/admin/media/new", { waitUntil: "networkidle" });
  await page.setInputFiles("input[type=file]", {
    name: `size-test-${testCase.bytes}.png`,
    mimeType: "image/png",
    buffer: buf,
  });
  await page.waitForTimeout(1500);

  // Search the whole page, not a guessed container — the first <ul> on the
  // page is the admin navigation, which is how this assertion first "failed"
  // against behaviour that was actually correct.
  const listText = await page.locator("body").innerText();

  if (testCase.expect === "reject") {
    // Must be refused in the browser, before anything is sent.
    const saysSize = /This file is 21\.0 MB/.test(listText);
    const saysLimit = /limit is 20\.0 MB/.test(listText);
    check(`${testCase.label}: refused in the UI with size and limit`, saysSize && saysLimit,
      listText.split("\n").find((l) => /This file is/.test(l)));
    check(`${testCase.label}: no 413 or 500 reached the browser`, badResponses.length === 0, badResponses.join(", "));
    const boundary = /Something went wrong loading this page|Minified React error/.test(await page.locator("body").innerText());
    check(`${testCase.label}: no React #441 / error boundary`, !boundary);
    const after = await counts();
    check(`${testCase.label}: nothing written`, after.rows === before.rows && after.priv === before.priv);
    continue;
  }

  await page.fill("#alt_text", TAG);
  await page.getByRole("button", { name: /^Upload/ }).click();

  // Big files need time to reach Supabase.
  const deadline = Date.now() + 180000;
  let text = "";
  while (Date.now() < deadline) {
    text = await page.locator("body").innerText();
    if (/Uploaded|Failed/.test(text)) break;
    await page.waitForTimeout(2000);
  }

  const ok = /Uploaded/.test(text);
  check(`${testCase.label}: upload succeeded`, ok,
    ok ? "" : (text.split("\n").find((l) => /limit|Failed|error|Upload/i.test(l)) ?? "").slice(0, 120));
  check(`${testCase.label}: no 413 or 500 reached the browser`, badResponses.length === 0, badResponses.join(", "));

  const after = await counts();
  check(`${testCase.label}: exactly one row and one private master, nothing published`,
    after.rows === before.rows + 1 && after.priv === before.priv + 1 && after.pub === before.pub,
    `rows ${before.rows}->${after.rows}, private ${before.priv}->${after.priv}, public ${before.pub}->${after.pub}`);

  const { data: rows } = await db
    .from("media_assets")
    .select("id, storage_path, publication_status, public_storage_path")
    .eq("alt_text", TAG)
    .order("created_at", { ascending: false })
    .limit(1);
  const row = rows?.[0];
  if (!row) { check(`${testCase.label}: row retrievable`, false); continue; }
  uploaded.push(row);

  check(`${testCase.label}: stored private, not published`,
    row.publication_status === "private" && !row.public_storage_path);

  // Byte-for-byte retention: download the master and compare hashes.
  const dl = await db.storage.from("media-private").download(row.storage_path);
  if (dl.error) {
    check(`${testCase.label}: master retrievable`, false, dl.error.message);
  } else {
    const stored = Buffer.from(await dl.data.arrayBuffer());
    check(`${testCase.label}: original bytes retained unaltered`,
      stored.length === buf.length && sha(stored) === digest,
      `${stored.length} vs ${buf.length} bytes`);
  }

  // Visible in the registry.
  await page.goto(BASE + "/admin/media", { waitUntil: "networkidle" });
  check(`${testCase.label}: appears in /admin/media`, (await page.content()).includes(`/admin/media/${row.id}`));
}

// --- Combined workflow: 5-10 MB upload -> associate -> reopen -----------------
const subject = uploaded.find((r) => r) ?? null;
if (subject) {
  const rightsCols = "source_type, rights_status, owned, license, creator, attribution, source_url, asset_role, licence_permits_modification, ai_generated, brand_role, publication_status";
  const { data: before } = await db.from("media_assets").select(rightsCols).eq("id", subject.id).single();

  await page.goto(`${BASE}/admin/media/${subject.id}`, { waitUntil: "networkidle" });
  const roleSelects = page.locator('select[name^="role_"]');
  if ((await roleSelects.count()) > 0) {
    await roleSelects.first().selectOption("gallery");
    await page.getByRole("button", { name: "Save product associations" }).click();
    await page.waitForTimeout(5000);

    check("combined workflow: association save did not crash",
      !/Something went wrong loading this page|Minified React error/.test(await page.locator("body").innerText()));

    await page.goto(`${BASE}/admin/media/${subject.id}`, { waitUntil: "networkidle" });
    const { count } = await db.from("product_media").select("*", { count: "exact", head: true }).eq("media_id", subject.id);
    check("combined workflow: association persists after reopening", (count ?? 0) === 1, `rows=${count}`);

    const { data: after } = await db.from("media_assets").select(rightsCols).eq("id", subject.id).single();
    const changed = Object.keys(before ?? {}).filter((k) => JSON.stringify(before[k]) !== JSON.stringify(after[k]));
    check("combined workflow: rights/provenance unchanged by the association", changed.length === 0, changed.join(", "));
  } else {
    check("combined workflow: association control present", false);
  }
}

check("no browser page errors throughout", consoleErrors.length === 0, consoleErrors.slice(0, 2).join(" | "));

await ctx.storageState({ path: STATE });
await browser.close();

// --- Cleanup -------------------------------------------------------------------
for (const row of uploaded) {
  if (row.public_storage_path) await db.storage.from("media-public").remove([row.public_storage_path]);
  await db.storage.from("media-private").remove([row.storage_path]);
  await db.from("product_media").delete().eq("media_id", row.id);
  await db.from("content_media").delete().eq("media_id", row.id);
  await db.from("media_assets").delete().eq("id", row.id);
}
const final = await counts();
console.log(`\nbaseline ${JSON.stringify(baseline)}\nfinal    ${JSON.stringify(final)}`);
check("cleanup returned every count to baseline",
  final.rows === baseline.rows && final.priv === baseline.priv && final.pub === baseline.pub);

const failed = results.filter((r) => !r.ok);
console.log("\n" + (results.length - failed.length) + "/" + results.length + " checks passed");
if (failed.length) { console.log("FAILED: " + failed.map((f) => f.name).join("; ")); process.exitCode = 1; }
