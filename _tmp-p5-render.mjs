import { chromium } from "playwright";
const BASE = "http://localhost:3210";
const OUT = "C:\\Users\\info\\AppData\\Local\\Temp\\claude\\C--Projects-TechCarvalho\\3ef1c09d-ae92-4361-b318-9f5d96e1a40d\\scratchpad\\";
const browser = await chromium.launch();

const viewports = [
  ["desktop", 1280, 1000],
  ["tablet", 820, 900],
  ["mobile", 390, 850],
];

for (const [name, width, height] of viewports) {
  const page = await browser.newPage({ viewport: { width, height } });
  await page.goto(BASE + "/", { waitUntil: "networkidle" });
  await page.getByRole("button", { name: "Reject non-essential" }).first().click().catch(() => {});
  await page.waitForTimeout(400);

  const heading = await page.locator("#trending-heading").isVisible().catch(() => false);
  const label = await page.locator("#trending-heading").locator("xpath=following-sibling::span").first().textContent().catch(() => null);
  const leadTitle = await page.locator("section[aria-labelledby='trending-heading'] h3").first().textContent().catch(() => null);
  const supportingCount = await page.locator("section[aria-labelledby='trending-heading'] li").count();
  // Horizontal overflow check — the lead hero must not push the page sideways.
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth > window.innerWidth + 1);
  console.log(`${name.padEnd(8)} trendingVisible=${heading} label="${(label ?? "").trim()}" supporting=${supportingCount} hOverflow=${overflow}`);
  console.log(`         lead="${(leadTitle ?? "").trim().slice(0, 60)}"`);

  await page.screenshot({ path: OUT + `p5-home-${name}.png`, fullPage: false });
  await page.close();
}

// Category page
const page = await browser.newPage({ viewport: { width: 1280, height: 1000 } });
await page.goto(BASE + "/gaming", { waitUntil: "networkidle" });
await page.getByRole("button", { name: "Reject non-essential" }).first().click().catch(() => {});
await page.waitForTimeout(300);
const catHeading = await page.locator("#trending-heading").textContent().catch(() => null);
const catOverflow = await page.evaluate(() => document.documentElement.scrollWidth > window.innerWidth + 1);
const sections = await page.locator("main section, section").count();
console.log(`\ncategory /gaming: trendingHeading="${(catHeading ?? "").trim()}" hOverflow=${catOverflow} sections=${sections}`);
await page.screenshot({ path: OUT + "p5-category-desktop.png", fullPage: false });

// Mobile category
const m = await browser.newPage({ viewport: { width: 390, height: 850 } });
await m.goto(BASE + "/gaming", { waitUntil: "networkidle" });
await m.getByRole("button", { name: "Reject non-essential" }).first().click().catch(() => {});
await m.waitForTimeout(300);
const mOverflow = await m.evaluate(() => document.documentElement.scrollWidth > window.innerWidth + 1);
console.log(`category /gaming mobile: hOverflow=${mOverflow}`);
await m.screenshot({ path: OUT + "p5-category-mobile.png", fullPage: false });

await browser.close();
console.log("\ndone");
