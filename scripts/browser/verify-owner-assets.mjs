// Owner items 14 and 15, against the REAL production assets.
//
// GTA 6 Sunset -> the GTA 6 release-date article
// Router       -> the Wi-Fi generations article
//
// Required final state for each: Hero + Thumbnail/card + Gallery, all served by
// ONE media asset with one master file.
//
// This MUTATES real production records, which is what the owner asked for. It
// changes only slot associations — no rights, provenance, classification or
// publication field is written, and nothing is deleted.
//
// Alt text is NOT written. It is missing on both assets and it is a factual
// description of a picture; inventing one is exactly the thing this project
// forbids. It is reported instead.
//
// Usage:
//   TC_ADMIN_EMAIL=... TC_ADMIN_PASSWORD=... \
//     node scripts/browser/verify-owner-assets.mjs [baseUrl]

import { chromium } from "playwright";
import { existsSync, readFileSync } from "node:fs";
import { createClient } from "@supabase/supabase-js";

const BASE = process.argv[2] ?? "https://www.techcarvalho.com";
const STATE = "C:/Users/info/AppData/Local/Temp/tc-admin-state.json";

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
if (authErr) { console.error("sign-in failed:", authErr.message); process.exit(1); }

const results = [];
function check(name, ok, detail) {
  results.push({ name, ok });
  console.log((ok ? "PASS  " : "FAIL  ") + name + (detail ? "  — " + detail : ""));
}
async function until(fn, { timeout = 45000, interval = 700 } = {}) {
  const deadline = Date.now() + timeout;
  while (Date.now() < deadline) {
    try { if (await fn()) return true; } catch { /* poll */ }
    await new Promise((r) => setTimeout(r, interval));
  }
  return false;
}

const RIGHTS = "source_type, rights_status, owned, license, creator, attribution, source_url, asset_role, ai_generated, publication_status, public_storage_path, storage_path";

const CASES = [
  { assetId: "85d16c8b-f1c7-448e-9f70-4308158bec0e", slug: "gta-6-release-date-status", name: "GTA 6 Sunset", search: "GTA 6" },
  { assetId: "2cba992d-cc9c-4b88-a92c-d51a64bdbe72", slug: "wifi-generations-explained-wifi-4-to-wifi-7", name: "Router", search: "Wi-Fi 4 to Wi-Fi 7" },
];

const browser = await chromium.launch();
const ctx = existsSync(STATE) ? await browser.newContext({ storageState: STATE }) : await browser.newContext();
const page = await ctx.newPage();
const pageErrors = [];
page.on("pageerror", (e) => pageErrors.push(e.message));

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

for (const c of CASES) {
  console.log(`\n=== ${c.name} -> ${c.slug} ===`);

  const { data: article } = await db.from("content_items").select("id, status").eq("slug", c.slug).single();
  const rightsBefore = JSON.stringify((await db.from("media_assets").select(RIGHTS).eq("id", c.assetId).single()).data);
  const { data: beforeRows } = await db.from("content_media").select("media_id, role").eq("content_id", article.id);
  const otherBefore = (beforeRows ?? []).filter((r) => r.media_id !== c.assetId).map((r) => `${r.role}:${r.media_id}`).sort().join(",");

  await page.goto(`${BASE}/admin/media/${c.assetId}`, { waitUntil: "networkidle" });
  await page.getByLabel("Search articles").fill(c.search);
  const found = await until(async () => (await page.locator(`input[name="scope_${article.id}"]`).count()) > 0);
  check(`${c.name}: article found via search`, found);
  if (!found) continue;

  for (const role of ["hero", "thumbnail", "gallery"]) {
    await page.locator(`input[name="roles_${article.id}"][value="${role}"]`).check();
  }
  await page.getByRole("button", { name: /Save content associations/ }).click();

  // A hero may already be held by another asset; answer Replace if asked.
  const asked = await until(async () => /already has a hero image/i.test(await page.locator("body").innerText()), { timeout: 12000 });
  if (asked) {
    await page.locator(`input[name="hero_decision_${article.id}"][value="replace"]`).check().catch(() => {});
    await page.getByRole("button", { name: /Confirm and apply/ }).click();
  }

  const applied = await until(async () => {
    const { data } = await db.from("content_media").select("media_id, role").eq("content_id", article.id);
    const mine = (data ?? []).filter((r) => r.media_id === c.assetId).map((r) => r.role).sort();
    return JSON.stringify(mine) === JSON.stringify(["gallery", "hero", "thumbnail"]);
  });

  const { data: afterRows } = await db.from("content_media").select("media_id, role").eq("content_id", article.id);
  const mine = (afterRows ?? []).filter((r) => r.media_id === c.assetId).map((r) => r.role).sort();
  check(`${c.name}: holds Hero + Thumbnail + Gallery`, applied, mine.join(", ") || "none");

  check(`${c.name}: exactly ONE hero on the article`,
    (afterRows ?? []).filter((r) => r.role === "hero").length === 1);
  check(`${c.name}: exactly ONE explicit card image`,
    (afterRows ?? []).filter((r) => r.role === "thumbnail").length === 1);

  const { data: assetRows } = await db.from("media_assets").select("id, storage_path").eq("id", c.assetId);
  check(`${c.name}: still ONE media_assets row and ONE master file`,
    (assetRows ?? []).length === 1 && Boolean(assetRows[0].storage_path));

  const rightsAfter = JSON.stringify((await db.from("media_assets").select(RIGHTS).eq("id", c.assetId).single()).data);
  check(`${c.name}: no rights/provenance/publication field changed`, rightsBefore === rightsAfter);

  // Anything the article already had, that this asset does not own, must be
  // untouched — except a hero this asset legitimately displaced.
  const otherAfter = (afterRows ?? []).filter((r) => r.media_id !== c.assetId).map((r) => `${r.role}:${r.media_id}`).sort().join(",");
  check(`${c.name}: other assets on the article were preserved`,
    otherAfter.length >= 0 && (afterRows ?? []).filter((r) => r.media_id !== c.assetId).length >= (beforeRows ?? []).filter((r) => r.media_id !== c.assetId && r.role !== "hero").length,
    `before[${otherBefore}] after[${otherAfter}]`);

  // --- public rendering ---------------------------------------------------
  const { data: asset } = await db.from("media_assets").select("public_storage_path, alt_text").eq("id", c.assetId).single();
  const publicFile = (asset.public_storage_path ?? "").split("/").pop();

  const articleHtml = await (await fetch(`${BASE}/articles/${c.slug}?cb=${Date.now()}`, { cache: "no-store" })).text();
  check(`${c.name}: live article renders this image`, publicFile && articleHtml.includes(publicFile));
  check(`${c.name}: NO private storage path leaked to the public page`,
    !articleHtml.includes("media-private"));

  const { data: cat } = await db.from("content_items").select("category_id").eq("id", article.id).single();
  const { data: catRow } = cat?.category_id
    ? await db.from("taxonomy_categories").select("slug").eq("id", cat.category_id).single()
    : { data: null };
  if (catRow) {
    const listHtml = await (await fetch(`${BASE}/${catRow.slug}?cb=${Date.now()}`, { cache: "no-store" })).text();
    check(`${c.name}: category card uses the explicit card image`, publicFile && listHtml.includes(publicFile));
  }

  check(`${c.name}: alt text present (NOT invented by this script)`, Boolean(asset.alt_text?.trim()),
    asset.alt_text?.trim() ? "" : "MISSING — owner must write it; a description of a picture is not something to fabricate");
}

check("no browser page errors throughout", pageErrors.length === 0, pageErrors.slice(0, 2).join(" | "));
await ctx.storageState({ path: STATE });
await browser.close();

const failed = results.filter((r) => !r.ok);
console.log(`\n${results.length - failed.length}/${results.length} checks passed`);
if (failed.length) console.log("FAILED: " + failed.map((f) => f.name).join("; "));
