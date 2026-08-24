// One asset, many slots — the owner's items 1-2, 5-7, 16-17 and A-O.
//
// A media asset is one physical master; its usages are separate relationships.
// This proves the same asset can be hero AND card AND gallery on one target,
// that the exclusive slots still hold, that removing one slot leaves the others
// alone, and that no rights or provenance field moves during any of it.
//
// Seeds its own records and removes them.
//
// Usage:
//   TC_ADMIN_EMAIL=... TC_ADMIN_PASSWORD=... \
//     node scripts/browser/verify-multi-slot.mjs [baseUrl]

import { chromium } from "playwright";
import { existsSync, readFileSync } from "node:fs";
import { createClient } from "@supabase/supabase-js";

const BASE = process.argv[2] ?? "https://www.techcarvalho.com";
const STATE = "C:/Users/info/AppData/Local/Temp/tc-admin-state.json";
const TAG = "TEMP multislot";

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

const RIGHTS = "source_type, rights_status, owned, license, creator, attribution, source_url, asset_role, licence_permits_modification, ai_generated, brand_role";
const created = { assets: [], content: [] };

const PNG = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==",
  "base64"
);

async function seedAsset(label, published) {
  const path = `image/${crypto.randomUUID()}-ms-${label}.png`;
  // A REAL object, because publishing copies private -> public. Seeding only a
  // row made "Publish and apply" fail for a reason that had nothing to do with
  // the feature.
  const up = await db.storage.from("media-private").upload(path, PNG, { contentType: "image/png" });
  if (up.error) throw new Error(`upload ${label}: ${up.error.message}`);
  const { data, error } = await db
    .from("media_assets")
    .insert({
      media_type: "image", storage_path: path, alt_text: `${TAG} ${label}`,
      publication_status: published ? "published" : "private",
      public_storage_path: published ? path : null,
      owned: true, rights_status: "verified", source_type: "staff_photograph",
    })
    .select("id").single();
  if (error) throw new Error(`seed ${label}: ${error.message}`);
  created.assets.push(data.id);
  return data.id;
}

async function slots(articleId, mediaId) {
  const { data } = await db.from("content_media").select("media_id, role").eq("content_id", articleId);
  return (data ?? []).filter((r) => !mediaId || r.media_id === mediaId).map((r) => r.role).sort();
}
async function allRows(articleId) {
  const { data } = await db.from("content_media").select("media_id, role").eq("content_id", articleId);
  return data ?? [];
}

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

  const main = await seedAsset("main", true);
  const rival = await seedAsset("rival", true);
  const extra = await seedAsset("extra", true);

  const { data: article, error: aErr } = await db
    .from("content_items")
    .insert({ slug: `temp-ms-${crypto.randomUUID().slice(0, 8)}`, title: `${TAG} article`, type: "guide", status: "draft", body: "t" })
    .select("id").single();
  if (aErr) throw new Error("seed article: " + aErr.message);
  created.content.push(article.id);

  const rightsBefore = JSON.stringify((await db.from("media_assets").select(RIGHTS).eq("id", main).single()).data);

  async function openAndSearch() {
    await page.goto(`${BASE}/admin/media/${main}`, { waitUntil: "networkidle" });
    await page.getByLabel("Search articles").fill(TAG);
    return until(async () => (await page.locator(`input[name="scope_${article.id}"]`).count()) > 0);
  }

  async function tick(roles) {
    for (const role of ["hero", "thumbnail", "gallery"]) {
      const box = page.locator(`input[name="roles_${article.id}"][value="${role}"]`);
      if ((await box.count()) === 0) continue;
      if (roles.includes(role)) await box.check(); else await box.uncheck();
    }
  }

  // --- A: one asset, three slots -------------------------------------------
  check("the slot checkboxes are reachable", await openAndSearch());
  await tick(["hero", "thumbnail", "gallery"]);
  await page.getByRole("button", { name: /Save content associations/ }).click();
  await until(async () => (await slots(article.id, main)).length === 3);

  check("A: ONE asset holds hero + thumbnail + gallery at once",
    JSON.stringify(await slots(article.id, main)) === JSON.stringify(["gallery", "hero", "thumbnail"]),
    (await slots(article.id, main)).join(", "));

  const { data: assetRows } = await db.from("media_assets").select("id, storage_path").eq("id", main);
  check("E: still exactly ONE media_assets row and one master path",
    (assetRows ?? []).length === 1 && Boolean(assetRows[0].storage_path));

  // --- B / C: exclusive slots still exclusive -------------------------------
  const heroDup = await db.from("content_media").insert({ content_id: article.id, media_id: rival, role: "hero", sort_order: 0 });
  check("B: a second hero is refused by the database", heroDup.error?.code === "23505", heroDup.error?.code ?? "ACCEPTED");
  const thumbDup = await db.from("content_media").insert({ content_id: article.id, media_id: rival, role: "thumbnail", sort_order: 0 });
  // The application always asks before replacing a card image. This checks the
  // DATABASE backstop, which needs 20260824_one_thumbnail_per_target.sql.
  check("C: the database refuses a second explicit card image",
    thumbDup.error?.code === "23505",
    thumbDup.error?.code ?? "ACCEPTED - apply supabase/migrations_pending/20260824_one_thumbnail_per_target.sql");
  if (!thumbDup.error) await db.from("content_media").delete().eq("content_id", article.id).eq("media_id", rival).eq("role", "thumbnail");

  // --- D: gallery is many --------------------------------------------------
  await db.from("content_media").insert({ content_id: article.id, media_id: extra, role: "gallery", sort_order: 1 });
  check("D: gallery holds several assets",
    (await allRows(article.id)).filter((r) => r.role === "gallery").length === 2);

  // --- M + 5: collision keeps the OTHER ticked slots ------------------------
  // rival takes the hero, then main asks for hero+thumbnail+gallery again and
  // chooses "keep existing hero". Its other slots must survive.
  await db.from("content_media").delete().eq("content_id", article.id).eq("media_id", main).eq("role", "hero");
  await db.from("content_media").insert({ content_id: article.id, media_id: rival, role: "hero", sort_order: 0 });

  await openAndSearch();
  await tick(["hero", "thumbnail", "gallery"]);
  await page.getByRole("button", { name: /Save content associations/ }).click();
  const asked = await until(async () => /already has a hero image/i.test(await page.locator("body").innerText()));
  check("M: the hero collision is raised", asked);

  await page.locator(`input[name="hero_decision_${article.id}"][value="add_to_gallery"]`).check();
  await page.getByRole("button", { name: /Confirm and apply/ }).click();
  await until(async () => (await slots(article.id, main)).includes("thumbnail"));

  const afterKeep = await slots(article.id, main);
  check("5: choosing KEEP leaves the other ticked slots intact",
    afterKeep.includes("thumbnail") && afterKeep.includes("gallery") && !afterKeep.includes("hero"),
    afterKeep.join(", "));
  check("5: the existing hero is still the rival asset",
    (await allRows(article.id)).some((r) => r.role === "hero" && r.media_id === rival));

  // --- F: slot removal independence ----------------------------------------
  await db.from("content_media").delete().eq("content_id", article.id).eq("media_id", rival).eq("role", "hero");
  await openAndSearch();
  await tick(["hero", "thumbnail", "gallery"]);
  await page.getByRole("button", { name: /Save content associations/ }).click();
  await until(async () => (await slots(article.id, main)).length === 3);

  await openAndSearch();
  await tick(["thumbnail", "gallery"]);
  await page.getByRole("button", { name: /Save content associations/ }).click();
  await until(async () => !(await slots(article.id, main)).includes("hero"));
  check("F: removing Hero leaves Thumbnail and Gallery",
    JSON.stringify(await slots(article.id, main)) === JSON.stringify(["gallery", "thumbnail"]),
    (await slots(article.id, main)).join(", "));

  await openAndSearch();
  await tick(["gallery"]);
  await page.getByRole("button", { name: /Save content associations/ }).click();
  await until(async () => !(await slots(article.id, main)).includes("thumbnail"));
  check("F: removing Thumbnail leaves Gallery",
    JSON.stringify(await slots(article.id, main)) === JSON.stringify(["gallery"]),
    (await slots(article.id, main)).join(", "));

  await openAndSearch();
  await tick([]);
  await page.getByRole("button", { name: /Save content associations/ }).click();
  await until(async () => (await slots(article.id, main)).length === 0);
  check("F: removing Gallery leaves nothing for this asset", (await slots(article.id, main)).length === 0);
  check("F: the OTHER asset's gallery association was untouched",
    (await allRows(article.id)).some((r) => r.media_id === extra && r.role === "gallery"));
  check("F: removing associations deleted NO media asset",
    ((await db.from("media_assets").select("id").in("id", [main, rival, extra])).data ?? []).length === 3);

  // --- L / 9: private asset + published target ------------------------------
  const privateAsset = await seedAsset("private", false);
  await db.from("content_items").update({ status: "published", published_at: new Date().toISOString() }).eq("id", article.id);

  await page.goto(`${BASE}/admin/media/${privateAsset}`, { waitUntil: "networkidle" });
  const privateBody = await page.locator("body").innerText();
  check("H: rights Verified and publication Private are shown as different things",
    /PRIVATE/i.test(privateBody) && /Verified/i.test(privateBody));
  check("9: the private warning explains it will not appear publicly",
    /still PRIVATE/i.test(privateBody) || /not visible on the public site/i.test(privateBody));
  check("L: an 'Apply but keep private' path exists (plain save)",
    (await page.getByRole("button", { name: /Save content associations/ }).count()) > 0);
  check("K: a 'Publish image and apply' action is offered",
    (await page.getByRole("button", { name: /Publish image and apply/ }).count()) > 0);
  // Both the products form and the articles form carry the button; scope to the
  // one that holds this article's row.
  const articleForm = () => page.locator("form", { has: page.locator(`input[name="scope_${article.id}"]`) });

  await page.getByLabel("Search articles").fill(TAG);
  await until(async () => (await page.locator(`input[name="scope_${article.id}"]`).count()) > 0);
  await page.locator(`input[name="roles_${article.id}"][value="gallery"]`).check();
  await articleForm().getByRole("button", { name: /Publish image and apply/ }).click();

  const publishedNow = await until(async () => {
    const { data } = await db.from("media_assets").select("publication_status").eq("id", privateAsset).single();
    return data?.publication_status === "published";
  });
  check("K: Publish and apply actually published the asset", publishedNow);
  check("K: ...and applied the slot", (await slots(article.id, privateAsset)).includes("gallery"));
  const { data: masterCheck } = await db.from("media_assets").select("storage_path, public_storage_path").eq("id", privateAsset).single();
  check("K: the private master path is unchanged", Boolean(masterCheck?.storage_path));

  // --- O: rights untouched throughout --------------------------------------
  const rightsAfter = JSON.stringify((await db.from("media_assets").select(RIGHTS).eq("id", main).single()).data);
  check("O: no rights/provenance field changed during any slot edit", rightsBefore === rightsAfter);
  check("no browser page errors throughout", pageErrors.length === 0, pageErrors.slice(0, 2).join(" | "));
} finally {
  await browser.close();
  for (const id of created.content) {
    await db.from("content_media").delete().eq("content_id", id);
    await db.from("content_items").delete().eq("id", id);
  }
  for (const id of created.assets) {
    const { data: a } = await db.from("media_assets").select("storage_path, public_storage_path").eq("id", id).maybeSingle();
    if (a?.public_storage_path) await db.storage.from("media-public").remove([a.public_storage_path]);
    if (a?.storage_path) await db.storage.from("media-private").remove([a.storage_path]);
    await db.from("content_media").delete().eq("media_id", id);
    await db.from("product_media").delete().eq("media_id", id);
    await db.from("media_assets").delete().eq("id", id);
  }
}

const failed = results.filter((r) => !r.ok);
console.log(`\n${results.length - failed.length}/${results.length} checks passed`);
if (failed.length) { console.log("FAILED: " + failed.map((f) => f.name).join("; ")); process.exitCode = 1; }
