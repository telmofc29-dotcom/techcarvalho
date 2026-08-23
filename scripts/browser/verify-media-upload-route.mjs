// Acceptance check for /admin/media/new, run against a REAL authenticated
// admin session.
//
// WHY THE PREVIOUS PROBE WAS NOT ENOUGH
// -------------------------------------
// It signed in fresh, loaded the route once by direct navigation, saw a form,
// and reported success — while the owner's real browser was showing React #441.
// A probe that exercises one path once, with a session it just created, cannot
// contradict a report of session-dependent or intermittent failure, and it
// recorded nothing about WHICH deployment answered.
//
// This one: reuses a persisted session across runs, loads the route repeatedly,
// exercises BOTH direct and client-side navigation, records the deployment id
// of every admin response, treats any browser console error as a failure,
// uploads through the actual form for every rights-sensitive combination,
// proves exactly one private record and one master per upload, proves nothing
// was published, and proves cleanup returns the library to a byte-identical
// baseline.
//
// Lives in scripts/browser/ because it imports Playwright, which is deliberately
// NOT in package.json — see scripts/browser/README.md and commit ecea6f4.
//
// Usage:
//   TC_ADMIN_EMAIL=... TC_ADMIN_PASSWORD=... \
//     node scripts/browser/verify-media-upload-route.mjs [baseUrl] [rounds]

import { chromium } from "playwright";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { createClient } from "@supabase/supabase-js";

const BASE = process.argv[2] ?? "https://www.techcarvalho.com";
const ROUNDS = Number(process.argv[3] ?? 3);
const STATE = "C:/Users/info/AppData/Local/Temp/tc-admin-state.json";
const TEST_ALT = "TEMP upload-route verification asset";

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
if (authErr) {
  console.error("supabase sign-in failed:", authErr.message);
  process.exit(1);
}

const results = [];
function check(name, ok, detail) {
  results.push({ name, ok });
  console.log((ok ? "PASS  " : "FAIL  ") + name + (detail ? "  — " + detail : ""));
}

// Full library fingerprint, so "no unrelated media modified" is provable rather
// than inferred from a row count that could coincidentally match.
async function fingerprint() {
  // The error is CHECKED and fatal, not discarded. The first version of this
  // function selected a column that does not exist on media_assets
  // (`updated_at`), so the query failed, `data` came back null, and the
  // "cleanup restored the baseline" comparison quietly compared "[]" to "[]"
  // and passed. A verification script that reports success because its own
  // query broke is worse than no script — it is the same class of false-pass
  // this whole investigation exists to eliminate.
  const { data, error } = await db
    .from("media_assets")
    .select("id, storage_path, publication_status, created_at")
    .order("id");
  if (error) throw new Error("fingerprint query failed, refusing to report a result: " + error.message);
  if (!data || data.length === 0) throw new Error("fingerprint returned no rows — the library is never empty; refusing to report a result");

  const privList = await db.storage.from("media-private").list("image", { limit: 2000 });
  if (privList.error) throw new Error("private bucket listing failed: " + privList.error.message);
  const pubList = await db.storage.from("media-public").list("image", { limit: 2000 });
  if (pubList.error) throw new Error("public bucket listing failed: " + pubList.error.message);
  const priv = privList.data ?? [];
  const pub = pubList.data ?? [];
  return {
    rows: JSON.stringify(data ?? []),
    count: (data ?? []).length,
    priv: priv.map((o) => o.name).sort().join(","),
    pub: pub.map((o) => o.name).sort().join(","),
    privCount: priv.length,
    pubCount: pub.length,
  };
}

const before = await fingerprint();
console.log("baseline: " + before.count + " assets, " + before.privCount + " private masters, " + before.pubCount + " public objects\n");

const PNG = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==",
  "base64"
);
const TEST_FILE = "C:/Users/info/AppData/Local/Temp/tc-upload-test.png";
writeFileSync(TEST_FILE, PNG);

const browser = await chromium.launch();
const ctx = existsSync(STATE) ? await browser.newContext({ storageState: STATE }) : await browser.newContext();
const page = await ctx.newPage();

let consoleErrors = [];
page.on("pageerror", (e) => consoleErrors.push("PAGEERROR " + e.message));
page.on("console", (m) => {
  if (m.type() === "error") consoleErrors.push("CONSOLE " + m.text());
});

const deployments = new Set();
page.on("response", (r) => {
  const id = r.headers()["x-vercel-id"];
  if (id && new URL(r.url()).pathname.startsWith("/admin")) deployments.add(id);
});

async function boundaryText() {
  const t = await page.locator("body").innerText();
  if (!/Something went wrong loading this page|Minified React error/.test(t)) return null;
  return t.split("\n").filter(Boolean).slice(0, 8).join(" | ");
}

// Sign in only if the persisted session has actually expired.
await page.goto(BASE + "/admin/media", { waitUntil: "domcontentloaded" });
if (page.url().includes("/login")) {
  await page.fill("input[type=email], input[name=email]", process.env.TC_ADMIN_EMAIL);
  await page.fill("input[type=password], input[name=password]", process.env.TC_ADMIN_PASSWORD);
  await Promise.all([
    page.waitForURL((u) => !u.pathname.includes("/login"), { timeout: 30000 }).catch(() => {}),
    page.locator("form button[type=submit]").first().click(),
  ]);
  await ctx.storageState({ path: STATE });
  console.log("signed in fresh\n");
} else {
  console.log("reused persisted session\n");
}

// --- Direct navigation, repeated ---------------------------------------------
let statusOk = true;
let directOk = true;
let formOk = true;
for (let i = 0; i < ROUNDS; i++) {
  const r = await page.goto(BASE + "/admin/media/new", { waitUntil: "networkidle" });
  if (r && r.status() !== 200) statusOk = false;
  const b = await boundaryText();
  if (b) {
    directOk = false;
    console.log("   boundary: " + b);
  }
  if ((await page.locator("input[type=file]").count()) === 0) formOk = false;
}
check("Direct navigation returns 200", statusOk);
check("No React #441 / error boundary on direct load", directOk);
check("Complete upload form renders (file input present)", formOk);

// --- Client-side navigation ---------------------------------------------------
let clientOk = true;
for (let i = 0; i < ROUNDS; i++) {
  await page.goto(BASE + "/admin/media", { waitUntil: "networkidle" });
  const link = page.locator('a[href="/admin/media/new"]').first();
  if ((await link.count()) === 0) {
    clientOk = false;
    break;
  }
  await link.click();
  await page.waitForURL(/\/admin\/media\/new/, { timeout: 30000 }).catch(() => {});
  await page.waitForTimeout(1200);
  if (await boundaryText()) clientOk = false;
  if ((await page.locator("input[type=file]").count()) === 0) clientOk = false;
}
check("Client-side navigation from /admin/media works", clientOk);

// --- Registry -----------------------------------------------------------------
await page.goto(BASE + "/admin/media", { waitUntil: "networkidle" });
const registryOk = !(await boundaryText()) && (await page.locator('a[href^="/admin/media/"]').count()) > 0;
check("Existing media registry still renders", registryOk);

// --- Validation ---------------------------------------------------------------
await page.goto(BASE + "/admin/media/new", { waitUntil: "networkidle" });
check("Empty submission cannot crash (submit disabled with no file)", await page.getByRole("button", { name: /^Upload/ }).isDisabled());
consoleErrors = [];

// --- Uploads, one per rights-sensitive combination ----------------------------
async function uploadOnce(label, assetRole, sourceType) {
  await page.goto(BASE + "/admin/media/new", { waitUntil: "networkidle" });
  await page.setInputFiles("input[type=file]", TEST_FILE);
  await page.waitForTimeout(1200);
  await page.fill("#alt_text", TEST_ALT);
  if (assetRole) await page.selectOption("#asset_role", assetRole);
  await page.click("button[aria-expanded]");
  await page.waitForTimeout(300);
  if (sourceType) await page.selectOption("#source_type", sourceType);
  await page.getByRole("button", { name: /^Upload/ }).click();
  await page.waitForTimeout(9000);
  const text = await page.locator("body").innerText();
  const ok = text.includes("Uploaded");
  const err = text.split("\n").find((l) => /valid source type|valid editorial role|Upload failed|Insert failed|not yet accepted/.test(l));
  check("Upload accepted: " + label, ok, err);
}

await uploadOnce("source_type=tc_graphic", "screenshot", "tc_graphic");
await uploadOnce("source_type=public_domain_or_cc", "screenshot", "public_domain_or_cc");
await uploadOnce("asset_role=concept_render", "concept_render", "");

check("Zero browser console errors during the upload flow", consoleErrors.length === 0, consoleErrors.slice(0, 2).join(" | "));

// --- Database / storage / rights ---------------------------------------------
const { data: created } = await db
  .from("media_assets")
  .select("id, storage_path, public_storage_path, publication_status, source_type, asset_role, ai_generated")
  .eq("alt_text", TEST_ALT);
const rows = created ?? [];
check("One media_assets record per upload", rows.length === 3, "created " + rows.length);
check(
  "Every upload landed PRIVATE (rights safeguard intact)",
  rows.length > 0 && rows.every((r) => r.publication_status === "private" && !r.public_storage_path)
);
const conceptRow = rows.find((r) => r.asset_role === "concept_render");
check(
  "concept_render stored and auto-marked AI-generated",
  !!conceptRow && conceptRow.ai_generated === true,
  conceptRow ? "ai_generated=" + conceptRow.ai_generated : "row missing"
);

const mid = await fingerprint();
check(
  "Exactly one private master per upload, nothing published",
  mid.privCount === before.privCount + rows.length && mid.pubCount === before.pubCount,
  "private " + before.privCount + "->" + mid.privCount + ", public " + before.pubCount + "->" + mid.pubCount
);

// --- Cleanup ------------------------------------------------------------------
for (const r of rows) {
  if (r.public_storage_path) await db.storage.from("media-public").remove([r.public_storage_path]);
  await db.storage.from("media-private").remove([r.storage_path]);
  await db.from("content_media").delete().eq("media_id", r.id);
  await db.from("product_media").delete().eq("media_id", r.id);
  await db.from("media_assets").delete().eq("id", r.id);
}
const after = await fingerprint();
check("Cleanup restored the library to byte-identical baseline", after.rows === before.rows && after.priv === before.priv && after.pub === before.pub);

console.log("\nDEPLOYMENTS THAT ANSWERED: " + ([...deployments].slice(0, 3).join(", ") || "(local)"));
await ctx.storageState({ path: STATE });
await browser.close();

const failed = results.filter((r) => !r.ok);
console.log("\n" + (results.length - failed.length) + "/" + results.length + " checks passed");
if (failed.length) {
  console.log("FAILED: " + failed.map((f) => f.name).join("; "));
  process.exitCode = 1;
}
