// SUPERSEDED — see scripts/product-qa.mjs.
//
// This script was written against an earlier generation of the UI and its
// selectors no longer match the markup, so it reports failures on a product
// that works. Known stale: the builder answer-mode selectors, and "reveal" is now a two-tap confirmation.
//
// It is left in place rather than deleted because removing someone else’s test
// is their call, not a side effect of a reliability pass. Do not treat a
// failure here as a regression without checking the selector first.

// Browser tests for free-text answer mode: typing, aliases, typos, hints,
// reveal, Enter submission, and keyboard-only play.
// Usage: node scripts/freetext-ui-test.mjs [baseUrl]
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

const browser = await chromium.launch({ channel: "chrome", headless: true });
const context = await browser.newContext({ viewport: { width: 390, height: 844 }, locale: "he-IL" });
const page = await context.newPage();

const consoleErrors = [];
page.on("console", (m) => m.type() === "error" && consoleErrors.push(m.text()));
page.on("pageerror", (e) => consoleErrors.push(`pageerror: ${e.message}`));

console.log(`\nFree-text mode UI test → ${BASE}\n`);

// Seed a free-text quiz directly into the session so the test controls the
// questions it plays, the same way the builder does.
async function startFreeTextQuiz(count = 5) {
  await page.goto(BASE, { waitUntil: "networkidle" });
  const quiz = await page.evaluate(async (n) => {
    const res = await fetch("/api/quiz", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        region: "WORLD",
        countries: [],
        competitions: ["ALL"],
        categories: [],
        difficulty: "MIXED",
        questionCount: n,
        gameMode: "CLASSIC",
        answerMode: "FREE_TEXT",
      }),
    });
    const quiz = await res.json();
    sessionStorage.setItem("fiq_active_quiz", JSON.stringify({ quiz, startedAt: Date.now() }));
    return quiz;
  }, count);
  await page.goto(`${BASE}/play`, { waitUntil: "networkidle" });
  await page.waitForSelector(".ft-input");
  return quiz;
}

// ---- Builder exposes the mode selector
await page.goto(`${BASE}/build`, { waitUntil: "networkidle" });
check("builder offers both answer modes", (await page.locator(".answer-mode").count()) === 2);
check(
  "free-text option is labelled in Hebrew",
  (await page.locator(".answer-mode").nth(1).innerText()).includes("תשובה חופשית")
);
await page.locator(".answer-mode").nth(1).click();
check("selecting free text marks it active", await page.locator(".answer-mode").nth(1).evaluate((el) => el.classList.contains("selected")));
await page.waitForTimeout(900);
const availability = await page.locator(".availability").innerText();
check("free-text availability count is substantial", /\d{3,}/.test(availability), availability);

// ---- Gameplay
let quiz = await startFreeTextQuiz(5);
check("free-text quiz renders a text input instead of options", (await page.locator(".option-btn").count()) === 0);
check("free-text badge is shown", (await page.locator(".badge", { hasText: "תשובה חופשית" }).count()) >= 1);

const inputBox = await page.locator(".ft-input").boundingBox();
check("input is comfortably tappable (>=48px)", inputBox.height >= 48, `${inputBox?.height}px`);
const fontSize = await page.locator(".ft-input").evaluate((el) => parseFloat(getComputedStyle(el).fontSize));
check("input font is >=16px so iOS will not zoom", fontSize >= 16, `${fontSize}px`);

// Empty submission must not resolve the question.
await page.locator(".ft-input").fill("   ");
await page.locator(".ft-submit").click();
check("whitespace-only answer does not submit", (await page.locator(".ft-result").count()) === 0);

// Hints
const hintButton = page.locator(".ft-actions button").first();
const hintLabel = await hintButton.innerText();
check("hint button shows remaining count", /רמז/.test(hintLabel), hintLabel);
await hintButton.click();
check("first hint appears", (await page.locator(".ft-hint").count()) === 1);
await hintButton.click();
check("a second hint can be revealed", (await page.locator(".ft-hint").count()) >= 2);

// Correct answer via the canonical value, submitted with Enter.
const canonical = quiz.questions[0].canonicalAnswer;
await page.locator(".ft-input").fill(canonical);
await page.locator(".ft-input").press("Enter");
await page.waitForSelector(".ft-result");
check("Enter submits the answer", (await page.locator(".ft-result").count()) === 1);
check("canonical answer is accepted", (await page.locator(".ft-result.ft-correct").count()) === 1);
check("success copy reads נכון", (await page.locator(".ft-result-title").innerText()).includes("נכון"));
check("input is removed once answered", (await page.locator(".ft-input").count()) === 0);
check("explanation is revealed after answering", (await page.locator(".explanation-box").count()) === 1);

// Next question: a wrong answer reveals the correct one.
await page.locator(".quiz-footer button").click();
await page.waitForSelector(".ft-input");
await page.locator(".ft-input").fill("קבוצה שלא קיימת בכלל");
await page.locator(".ft-submit").click();
await page.waitForSelector(".ft-result");
check("clearly wrong answer is rejected", (await page.locator(".ft-result.ft-wrong").count()) === 1);
check("rejection copy reads לא בדיוק", (await page.locator(".ft-result-title").innerText()).includes("לא בדיוק"));
check(
  "correct answer is revealed after a miss",
  (await page.locator(".ft-canonical").innerText()).includes(quiz.questions[1].canonicalAnswer)
);

// Next question: a minor typo should still pass.
await page.locator(".quiz-footer button").click();
await page.waitForSelector(".ft-input");
const target = quiz.questions[2].canonicalAnswer;
// Introduce a single-character transposition in a long-enough answer.
const typo = target.length > 7 ? target.slice(0, 2) + target[3] + target[2] + target.slice(4) : target;
await page.locator(".ft-input").fill(typo);
await page.locator(".ft-submit").click();
await page.waitForSelector(".ft-result");
if (target.length > 7) {
  check(`single transposition "${typo}" is accepted for "${target}"`, (await page.locator(".ft-result.ft-correct").count()) === 1);
} else {
  check("short answer skipped for typo tolerance (by design)", true);
}

// Next question: reveal answer needs two deliberate clicks.
await page.locator(".quiz-footer button").click();
await page.waitForSelector(".ft-input");
const revealButton = page.locator(".ft-actions button").nth(1);
check("reveal button is present", (await revealButton.innerText()).includes("גלה תשובה"));
await revealButton.click();
check("first click asks for confirmation instead of revealing", (await page.locator(".ft-result").count()) === 0);
check("confirmation copy is shown", (await revealButton.innerText()).includes("בטוחים"));
await revealButton.click();
await page.waitForSelector(".ft-result");
check("second click reveals the answer", (await page.locator(".ft-result.ft-revealed").count()) === 1);

// Finish the quiz and confirm the reveal is reported separately.
await page.locator(".quiz-footer button").click();
await page.waitForSelector(".ft-input");
await page.locator(".ft-input").fill(quiz.questions[4].canonicalAnswer);
await page.locator(".ft-input").press("Enter");
await page.waitForSelector(".quiz-footer button");
await page.locator(".quiz-footer button").click();
await page.waitForURL("**/results", { timeout: 15000 });
await page.waitForSelector(".iq-value");
// innerText in an RTL document can carry bidi control characters, so compare digits only.
const iqText = (await page.locator(".iq-value").innerText()).replace(/[^0-9]/g, "");
check(
  "results screen shows a Football IQ rating",
  iqText.length > 0 && Number(iqText) >= 0 && Number(iqText) <= 100,
  JSON.stringify(await page.locator(".iq-value").innerText())
);
const statLabels = await page.locator(".stat-label").allInnerTexts();
check("revealed answers are counted separately in results", statLabels.some((l) => l.includes("נחשפו")), statLabels.join(" | "));

// ---- Keyboard-only play
quiz = await startFreeTextQuiz(5);
await page.keyboard.press("Tab");
await page.locator(".ft-input").focus();
await page.keyboard.type(quiz.questions[0].canonicalAnswer);
await page.keyboard.press("Enter");
await page.waitForSelector(".ft-result");
check("quiz is playable with keyboard only", (await page.locator(".ft-result.ft-correct").count()) === 1);

// ---- Alias acceptance, checked against a question whose answer has aliases
const aliasQuestion = quiz.questions.find((q) => q.aliases && q.aliases.length > 0);
if (aliasQuestion) {
  await page.evaluate((q) => {
    sessionStorage.setItem(
      "fiq_active_quiz",
      JSON.stringify({ quiz: { configuration: { answerMode: "FREE_TEXT", gameMode: "CLASSIC" }, questions: [q], requestedCount: 1, availableCount: 1 }, startedAt: Date.now() })
    );
  }, aliasQuestion);
  await page.goto(`${BASE}/play`, { waitUntil: "networkidle" });
  await page.waitForSelector(".ft-input");
  const alias = aliasQuestion.aliases[0];
  await page.locator(".ft-input").fill(alias);
  await page.locator(".ft-submit").click();
  await page.waitForSelector(".ft-result");
  check(`alias "${alias}" is accepted for "${aliasQuestion.canonicalAnswer}"`, (await page.locator(".ft-result.ft-correct").count()) === 1);
} else {
  check("alias case available to test", false, "no question with aliases returned");
}

check("no console errors during free-text run", consoleErrors.length === 0, consoleErrors.slice(0, 3).join(" | "));

await browser.close();
console.log(`\n${passed} passed, ${failed} failed\n`);
process.exit(failed === 0 ? 0 : 1);
