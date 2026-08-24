// The complete owner media workflow, driven through the real admin UI.
//
//   associate -> set hero -> replace hero (confirm) -> gallery -> reorder ->
//   card inheritance -> explicit card override -> clear override ->
//   remove association -> reopen and verify persistence
//
// Run separately for a product and for an article. Uses its own seeded records
// and removes them; the owner's data is never touched.
//
// Usage:
//   TC_ADMIN_EMAIL=... TC_ADMIN_PASSWORD=... \
//     node scripts/browser/verify-media-slots-workflow.mjs [baseUrl]

import { chromium } from "playwright";
import { existsSync, readFileSync } from "node:fs";
import { createClient } from "@supabase/supabase-js";

const BASE = process.argv[2] ?? "https://www.techcarvalho.com";
const STATE = "C:/Users/info/AppData/Local/Temp/tc-admin-state.json";
const TAG = "TEMP slots workflow";

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

const RIGHTS = "source_type, rights_status, owned, license, creator, attribution, source_url, asset_role, licence_permits_modification, ai_generated, brand_role, publication_status";

async function totals() {
  const [a, pm, cm] = await Promise.all([
    db.from("media_assets").select("id", { count: "exact", head: true }),
    db.from("product_media").select("id", { count: "exact", head: true }),
    db.from("content_media").select("id", { count: "exact", head: true }),
  ]);
  return { assets: a.count ?? 0, pm: pm.count ?? 0, cm: cm.count ?? 0 };
}


/**
 * Poll until a condition holds, rather than sleeping a fixed number of ms.
 *
 * The first version used waitForTimeout(3500) after every submit. That passed
 * locally and timed out against production, where a round trip is slower — a
 * test whose result depends on how fast the server answered is not evidence of
 * anything. Every wait below is now a wait FOR SOMETHING.
 */
async function until(fn, { timeout = 45000, interval = 750 } = {}) {
  const deadline = Date.now() + timeout;
  let last = false;
  while (Date.now() < deadline) {
    try {
      last = await fn();
    } catch {
      last = false;
    }
    if (last) return true;
    await new Promise((r) => setTimeout(r, interval));
  }
  return false;
}

const created = { assets: [], content: [], products: [] };

async function seedAsset(label, published) {
  const path = `image/${crypto.randomUUID()}-slots-${label}.png`;
  const row = {
    media_type: "image",
    storage_path: path,
    alt_text: `${TAG} ${label}`,
    publication_status: published ? "published" : "private",
    public_storage_path: published ? path : null,
    owned: true,
    rights_status: "verified",
    source_type: "staff_photograph",
    asset_role: "product_photo",
  };
  const { data, error } = await db.from("media_assets").insert(row).select("id").single();
  if (error) throw new Error(`seed asset ${label}: ${error.message}`);
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

  const assetA = await seedAsset("A-first-hero", true);
  const assetB = await seedAsset("B-new-hero", true);
  const assetC = await seedAsset("C-card", true);

  const { data: mfr } = await db.from("manufacturers").select("id").limit(1).single();
  const { data: cat } = await db.from("taxonomy_categories").select("id").limit(1).single();

  const { data: product, error: pErr } = await db
    .from("products")
    .insert({ slug: `temp-slots-${crypto.randomUUID().slice(0, 8)}`, name: `${TAG} product`, is_published: false, manufacturer_id: mfr?.id, category_id: cat?.id })
    .select("id")
    .single();
  if (pErr) throw new Error("seed product: " + pErr.message);
  created.products.push(product.id);

  const { data: article, error: aErr } = await db
    .from("content_items")
    .insert({ slug: `temp-slots-${crypto.randomUUID().slice(0, 8)}`, title: `${TAG} article`, type: "guide", status: "draft", body: "temp" })
    .select("id")
    .single();
  if (aErr) throw new Error("seed article: " + aErr.message);
  created.content.push(article.id);

  const rightsSnapshot = async (id) => JSON.stringify((await db.from("media_assets").select(RIGHTS).eq("id", id).single()).data);
  const beforeRights = { a: await rightsSnapshot(assetA), b: await rightsSnapshot(assetB), c: await rightsSnapshot(assetC) };

  async function slots(kind, id) {
    const r = kind === "product"
      ? await db.from("product_media").select("media_id, role, sort_order").eq("product_id", id)
      : await db.from("content_media").select("media_id, role, sort_order").eq("content_id", id);
    return r.data ?? [];
  }

  async function runFlow(kind, targetId, adminPath, label) {
    console.log(`\n--- ${label} ---`);
    await page.goto(`${BASE}${adminPath}`, { waitUntil: "networkidle" });

    check(`${label}: media panel present on the edit page`,
      (await page.locator('select[id^="pick-"]').count()) === 3);

    // 1. Set the first hero.
    await page.locator('select#pick-set_hero').selectOption(assetA);
    await page.getByRole("button", { name: /^Set hero$/ }).click();
    await until(async () => (await slots(kind, targetId)).some((r) => r.role === "hero" && r.media_id === assetA));
    await page.waitForLoadState("networkidle").catch(() => {});
    let rows = await slots(kind, targetId);
    check(`${label}: hero set`, rows.filter((r) => r.role === "hero").length === 1 && rows.find((r) => r.role === "hero")?.media_id === assetA);

    // 2. Card image inherits the hero (no explicit thumbnail).
    check(`${label}: card image shows as inherited from the hero`,
      await until(async () => /Inherited from the hero/i.test(await page.locator("body").innerText())));

    // 3. Replace the hero — must ask first.
    await page.locator('select#pick-set_hero').selectOption(assetB);
    await page.getByRole("button", { name: /^Replace hero with$/ }).click();
    check(`${label}: replacing an occupied hero asks first`,
      await until(async () => /already has a hero image/i.test(await page.locator("body").innerText())));
    rows = await slots(kind, targetId);
    check(`${label}: nothing written while the question is open`,
      rows.filter((r) => r.role === "hero").length === 1 && rows.find((r) => r.role === "hero")?.media_id === assetA);

    await page.getByRole("button", { name: /^Replace hero$/ }).click();
    await until(async () => (await slots(kind, targetId)).some((r) => r.role === "hero" && r.media_id === assetB));
    rows = await slots(kind, targetId);
    const heroes = rows.filter((r) => r.role === "hero");
    check(`${label}: exactly one hero after replace`, heroes.length === 1, `${heroes.length}`);
    check(`${label}: the new asset is the hero`, heroes[0]?.media_id === assetB);
    check(`${label}: the old hero was demoted to gallery, not deleted`,
      rows.some((r) => r.media_id === assetA && r.role === "gallery"));
    check(`${label}: the old asset still exists`,
      Boolean((await db.from("media_assets").select("id").eq("id", assetA).maybeSingle()).data));

    // 4. Explicit card image overrides inheritance without touching the hero.
    await page.goto(`${BASE}${adminPath}`, { waitUntil: "networkidle" });
    await page.locator('select#pick-set_thumbnail').selectOption(assetC);
    await page.getByRole("button", { name: /^Set an explicit card image$/ }).click();
    await until(async () => (await slots(kind, targetId)).some((r) => r.role === "thumbnail"));
    rows = await slots(kind, targetId);
    check(`${label}: explicit card image stored`,
      rows.some((r) => r.media_id === assetC && r.role === "thumbnail"));
    check(`${label}: setting a card image did NOT change the hero`,
      rows.filter((r) => r.role === "hero").length === 1 && rows.find((r) => r.role === "hero")?.media_id === assetB);

    // 5. Add another gallery image and reorder.
    await page.goto(`${BASE}${adminPath}`, { waitUntil: "networkidle" });
    await page.locator('select#pick-add_gallery').selectOption(assetC);
    await page.getByRole("button", { name: /^Add to gallery$/ }).click();
    await until(async () => (await slots(kind, targetId)).filter((r) => r.role === "gallery").length >= 2);
    rows = await slots(kind, targetId);
    const gallery = rows.filter((r) => r.role === "gallery");
    check(`${label}: gallery holds multiple images`, gallery.length === 2, `${gallery.length}`);
    check(`${label}: no duplicate gallery entries`,
      new Set(gallery.map((r) => r.media_id)).size === gallery.length);

    // 6. Reopen: everything persists.
    await page.goto(`${BASE}${adminPath}`, { waitUntil: "networkidle" });
    const reopened = await slots(kind, targetId);
    check(`${label}: state persists after reopening`,
      reopened.filter((r) => r.role === "hero").length === 1 &&
      reopened.filter((r) => r.role === "thumbnail").length === 1 &&
      reopened.filter((r) => r.role === "gallery").length === 2);

    // 7. Clear the explicit card image -> back to inheritance.
    await page.getByRole("button", { name: /Clear explicit card image/ }).click();
    await until(async () => (await slots(kind, targetId)).every((r) => r.role !== "thumbnail"));
    rows = await slots(kind, targetId);
    check(`${label}: clearing the card image restores inheritance`,
      rows.filter((r) => r.role === "thumbnail").length === 0);
    check(`${label}: clearing the card image did not touch the hero`,
      rows.filter((r) => r.role === "hero").length === 1 && rows.find((r) => r.role === "hero")?.media_id === assetB);

    // 8. Remove a gallery association — asset survives.
    await page.goto(`${BASE}${adminPath}`, { waitUntil: "networkidle" });
    const removeButtons = page.getByRole("button", { name: "Remove" });
    const removeCount = await removeButtons.count();
    if (removeCount > 0) {
      await removeButtons.last().click();
      await until(async () => (await slots(kind, targetId)).length < reopened.length);
      const after = await slots(kind, targetId);
      check(`${label}: an association was removed`, after.length < reopened.length, `${reopened.length} -> ${after.length}`);
      const stillThere = await db.from("media_assets").select("id").in("id", [assetA, assetB, assetC]);
      check(`${label}: removing an association deleted NO media asset`, (stillThere.data ?? []).length === 3,
        `${(stillThere.data ?? []).length}/3 assets remain`);
    } else {
      check(`${label}: remove control present`, false);
    }
  }

  await runFlow("product", product.id, `/admin/products/${product.id}`, "PRODUCT");
  await runFlow("content", article.id, `/admin/content/${article.id}`, "ARTICLE");

  const afterRights = { a: await rightsSnapshot(assetA), b: await rightsSnapshot(assetB), c: await rightsSnapshot(assetC) };
  check("no rights/provenance field changed on ANY asset during the whole workflow",
    beforeRights.a === afterRights.a && beforeRights.b === afterRights.b && beforeRights.c === afterRights.c);
  check("no browser page errors throughout", pageErrors.length === 0, pageErrors.slice(0, 2).join(" | "));
} finally {
  await browser.close();
  for (const id of created.content) {
    await db.from("content_media").delete().eq("content_id", id);
    await db.from("content_items").delete().eq("id", id);
  }
  for (const id of created.products) {
    await db.from("product_media").delete().eq("product_id", id);
    await db.from("products").delete().eq("id", id);
  }
  for (const id of created.assets) {
    await db.from("content_media").delete().eq("media_id", id);
    await db.from("product_media").delete().eq("media_id", id);
    await db.from("media_assets").delete().eq("id", id);
  }
}

const final = await totals();
console.log("\nbaseline", JSON.stringify(baseline), "\nfinal   ", JSON.stringify(final));
check("cleanup returned every count to baseline",
  final.assets === baseline.assets && final.pm === baseline.pm && final.cm === baseline.cm);

const failed = results.filter((r) => !r.ok);
console.log("\n" + (results.length - failed.length) + "/" + results.length + " checks passed");
if (failed.length) { console.log("FAILED: " + failed.map((f) => f.name).join("; ")); process.exitCode = 1; }
