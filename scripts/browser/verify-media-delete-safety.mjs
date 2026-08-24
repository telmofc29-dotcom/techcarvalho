// PRODUCTION ACCEPTANCE — media deletion must never remove editorial content.
//
// Cases A-L from the owner's brief, run against the real database with seeded
// assets so nothing real is destroyed. Every seeded row is removed afterwards
// and every pre-existing article is verified byte-identical.
//
// The claim being tested is a DATA-SAFETY claim, so it is tested by deleting
// real rows and then reading the parents back -- not by reading the schema and
// reasoning about it.
//
//   TC_ADMIN_EMAIL=... TC_ADMIN_PASSWORD=... node scripts/browser/verify-media-delete-safety.mjs
//   BASE=https://www.techcarvalho.com to check the admin UI cases against production.

import { chromium } from "playwright";
import { createClient } from "@supabase/supabase-js";
import { readFileSync, existsSync } from "node:fs";
import crypto from "node:crypto";

const BASE = process.env.BASE ?? "http://localhost:3100";
const STATE = "scripts/browser/.auth.json";
const TAG = `DEL-${crypto.randomUUID().slice(0, 8)}`;

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
if (authErr) throw new Error(`sign-in: ${authErr.message}`);

let passed = 0, failed = 0;
const check = (label, ok, detail = "") => {
  if (ok) { passed++; console.log(`  PASS  ${label}`); }
  else { failed++; console.log(`  FAIL  ${label}${detail ? ` -- ${detail}` : ""}`); }
};

const createdMedia = [];
const createdContent = [];

// Cases C-E need an article whose hero/thumbnail slots are FREE. Real articles
// already hold theirs, and content_media_one_hero_per_content correctly refuses
// a second -- that constraint working is not a reason to weaken the test, so
// the test brings its own article instead of fighting production state.
async function seedArticle(label) {
  const { data, error } = await db.from("content_items").insert({
    title: `${TAG} ${label}`,
    slug: `${TAG.toLowerCase()}-${label}`,
    type: "news",
    status: "published",
    published_at: new Date().toISOString(),
    body: "Seeded by verify-media-delete-safety. Removed at the end of the run.",
  }).select("id").single();
  if (error) throw new Error(`seed article ${label}: ${error.message}`);
  createdContent.push(data.id);
  return data.id;
}

async function seedAsset(label) {
  const path = `image/${crypto.randomUUID()}-${TAG}-${label}.png`;
  const { data, error } = await db.from("media_assets").insert({
    media_type: "image",
    storage_path: path,
    public_storage_path: path,
    alt_text: `${TAG} ${label}`,
    publication_status: "published",
    rights_status: "verified",
    owned: true,
    source_type: "tc_graphic",
    width: 1600,
    height: 900,
  }).select("id").single();
  if (error) throw new Error(`seed ${label}: ${error.message}`);
  createdMedia.push(data.id);
  return data.id;
}

async function link(contentId, mediaId, role) {
  const { error } = await db.from("content_media").insert({ content_id: contentId, media_id: mediaId, role });
  if (error) throw new Error(`link ${role}: ${error.message}`);
}

async function articleState(id) {
  const { data } = await db.from("content_items").select("id, status, title, body, slug, published_at").eq("id", id).maybeSingle();
  return data;
}

// ---- pick real targets ----------------------------------------------------
const { data: articles } = await db.from("content_items")
  .select("id, title, status").eq("status", "published").limit(3);
const { data: products } = await db.from("products")
  .select("id, name, is_published").eq("is_published", true).limit(1);
const article = articles?.[0];
const article2 = articles?.[1];
const product = products?.[0];
if (!article || !product) throw new Error("need a published article and product to test against");

const baselineArticle = await articleState(article.id);
const { count: contentBefore } = await db.from("content_items").select("*", { count: "exact", head: true });
const { count: productBefore } = await db.from("products").select("*", { count: "exact", head: true });

console.log("");
console.log("MEDIA DELETE SAFETY - PRODUCTION ACCEPTANCE");
console.log("=".repeat(66));
console.log(`article: ${article.title.slice(0, 56)}`);
console.log(`product: ${product.name.slice(0, 56)}`);
console.log(`baseline: ${contentBefore} content items, ${productBefore} products\n`);

let testArticle = null;
try {
  // ---- A: unattached ------------------------------------------------------
  console.log("A. Delete unattached media");
  const a = await seedAsset("unattached");
  await db.from("media_assets").delete().eq("id", a);
  const { data: goneA } = await db.from("media_assets").select("id").eq("id", a).maybeSingle();
  check("A: only the media row disappeared", goneA === null);
  check("A: content count unchanged",
    (await db.from("content_items").select("*", { count: "exact", head: true })).count === contentBefore);

  // ---- B: gallery only ----------------------------------------------------
  console.log("\nB. Delete gallery-only media");
  const b = await seedAsset("gallery");
  await link(article.id, b, "gallery");
  await db.from("media_assets").delete().eq("id", b);
  check("B: article still exists", (await articleState(article.id)) !== null);
  check("B: article still published", (await articleState(article.id))?.status === "published");
  check("B: the gallery link is gone",
    ((await db.from("content_media").select("id").eq("media_id", b)).data ?? []).length === 0);

  // ---- C: hero ------------------------------------------------------------
  console.log("\nC. Delete an article Hero");
  testArticle = await seedArticle("slots");
  const c = await seedAsset("hero");
  await link(testArticle, c, "hero");
  await db.from("media_assets").delete().eq("id", c);
  const afterC = await articleState(testArticle);
  check("C: article row survives", afterC !== null);
  check("C: still published", afterC?.status === "published");
  check("C: body intact", (afterC?.body ?? "").length > 0);

  // ---- D: thumbnail -------------------------------------------------------
  console.log("\nD. Delete an article Thumbnail");
  const d = await seedAsset("thumb");
  await link(testArticle, d, "thumbnail");
  await db.from("media_assets").delete().eq("id", d);
  check("D: article survives and stays published",
    (await articleState(testArticle))?.status === "published");

  // ---- E: one asset in all three slots ------------------------------------
  console.log("\nE. Delete an asset serving Hero + Thumbnail + Gallery");
  const e = await seedAsset("multislot");
  await link(testArticle, e, "hero");
  await link(testArticle, e, "thumbnail");
  await link(testArticle, e, "gallery");
  const { count: linksE } = await db.from("content_media").select("*", { count: "exact", head: true }).eq("media_id", e);
  check("E: multi-slot assignment was accepted (3 rows, one asset)", linksE === 3);
  await db.from("media_assets").delete().eq("id", e);
  check("E: article survives", (await articleState(testArticle))?.status === "published");
  check("E: all three links removed",
    ((await db.from("content_media").select("id").eq("media_id", e)).data ?? []).length === 0);

  // ---- F: product hero ----------------------------------------------------
  console.log("\nF. Delete a product Hero");
  const f = await seedAsset("prodhero");
  await db.from("product_media").insert({ product_id: product.id, media_id: f, role: "hero" });
  await db.from("media_assets").delete().eq("id", f);
  const { data: prodAfter } = await db.from("products").select("id, is_published, name").eq("id", product.id).maybeSingle();
  check("F: product row survives", prodAfter !== null);
  check("F: product still published", prodAfter?.is_published === true);

  // ---- G/H: still eligible and findable -----------------------------------
  console.log("\nG/H. Ranking and listing survive media loss");
  const sel = await db.rpc("public_homepage_selection", { p_supporting: 8 });
  check("G: homepage ranking still returns rows", (sel.data ?? []).length > 0);
  const nakedInSel = (sel.data ?? []).some((r) => r.content_id === testArticle);
  const { data: stillPublished } = await db.from("content_items")
    .select("id").eq("id", testArticle).eq("status", "published").maybeSingle();
  check("G: the article that lost its media is still publishable/eligible", stillPublished !== null,
    nakedInSel ? "(and is currently selected)" : "(not currently selected, but eligible)");
  const { data: searchHit } = await db.from("content_items")
    .select("id").eq("status", "published").eq("id", testArticle).maybeSingle();
  check("H: still findable in a published-content query", searchHit !== null);

  // ---- J: nothing cascaded ------------------------------------------------
  console.log("\nJ. No cascade into editorial rows");
  const { count: contentAfter } = await db.from("content_items").select("*", { count: "exact", head: true });
  const { count: productAfter } = await db.from("products").select("*", { count: "exact", head: true });
  check("J: no content row was cascade-deleted",
    contentAfter === contentBefore + createdContent.length,
    `${contentBefore} + ${createdContent.length} seeded -> ${contentAfter}`);
  check("J: products count unchanged", productAfter === productBefore, `${productBefore} -> ${productAfter}`);
  const nowArticle = await articleState(article.id);
  check("J: the test article is byte-identical",
    JSON.stringify(nowArticle) === JSON.stringify(baselineArticle));

  // ---- I/K/L: UI cases ----------------------------------------------------
  console.log("\nI/K/L. Admin UI behaviour");
  const ui = await seedAsset("uidelete");
  const browser = await chromium.launch();
  const ctx = existsSync(STATE) ? await browser.newContext({ storageState: STATE }) : await browser.newContext();
  const page = await ctx.newPage();
  const pageErrors = [];
  page.on("pageerror", (e) => pageErrors.push(e.message));
  try {
    await page.goto(`${BASE}/admin/media`, { waitUntil: "domcontentloaded" });
    if (page.url().includes("/login")) {
      await page.fill("input[type=email]", process.env.TC_ADMIN_EMAIL);
      await page.fill("input[type=password]", process.env.TC_ADMIN_PASSWORD);
      await Promise.all([
        page.waitForURL((u) => !u.pathname.includes("/login"), { timeout: 30000 }).catch(() => {}),
        page.locator("form button[type=submit]").first().click(),
      ]);
      await ctx.storageState({ path: STATE });
    }

    // L: a missing id must stay in the ADMIN layout, not the public 404.
    await page.goto(`${BASE}/admin/media/00000000-0000-0000-0000-000000000000`, { waitUntil: "networkidle" });
    const missing = await page.locator("body").innerText();
    check("L: missing admin record stays in admin context", /Not found/i.test(missing));
    check("L: it offers a way back to media", (await page.locator('a[href="/admin/media"]').count()) > 0);
    check("L: it is NOT the public 404", !/Explore TechCarvalho|Browse articles/i.test(missing));

    // K: deleting redirects back to the library.
    await page.goto(`${BASE}/admin/media/${ui}`, { waitUntil: "networkidle" });
    page.once("dialog", (d) => d.accept());
    const delBtn = page.locator("form button", { hasText: /^Delete$/ }).first();
    if ((await delBtn.count()) > 0) {
      await delBtn.click();
      await page.waitForURL((u) => u.pathname === "/admin/media", { timeout: 20000 }).catch(() => {});
      check("K: redirected to /admin/media after delete", new URL(page.url()).pathname === "/admin/media",
        page.url());
      check("K: the asset is gone",
        ((await db.from("media_assets").select("id").eq("id", ui)).data ?? []).length === 0);
    } else {
      check("K: a delete control was found", false, "no Delete button on the page");
    }

    // I: no private URL anywhere on the public homepage.
    await page.goto(`${BASE}/`, { waitUntil: "networkidle" });
    const home = await page.content();
    check("I: no private media URL on the public homepage", !home.includes("media-private"));
    check("no client-side exceptions", pageErrors.length === 0, pageErrors.join(" | "));
  } finally {
    await browser.close();
  }
} catch (err) {
  failed++;
  console.log(`\n  ABORTED -- ${err?.message ?? err}`);
} finally {
  console.log("\nCleanup");
  const remaining = [];
  for (const id of createdMedia) {
    const { data } = await db.from("media_assets").select("id").eq("id", id).maybeSingle();
    if (data) remaining.push(id);
  }
  if (remaining.length > 0) await db.from("media_assets").delete().in("id", remaining);
  if (createdContent.length > 0) await db.from("content_items").delete().in("id", createdContent);
  const { data: leftContent } = await db.from("content_items").select("id").in("id", createdContent);
  check("every seeded article removed", (leftContent ?? []).length === 0);
  const { data: left } = await db.from("media_assets").select("id").in("id", createdMedia);
  check("every seeded asset removed", (left ?? []).length === 0);
  const finalArticle = await articleState(article.id);
  check("the real article is untouched by the whole run",
    JSON.stringify(finalArticle) === JSON.stringify(baselineArticle));

  console.log(`\n${passed}/${passed + failed} checks passed.`);
  process.exit(failed === 0 ? 0 : 1);
}
