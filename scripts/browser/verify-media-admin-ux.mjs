// The owner-reported failures, tested as the owner actually hits them.
//
//   A1  Media asset -> Content associations -> choose Hero for an article that
//       already has one -> the collision panel must carry its OWN confirm
//       button, and pressing it must actually apply.
//   A2  A TechCarvalho-owned render stuck as "Private / unknown" must reach a
//       usable state through classification alone, with NO invented external
//       provenance.
//   A2b External media must STILL require real provenance.
//   B5  The association picker must not render every article as a row.
//
// Seeds its own records and removes them.
//
// Usage:
//   TC_ADMIN_EMAIL=... TC_ADMIN_PASSWORD=... \
//     node scripts/browser/verify-media-admin-ux.mjs [baseUrl]

import { chromium } from "playwright";
import { existsSync, readFileSync } from "node:fs";
import { createClient } from "@supabase/supabase-js";

const BASE = process.argv[2] ?? "https://www.techcarvalho.com";
const STATE = "C:/Users/info/AppData/Local/Temp/tc-admin-state.json";
const TAG = "TEMP admin-ux";

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

async function until(fn, { timeout = 45000, interval = 750 } = {}) {
  const deadline = Date.now() + timeout;
  while (Date.now() < deadline) {
    try { if (await fn()) return true; } catch { /* keep polling */ }
    await new Promise((r) => setTimeout(r, interval));
  }
  return false;
}

async function totals() {
  const [a, cm] = await Promise.all([
    db.from("media_assets").select("id", { count: "exact", head: true }),
    db.from("content_media").select("id", { count: "exact", head: true }),
  ]);
  return { assets: a.count ?? 0, cm: cm.count ?? 0 };
}

const created = { assets: [], content: [] };

async function seedAsset(label, extra) {
  const path = `image/${crypto.randomUUID()}-ux-${label}.png`;
  const { data, error } = await db
    .from("media_assets")
    .insert({ media_type: "image", storage_path: path, alt_text: `${TAG} ${label}`, publication_status: "private", ...extra })
    .select("id")
    .single();
  if (error) throw new Error(`seed ${label}: ${error.message}`);
  created.assets.push(data.id);
  return data.id;
}

const baseline = await totals();
console.log("baseline:", JSON.stringify(baseline), "\n");

const browser = await chromium.launch();
const ctx = existsSync(STATE) ? await browser.newContext({ storageState: STATE }) : await browser.newContext();
const page = await ctx.newPage();
const pageErrors = [];
page.on("pageerror", (e) => pageErrors.push(e.message));

try {
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

  // ---------- A2: an owned render stuck as "unknown" ----------------------
  // Exactly the state the owner's new renders arrived in.
  const render = await seedAsset("owned-render", {
    owned: false,
    rights_status: "unknown",
    source_type: null,
  });

  await page.goto(`${BASE}/admin/media/${render}`, { waitUntil: "networkidle" });
  const body = await page.locator("body").innerText();
  check("A2: an unclassified asset says so, and says what to do", /not classified yet/i.test(body));
  check("A2: the classification question is on the page",
    /Where did this file come from/i.test(body));

  await page.locator('input[name="preset"][value="tc_render"]').check();
  await page.getByRole("button", { name: /Save classification/ }).click();

  const classified = await until(async () => {
    const { data } = await db.from("media_assets").select("owned, source_type, rights_status").eq("id", render).single();
    return data?.rights_status === "verified";
  });
  check("A2: classifying as a TechCarvalho render reaches verified", classified);

  const { data: afterClass } = await db
    .from("media_assets")
    .select("owned, source_type, rights_status, source_url, license, creator, attribution")
    .eq("id", render)
    .single();
  check("A2: it is recorded as owned", afterClass?.owned === true, `owned=${afterClass?.owned}`);
  check("A2: source type is TechCarvalho graphic", afterClass?.source_type === "tc_graphic", `${afterClass?.source_type}`);
  check(
    "A2: NO external provenance was invented",
    !afterClass?.source_url && !afterClass?.license && !afterClass?.creator && !afterClass?.attribution,
    JSON.stringify({ url: afterClass?.source_url, lic: afterClass?.license, cre: afterClass?.creator })
  );

  // ---------- A2b: external media still needs real provenance -------------
  const external = await seedAsset("external", { owned: false, rights_status: "unknown", source_type: "stock_licensed" });
  await page.goto(`${BASE}/admin/media/${external}`, { waitUntil: "networkidle" });
  await page.selectOption("#rights_status", "verified");
  await page.getByRole("button", { name: /Save provenance/ }).click();
  const refused = await until(async () =>
    /cannot be marked Verified/i.test(await page.locator("body").innerText())
  );
  check("A2b: external media is STILL refused verified without provenance", refused);
  const { data: extAfter } = await db.from("media_assets").select("rights_status").eq("id", external).single();
  check("A2b: and its rights status did not change", extAfter?.rights_status !== "verified", `${extAfter?.rights_status}`);

  // ---------- A1: hero collision confirm button ---------------------------
  const heroA = await seedAsset("hero-incumbent", {
    owned: true, rights_status: "verified", source_type: "staff_photograph",
  });

  const { data: article, error: aErr } = await db
    .from("content_items")
    .insert({ slug: `temp-ux-${crypto.randomUUID().slice(0, 8)}`, title: `${TAG} article`, type: "guide", status: "draft", body: "t" })
    .select("id")
    .single();
  if (aErr) throw new Error("seed article: " + aErr.message);
  created.content.push(article.id);
  await db.from("content_media").insert({ content_id: article.id, media_id: heroA, role: "hero", sort_order: 0 });

  // Drive it from the MEDIA ASSET page, exactly as the owner did.
  await page.goto(`${BASE}/admin/media/${render}`, { waitUntil: "networkidle" });

  // B5: the picker must not list every article up front.
  const preSearchRows = await page.locator('input[type=checkbox][name^="roles_"]').count();
  check("B5: the article list is NOT rendered in full before searching", preSearchRows < 30, `${preSearchRows} slot checkboxes on the page`);

  await page.getByLabel("Search articles").fill(TAG);
  await until(async () => (await page.locator(`input[name="roles_${article.id}"][value="hero"]`).count()) === 1);
  check("B5: searching finds the target article",
    (await page.locator(`input[name="roles_${article.id}"][value="hero"]`).count()) === 1);

  await page.locator(`input[name="roles_${article.id}"][value="hero"]`).check();
  await page.getByRole("button", { name: /Save content associations/ }).click();

  const collisionShown = await until(async () =>
    /already has a hero image/i.test(await page.locator("body").innerText())
  );
  check("A1: the collision panel appears", collisionShown);
  check("A1: the panel carries its OWN confirm button",
    (await page.getByRole("button", { name: /Confirm and apply/ }).count()) > 0);
  check("A1: it states that nothing is saved yet",
    /Nothing is saved until you press this/i.test(await page.locator("body").innerText()));

  const beforeConfirm = await db.from("content_media").select("media_id, role").eq("content_id", article.id);
  check("A1: nothing written before confirming",
    (beforeConfirm.data ?? []).filter((r) => r.role === "hero").length === 1 &&
    beforeConfirm.data[0].media_id === heroA);

  await page.locator(`input[name="hero_decision_${article.id}"][value="replace"]`).check();
  await page.getByRole("button", { name: /Confirm and apply/ }).click();

  const applied = await until(async () => {
    const { data } = await db.from("content_media").select("media_id, role").eq("content_id", article.id);
    return (data ?? []).some((r) => r.role === "hero" && r.media_id === render);
  });
  check("A1: CONFIRM ACTUALLY APPLIES the replacement", applied);

  const { data: finalRows } = await db.from("content_media").select("media_id, role").eq("content_id", article.id);
  const heroes = (finalRows ?? []).filter((r) => r.role === "hero");
  check("A1: exactly one hero remains", heroes.length === 1, `${heroes.length}`);
  check("A1: the previous hero was kept in the gallery",
    (finalRows ?? []).some((r) => r.media_id === heroA && r.role === "gallery"));
  check("A1: the previous asset still exists",
    Boolean((await db.from("media_assets").select("id").eq("id", heroA).maybeSingle()).data));
  check("A1: a clear success message is shown",
    await until(async () => /Hero replaced successfully/i.test(await page.locator("body").innerText())));

  check("no browser page errors throughout", pageErrors.length === 0, pageErrors.slice(0, 2).join(" | "));
} finally {
  await browser.close();
  for (const id of created.content) {
    await db.from("content_media").delete().eq("content_id", id);
    await db.from("content_items").delete().eq("id", id);
  }
  for (const id of created.assets) {
    await db.from("content_media").delete().eq("media_id", id);
    await db.from("product_media").delete().eq("media_id", id);
    await db.from("media_assets").delete().eq("id", id);
  }
}

// Verify OUR OWN records are gone, rather than comparing global totals.
//
// Global counts are not a safe assertion here: the owner may be using the
// admin at the same time, and this test would then fail because somebody else
// attached an image — a false alarm that says nothing about whether this test
// cleaned up after itself. It happened.
const none = ["00000000-0000-0000-0000-000000000000"];
const { data: strayAssets } = await db.from("media_assets").select("id").in("id", created.assets.length ? created.assets : none);
const { data: strayContent } = await db.from("content_items").select("id").in("id", created.content.length ? created.content : none);
const { data: strayLinks } = await db.from("content_media").select("id").in("media_id", created.assets.length ? created.assets : none);

const final = await totals();
console.log("baseline", JSON.stringify(baseline), "| final", JSON.stringify(final), "(global totals informational only)");
check(
  "cleanup removed every record this test created",
  (strayAssets ?? []).length === 0 && (strayContent ?? []).length === 0 && (strayLinks ?? []).length === 0,
  `assets=${(strayAssets ?? []).length} articles=${(strayContent ?? []).length} links=${(strayLinks ?? []).length}`
);

const failed = results.filter((r) => !r.ok);
console.log("\n" + (results.length - failed.length) + "/" + results.length + " checks passed");
if (failed.length) { console.log("FAILED: " + failed.map((f) => f.name).join("; ")); process.exitCode = 1; }
