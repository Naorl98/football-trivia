// Captures screenshots of the main screens for visual review.
// Usage: node scripts/screenshots.mjs [baseUrl] [outDir]
import { chromium } from "playwright";
import { mkdirSync } from "node:fs";

const BASE = process.argv[2] ?? "http://localhost:5173";
const OUT = process.argv[3] ?? "screenshots";
mkdirSync(OUT, { recursive: true });

const browser = await chromium.launch({ channel: "chrome", headless: true });
const context = await browser.newContext({ viewport: { width: 390, height: 844 }, locale: "he-IL" });
const page = await context.newPage();

async function shot(name, fullPage = false) {
  await page.waitForTimeout(600); // let entrance animations settle
  await page.screenshot({ path: `${OUT}/${name}.png`, fullPage });
  console.log(`captured ${name}.png`);
}

await page.goto(BASE, { waitUntil: "networkidle" });
await shot("01-home", true);

await page.goto(`${BASE}/build`, { waitUntil: "networkidle" });
await page.waitForTimeout(900);
await shot("02-builder", true);

await page.goto(BASE, { waitUntil: "networkidle" });
await page.locator(".quick-card").first().click();
await page.waitForSelector(".quiz-question");
await shot("03-quiz-question");

await page.locator(".option-btn").first().click();
await page.waitForSelector(".option-btn.correct");
await shot("04-quiz-answered");

// play to the end
let guard = 0;
while (guard++ < 30) {
  const btn = page.locator(".quiz-footer button");
  const label = await btn.innerText();
  await btn.click();
  if (label.includes("סיום")) break;
  await page.waitForSelector(".option-btn:not([disabled])");
  await page.locator(".option-btn").nth(guard % 4).click();
  await page.waitForSelector(".quiz-footer button");
}
await page.waitForURL("**/results");
await page.waitForSelector(".results-score");
await shot("05-results", true);

// clue-based mode
await page.goto(BASE, { waitUntil: "networkidle" });
await page.locator(".quick-card").nth(5).click(); // career path preset
await page.waitForSelector(".quiz-question");
await shot("06-career-path");

await page.goto(`${BASE}/daily`, { waitUntil: "networkidle" });
await page.waitForSelector(".intro-card");
await shot("07-daily");

// desktop view of home
const desktop = await context.newPage();
await desktop.setViewportSize({ width: 1280, height: 900 });
await desktop.goto(BASE, { waitUntil: "networkidle" });
await desktop.waitForTimeout(600);
await desktop.screenshot({ path: `${OUT}/08-home-desktop.png` });
console.log("captured 08-home-desktop.png");

await browser.close();
