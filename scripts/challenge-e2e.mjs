// SUPERSEDED — see scripts/product-qa.mjs.
//
// This script was written against an earlier generation of the UI and its
// selectors no longer match the markup, so it reports failures on a product
// that works. Known stale: the quiz-board selectors it waits on.
//
// It is left in place rather than deleted because removing someone else’s test
// is their call, not a side effect of a reliability pass. Do not treat a
// failure here as a regression without checking the selector first.

// Verifies the full "challenge a friend" round trip against a running deployment:
// create a challenge over the API, open its URL in a real browser as a second
// player would, and confirm the exact same questions are replayed.
// Usage: node scripts/challenge-e2e.mjs [baseUrl]
import { chromium } from "playwright";

const BASE = process.argv[2] ?? "http://localhost:5173";
let passed = 0;
let failed = 0;
const check = (name, cond, detail = "") => {
  if (cond) {
    passed++;
    console.log(`  PASS  ${name}`);
  } else {
    failed++;
    console.log(`  FAIL  ${name}${detail ? ` — ${detail}` : ""}`);
  }
};

console.log(`\nChallenge round-trip test → ${BASE}\n`);

const config = {
  region: "WORLD",
  countries: [],
  competitions: ["ALL"],
  categories: [],
  difficulty: "MIXED",
  questionCount: 5,
  gameMode: "CLASSIC",
};

const created = await (
  await fetch(`${BASE}/api/challenges`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(config),
  })
).json();

const publicId = created.challenge.publicId;
const expectedQuestions = created.quiz.questions.map((q) => q.questionHe);
console.log(`  challenge id: ${publicId}`);

const browser = await chromium.launch({ channel: "chrome", headless: true });
const page = await browser.newPage({ viewport: { width: 390, height: 844 } });

await page.goto(`${BASE}/challenge/${publicId}`, { waitUntil: "networkidle" });
await page.waitForSelector(".intro-card");
check("challenge landing page invites the player", (await page.locator(".intro-card h1").innerText()).includes("אתגר"));

await page.getByRole("button", { name: "קבלו את האתגר" }).click();
await page.waitForURL("**/play");
await page.waitForSelector(".quiz-question");

const seen = [];
let guard = 0;
while (guard++ < 12) {
  seen.push(await page.locator(".quiz-question").innerText());
  await page.locator(".option-btn").first().click();
  await page.waitForSelector(".quiz-footer button");
  const btn = page.locator(".quiz-footer button");
  const label = await btn.innerText();
  await btn.click();
  if (label.includes("סיום")) break;
  await page.waitForSelector(".option-btn:not([disabled])");
}

check("challenge replays the same number of questions", seen.length === expectedQuestions.length, `${seen.length} vs ${expectedQuestions.length}`);
check(
  "challenge replays the exact same questions in the same order",
  seen.join("|") === expectedQuestions.join("|")
);

await page.waitForURL("**/results", { timeout: 15000 });
await page.waitForSelector(".results-score");
check("challenge play-through reaches the results screen", true);

await browser.close();
console.log(`\n${passed} passed, ${failed} failed\n`);
process.exit(failed === 0 ? 0 : 1);
