/**
 * Do the routes added by phases B/D/E render — with their migrations UNAPPLIED?
 *
 * That last clause is the whole point. /admin/engine/autonomy reads
 * `engine_settings.stage_modes`, which ships in
 * supabase/migrations_pending/20260824_stage_modes.sql and has NOT been run.
 * Naming an absent column in a PostgREST select errors the entire read, and in
 * a production build that surfaces as a masked React #441 — the exact failure
 * this project has chased repeatedly.
 *
 * So the state being tested is not "does the page work once everything is
 * applied". It is "does the page work in the state production is actually in
 * right now", which is the state the owner will open it in.
 *
 * Read-only: signs in, loads pages, asserts they rendered. Clicks nothing,
 * writes nothing.
 */
import { chromium } from "playwright";

const BASE = process.argv[2] ?? "https://www.techcarvalho.com";
const results: { ok: boolean; label: string; detail?: unknown }[] = [];

function record(label: string, ok: boolean, detail?: unknown) {
  results.push({ ok, label, detail });
  console.log(`[${ok ? "PASS" : "FAIL"}] ${label}`);
  if (detail !== undefined) console.log(`       ${JSON.stringify(detail).slice(0, 220)}`);
}

async function main() {
  const browser = await chromium.launch();
  const context = await browser.newContext({
    userAgent:
      "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0.0.0 Safari/537.36",
  });
  const page = await context.newPage();
  const pageErrors: string[] = [];
  page.on("pageerror", (e) => pageErrors.push(String(e)));

  await page.goto(`${BASE}/admin/login`, { waitUntil: "domcontentloaded" });
  await page.fill("input[name=email]", process.env.TC_ADMIN_EMAIL!);
  await page.fill("input[name=password]", process.env.TC_ADMIN_PASSWORD!);
  // Scoped to main — an unscoped submit hits the header's "Sign out".
  await page.click("main button[type=submit]");
  await page.waitForURL((u) => !u.pathname.includes("/login"), { timeout: 30_000 });

  const res = await page.goto(`${BASE}/admin/engine/autonomy`, { waitUntil: "domcontentloaded" });
  await page.waitForTimeout(1500);
  const body = (await page.textContent("body")) ?? "";
  const crashed = /Minified React error|Something went wrong loading this page/i.test(body);

  record("/admin/engine/autonomy renders with stage_modes ABSENT", res?.status() === 200 && !crashed, {
    status: res?.status(),
    crashed,
    chars: body.trim().length,
  });

  if (crashed) {
    const digest = await page
      .evaluate(() => {
        const dds = Array.from(document.querySelectorAll("dd"));
        return dds.map((d) => (d.textContent ?? "").trim()).find((t) => /^[0-9]+(@\w+)?$/.test(t)) ?? null;
      })
      .catch(() => null);
    console.log(`       digest: ${digest ?? "none shown"}`);
  }

  // Not merely "did not crash" — it must SAY the column is missing. A page that
  // silently renders defaults would let an owner believe they had set a stage
  // mode that was never stored anywhere.
  record(
    "it names the unapplied migration rather than silently showing defaults",
    /stage_modes/i.test(body) && /migrations_pending|does not exist/i.test(body),
    { mentionsColumn: /stage_modes/i.test(body) }
  );

  // A brand-new dynamic route: a bad id must 404 or say not-found, never crash.
  const pkg = await page.goto(`${BASE}/admin/engine/packages/00000000-0000-0000-0000-000000000000`, {
    waitUntil: "domcontentloaded",
  });
  await page.waitForTimeout(1200);
  const pkgBody = (await page.textContent("body")) ?? "";
  const pkgCrashed = /Minified React error|Something went wrong loading this page/i.test(pkgBody);
  record("/admin/engine/packages/[id] handles an unknown id without crashing", !pkgCrashed, {
    status: pkg?.status(),
    crashed: pkgCrashed,
  });

  record("no browser page errors on any route", pageErrors.length === 0, pageErrors.slice(0, 2));

  await browser.close();
  const passed = results.filter((r) => r.ok).length;
  console.log(`\n${passed}/${results.length} checks passed.`);
  if (passed !== results.length) process.exitCode = 1;
}

main().catch((e) => {
  console.error(e);
  process.exitCode = 1;
});
