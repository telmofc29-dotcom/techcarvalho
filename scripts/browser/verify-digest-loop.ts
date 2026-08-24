/**
 * Does the digest actually resolve to the real exception, end to end?
 *
 * The owner is being asked to hit a crash, read a digest off the red box, and
 * follow a link to recover the underlying error. That instruction is worthless
 * if any link in the chain is broken, so this exercises the whole chain against
 * a PRODUCTION BUILD rather than trusting that it works:
 *
 *   1. a Server Component inside the (dashboard) layout throws
 *   2. React masks it as #441 and the (dashboard) error boundary renders
 *   3. the boundary displays a digest
 *   4. /api/admin/recent-errors?digest=... returns the TRUE exception + stack
 *
 * Run against a local production build (`next build && next start -p 3199`),
 * because `next dev` does not mask errors and so cannot reproduce the thing
 * being tested.
 *
 * IT NEEDS A PAGE THAT THROWS, and no such page is committed — shipping a
 * route that deliberately crashes inside the admin area is not something to
 * leave lying in the tree. Recreate it for the run:
 *
 *   src/app/admin/(dashboard)/throwprobe/page.tsx
 *
 *     import { requireAdmin } from "@/lib/dal";
 *     export const dynamic = "force-dynamic";
 *     export default async function ThrowProbe() {
 *       await requireAdmin();
 *       const o = null as unknown as { y: number };
 *       return <div>{o.y}</div>;
 *     }
 *
 * then `npm run build`, `npx next start -p 3199`, run this, and DELETE the page
 * afterwards.
 *
 * Last run: 9/9, digest 1369820651 on screen resolved to
 * "Cannot read properties of null (reading 'y')" with stack and
 * routePath=/admin/throwprobe.
 */
import { chromium } from "playwright";

const BASE = process.argv[2] ?? "http://localhost:3199";
const results: { ok: boolean; label: string; detail?: unknown }[] = [];

function record(label: string, ok: boolean, detail?: unknown) {
  results.push({ ok, label, detail });
  console.log(`[${ok ? "PASS" : "FAIL"}] ${label}`);
  if (detail !== undefined) console.log(`       ${JSON.stringify(detail).slice(0, 300)}`);
}

async function main() {
  const browser = await chromium.launch();
  const context = await browser.newContext({
    userAgent:
      "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0.0.0 Safari/537.36",
  });
  const page = await context.newPage();

  await page.goto(`${BASE}/admin/login`, { waitUntil: "domcontentloaded" });
  await page.fill("input[name=email]", process.env.TC_ADMIN_EMAIL!);
  await page.fill("input[name=password]", process.env.TC_ADMIN_PASSWORD!);
  // Scoped to main: an unscoped submit hits the header's "Sign out".
  await page.click("main button[type=submit]");
  await page.waitForURL((u) => !u.pathname.includes("/login"), { timeout: 30_000 });
  record("signed in as a real admin", true);

  await page.goto(`${BASE}/admin/throwprobe`, { waitUntil: "domcontentloaded" });
  await page.waitForTimeout(1500);

  const bodyText = (await page.textContent("body")) ?? "";

  // The (dashboard) boundary, NOT the root one. The wording differs, and which
  // boundary catches tells you whether the layout or the page threw.
  record(
    "the (dashboard) error boundary caught it, so the layout itself survived",
    /Something went wrong loading this page/i.test(bodyText),
    { rootBoundaryInstead: /head back to the homepage/i.test(bodyText) }
  );

  // React must still be masking the message — otherwise this is not the
  // condition the owner is hitting and the test proves nothing.
  record(
    "the real message is NOT shown in the browser (React masked it)",
    !bodyText.includes("Cannot read properties of null"),
    { masked: !bodyText.includes("Cannot read properties of null") }
  );

  const digest = await page.evaluate(() => {
    const dds = Array.from(document.querySelectorAll("dd"));
    const found = dds.map((d) => (d.textContent ?? "").trim()).find((t) => /^[0-9]+(@[A-Za-z0-9]+)?$/.test(t));
    return found ?? null;
  });
  record("a digest is displayed on the error screen", Boolean(digest), { digest });

  if (!digest) {
    await browser.close();
    return finish();
  }

  // Same browser session, so the admin cookie is carried — this is exactly the
  // path the owner is told to click.
  const res = await page.goto(`${BASE}/api/admin/recent-errors?digest=${encodeURIComponent(digest)}`, {
    waitUntil: "domcontentloaded",
  });
  record("the recent-errors endpoint answers an authenticated admin", res?.status() === 200, {
    status: res?.status(),
  });

  const json = JSON.parse((await page.textContent("pre")) ?? (await page.textContent("body")) ?? "{}");
  record("the digest was FOUND in the capture buffer", json.found === true, { found: json.found, note: json.note });
  record(
    "the endpoint returns the TRUE exception, not the masked text",
    typeof json.error?.message === "string" && json.error.message.includes("Cannot read properties of null"),
    { message: json.error?.message }
  );
  record("it carries a stack", typeof json.error?.stack === "string" && json.error.stack.length > 0);
  record("it names the route that threw", json.error?.routePath === "/admin/throwprobe", {
    routePath: json.error?.routePath,
    renderSource: json.error?.renderSource,
  });

  await browser.close();
  finish();
}

function finish() {
  const passed = results.filter((r) => r.ok).length;
  console.log(`\n${passed}/${results.length} checks passed.`);
  if (passed !== results.length) process.exitCode = 1;
}

main().catch((e) => {
  console.error(e);
  process.exitCode = 1;
});
