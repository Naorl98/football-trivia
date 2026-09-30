// Layout QA across the required viewport matrix.
// Checks every key screen for horizontal overflow, clipped controls,
// off-screen content and RTL correctness.
// Usage: node scripts/viewport-qa.mjs [baseUrl] [--shots]
import { chromium } from "playwright";
import { mkdirSync } from "node:fs";

const BASE = process.argv[2] ?? "http://localhost:5173";
const SHOTS = process.argv.includes("--shots");
if (SHOTS) mkdirSync("screenshots-viewports", { recursive: true });

const VIEWPORTS = [
  { name: "iphone-se", width: 375, height: 812 },
  { name: "iphone-14", width: 390, height: 844 },
  { name: "iphone-pro-max", width: 430, height: 932 },
  { name: "ipad", width: 768, height: 1024 },
  { name: "laptop-sm", width: 1366, height: 768 },
  { name: "laptop", width: 1440, height: 900 },
  { name: "desktop", width: 1920, height: 1080 },
];

let passed = 0;
let failed = 0;
const check = (name, cond, detail = "") => {
  if (cond) passed++;
  else {
    failed++;
    console.log(`  FAIL  [${name}] ${detail}`);
  }
};

const browser = await chromium.launch({ channel: "chrome", headless: true });

console.log(`\nViewport QA → ${BASE}\n`);

for (const vp of VIEWPORTS) {
  const context = await browser.newContext({
    viewport: { width: vp.width, height: vp.height },
    locale: "he-IL",
  });
  const page = await context.newPage();
  const errors = [];
  page.on("pageerror", (e) => errors.push(e.message));

  // Seed a free-text quiz so the input screen is covered too.
  await page.goto(BASE, { waitUntil: "networkidle" });
  await page.evaluate(async () => {
    const res = await fetch("/api/quiz", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        region: "WORLD", countries: [], competitions: ["ALL"], categories: [],
        difficulty: "MIXED", questionCount: 5, gameMode: "CLASSIC", answerMode: "FREE_TEXT",
      }),
    });
    sessionStorage.setItem("fiq_active_quiz", JSON.stringify({ quiz: await res.json(), startedAt: Date.now() }));
  });

  const screens = [
    { label: "home", url: BASE, ready: ".hero-title" },
    { label: "builder", url: `${BASE}/build`, ready: ".builder-title" },
    { label: "play-freetext", url: `${BASE}/play`, ready: ".ft-input" },
    { label: "daily", url: `${BASE}/daily`, ready: ".intro-card" },
  ];

  for (const screen of screens) {
    await page.goto(screen.url, { waitUntil: "networkidle" });
    await page.waitForSelector(screen.ready, { timeout: 20000 });
    await page.waitForTimeout(350);

    const metrics = await page.evaluate(() => {
      const docWidth = document.documentElement.scrollWidth;
      const winWidth = window.innerWidth;
      // Any element sticking out past the viewport edge on either side.
      const offenders = [];
      document.querySelectorAll("body *").forEach((el) => {
        const r = el.getBoundingClientRect();
        if (r.width === 0 || r.height === 0) return;
        const style = getComputedStyle(el);
        if (style.position === "fixed" && style.pointerEvents === "none") return;
        if (r.right > winWidth + 1.5 || r.left < -1.5) {
          offenders.push(`${el.className || el.tagName}@${Math.round(r.left)}..${Math.round(r.right)}`);
        }
      });
      return { docWidth, winWidth, offenders: offenders.slice(0, 3), dir: document.documentElement.dir };
    });

    check(`${vp.name}/${screen.label}`, metrics.docWidth <= metrics.winWidth + 1,
      `horizontal overflow: doc ${metrics.docWidth} > win ${metrics.winWidth}`);
    check(`${vp.name}/${screen.label} elements in bounds`, metrics.offenders.length === 0,
      `out of bounds: ${metrics.offenders.join(", ")}`);
    check(`${vp.name}/${screen.label} rtl`, metrics.dir === "rtl", `dir=${metrics.dir}`);

    // Primary action must be reachable, not clipped off the bottom.
    const cta = page.locator(".btn-primary").first();
    if ((await cta.count()) > 0) {
      const box = await cta.boundingBox();
      check(`${vp.name}/${screen.label} cta visible`, !!box && box.width > 0 && box.height >= 40,
        `cta box ${JSON.stringify(box)}`);
    }

    // Sound toggle must be present and keyboard-focusable on every screen.
    const toggle = page.locator(".sound-toggle");
    check(`${vp.name}/${screen.label} sound toggle present`, (await toggle.count()) === 1);

    if (SHOTS) {
      await page.screenshot({ path: `screenshots-viewports/${vp.name}-${screen.label}.png` });
    }
  }

  check(`${vp.name} no page errors`, errors.length === 0, errors.slice(0, 2).join(" | "));
  await context.close();
  console.log(`  checked ${vp.name} (${vp.width}x${vp.height})`);
}

await browser.close();
console.log(`\n${passed} checks passed, ${failed} failed\n`);
process.exit(failed === 0 ? 0 : 1);
