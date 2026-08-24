/**
 * Do the new engine admin routes actually render in production?
 *
 * Phase A added /admin/engine (rewritten) and /admin/engine/health (new), and
 * changed the dashboard. A build succeeding says nothing about whether a Server
 * Component throws on real data — that failure mode has appeared repeatedly in
 * this project as a masked React #441, and the whole reason /api/build and the
 * digest capture exist.
 *
 * Read-only: it signs in, loads pages, and asserts they rendered. It clicks no
 * action, approves no brief, and writes nothing.
 */
import { chromium } from "playwright";

const BASE = process.argv[2] ?? "https://www.techcarvalho.com";
const results: { ok: boolean; label: string; detail?: unknown }[] = [];

function record(label: string, ok: boolean, detail?: unknown) {
  results.push({ ok, label, detail });
  console.log(`[${ok ? "PASS" : "FAIL"}] ${label}`);
  if (detail !== undefined) console.log(`       ${JSON.stringify(detail).slice(0, 200)}`);
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
  record("signed in as a real admin", true);

  for (const path of ["/admin", "/admin/engine", "/admin/engine/health"]) {
    const res = await page.goto(`${BASE}${path}`, { waitUntil: "domcontentloaded" });
    await page.waitForTimeout(1200);
    const body = (await page.textContent("body")) ?? "";
    const crashed = /Minified React error|Something went wrong loading this page/i.test(body);
    const empty = body.trim().length < 200;
    record(`${path} renders (${res?.status()})`, res?.status() === 200 && !crashed && !empty, {
      status: res?.status(),
      crashed,
      chars: body.trim().length,
    });
    if (crashed) {
      // The digest is on screen now; print it so a failure here is immediately
      // actionable instead of starting another round of guessing.
      const digest = await page
        .evaluate(() => {
          const dds = Array.from(document.querySelectorAll("dd"));
          return dds.map((d) => (d.textContent ?? "").trim()).find((t) => /^[0-9]+(@\w+)?$/.test(t)) ?? null;
        })
        .catch(() => null);
      console.log(`       digest: ${digest ?? "none shown"}`);
    }
  }

  // The queue must actually be populated — a queue page that renders an empty
  // state while 47 briefs wait is a worse failure than a crash, because it
  // looks fine. 71 briefs exist in production.
  await page.goto(`${BASE}/admin/engine`, { waitUntil: "domcontentloaded" });
  await page.waitForTimeout(1200);
  const engineBody = (await page.textContent("body")) ?? "";
  const mentionsWork = /\d/.test(engineBody) && engineBody.length > 500;
  record("the engine page shows content, not a bare empty state", mentionsWork, {
    chars: engineBody.length,
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
