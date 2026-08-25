// PRIORITY WATCHLIST VERIFICATION — against a real build and real data.
//
// Unit tests already prove assessPriority orders correctly. What they cannot
// prove is that the owner SEES that ordering, which is the entire point of the
// feature: a priority layer nothing surfaces is a priority layer that does not
// exist.
//
// Checks, in order:
//   1. /admin/engine renders at all.
//   2. The drafts card lists its examples highest-priority first, matching what
//      assessPriority says about the same titles read from the database.
//   3. Each example carries its REASON underneath.
//   4. Nothing on the page asserts demand data this project does not possess
//      (search volume, keyword difficulty, market demand). Priority is
//      editorial configuration, and the page must never suggest otherwise.
//   5. Pages awaiting media still reports, so new drafts entered that queue.
//
// Read-only. This script creates, modifies and deletes nothing.
//
//   TC_ADMIN_EMAIL=... TC_ADMIN_PASSWORD=... node scripts/browser/verify-priority-queue.mjs
//   BASE=https://... to run against deployed production.

import { chromium } from "playwright";
import { createClient } from "@supabase/supabase-js";
import { readFileSync, existsSync } from "node:fs";
import { assessPriority } from "../../src/lib/engine/priority-entities.ts";

const BASE = process.env.BASE ?? "http://localhost:3100";
const STATE = "scripts/browser/.auth.json";

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

const browser = await chromium.launch();
const ctx = existsSync(STATE)
  ? await browser.newContext({ storageState: STATE })
  : await browser.newContext();
const page = await ctx.newPage();

// The exception must reach the console. An earlier script in this repo called
// process.exit() from its finally block, which swallowed its own failure and
// printed an aborted run as a clean short pass.
let fatal = null;
try {
  await page.goto(BASE + "/admin", { waitUntil: "domcontentloaded" });
  if (page.url().includes("/login")) {
    await page.fill("input[type=email]", process.env.TC_ADMIN_EMAIL);
    await page.fill("input[type=password]", process.env.TC_ADMIN_PASSWORD);
    await Promise.all([
      page.waitForURL((u) => !u.pathname.includes("/login"), { timeout: 30000 }).catch(() => {}),
      page.click("button[type=submit]"),
    ]);
    await ctx.storageState({ path: STATE });
  }

  await page.goto(BASE + "/admin/engine", { waitUntil: "networkidle" });
  check("/admin/engine renders", !/not found/i.test(await page.title()));

  // ---- expectation computed from the database, not from the page ----------
  const { data: draftRows, error: draftErr } = await db
    .from("content_items")
    .select("title, updated_at")
    .eq("status", "draft")
    .order("updated_at", { ascending: false })
    .limit(50);
  if (draftErr) throw new Error(`draft read failed: ${draftErr.message}`);

  const expected = draftRows
    .map((d) => ({ title: d.title, p: assessPriority({ headline: d.title, alreadyCovered: false }) }))
    // Same tiebreak as the page: score, then recency. Without it this check
    // compares two arbitrary orderings of an equal-scoring set and fails on
    // a difference that means nothing.
    .sort((a, b) => b.p.score - a.p.score || Date.parse(b.updated_at) - Date.parse(a.updated_at))
    .slice(0, 3);

  console.log(`\n  expected top 3 of ${draftRows.length} drafts:`);
  for (const e of expected) console.log(`    ${e.title.slice(0, 58)}\n      ${e.p.reason.slice(0, 84)}`);

  // The card is found by its heading, then read as a whole. innerText is
  // CSS-transformed text, so every comparison here is case-insensitive — an
  // earlier suite passed falsely by comparing against uppercased headings.
  const cardText = await page.evaluate(() => {
    const link = [...document.querySelectorAll("a")].find((a) =>
      /drafts ready for review/i.test(a.textContent ?? "")
    );
    // The card is the link's grandparent; innerText carries the examples and
    // the reason line beneath each one.
    return link ? (link.closest("div")?.parentElement?.innerText ?? "") : "";
  });
  check("the drafts card is on the page", cardText.length > 0);

  const flat = cardText.replace(/\s+/g, " ").toLowerCase();

  // Ordering: the top expected title must appear before the others.
  const positions = expected.map((e) => flat.indexOf(e.title.slice(0, 34).toLowerCase()));
  check(
    "the highest-priority draft is listed first",
    positions[0] >= 0 && positions.slice(1).every((p) => p < 0 || p > positions[0]),
    `positions ${JSON.stringify(positions)}`
  );

  check(
    "each listed draft shows its priority reason",
    expected.every((e) => flat.includes(e.p.reason.slice(0, 26).toLowerCase())),
    "a reason string was missing from the card"
  );

  // ---- priority must never look like demand data --------------------------
  const bodyText = (await page.innerText("body")).toLowerCase();
  // Only phrases that would assert demand data this project does not possess.
  // Bare words like "traffic" and "trending" are excluded deliberately: the
  // site has real first-party analytics and a real rotation feature, and
  // failing on their names would be a false alarm about honest labels.
  const demandWords = [
    "search volume", "monthly searches", "keyword difficulty", "cost per click",
    "popularity score", "estimated traffic", "social engagement", "market demand",
  ];
  const found = demandWords.filter((w) => bodyText.includes(w));
  check(
    "nothing on Today implies demand data we do not have",
    found.length === 0,
    `found: ${found.join(", ")}`
  );

  check("pages awaiting media still reports", /awaiting media/i.test(bodyText));
} catch (e) {
  fatal = e;
} finally {
  await browser.close();
}

if (fatal) {
  console.error(`\nABORTED: ${fatal.stack ?? fatal.message}`);
  process.exitCode = 1;
} else {
  console.log(`\n${passed} passed, ${failed} failed`);
  process.exitCode = failed > 0 ? 1 : 0;
}
