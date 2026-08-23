/**
 * Which build is production serving?
 *
 * THE PROBLEM
 * Commit f14a784 fixed a validator that rejected two source types the form
 * offered. The fix is admin-only and changed no label, so the rendered DOM is
 * byte-identical between the old build and the new one. There is nothing to
 * read that tells you which is live.
 *
 * THE DISCRIMINATOR
 * In the OLD build the source-type allow-list omitted `tc_graphic`, and that
 * check runs BEFORE the "did you attach a file" check:
 *
 *     line 111  ...return { error: "Choose a valid source type." }
 *     line 157  ...return { error: "Choose a file to upload." }
 *
 * So submitting source_type=tc_graphic with NO FILE separates them exactly:
 *
 *     old build -> "Choose a valid source type."   (the bug)
 *     new build -> "Choose a file to upload."      (fixed; got past the gate)
 *
 * and because it stops at the missing file, it INSERTS NOTHING and UPLOADS
 * NOTHING. No row, no storage object, no cleanup to get wrong. That is the
 * whole reason this particular probe was chosen over re-uploading a test PNG.
 *
 * The submit button is disabled without a file, so the disabled attribute is
 * removed before clicking — we are deliberately exercising a path the UI
 * prevents, to read the server's answer.
 */
import { chromium } from "playwright";

const BASE = process.env.TC_BASE_URL ?? "https://www.techcarvalho.com";

async function main() {
  const browser = await chromium.launch();
  const context = await browser.newContext({
    // A realistic UA: BOT_UA_PATTERN rejects HeadlessChrome.
    userAgent:
      "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0.0.0 Safari/537.36",
  });
  const page = await context.newPage();

  await page.goto(`${BASE}/admin/login`, { waitUntil: "domcontentloaded" });
  await page.fill("input[name=email]", process.env.TC_ADMIN_EMAIL!);
  await page.fill("input[name=password]", process.env.TC_ADMIN_PASSWORD!);
  // SCOPED TO MAIN — an unscoped button[type=submit] hits the header's
  // "Sign out" button and silently ends the session. It cost an hour once.
  await page.click("main button[type=submit]");
  await page.waitForURL((u) => !u.pathname.includes("/login"), { timeout: 30_000 });

  const resp = await page.goto(`${BASE}/admin/media/new`, { waitUntil: "domcontentloaded" });
  console.log(`GET /admin/media/new -> ${resp?.status()}`);

  const body = await page.textContent("body");
  if (body?.includes("Minified React error") || body?.includes("Something went wrong")) {
    console.log("RESULT: the page is CRASHING (React error boundary present).");
    await browser.close();
    process.exit(1);
  }
  console.log("Form renders, no error boundary.");

  // Reveal the advanced section that holds the source-type menu.
  for (const label of ["Advanced", "Provenance", "Rights"]) {
    await page.click(`text=${label}`, { timeout: 2000 }).catch(() => {});
  }

  await page.selectOption("#source_type", "tc_graphic");
  console.log("Selected source_type = tc_graphic (a value 60 live assets already use).");

  // Deliberately submit with no file attached.
  await page.evaluate(() => {
    document
      .querySelectorAll("main button[type=submit]")
      .forEach((b) => b.removeAttribute("disabled"));
  });
  await page.click("main button[type=submit]");
  await page.waitForTimeout(6000);

  const after = (await page.textContent("body")) ?? "";
  const sawSourceReject = after.includes("Choose a valid source type");
  const sawFileReject = after.includes("Choose a file to upload");

  console.log("\n--- verdict ---");
  if (sawSourceReject) {
    console.log('Server said: "Choose a valid source type."');
    console.log("RESULT: production is serving the OLD build. f14a784 has NOT deployed.");
  } else if (sawFileReject) {
    console.log('Server said: "Choose a file to upload."');
    console.log("RESULT: production is serving the NEW build. f14a784 IS live.");
  } else {
    console.log("RESULT: INDETERMINATE — neither message appeared. Not proof of either build.");
    console.log(after.slice(0, 400));
  }
  console.log("Nothing was written: the request stopped at the missing-file check.");

  await browser.close();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
