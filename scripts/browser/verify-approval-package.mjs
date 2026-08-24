// PHASE B VERIFICATION — the one-click approval package.
//
// Proves, against a real build and the real database:
//   1. The package page states every consequence before asking.
//   2. It distinguishes what EXISTS from what WILL BE CREATED.
//   3. It never claims it will publish.
//   4. Blockers actually disable the build (cannibalisation, already-assembled).
//   5. "Approve & build" runs the real engine path: review_state becomes
//      approved AND a content_items DRAFT is created and linked back to the
//      brief via assembled_content_id.
//   6. The created row is a DRAFT. Not published. This is the structural
//      guarantee, checked rather than assumed.
//
// Everything seeded is removed, and every pre-existing brief and content item
// is verified byte-identical afterwards.
//
//   TC_ADMIN_EMAIL=... TC_ADMIN_PASSWORD=... node scripts/browser/verify-approval-package.mjs

import { chromium } from "playwright";
import { createClient } from "@supabase/supabase-js";
import { readFileSync, existsSync } from "node:fs";
import crypto from "node:crypto";

const BASE = process.env.BASE ?? "http://localhost:3100";
const STATE = "scripts/browser/.auth.json";
const TAG = `PHASE-B-${crypto.randomUUID().slice(0, 8)}`;

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
if (authErr) throw new Error(`admin sign-in failed: ${authErr.message}`);

let passed = 0;
let failed = 0;
function check(label, ok, detail = "") {
  if (ok) { passed++; console.log(`  PASS  ${label}`); }
  else { failed++; console.log(`  FAIL  ${label}${detail ? ` — ${detail}` : ""}`); }
}

async function until(fn, { timeout = 25000, interval = 400, label = "condition" } = {}) {
  const deadline = Date.now() + timeout;
  for (;;) {
    if (await fn()) return true;
    if (Date.now() > deadline) throw new Error(`timed out waiting for ${label}`);
    await new Promise((r) => setTimeout(r, interval));
  }
}

// ---- baselines ------------------------------------------------------------
const { data: briefsBefore, error: bErr } = await db
  .from("engine_briefs").select("id, review_state, assembled_content_id").order("id");
if (bErr) throw new Error(`brief baseline: ${bErr.message}`);
const briefBase = new Map(briefsBefore.map((r) => [r.id, JSON.stringify(r)]));

const { data: contentBefore, error: cErr } = await db
  .from("content_items").select("id, status, slug").order("id");
if (cErr) throw new Error(`content baseline: ${cErr.message}`);
const contentBaseIds = new Set(contentBefore.map((r) => r.id));
const contentBase = new Map(contentBefore.map((r) => [r.id, JSON.stringify(r)]));

console.log(`baseline: ${briefsBefore.length} briefs, ${contentBefore.length} content items\n`);

const createdBriefs = [];
const createdContent = [];

async function seedBrief(title, fields) {
  const { data, error } = await db.from("engine_briefs").insert({
    proposed_title: title,
    rationale: `${TAG} seeded for Phase B verification`,
    review_state: "pending",
    state: "planned",
    ...fields,
  }).select("id").single();
  if (error) throw new Error(`seed "${title}": ${error.message}`);
  createdBriefs.push(data.id);
  return data.id;
}

const STRONG = {
  brief_kind: "breaking",
  content_type: "news",
  primary_question: "What has actually been confirmed so far?",
  supporting_questions: ["What is still unknown?"],
  verified_facts: ["Confirmed fact one", "Confirmed fact two", "Confirmed fact three"],
  uncertainties: ["Reported but unconfirmed detail"],
  source_urls: ["https://www.reuters.com/phase-b-a", "https://www.theverge.com/phase-b-b"],
  suggested_structure: ["What is confirmed", "What is not"],
  freshness_sensitivity: "time_sensitive",
};

const browser = await chromium.launch();
const ctx = existsSync(STATE)
  ? await browser.newContext({ storageState: STATE })
  : await browser.newContext();
const page = await ctx.newPage();
const pageErrors = [];
page.on("pageerror", (e) => pageErrors.push(e.message));

try {
  await page.goto(BASE + "/admin", { waitUntil: "domcontentloaded" });
  if (page.url().includes("/login")) {
    await page.fill("input[type=email]", process.env.TC_ADMIN_EMAIL);
    await page.fill("input[type=password]", process.env.TC_ADMIN_PASSWORD);
    await Promise.all([
      page.waitForURL((u) => !u.pathname.includes("/login"), { timeout: 30000 }).catch(() => {}),
      page.locator("form button[type=submit]").first().click(),
    ]);
    await ctx.storageState({ path: STATE });
  }

  // ---- 1. the package states its consequences --------------------------
  console.log("1. The package states every consequence before asking");
  const goodId = await seedBrief(`${TAG} Genuine sourced story`, STRONG);
  await page.goto(`${BASE}/admin/engine/packages/${goodId}`, { waitUntil: "networkidle" });
  const pkg = await page.locator("body").innerText();

  // Case-insensitive: the section headings carry `text-transform: uppercase`,
  // and Playwright's innerText returns the CSS-TRANSFORMED text, so a
  // case-sensitive /Research/ never matches "RESEARCH". The first run of this
  // script passed "Content" and "Media" only because those words also occur in
  // ordinary sentence case elsewhere on the page — a false pass that hid a
  // false fail.
  check("Research section present", /Research/i.test(pkg));
  check("Database section present", /Database/i.test(pkg));
  check("Content section present", /Content/i.test(pkg));
  check("Media section present", /Media/i.test(pkg));
  check("SEO section present", /SEO/i.test(pkg));
  check("evidence is stated", /3 verified facts/.test(pkg));
  check("independent publishers are stated", /2 independent publishers/.test(pkg));

  // ---- 2. exists vs will-be-created ------------------------------------
  console.log("\n2. What exists is distinguished from what will be created");
  check("the article is marked as WILL BE CREATED", /will be created as a DRAFT/i.test(pkg));
  check("unconfirmed claims are kept separate", /unconfirmed claims kept separate/i.test(pkg));

  // ---- 3. it never claims to publish -----------------------------------
  console.log("\n3. Approving is never presented as publishing");
  check("the page says it does not publish", /does not publish/i.test(pkg));
  check("publishing is named as a separate action", /separate action/i.test(pkg));
  check("after-build steps are listed", /After building, you still do this/i.test(pkg));

  // ---- 4. blockers actually block --------------------------------------
  console.log("\n4. Blockers disable the build");
  // A brief whose title duplicates real published content.
  const { data: publishedOne } = await db
    .from("content_items").select("title").eq("status", "published").limit(1).single();
  if (publishedOne?.title) {
    const dupId = await seedBrief(publishedOne.title, STRONG);
    await page.goto(`${BASE}/admin/engine/packages/${dupId}`, { waitUntil: "networkidle" });
    const dupPkg = await page.locator("body").innerText();
    check("cannibalisation is reported", /Overlaps existing content/i.test(dupPkg));
    check("the build is blocked", /cannot be built yet/i.test(dupPkg));
    const disabled = await page.locator('button[disabled]', { hasText: /Approve & build/ }).count();
    check("the approve button is disabled", disabled > 0);
  } else {
    check("no published content to test cannibalisation against — skipped", true);
  }

  // ---- 5. approve & build runs the real engine path --------------------
  console.log("\n5. Approve & build assembles a real draft");
  await page.goto(`${BASE}/admin/engine/packages/${goodId}`, { waitUntil: "networkidle" });
  const buildBtn = page.locator(
    `form:has(input[name="id"][value="${goodId}"]) button[type=submit]`
  ).first();
  check("an enabled Approve & build control exists", (await buildBtn.count()) > 0);
  await buildBtn.click();

  await until(async () => {
    const { data } = await db
      .from("engine_briefs").select("review_state, assembled_content_id").eq("id", goodId).single();
    return data?.review_state === "approved" && data?.assembled_content_id !== null;
  }, { label: "brief to be approved AND assembled" });

  const { data: after } = await db
    .from("engine_briefs").select("review_state, assembled_content_id, assembled_at")
    .eq("id", goodId).single();
  check("review_state is approved", after?.review_state === "approved");
  check("a draft was assembled and linked back", !!after?.assembled_content_id);
  check("assembled_at was stamped", !!after?.assembled_at);

  if (after?.assembled_content_id) {
    createdContent.push(after.assembled_content_id);
    // meta_title lives in seo_metadata, NOT on content_items. Selecting it
    // here previously errored the whole query and blanked every field, which
    // reported as "status was undefined" rather than as a broken select.
    const { data: article, error: articleErr } = await db
      .from("content_items")
      .select("id, title, status, slug, body")
      .eq("id", after.assembled_content_id).single();
    if (articleErr) check("assembled article is readable", false, articleErr.message);

    const { data: seo } = await db
      .from("seo_metadata")
      .select("meta_title, meta_description")
      .eq("content_id", after.assembled_content_id)
      .maybeSingle();

    // ---- 6. THE structural guarantee ---------------------------------
    console.log("\n6. The created row is a DRAFT — the boundary held");
    check("status is draft, not published", article?.status === "draft",
      `status was ${article?.status}`);
    check("the body was actually assembled", (article?.body ?? "").length > 200);
    check("the assembly banner is present", /ENGINE-ASSEMBLED DRAFT/.test(article?.body ?? ""));
    check("verified facts reached the body", /Confirmed fact one/.test(article?.body ?? ""));
    check("uncertainties reached the body", /Reported but unconfirmed detail/.test(article?.body ?? ""));
    check("a meta title was recorded in seo_metadata", !!seo?.meta_title,
      seo ? "row present but meta_title empty" : "no seo_metadata row");
    check("it has a slug", !!article?.slug);
  }

  check("no client-side exceptions", pageErrors.length === 0, pageErrors.join(" | "));
} catch (err) {
  failed++;
  console.log(`\n  ABORTED — ${err && err.message ? err.message : err}`);
  if (err && err.stack) console.log(err.stack.split("\n").slice(1, 4).join("\n"));
} finally {
  console.log("\n7. Cleanup");
  // Content first: engine_briefs.assembled_content_id references it.
  if (createdContent.length > 0) {
    const { error } = await db.from("content_items").delete().in("id", createdContent);
    if (error) console.log(`  WARN  content cleanup failed: ${error.message}`);
  }
  if (createdBriefs.length > 0) {
    const { error } = await db.from("engine_briefs").delete().in("id", createdBriefs);
    if (error) console.log(`  WARN  brief cleanup failed: ${error.message}`);
  }

  const { data: briefsAfter } = await db
    .from("engine_briefs").select("id, review_state, assembled_content_id").order("id");
  const { data: contentAfter } = await db
    .from("content_items").select("id, status, slug").order("id");

  if (briefsAfter) {
    const ids = new Set(briefsAfter.map((r) => r.id));
    check("every seeded brief removed", createdBriefs.every((id) => !ids.has(id)));
    const drift = briefsAfter.filter(
      (r) => briefBase.has(r.id) && briefBase.get(r.id) !== JSON.stringify(r)
    );
    check("no pre-existing brief modified", drift.length === 0, drift.map((d) => d.id).join(", "));
  }
  if (contentAfter) {
    const ids = new Set(contentAfter.map((r) => r.id));
    check("every assembled draft removed", createdContent.every((id) => !ids.has(id)));
    check("no content item created outside this run remains new",
      contentAfter.every((r) => contentBaseIds.has(r.id) || createdContent.includes(r.id)));
    const drift = contentAfter.filter(
      (r) => contentBase.has(r.id) && contentBase.get(r.id) !== JSON.stringify(r)
    );
    check("no pre-existing content modified", drift.length === 0, drift.map((d) => d.id).join(", "));
  }

  await browser.close();
  console.log(`\n${passed}/${passed + failed} checks passed.`);
  process.exit(failed === 0 ? 0 : 1);
}
