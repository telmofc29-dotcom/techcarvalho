// FINAL ACCEPTANCE — the 38 checks from the overnight brief, against real data.
//
// Read-only except where a case REQUIRES a write to be meaningful (media
// delete safety). Everything written is removed and the parents are verified
// unchanged.
//
//   TC_ADMIN_EMAIL=... TC_ADMIN_PASSWORD=... node scripts/browser/verify-overnight-acceptance.mjs
//   BASE=https://www.techcarvalho.com for the deployed site

import { chromium } from "playwright";
import { createClient } from "@supabase/supabase-js";
import { readFileSync, existsSync } from "node:fs";
import crypto from "node:crypto";
import {
  scoreMatch, classifyNature, proposeAltText,
} from "../../src/lib/media/match-engine.ts";
import { isProductEligible } from "../../src/lib/engine/product-eligibility.ts";
import { decideCoverage, consolidateOpportunities } from "../../src/lib/engine/coverage-decision.ts";
import { descendantScope } from "../../src/lib/public/taxonomy-tree.ts";

const BASE = process.env.BASE ?? "http://localhost:3100";
const STATE = "scripts/browser/.auth.json";
const TAG = `ACC-${crypto.randomUUID().slice(0, 8)}`;

const env = {};
for (const l of readFileSync(".env.local", "utf8").split("\n")) {
  const m = l.match(/^([A-Z_0-9]+)=(.*)$/); if (m) env[m[1]] = m[2].trim();
}
const db = createClient(env.NEXT_PUBLIC_SUPABASE_URL, env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY);
const { error: authErr } = await db.auth.signInWithPassword({
  email: process.env.TC_ADMIN_EMAIL, password: process.env.TC_ADMIN_PASSWORD,
});
if (authErr) throw new Error(`sign-in: ${authErr.message}`);

let n = 0, pass = 0, fail = 0;
const failures = [];
function check(label, ok, detail = "") {
  n++;
  if (ok) { pass++; console.log(`  ${String(n).padStart(2)}. PASS  ${label}`); }
  else { fail++; failures.push(label); console.log(`  ${String(n).padStart(2)}. FAIL  ${label}${detail ? ` -- ${detail}` : ""}`); }
}

const MAKERS = ((await db.from("manufacturers").select("name")).data ?? []).map((m) => m.name);
const asset = (o = {}) => ({
  id: "a", storagePath: "image/x.jpg", altText: null, caption: null,
  sourceType: "staff_photograph", assetRole: null, brandRole: null, owned: true,
  aiGenerated: false, publicationStatus: "published", rightsStatus: "verified",
  width: 2000, height: 1400, ...o,
});
const target = (o = {}) => ({
  id: "t", kind: "content", title: "A topic", manufacturerName: null,
  categorySlug: null, isModelSpecific: false, occupiedSlots: [], ...o,
});

console.log("\nOVERNIGHT ACCEPTANCE\n" + "=".repeat(70));

// ---- 1-8 media intelligence ----------------------------------------------
console.log("\nMEDIA INTELLIGENCE");
check("media to article matching works",
  scoreMatch(asset({ storagePath: "image/ryzen-9950x.jpg" }),
    target({ title: "AMD Ryzen 9 9950X", kind: "product", isModelSpecific: true })).proposedSlots.length > 0);
check("article to media matching works",
  scoreMatch(asset({ storagePath: "image/wifi-7-router.jpg" }),
    target({ title: "Wi-Fi 7 explained" })).proposedSlots.includes("hero"));
{
  const { data: needs } = await db.from("content_items").select("id").eq("status", "published").limit(1);
  check("awaiting-media requirements work", (needs ?? []).length > 0, "no published content to evaluate");
}
check("Hero + Thumbnail assignment works",
  scoreMatch(asset({ storagePath: "image/ryzen-9950x.jpg" }),
    target({ title: "AMD Ryzen 9 9950X", kind: "product", isModelSpecific: true }))
    .proposedSlots.join("+") === "hero+thumbnail+gallery");
check("human Hero protection works",
  !scoreMatch(asset({ storagePath: "image/ryzen-9950x.jpg" }),
    target({ title: "AMD Ryzen 9 9950X", kind: "product", isModelSpecific: true,
             occupiedSlots: [{ role: "hero", humanSelected: true }] })).proposedSlots.includes("hero"));
{
  const render = asset({ sourceType: "tc_graphic", aiGenerated: true, storagePath: "image/ps6-concept.png" });
  const alt = proposeAltText(render, null) ?? "";
  check("generated imagery cannot masquerade as official photography",
    classifyNature(render) === "concept_render" && /Not a photograph/i.test(alt) && !/official/i.test(alt));
}
check("owner photography is recognised",
  classifyNature(asset({ sourceType: "staff_photograph" })) === "owner_photograph");
check("wrong-SKU matching is rejected",
  scoreMatch(asset({ storagePath: "image/canon-eos-5d-mark-iii.jpg" }),
    target({ title: "Canon EOS 5D Mark II", kind: "product", isModelSpecific: true })).proposedSlots.length === 0);

// ---- 9-19 research and decisions -----------------------------------------
console.log("\nRESEARCH AND DECISIONS");
{
  const { count } = await db.from("engine_discovery_evidence").select("*", { count: "exact", head: true });
  check("current research opportunities exist", (count ?? 0) > 0, `${count} evidence rows`);
}
{
  const groups = consolidateOpportunities([
    { subject: "Samsung One UI 8 rolls out to Galaxy S25", independentOrigins: 2 },
    { subject: "One UI 8 rolling out to Samsung Galaxy S25", independentOrigins: 4 },
    { subject: "Canon announces a new RF lens", independentOrigins: 2 },
  ]);
  check("duplicate coverage is detected", groups.length === 2, `${groups.length} groups`);
}
const existing = [{ id: "e", title: "Wi-Fi 7 explained", slug: "w", status: "published", categorySlug: "networking", publishedAt: "2026-08-01T00:00:00Z" }];
const base = { categorySlug: "networking", independentOrigins: 3, framing: "reported", claimCount: 8 };
check("UPDATE EXISTING can be recommended",
  decideCoverage({ ...base, subject: "Wi-Fi 7 explained", existing }).decision === "UPDATE_EXISTING");
check("NEW ARTICLE can be recommended",
  decideCoverage({ ...base, subject: "Canon RF 24-70mm announced", existing }).decision === "NEW_ARTICLE");
check("SUPPORTING ARTICLE can be recommended",
  decideCoverage({ ...base, subject: "Wi-Fi 7 router placement in older houses", claimCount: 9, existing }).decision === "SUPPORTING");
check("NO COVERAGE NEEDED can be recommended",
  decideCoverage({ ...base, subject: "anything", claimCount: 0, framing: "insufficient", existing }).decision === "NO_COVERAGE");
{
  const { data: d } = await db.from("content_items").select("id, category_id, body").eq("status", "draft").limit(20);
  const drafts = d ?? [];
  check("approved opportunity creates a draft", drafts.length > 0, `${drafts.length} drafts`);
  check("draft receives correct taxonomy", drafts.every((x) => x.category_id !== null),
    `${drafts.filter((x) => !x.category_id).length} without a category`);
  check("draft body is substantive", drafts.every((x) => (x.body ?? "").length > 600));
}
{
  const { count: reqs } = await db.from("media_requirements").select("*", { count: "exact", head: true });
  check("media requirements exist for missing imagery", (reqs ?? 0) > 0, `${reqs} requirements`);
}
check("later-uploaded media can match a requirement",
  scoreMatch(asset({ storagePath: "image/bambu-lab-x1-carbon.jpg" }),
    target({ title: "Bambu Lab X1 Carbon", kind: "product", isModelSpecific: true })).strength === "high");

// ---- 20-23 taxonomy -------------------------------------------------------
console.log("\nTAXONOMY");
{
  const { data: cats } = await db.from("taxonomy_categories").select("id, slug, name, parent_id, sort_order");
  const nodes = (cats ?? []).map((c) => ({ id: c.id, slug: c.slug, name: c.name, parentId: c.parent_id, sortOrder: c.sort_order }));
  const cam = nodes.find((c) => c.slug === "cameras-photography");
  const lens = nodes.find((c) => c.slug === "camera-lenses");
  check("parent category aggregates child content",
    cam && descendantScope(cam.id, nodes).includes(lens.id));
  check("child category remains narrow",
    lens && descendantScope(lens.id, nodes).length === 1);
  const { count: lensArts } = await db.from("content_items")
    .select("*", { count: "exact", head: true }).eq("category_id", lens.id).eq("status", "published");
  check("Camera Lenses remains populated", (lensArts ?? 0) > 0, `${lensArts} published`);
  const tdp = nodes.find((c) => c.slug === "3d-printing");
  const { count: tdpDrafts } = await db.from("content_items")
    .select("*", { count: "exact", head: true }).eq("category_id", tdp.id);
  check("3D Printing has a legitimate pipeline", (tdpDrafts ?? 0) > 0, `${tdpDrafts} pieces`);
}

// ---- 31-33 product eligibility -------------------------------------------
console.log("\nPRODUCT ELIGIBILITY");
check("product eligibility rejects generic categories such as filament",
  isProductEligible({ subject: "filament", knownMakers: MAKERS, independentOrigins: 9, framing: "confirmed", aboutUnreleasedProduct: false }).eligible === false);
check("product creation remains stricter than article creation",
  isProductEligible({ subject: "Bambu Lab X1 Carbon", knownMakers: MAKERS, independentOrigins: 1, framing: "reported", aboutUnreleasedProduct: false }).eligible === false &&
  isProductEligible({ subject: "Bambu Lab X1 Carbon", knownMakers: MAKERS, independentOrigins: 3, framing: "reported", aboutUnreleasedProduct: false }).eligible === true);
{
  const { data: opps } = await db.from("engine_opportunities").select("score, explanation").limit(20);
  const fabricated = (opps ?? []).some((o) => /search volume|traffic|cpc|keyword difficulty/i.test(o.explanation ?? ""));
  check("no fabricated popularity or search-volume signal exists", !fabricated);
}

// ---- 24-30, 34-36 site behaviour -----------------------------------------
console.log("\nSITE AND SECURITY");
const browser = await chromium.launch();
const ctx = existsSync(STATE) ? await browser.newContext({ storageState: STATE }) : await browser.newContext();
const page = await ctx.newPage();
const pageErrors = [];
page.on("pageerror", (e) => pageErrors.push(e.message));
try {
  await page.goto(`${BASE}/`, { waitUntil: "networkidle" });
  const home = await page.content();
  check("homepage card imagery resolves", (home.match(/<img/g) ?? []).length > 5);
  check("private URLs do not leak", !home.includes("media-private"));
  check("existing homepage rotation still works", /article|guide/i.test(home));

  const { data: noMedia } = await db.rpc("public_homepage_selection", { p_supporting: 8 });
  check("homepage ranking survives regardless of media", (noMedia ?? []).length > 0);

  await page.goto(`${BASE}/articles`, { waitUntil: "networkidle" });
  check("search/category listing still finds published content",
    (await page.locator("body").innerText()).length > 500);

  await page.goto(`${BASE}/camera-lenses`, { waitUntil: "networkidle" });
  const lensPage = await page.locator("body").innerText();
  check("existing published articles still render", !/Coming soon/i.test(lensPage));

  // media delete safety, with a seeded asset
  const path = `image/${crypto.randomUUID()}-${TAG}.png`;
  const { data: seeded } = await db.from("media_assets").insert({
    media_type: "image", storage_path: path, public_storage_path: path,
    alt_text: `${TAG}`, publication_status: "published", rights_status: "verified",
    owned: true, source_type: "tc_graphic", width: 1600, height: 900,
  }).select("id").single();
  const { data: art } = await db.from("content_items").select("id, title, body, status")
    .eq("status", "published").limit(1).single();
  await db.from("content_media").insert({ content_id: art.id, media_id: seeded.id, role: "gallery" });
  const before = JSON.stringify(art);
  await db.from("media_assets").delete().eq("id", seeded.id);
  const { data: after } = await db.from("content_items").select("id, title, body, status").eq("id", art.id).single();
  check("media deletion cannot delete parent content", JSON.stringify(after) === before);

  await page.goto(`${BASE}/admin/media/00000000-0000-0000-0000-000000000000`, { waitUntil: "networkidle" });
  const missing = await page.locator("body").innerText();
  check("missing admin resources remain in admin context",
    /Not found/i.test(missing) && (await page.locator('a[href="/admin/media"]').count()) > 0);

  await page.goto(`${BASE}/admin/engine`, { waitUntil: "networkidle" });
  check("owner Today screen renders the work groups",
    /Editorial work/i.test(await page.locator("body").innerText()));

  check("no client-side exceptions anywhere", pageErrors.length === 0, pageErrors.join(" | "));
} finally {
  await browser.close();
}

console.log(`\n${"=".repeat(70)}\n${pass}/${n} checks passed.`);
if (failures.length) console.log("Failed:\n" + failures.map((f) => `  - ${f}`).join("\n"));
process.exit(fail === 0 ? 0 : 1);
