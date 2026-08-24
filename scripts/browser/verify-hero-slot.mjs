// Behavioural test for hero slot ownership (owner requirement 0.12).
//
// Reproduces the production situation: a target already has a hero, a second
// valid image is assigned as hero, and the admin must be ASKED rather than
// silently ending up with two heroes.
//
// Uses its own seeded article, product and assets so the owner's real records
// are never touched. Everything is removed afterwards and counts are proven to
// return to baseline.
//
// Usage:
//   TC_ADMIN_EMAIL=... TC_ADMIN_PASSWORD=... \
//     node scripts/browser/verify-hero-slot.mjs [baseUrl]

import { chromium } from "playwright";
import { existsSync, readFileSync } from "node:fs";
import { createClient } from "@supabase/supabase-js";

const BASE = process.argv[2] ?? "https://www.techcarvalho.com";
const STATE = "C:/Users/info/AppData/Local/Temp/tc-admin-state.json";
const TAG = "TEMP hero-slot verification";

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
  return { assets: a.count ?? 0, productMedia: pm.count ?? 0, contentMedia: cm.count ?? 0 };
}

const created = { assets: [], content: [], product: [] };

async function seedAsset(label) {
  const path = `image/${crypto.randomUUID()}-hero-slot-${label}.png`;
  const { data, error } = await db
    .from("media_assets")
    .insert({
      media_type: "image",
      storage_path: path,
      alt_text: `${TAG} ${label}`,
      publication_status: "private",
      owned: true,
      rights_status: "verified",
      source_type: "staff_photograph",
      asset_role: "product_photo",
    })
    .select("id")
    .single();
  if (error) throw new Error(`seed asset ${label}: ${error.message}`);
  created.assets.push(data.id);
  return data.id;
}

const baseline = await totals();
console.log("baseline:", JSON.stringify(baseline), "\n");

let assetA, assetB, articleId, productId;
try {
  assetA = await seedAsset("incumbent");
  assetB = await seedAsset("newcomer");

  const { data: article, error: articleErr } = await db
    .from("content_items")
    .insert({ slug: `temp-hero-slot-${crypto.randomUUID().slice(0, 8)}`, title: `${TAG} article`, type: "guide", status: "draft", body: "temp" })
    .select("id")
    .single();
  if (articleErr) throw new Error("seed article: " + articleErr.message);
  articleId = article.id;
  created.content.push(articleId);

  // products.manufacturer_id is NOT NULL, so borrow an existing manufacturer
  // rather than inventing one. Nothing about the manufacturer is modified.
  const { data: anyManufacturer } = await db.from("manufacturers").select("id").limit(1).single();
  const { data: anyCategory } = await db.from("taxonomy_categories").select("id").limit(1).single();
  const { data: product, error: productErr } = await db
    .from("products")
    .insert({
      slug: `temp-hero-slot-${crypto.randomUUID().slice(0, 8)}`,
      name: `${TAG} product`,
      is_published: false,
      manufacturer_id: anyManufacturer?.id,
      category_id: anyCategory?.id,
    })
    .select("id")
    .single();
  if (productErr) throw new Error("seed product: " + productErr.message);
  productId = product.id;
  created.product.push(productId);

  // Asset A is the incumbent hero on both targets.
  await db.from("content_media").insert({ content_id: articleId, media_id: assetA, role: "hero", sort_order: 0 });
  await db.from("product_media").insert({ product_id: productId, media_id: assetA, role: "hero", sort_order: 0 });

  const browser = await chromium.launch();
  const ctx = existsSync(STATE) ? await browser.newContext({ storageState: STATE }) : await browser.newContext();
  const page = await ctx.newPage();
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

  const rightsBefore = async (id) => (await db.from("media_assets").select(RIGHTS).eq("id", id).single()).data;
  const assetARights = await rightsBefore(assetA);

  // ---- ARTICLE: assign B as hero while A holds it -------------------------
  await page.goto(`${BASE}/admin/media/${assetB}`, { waitUntil: "networkidle" });

  const articleSelect = page.locator(`select[name="role_${articleId}"]`);
  check("article association control is present on the new asset", (await articleSelect.count()) === 1);
  await articleSelect.selectOption("hero");
  await page.getByRole("button", { name: "Save content associations" }).click();
  await page.waitForTimeout(4000);

  const bodyAfterFirstSave = await page.locator("body").innerText();
  check("COLLISION DETECTED: admin is told the target already has a hero",
    /already has a hero image/i.test(bodyAfterFirstSave),
    bodyAfterFirstSave.split("\n").find((l) => /already has a hero/i.test(l)));
  check("all three choices offered (replace / add to gallery / cancel)",
    (await page.locator(`input[name="hero_decision_${articleId}"]`).count()) === 3);

  const heroRowsNow = await db.from("content_media").select("media_id").eq("content_id", articleId).eq("role", "hero");
  check("NOTHING was written while waiting for the decision", (heroRowsNow.data ?? []).length === 1 && heroRowsNow.data[0].media_id === assetA,
    `${(heroRowsNow.data ?? []).length} hero row(s)`);

  // ---- Choose Replace ------------------------------------------------------
  await page.locator(`input[name="hero_decision_${articleId}"][value="replace"]`).check();
  await page.getByRole("button", { name: /Apply choices/ }).click();
  await page.waitForTimeout(5000);

  const { data: articleRows } = await db.from("content_media").select("media_id, role").eq("content_id", articleId);
  const heroes = (articleRows ?? []).filter((r) => r.role === "hero");
  check("exactly ONE hero after replace", heroes.length === 1, `${heroes.length} hero rows`);
  check("the NEW asset holds the hero slot", heroes[0]?.media_id === assetB);
  const demoted = (articleRows ?? []).find((r) => r.media_id === assetA);
  check("the old hero was DEMOTED, not deleted", demoted?.role === "gallery", `old asset role=${demoted?.role ?? "GONE"}`);
  const { data: assetAStill } = await db.from("media_assets").select("id").eq("id", assetA).maybeSingle();
  check("the old ASSET still exists", Boolean(assetAStill));
  const assetARightsAfter = await rightsBefore(assetA);
  check("no rights/provenance field changed on the displaced asset",
    JSON.stringify(assetARights) === JSON.stringify(assetARightsAfter));

  // ---- PRODUCT: same behaviour, choosing Add to gallery --------------------
  await page.goto(`${BASE}/admin/media/${assetB}`, { waitUntil: "networkidle" });
  const productSelect = page.locator(`select[name="role_${productId}"]`);
  if ((await productSelect.count()) === 1) {
    await productSelect.selectOption("hero");
    await page.getByRole("button", { name: "Save product associations" }).click();
    await page.waitForTimeout(4000);
    check("PRODUCT collision also detected", /already has a hero image/i.test(await page.locator("body").innerText()));

    await page.locator(`input[name="hero_decision_${productId}"][value="add_to_gallery"]`).check();
    await page.getByRole("button", { name: /Apply choices/ }).click();
    await page.waitForTimeout(5000);

    const { data: productRows } = await db.from("product_media").select("media_id, role").eq("product_id", productId);
    const pHeroes = (productRows ?? []).filter((r) => r.role === "hero");
    check("add-to-gallery leaves the incumbent as hero", pHeroes.length === 1 && pHeroes[0].media_id === assetA,
      `${pHeroes.length} hero(es)`);
    check("the newcomer joined the gallery instead",
      (productRows ?? []).some((r) => r.media_id === assetB && r.role === "gallery"));
  } else {
    check("product association control present", false, "product select not rendered (too many products to list?)");
  }

  check("no browser page errors throughout", consoleErrors.length === 0, consoleErrors.slice(0, 2).join(" | "));

  await ctx.storageState({ path: STATE });
  await browser.close();
} finally {
  for (const id of created.content) {
    await db.from("content_media").delete().eq("content_id", id);
    await db.from("content_items").delete().eq("id", id);
  }
  for (const id of created.product) {
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
  final.assets === baseline.assets && final.productMedia === baseline.productMedia && final.contentMedia === baseline.contentMedia);

const failed = results.filter((r) => !r.ok);
console.log("\n" + (results.length - failed.length) + "/" + results.length + " checks passed");
if (failed.length) { console.log("FAILED: " + failed.map((f) => f.name).join("; ")); process.exitCode = 1; }
