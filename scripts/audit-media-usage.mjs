// Read-only audit of how media is actually USED, as opposed to what it is.
//
// Reports contradictions. Deletes nothing, changes nothing — a questionable
// association is an editorial decision, not something a script should resolve.
//
// Usage:
//   TC_ADMIN_EMAIL=... TC_ADMIN_PASSWORD=... node scripts/audit-media-usage.mjs

import { readFileSync } from "node:fs";
import { createClient } from "@supabase/supabase-js";

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
if (authErr) { console.error("auth:", authErr.message); process.exit(1); }

async function all(table, columns) {
  const { data, error } = await db.from(table).select(columns);
  if (error) throw new Error(`${table}: ${error.message}`);
  return data ?? [];
}

const [products, content, assets, pm, cm] = await Promise.all([
  all("products", "id, slug, name, is_published"),
  all("content_items", "id, slug, title, status"),
  all("media_assets", "id, alt_text, asset_role, source_type, owned, ai_generated, publication_status, storage_path"),
  all("product_media", "id, product_id, media_id, role, sort_order"),
  all("content_media", "id, content_id, media_id, role, sort_order"),
]);

const assetById = new Map(assets.map((a) => [a.id, a]));
const productById = new Map(products.map((p) => [p.id, p]));
const contentById = new Map(content.map((c) => [c.id, c]));

console.log(`products ${products.length} · content ${content.length} · media ${assets.length}`);
console.log(`product_media ${pm.length} · content_media ${cm.length}\n`);

function groupBy(rows, key) {
  const map = new Map();
  for (const r of rows) {
    const k = r[key];
    if (!map.has(k)) map.set(k, []);
    map.get(k).push(r);
  }
  return map;
}

const section = (title) => console.log(`\n=== ${title} ===`);

// --- MULTIPLE HEROES: the defect the owner hit ------------------------------
section("TARGETS WITH MORE THAN ONE HERO (the PS5 Pro symptom)");
let multiHero = 0;
for (const [label, rows, keyName, lookup] of [
  ["product", pm, "product_id", productById],
  ["article", cm, "content_id", contentById],
]) {
  for (const [targetId, group] of groupBy(rows.filter((r) => r.role === "hero"), keyName)) {
    if (group.length <= 1) continue;
    multiHero++;
    const target = lookup.get(targetId);
    console.log(`  ${label}: ${target?.slug ?? targetId} — ${group.length} hero rows`);
    for (const r of group) {
      const a = assetById.get(r.media_id);
      console.log(`      ${r.media_id.slice(0, 8)} role=${r.role} sort=${r.sort_order} asset_role=${a?.asset_role ?? "-"} source=${a?.source_type ?? "-"} alt="${(a?.alt_text ?? "").slice(0, 46)}"`);
    }
  }
}
if (multiHero === 0) console.log("  none");

// --- ZERO HEROES ------------------------------------------------------------
section("PUBLISHED TARGETS WITH NO HERO");
const productHeroIds = new Set(pm.filter((r) => r.role === "hero").map((r) => r.product_id));
const contentHeroIds = new Set(cm.filter((r) => r.role === "hero").map((r) => r.content_id));
const prodNoHero = products.filter((p) => p.is_published && !productHeroIds.has(p.id));
const contNoHero = content.filter((c) => c.status === "published" && !contentHeroIds.has(c.id));
console.log(`  published products without a hero: ${prodNoHero.length}`);
for (const p of prodNoHero.slice(0, 10)) console.log(`      ${p.slug}`);
console.log(`  published articles without a hero: ${contNoHero.length}`);
for (const c of contNoHero.slice(0, 10)) console.log(`      ${c.slug}`);

// --- SAME ASSET IN MULTIPLE ROLES ON ONE TARGET -----------------------------
section("SAME ASSET HOLDING MORE THAN ONE ROLE ON THE SAME TARGET");
let dupRole = 0;
for (const [label, rows, keyName, lookup] of [
  ["product", pm, "product_id", productById],
  ["article", cm, "content_id", contentById],
]) {
  const byPair = new Map();
  for (const r of rows) {
    const k = `${r[keyName]}|${r.media_id}`;
    if (!byPair.has(k)) byPair.set(k, []);
    byPair.get(k).push(r);
  }
  for (const [k, group] of byPair) {
    if (group.length <= 1) continue;
    dupRole++;
    const [targetId] = k.split("|");
    console.log(`  ${label}: ${lookup.get(targetId)?.slug ?? targetId} — same asset as ${group.map((g) => g.role).join(" + ")}`);
  }
}
if (dupRole === 0) console.log("  none");

// --- DUPLICATE GALLERY ENTRIES ----------------------------------------------
section("GALLERIES CONTAINING THE SAME ASSET TWICE");
let dupGallery = 0;
for (const [label, rows, keyName, lookup] of [
  ["product", pm, "product_id", productById],
  ["article", cm, "content_id", contentById],
]) {
  for (const [targetId, group] of groupBy(rows.filter((r) => r.role === "gallery"), keyName)) {
    const seen = new Map();
    for (const r of group) seen.set(r.media_id, (seen.get(r.media_id) ?? 0) + 1);
    for (const [mediaId, n] of seen) {
      if (n > 1) {
        dupGallery++;
        console.log(`  ${label}: ${lookup.get(targetId)?.slug ?? targetId} — asset ${mediaId.slice(0, 8)} appears ${n}x`);
      }
    }
  }
}
if (dupGallery === 0) console.log("  none");

// --- ORPHANED / UNUSED ------------------------------------------------------
section("MEDIA ASSOCIATED NOWHERE");
const usedIds = new Set([...pm.map((r) => r.media_id), ...cm.map((r) => r.media_id)]);
const unused = assets.filter((a) => !usedIds.has(a.id));
console.log(`  assets with no product or article association: ${unused.length}`);
const unusedPublished = unused.filter((a) => a.publication_status === "published");
console.log(`  ...of which are PUBLISHED (public bytes nothing links to): ${unusedPublished.length}`);

// --- ASSOCIATIONS POINTING AT UNPUBLISHED TARGETS ---------------------------
section("HERO ASSOCIATIONS THAT CANNOT RENDER");
let cannotRender = 0;
for (const r of pm.filter((r) => r.role === "hero")) {
  const a = assetById.get(r.media_id);
  const p = productById.get(r.product_id);
  if (p?.is_published && a && a.publication_status !== "published") {
    cannotRender++;
    console.log(`  product ${p.slug}: hero asset is ${a.publication_status}, so the page shows no hero`);
  }
}
for (const r of cm.filter((r) => r.role === "hero")) {
  const a = assetById.get(r.media_id);
  const c = contentById.get(r.content_id);
  if (c?.status === "published" && a && a.publication_status !== "published") {
    cannotRender++;
    console.log(`  article ${c.slug}: hero asset is ${a.publication_status}, so the page shows no hero`);
  }
}
if (cannotRender === 0) console.log("  none");

// --- GENERATED WINNING OVER A REAL PHOTOGRAPH -------------------------------
section("GENERATED/GRAPHIC HERO WHERE A REAL PHOTOGRAPH OF THE SAME TARGET EXISTS");
const GENERATED = new Set(["tc_graphic"]);
const isPhoto = (a) => a && (a.source_type === "staff_photograph" || a.asset_role === "product_photo");
let displaced = 0;
for (const [label, rows, keyName, lookup] of [
  ["product", pm, "product_id", productById],
  ["article", cm, "content_id", contentById],
]) {
  for (const [targetId, group] of groupBy(rows, keyName)) {
    const hero = group.find((r) => r.role === "hero");
    if (!hero) continue;
    const heroAsset = assetById.get(hero.media_id);
    if (!heroAsset || !GENERATED.has(heroAsset.source_type ?? "")) continue;
    const photo = group.find((r) => r.role !== "hero" && isPhoto(assetById.get(r.media_id)));
    if (photo) {
      displaced++;
      console.log(`  ${label}: ${lookup.get(targetId)?.slug ?? targetId} — hero is ${heroAsset.source_type}, but a photograph is attached as ${photo.role}`);
    }
  }
}
if (displaced === 0) console.log("  none (no target currently has both a generated hero and an attached real photograph)");

// --- EXPLICIT CARD IMAGE THAT CANNOT BE USED ---------------------------------
section("EXPLICIT CARD/THUMBNAIL THAT WILL BE IGNORED");
let deadThumbs = 0;
for (const [label, rows, keyName, lookup] of [
  ["product", pm, "product_id", productById],
  ["article", cm, "content_id", contentById],
]) {
  for (const [targetId, group] of groupBy(rows.filter((r) => r.role === "thumbnail"), keyName)) {
    const usable = group.some((r) => assetById.get(r.media_id)?.publication_status === "published");
    if (!usable) {
      deadThumbs++;
      console.log(`  ${label}: ${lookup.get(targetId)?.slug ?? targetId} — explicit card image is not published, so cards fall back to the hero`);
    }
  }
}
if (deadThumbs === 0) console.log("  none");

// --- MORE THAN ONE EXPLICIT CARD IMAGE ---------------------------------------
section("TARGETS WITH MORE THAN ONE EXPLICIT CARD/THUMBNAIL");
let multiThumb = 0;
for (const [label, rows, keyName, lookup] of [
  ["product", pm, "product_id", productById],
  ["article", cm, "content_id", contentById],
]) {
  for (const [targetId, group] of groupBy(rows.filter((r) => r.role === "thumbnail"), keyName)) {
    if (group.length > 1) {
      multiThumb++;
      console.log(`  ${label}: ${lookup.get(targetId)?.slug ?? targetId} — ${group.length} thumbnail rows`);
    }
  }
}
if (multiThumb === 0) console.log("  none");

// --- PUBLISHED PAGES POINTING AT PRIVATE ASSETS ------------------------------
section("PUBLISHED PAGES REFERENCING A PRIVATE ASSET IN ANY PUBLIC SLOT");
let privateRefs = 0;
for (const r of pm) {
  if (r.role === "gallery" && false) continue;
  const a = assetById.get(r.media_id);
  const p = productById.get(r.product_id);
  if (p?.is_published && a && a.publication_status !== "published") {
    privateRefs++;
    console.log(`  product ${p.slug} [${r.role}]: asset is ${a.publication_status}`);
  }
}
for (const r of cm) {
  const a = assetById.get(r.media_id);
  const c = contentById.get(r.content_id);
  if (c?.status === "published" && a && a.publication_status !== "published") {
    privateRefs++;
    console.log(`  article ${c.slug} [${r.role}]: asset is ${a.publication_status}`);
  }
}
if (privateRefs === 0) console.log("  none");

// --- STORAGE OBJECTS THAT DO NOT EXIST ---------------------------------------
section("MEDIA ROWS WHOSE STORAGE OBJECT IS MISSING");
const privListing = await db.storage.from("media-private").list("image", { limit: 2000 });
const privNames = new Set((privListing.data ?? []).map((o) => "image/" + o.name));
let missingObjects = 0;
for (const a of assets) {
  if (!a.storage_path?.startsWith("image/")) continue;
  if (!privNames.has(a.storage_path)) {
    missingObjects++;
    if (missingObjects <= 10) console.log(`  ${a.id.slice(0, 8)} "${(a.alt_text ?? "").slice(0, 44)}" -> ${a.storage_path}`);
  }
}
console.log(`  total: ${missingObjects}`);

// --- USAGE SPREAD -------------------------------------------------------------
section("MOST-REUSED ASSETS");
const useCount = new Map();
for (const r of [...pm, ...cm]) useCount.set(r.media_id, (useCount.get(r.media_id) ?? 0) + 1);
const top = [...useCount.entries()].sort((a, b) => b[1] - a[1]).slice(0, 5);
for (const [id, n] of top) console.log(`  ${n}x  ${(assetById.get(id)?.alt_text ?? id).slice(0, 60)}`);

console.log("\n--- summary ---");
console.log(`multiple-hero targets: ${multiHero}`);
console.log(`published products without hero: ${prodNoHero.length}`);
console.log(`published articles without hero: ${contNoHero.length}`);
console.log(`same asset in two roles on one target: ${dupRole}`);
console.log(`duplicate gallery entries: ${dupGallery}`);
console.log(`unused assets: ${unused.length}`);
console.log(`hero associations that cannot render: ${cannotRender}`);
console.log(`explicit card images that will be ignored: ${deadThumbs}`);
console.log(`targets with more than one explicit card image: ${multiThumb}`);
console.log(`published pages referencing a private asset: ${privateRefs}`);
console.log(`media rows whose storage object is missing: ${missingObjects}`);
console.log("\nNothing was changed. Every item above is reported for human review.");
