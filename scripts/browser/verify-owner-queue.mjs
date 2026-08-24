// PHASE A VERIFICATION — the owner queue, against a real build and real data.
//
// Proves the things a passing unit test cannot:
//   1. /admin links to the engine at all (before Phase A it did not).
//   2. /admin/engine is Today, not the job table.
//   3. The funnel reports the REAL production brief backlog.
//   4. The empty state reads as "engine working", not "engine broken".
//   5. A brief that clears the evidence bar actually appears, with its
//      evidence on the row.
//   6. Approving it FROM Today writes review_state='approved' and the item
//      leaves the queue.
//   7. /admin/engine/health still works at its new address.
//
// Step 6 matters most: `review_state='approved'` has never been written in
// this production database, so draft assembly has never had an input. This is
// the first time that path is exercised end to end.
//
// SEEDED DATA IS REMOVED, and the script additionally asserts that every
// pre-existing brief is byte-identical afterwards — an earlier suite in this
// repo false-alarmed on global counts while the owner edited concurrently, so
// "my rows are gone AND yours are untouched" is the only safe assertion.
//
//   TC_ADMIN_EMAIL=... TC_ADMIN_PASSWORD=... node scripts/browser/verify-owner-queue.mjs
//   BASE=https://... to run against deployed production.

import { chromium } from "playwright";
import { createClient } from "@supabase/supabase-js";
import { readFileSync, existsSync } from "node:fs";
import crypto from "node:crypto";

const BASE = process.env.BASE ?? "http://localhost:3100";
const STATE = "scripts/browser/.auth.json";
const TAG = `PHASE-A-${crypto.randomUUID().slice(0, 8)}`;

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
  if (ok) {
    passed++;
    console.log(`  PASS  ${label}`);
  } else {
    failed++;
    console.log(`  FAIL  ${label}${detail ? ` — ${detail}` : ""}`);
  }
}

/** Poll until a condition holds. Never a fixed sleep — those pass locally and time out on production. */
async function until(fn, { timeout = 20000, interval = 300, label = "condition" } = {}) {
  const deadline = Date.now() + timeout;
  for (;;) {
    if (await fn()) return true;
    if (Date.now() > deadline) throw new Error(`timed out waiting for ${label}`);
    await new Promise((r) => setTimeout(r, interval));
  }
}

// ---------------------------------------------------------------------------
// Baseline: every pre-existing brief, so we can prove we did not touch them.
// ---------------------------------------------------------------------------
const { data: before, error: beforeErr } = await db
  .from("engine_briefs")
  .select("id, review_state, state, reviewed_at, review_note")
  .order("id");
if (beforeErr) throw new Error(`baseline read failed: ${beforeErr.message}`);
const beforeMap = new Map(before.map((r) => [r.id, JSON.stringify(r)]));
console.log(`baseline: ${before.length} existing briefs\n`);

const createdBriefIds = [];

async function seedBrief(title, fields) {
  const { data, error } = await db
    .from("engine_briefs")
    .insert({
      proposed_title: title,
      rationale: `${TAG} seeded for Phase A verification`,
      review_state: "pending",
      state: "planned",
      ...fields,
    })
    .select("id")
    .single();
  if (error) throw new Error(`seed "${title}": ${error.message}`);
  createdBriefIds.push(data.id);
  return data.id;
}

const browser = await chromium.launch();
const ctx = existsSync(STATE)
  ? await browser.newContext({ storageState: STATE })
  : await browser.newContext();
const page = await ctx.newPage();
const pageErrors = [];
page.on("pageerror", (e) => pageErrors.push(e.message));

try {
  // ---- login -------------------------------------------------------------
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

  // ---- 1. the dashboard now surfaces the engine --------------------------
  console.log("1. Dashboard surfaces the engine");
  await page.goto(BASE + "/admin", { waitUntil: "networkidle" });
  const dash = await page.locator("body").innerText();
  check("dashboard shows engine status", /Engine running|Engine stopped|Running with failures|Status unknown/.test(dash));
  check("dashboard links to the engine", (await page.locator('a[href="/admin/engine"]').count()) > 0);
  check("dashboard states whether anything needs attention", /needs? your attention|Nothing needs a decision/i.test(dash));

  // ---- 2. /admin/engine is Today ----------------------------------------
  console.log("\n2. /admin/engine is the owner queue, not the job table");
  await page.goto(BASE + "/admin/engine", { waitUntil: "networkidle" });
  const today = await page.locator("body").innerText();
  check("page is Today", /Needs your attention/i.test(today));
  check("Today does not lead with the settings form", !/kill switch/i.test(today));
  check("engine details are still reachable", (await page.locator('a[href="/admin/engine/health"]').count()) > 0);

  // ---- 3. the funnel reports the real backlog ---------------------------
  console.log("\n3. Funnel reports the real production backlog");
  const { count: realPending, error: pendErr } = await db
    .from("engine_briefs")
    .select("*", { count: "exact", head: true })
    .eq("review_state", "pending")
    .is("assembled_content_id", null);
  if (pendErr) throw new Error(pendErr.message);
  check("funnel section is present", /Content opportunities/i.test(today));
  check(
    `funnel shows the real pending count (${realPending})`,
    new RegExp(`\\b${realPending}\\b`).test(today),
    `page did not contain ${realPending}`
  );
  check("funnel explains what was filtered", /filtered out/i.test(today));

  // ---- 4. the empty state is honest -------------------------------------
  console.log("\n4. Empty state reads as working, not broken");
  if (/Nothing needs a decision right now/i.test(today)) {
    check("empty state says the engine examined things", /examined \d+ brief/i.test(today));
    check("empty state says it is the engine working", /engine working, not waiting/i.test(today));
  } else {
    check("queue non-empty, so empty-state copy is not asserted", true);
  }

  // ---- 5. a good brief appears with its evidence ------------------------
  console.log("\n5. A brief clearing the evidence bar reaches the queue");
  const goodId = await seedBrief(`${TAG} Real sourced finding`, {
    brief_kind: "breaking",
    content_type: "news",
    verified_facts: ["First established fact", "Second established fact", "Third established fact"],
    uncertainties: ["One thing still unconfirmed"],
    source_urls: ["https://www.reuters.com/example-a", "https://www.theverge.com/example-b"],
    freshness_sensitivity: "time_sensitive",
  });
  // And a weak one that must NOT appear.
  const weakId = await seedBrief(`${TAG} Canon EOS Fake A vs Canon EOS Fake B`, {
    brief_kind: "comparison",
    content_type: "comparison",
    verified_facts: [],
    uncertainties: [],
    source_urls: [],
  });

  await page.goto(BASE + "/admin/engine", { waitUntil: "networkidle" });
  const withSeed = await page.locator("body").innerText();
  check("the well-sourced brief appears", withSeed.includes(`${TAG} Real sourced finding`));
  check("the combinatorial brief does NOT appear", !withSeed.includes("Canon EOS Fake A"));
  check("evidence is on the row (facts)", /3 verified facts/.test(withSeed));
  check("evidence is on the row (independent publishers)", /2 independent publishers/.test(withSeed));
  check("open questions are shown separately", /1 open question/.test(withSeed));

  // ---- 6. approving from Today actually works ---------------------------
  console.log("\n6. Approving from Today writes the decision");
  // Targeted by the form's own hidden inputs rather than by walking up from the
  // title text: `div` filtered by hasText matches every ancestor, and .last()
  // picks the innermost one, which is the heading — not the element containing
  // the form.
  const approve = page.locator(
    `form:has(input[name="id"][value="${goodId}"]):has(input[name="review_state"][value="approved"]) button[type=submit]`
  );
  check("an Approve control exists on the row", (await approve.count()) === 1);
  await approve.click();

  await until(
    async () => {
      const { data } = await db.from("engine_briefs").select("review_state").eq("id", goodId).single();
      return data?.review_state === "approved";
    },
    { label: "review_state to become approved" }
  );
  const { data: approved } = await db
    .from("engine_briefs")
    .select("review_state, reviewed_at")
    .eq("id", goodId)
    .single();
  check("review_state is approved", approved?.review_state === "approved");
  check("reviewed_at was stamped", !!approved?.reviewed_at);

  // This is the state draft assembly consumes. It has never been non-empty.
  const { count: assemblable } = await db
    .from("engine_briefs")
    .select("*", { count: "exact", head: true })
    .eq("review_state", "approved");
  check("draft assembly now has an input", (assemblable ?? 0) > 0, `approved count = ${assemblable}`);

  await page.goto(BASE + "/admin/engine", { waitUntil: "networkidle" });
  const afterApprove = await page.locator("body").innerText();
  check("the approved item left the queue", !afterApprove.includes(`${TAG} Real sourced finding`));

  // ---- 7. health page still works at its new address --------------------
  console.log("\n7. Engine details survive the move");
  await page.goto(BASE + "/admin/engine/health", { waitUntil: "networkidle" });
  const health = await page.locator("body").innerText();
  check("health page renders", /Engine details/i.test(health));
  check("health page still has the kill switch", /kill switch/i.test(health));

  check("no client-side exceptions on any page", pageErrors.length === 0, pageErrors.join(" | "));
} catch (err) {
  // Without this the `finally` below calls process.exit() and the exception is
  // lost — the run then LOOKS like a clean short pass, which is the single most
  // dangerous way for a verification script to fail.
  failed++;
  console.log(`\n  ABORTED — ${err && err.message ? err.message : err}`);
  if (err && err.stack) console.log(err.stack.split("\n").slice(1, 4).join("\n"));
} finally {
  // ---- cleanup ----------------------------------------------------------
  console.log("\n8. Cleanup");
  if (createdBriefIds.length > 0) {
    const { error } = await db.from("engine_briefs").delete().in("id", createdBriefIds);
    if (error) console.log(`  WARN  cleanup failed: ${error.message}`);
  }
  const { data: after, error: afterErr } = await db
    .from("engine_briefs")
    .select("id, review_state, state, reviewed_at, review_note")
    .order("id");
  if (afterErr) {
    check("post-run verification read succeeded", false, afterErr.message);
  } else {
    const afterIds = new Set(after.map((r) => r.id));
    check("every seeded brief was removed", createdBriefIds.every((id) => !afterIds.has(id)));

    // Pre-existing rows must be untouched. Compared field by field rather than
    // by count, because the owner may be editing concurrently and a changed
    // TOTAL is not evidence that WE changed anything.
    let drifted = [];
    for (const row of after) {
      const baseline = beforeMap.get(row.id);
      if (baseline === undefined) continue; // created by someone else during the run
      if (baseline !== JSON.stringify(row)) drifted.push(row.id);
    }
    check("no pre-existing brief was modified", drifted.length === 0, drifted.join(", "));
  }

  await browser.close();
  console.log(`\n${passed}/${passed + failed} checks passed.`);
  process.exit(failed === 0 ? 0 : 1);
}
