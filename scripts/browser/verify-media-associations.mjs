// Acceptance check for /admin/media/[id]: association saves must not touch
// rights or provenance, and an invalid rights change must be a message, never
// React #441 (production digest 994149443).
//
// Creates its own throwaway assets, drives the real forms, and deletes them.
//
// Usage:
//   TC_ADMIN_EMAIL=... TC_ADMIN_PASSWORD=... \
//     node scripts/browser/verify-media-associations.mjs [baseUrl]

import { chromium } from "playwright";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { createClient } from "@supabase/supabase-js";

const BASE = process.argv[2] ?? "https://www.techcarvalho.com";
const STATE = "C:/Users/info/AppData/Local/Temp/tc-admin-state.json";
const TAG = "TEMP association-verification asset";

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

const RIGHTS_COLUMNS =
  "source_type, rights_status, owned, license, creator, attribution, attribution_required, source_url, asset_role, licence_permits_modification, ai_generated, brand_role, publication_status";

async function rightsOf(id) {
  const { data, error } = await db.from("media_assets").select(RIGHTS_COLUMNS).eq("id", id).single();
  if (error) throw new Error("reading asset failed: " + error.message);
  return data;
}

// Seed assets directly, so the test is about the EDIT page rather than upload.
async function seed(label, fields) {
  const storage_path = `image/${crypto.randomUUID()}-assoc-test.png`;
  const { data, error } = await db
    .from("media_assets")
    .insert({ media_type: "image", storage_path, alt_text: TAG, publication_status: "private", ...fields })
    .select("id")
    .single();
  if (error) throw new Error(`seeding ${label} failed: ${error.message}`);
  return data.id;
}


/**
 * Choose a role for a target in the searchable association picker.
 *
 * The picker deliberately does NOT render every article and product up front —
 * that was the point of replacing it. An unattached target therefore has to be
 * searched for before its role control exists, and its control is named
 * __pick_<id> until it is saved, after which it becomes role_<id>.
 */
async function pickRole(page, targetId, searchLabel, searchText, role) {
  const attached = page.locator(`select[name="role_${targetId}"]`);
  if ((await attached.count()) === 1) {
    await attached.selectOption(role);
    return true;
  }
  const box = page.getByLabel(searchLabel);
  if ((await box.count()) === 0) return false;
  await box.fill(searchText);
  const picker = page.locator(`select[name="__pick_${targetId}"]`);
  for (let i = 0; i < 40 && (await picker.count()) === 0; i++) {
    await page.waitForTimeout(250);
  }
  if ((await picker.count()) === 0) return false;
  await picker.selectOption(role);
  return true;
}

const seeded = [];
try {
  const owned = await seed("owned photograph", {
    owned: true, rights_status: "verified", source_type: "staff_photograph",
    asset_role: "product_photo",
  });
  const graphic = await seed("tc graphic", {
    owned: true, rights_status: "verified", source_type: "tc_graphic", asset_role: "diagram",
  });
  const concept = await seed("concept render", {
    owned: true, rights_status: "verified", source_type: "tc_graphic",
    asset_role: "concept_render", ai_generated: true,
  });
  const external = await seed("external unverified", {
    owned: false, rights_status: "unknown", source_type: "stock_licensed", asset_role: "product_photo",
  });
  seeded.push(owned, graphic, concept, external);

  const browser = await chromium.launch();
  const ctx = existsSync(STATE) ? await browser.newContext({ storageState: STATE }) : await browser.newContext();
  const page = await ctx.newPage();
  const consoleErrors = [];
  page.on("pageerror", (e) => consoleErrors.push("PAGEERROR " + e.message));
  page.on("console", (m) => { if (m.type() === "error") consoleErrors.push("CONSOLE " + m.text()); });

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

  const boundary = async () => /Something went wrong loading this page|Minified React error/.test(await page.locator("body").innerText());

  // Associate with the first product via the real form, then compare rights
  // columns byte-for-byte.
  async function associateAndCompare(label, id) {
    await page.goto(`${BASE}/admin/media/${id}`, { waitUntil: "networkidle" });
    if (await boundary()) { check(`${label}: detail page renders`, false, "error boundary"); return; }
    const before = await rightsOf(id);

    // The picker lists nothing until searched, so search for a real product and
    // take the first result. Any product will do — this test is about whether
    // the ASSOCIATION disturbs rights, not about which product it picks.
    const search = page.getByLabel("Search products");
    if ((await search.count()) === 0) { check(`${label}: has an association control`, false); return; }
    await search.fill("a");
    const picker = page.locator('select[name^="__pick_"]').first();
    for (let i = 0; i < 40 && (await picker.count()) === 0; i++) await page.waitForTimeout(250);
    if ((await picker.count()) === 0) { check(`${label}: has an association control`, false); return; }
    await picker.selectOption("gallery");
    await page.getByRole("button", { name: "Save product associations" }).click();
    await page.waitForTimeout(4000);

    check(`${label}: association save did not crash`, !(await boundary()));
    const after = await rightsOf(id);
    const changed = Object.keys(before).filter((k) => JSON.stringify(before[k]) !== JSON.stringify(after[k]));
    check(`${label}: association-only save left every rights/provenance field unchanged`, changed.length === 0, changed.join(", "));

    const { count } = await db
      .from("product_media")
      .select("*", { count: "exact", head: true })
      .eq("media_id", id);
    check(`${label}: association row exists`, (count ?? 0) === 1, `rows=${count}`);
  }

  await associateAndCompare("owned photograph", seeded[0]);
  await associateAndCompare("tc graphic", seeded[1]);
  await associateAndCompare("concept render", seeded[2]);

  // The digest-994149443 state: mark an external asset Verified with no
  // provenance. Must be a readable message, not a crash.
  const external2 = seeded[3];
  await page.goto(`${BASE}/admin/media/${external2}`, { waitUntil: "networkidle" });
  const beforeExternal = await rightsOf(external2);
  await page.selectOption("#rights_status", "verified");
  await page.getByRole("button", { name: "Save provenance" }).click();
  await page.waitForTimeout(4000);

  const text = await page.locator("body").innerText();
  check("verified-without-provenance does NOT crash", !/Minified React error|Something went wrong loading this page/.test(text));
  check(
    "verified-without-provenance explains which field is missing",
    /cannot be marked Verified/i.test(text) && /Source URL/.test(text) && /License/.test(text),
    text.split("\n").find((l) => /cannot be marked Verified/i.test(l))?.slice(0, 110)
  );
  const afterExternal = await rightsOf(external2);
  check("the rejected save changed nothing", JSON.stringify(beforeExternal) === JSON.stringify(afterExternal));

  // A legitimate provenance save must still work, and must not wipe asset_role.
  await page.goto(`${BASE}/admin/media/${external2}`, { waitUntil: "networkidle" });
  await page.fill("#source_url", "https://example.org/verification-test");
  await page.selectOption("#rights_status", "verified");
  await page.getByRole("button", { name: "Save provenance" }).click();
  await page.waitForTimeout(4000);
  const afterGood = await rightsOf(external2);
  // license/creator live on the other form, so this should still be refused —
  // proving the check is on the MERGED row, not just the submitted fields.
  check(
    "still refused while License/Creator remain empty (merged-row check)",
    afterGood.rights_status !== "verified",
    "rights_status=" + afterGood.rights_status
  );
  check("asset_role survived the provenance save", afterGood.asset_role === beforeExternal.asset_role,
    `${beforeExternal.asset_role} -> ${afterGood.asset_role}`);

  check("no browser console errors throughout", consoleErrors.length === 0, consoleErrors.slice(0, 2).join(" | "));

  await ctx.storageState({ path: STATE });
  await browser.close();
} finally {
  for (const id of seeded) {
    await db.from("product_media").delete().eq("media_id", id);
    await db.from("content_media").delete().eq("media_id", id);
    await db.from("media_assets").delete().eq("id", id);
  }
  const { count } = await db.from("media_assets").select("*", { count: "exact", head: true }).eq("alt_text", TAG);
  check("cleanup removed every seeded asset", (count ?? 0) === 0, `remaining=${count}`);
}

const failed = results.filter((r) => !r.ok);
console.log("\n" + (results.length - failed.length) + "/" + results.length + " checks passed");
if (failed.length) { console.log("FAILED: " + failed.map((f) => f.name).join("; ")); process.exitCode = 1; }
