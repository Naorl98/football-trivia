#!/usr/bin/env node
// Browser QA for the game-creation wizard and the preset difficulty rules.
//
//   npm run qa:builder                                  # against production
//   npm run qa:builder -- --base=http://localhost:5173  # against a dev server
//   npm run qa:builder -- --engines=webkit
//
// WHAT THIS CHECKS, AND WHY IT IS NOT A SCREENSHOT TEST
//
// Two things can be wrong with a quiz builder and only one of them is visible.
// The visible one is layout: a step that scrolls, a start button below the fold.
// The invisible one is worse — a wizard that looks right and sends the wrong
// query, so the player gets questions they did not ask for and has no way to
// tell. So every flow here reads the actual POST /api/quiz BODY and asserts the
// answer mode, difficulty, count, geography, competition and game mode that the
// engine will receive.
//
// The same applies to the preset difficulty rules. "Quick Start never serves an
// Expert question" cannot be checked by looking at the home page; it is checked
// by reading the difficulties of the questions the server actually returned.

import { chromium, webkit, devices } from "playwright";

const arg = (name, fallback) => {
  const hit = process.argv.find((a) => a.startsWith(`--${name}=`));
  return hit ? hit.slice(name.length + 3) : fallback;
};

const BASE = arg("base", "https://football-iq.naorl.workers.dev").replace(/\/$/, "");
const ENGINES = arg("engines", "chromium").split(",").filter(Boolean);
const QUICK_RUNS = Number(arg("quick-runs", "8"));
const DAILY_RUNS = Number(arg("daily-runs", "5"));

const pick = (name) => devices[name];

/** The viewports the spec names, plus the desktop widths. */
const MOBILE = [
  { label: "390x844 (iPhone 14)", device: pick("iPhone 14") ?? { viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true, deviceScaleFactor: 3 } },
  { label: "393x852 (iPhone 15 Pro)", device: pick("iPhone 15 Pro") ?? { viewport: { width: 393, height: 852 }, isMobile: true, hasTouch: true, deviceScaleFactor: 3 } },
  { label: "430x932 (iPhone 15 Pro Max)", device: pick("iPhone 15 Pro Max") ?? { viewport: { width: 430, height: 932 }, isMobile: true, hasTouch: true, deviceScaleFactor: 3 } },
];

const DESKTOP = [
  { label: "1366x768", device: { viewport: { width: 1366, height: 768 } } },
  { label: "1440x900", device: { viewport: { width: 1440, height: 900 } } },
  { label: "1920x1080", device: { viewport: { width: 1920, height: 1080 } } },
];

async function launch(engine) {
  if (engine === "webkit") return webkit.launch();
  for (const options of [{}, { channel: "chrome" }, { channel: "msedge" }]) {
    try {
      return await chromium.launch(options);
    } catch {
      /* next */
    }
  }
  throw new Error("no usable Chromium");
}

const results = [];
const record = (ok, area, detail) => {
  results.push({ ok, area, detail });
  console.log(`  ${ok ? "PASS" : "FAIL"}  ${area}${detail ? ` — ${detail}` : ""}`);
};

// ---------------------------------------------------------------------------
// The flows the spec requires
// ---------------------------------------------------------------------------

/**
 * `expect` is asserted against the POST /api/quiz body, which is the query the
 * engine receives. Anything absent from `expect` is not asserted.
 */
const FLOWS = [
  {
    id: "A",
    name: "free text, hard, 10, worldwide",
    answerMode: "תשובה חופשית",
    difficulty: "קשה",
    count: "10",
    scope: { kind: "world" },
    expect: {
      answerMode: "FREE_TEXT",
      difficulty: "HARD",
      questionCount: 10,
      region: "WORLD",
      competitions: ["ALL"],
      countries: [],
      gameMode: "CLASSIC",
    },
  },
  {
    id: "B",
    name: "multiple choice, normal, 15, Europe → Spain → La Liga",
    answerMode: "אמריקאי",
    difficulty: "רגיל",
    count: "15",
    scope: { kind: "region", continent: "אירופה", country: "ספרד", league: "לה ליגה" },
    expect: {
      answerMode: "MULTIPLE_CHOICE",
      difficulty: "NORMAL",
      questionCount: 15,
      region: "EUROPE",
      countries: ["ESP"],
      competitions: ["LA_LIGA"],
      gameMode: "CLASSIC",
    },
  },
  {
    id: "C",
    name: "free text, expert, 10, Champions League",
    answerMode: "תשובה חופשית",
    difficulty: "מומחה",
    count: "10",
    scope: { kind: "quick", chip: "ליגת האלופות" },
    expect: {
      answerMode: "FREE_TEXT",
      difficulty: "EXPERT",
      questionCount: 10,
      competitions: ["UCL"],
      region: "EUROPE",
      gameMode: "CLASSIC",
    },
  },
  {
    id: "D",
    name: "multiple choice, hard, 10, six big leagues",
    answerMode: "אמריקאי",
    difficulty: "קשה",
    count: "10",
    scope: { kind: "quick", chip: "6 הליגות הגדולות" },
    expect: {
      answerMode: "MULTIPLE_CHOICE",
      difficulty: "HARD",
      questionCount: 10,
      competitions: ["TOP_6_EUROPE"],
      region: "EUROPE",
      gameMode: "CLASSIC",
    },
  },
  {
    id: "E",
    name: "free text, hard, 10, Who Am I",
    answerMode: "תשובה חופשית",
    difficulty: "קשה",
    count: "10",
    scope: { kind: "quick", chip: "מי אני?" },
    expect: {
      answerMode: "FREE_TEXT",
      difficulty: "HARD",
      questionCount: 10,
      gameMode: "WHO_AM_I",
      categories: ["WHO_AM_I"],
      competitions: ["ALL"],
      region: "WORLD",
    },
  },
];

/** Whether the page can be scrolled vertically at all. */
const overflow = (page) =>
  page.evaluate(() => {
    const el = document.scrollingElement ?? document.documentElement;
    return { scrollHeight: el.scrollHeight, viewport: window.innerHeight };
  });

/** Whether the primary action is inside the viewport right now. */
async function actionVisible(page) {
  const button = page.locator(".wiz-dock .btn-primary");
  if ((await button.count()) === 0) return false;
  const box = await button.first().boundingBox();
  if (!box) return false;
  const height = await page.evaluate(() => window.innerHeight);
  return box.y >= 0 && box.y + box.height <= height + 1;
}

async function stepTitle(page) {
  return (await page.locator("h1.wiz-title").first().innerText()).trim();
}

/** One wizard step: measure it, then advance. */
async function measureStep(page, viewport, flowId, steps) {
  const title = await stepTitle(page);
  const { scrollHeight, viewport: height } = await overflow(page);
  // 8px of tolerance: sub-pixel rounding on a 3x device can report one more
  // pixel of content than the viewport without anything actually scrolling.
  const scrolls = scrollHeight > height + 8;
  const visible = await actionVisible(page);
  steps.push({ title, scrollHeight, height, scrolls, actionVisible: visible });
  return { title, scrolls, visible };
}

async function advance(page) {
  await page.locator(".wiz-dock .btn-primary").first().click();
  await page.waitForTimeout(260);
}

async function runFlow(page, flow, viewport, isMobile) {
  const steps = [];
  let body = null;

  const onRequest = (request) => {
    if (request.method() === "POST" && request.url().includes("/api/quiz") && !request.url().includes("/count")) {
      try {
        body = JSON.parse(request.postData() ?? "null");
      } catch {
        body = null;
      }
    }
  };
  page.on("request", onRequest);

  try {
    await page.goto(`${BASE}/build`, { waitUntil: "domcontentloaded" });
    await page.locator("h1.wiz-title").first().waitFor({ timeout: 20000 });
    await page.waitForTimeout(400);

    // ---- step 1: answer mode
    await measureStep(page, viewport, flow.id, steps);
    await page.locator(".wiz-card", { hasText: flow.answerMode }).first().click();
    await advance(page);

    // ---- step 2: difficulty + count
    await measureStep(page, viewport, flow.id, steps);
    await page.locator(".wiz-pill", { hasText: new RegExp(`^${flow.difficulty}$`) }).first().click();
    await page.locator(".wiz-count", { hasText: new RegExp(`^${flow.count}$`) }).first().click();
    // Availability is debounced; give it a moment so the reading is the real one.
    await page.waitForTimeout(500);
    await advance(page);

    // ---- step 3: scope
    await measureStep(page, viewport, flow.id, steps);
    if (flow.scope.kind === "world") {
      await page.locator(".wiz-card-row", { hasText: "כל העולם" }).first().click();
    } else if (flow.scope.kind === "region") {
      await page.locator(".wiz-card-row", { hasText: "אזור מסוים" }).first().click();
    } else {
      await page.locator(".wiz-chip", { hasText: new RegExp(`^${escapeRe(flow.scope.chip)}$`) }).first().click();
    }
    await advance(page);

    // ---- step 4: the region drill-down, only on that branch
    if (flow.scope.kind === "region") {
      await measureStep(page, viewport, flow.id, steps);
      await page.locator(".wiz-chip", { hasText: new RegExp(`^${flow.scope.continent}$`) }).first().click();
      await page.waitForTimeout(150);
      await page.locator(".wiz-chip", { hasText: new RegExp(`^${flow.scope.country}$`) }).first().click();
      await page.waitForTimeout(150);
      await page.locator(".wiz-chip", { hasText: new RegExp(`^${escapeRe(flow.scope.league)}$`) }).first().click();
      await page.waitForTimeout(400);
      await advance(page);
    }

    // ---- step 5: summary
    const summaryStep = await measureStep(page, viewport, flow.id, steps);
    const summary = await page
      .locator(".wiz-summary-row")
      .evaluateAll((rows) => rows.map((r) => r.innerText.replace(/\s+/g, " ").trim()));

    await page.locator(".wiz-dock .btn-primary").first().click();
    await page.waitForURL(/\/play/, { timeout: 25000 });

    // ---- the assertions that matter: the query, not the screen
    const mismatches = [];
    if (!body) mismatches.push("no quiz request was captured");
    for (const [key, want] of Object.entries(flow.expect)) {
      const got = body?.[key];
      const same = Array.isArray(want)
        ? Array.isArray(got) && want.length === got.length && [...want].sort().every((v, i) => v === [...got].sort()[i])
        : got === want;
      if (!same) mismatches.push(`${key}: expected ${JSON.stringify(want)}, got ${JSON.stringify(got)}`);
    }
    // The builder is not Quick Start. A player who chose EXPERT must get EXPERT.
    if (body?.preset) mismatches.push(`preset must not be set by the builder, got ${body.preset}`);

    record(
      mismatches.length === 0,
      `FLOW ${flow.id} query @ ${viewport}`,
      mismatches.length === 0 ? flow.name : mismatches.join("; ")
    );

    const stepCount = steps.length;
    record(
      flow.scope.kind === "region" ? stepCount === 5 : stepCount === 4,
      `FLOW ${flow.id} steps @ ${viewport}`,
      `${stepCount} step(s): ${steps.map((s) => s.title).join(" → ")}`
    );

    if (isMobile) {
      const scrolling = steps.filter((s) => s.scrolls);
      record(
        scrolling.length === 0,
        `FLOW ${flow.id} no-scroll @ ${viewport}`,
        scrolling.length === 0
          ? "every step fits the viewport"
          : scrolling.map((s) => `${s.title}: ${s.scrollHeight}px in ${s.height}px`).join("; ")
      );
    }

    const hidden = steps.filter((s) => !s.actionVisible);
    record(
      hidden.length === 0,
      `FLOW ${flow.id} action visible @ ${viewport}`,
      hidden.length === 0 ? "the primary action is on screen at every step" : hidden.map((s) => s.title).join("; ")
    );

    if (flow.id === "A") {
      record(
        summary.length === 4,
        `summary is compact @ ${viewport}`,
        `${summary.length} line(s): ${summary.join(" | ")}`
      );
      void summaryStep;
    }
  } finally {
    page.off("request", onRequest);
  }
}

const escapeRe = (value) => value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

// ---------------------------------------------------------------------------
// Back navigation must preserve selections
// ---------------------------------------------------------------------------
async function checkBackNavigation(page, viewport) {
  await page.goto(`${BASE}/build`, { waitUntil: "domcontentloaded" });
  await page.locator("h1.wiz-title").first().waitFor({ timeout: 20000 });
  await page.waitForTimeout(400);

  await page.locator(".wiz-card", { hasText: "אמריקאי" }).first().click();
  await advance(page);
  await page.locator(".wiz-pill", { hasText: /^מומחה$/ }).first().click();
  await page.locator(".wiz-count", { hasText: /^20$/ }).first().click();
  await advance(page);
  await page.locator(".wiz-card-row", { hasText: "אזור מסוים" }).first().click();
  await advance(page);
  await page.locator(".wiz-chip", { hasText: /^אירופה$/ }).first().click();
  await page.waitForTimeout(150);
  await page.locator(".wiz-chip", { hasText: /^איטליה$/ }).first().click();
  await page.waitForTimeout(250);

  // Back three times, to the first step.
  for (let i = 0; i < 3; i++) {
    await page.locator(".wiz-back").click();
    await page.waitForTimeout(220);
  }

  const problems = [];
  if ((await stepTitle(page)) !== "איך משחקים?") problems.push(`landed on "${await stepTitle(page)}"`);
  const modeOn = await page.locator(".wiz-card.is-on").first().innerText();
  if (!modeOn.includes("אמריקאי")) problems.push(`answer mode lost: "${modeOn.replace(/\s+/g, " ")}"`);

  await advance(page);
  const pillOn = (await page.locator(".wiz-pill.is-on").first().innerText()).trim();
  const countOn = (await page.locator(".wiz-count.is-on").first().innerText()).trim();
  if (pillOn !== "מומחה") problems.push(`difficulty lost: "${pillOn}"`);
  if (countOn !== "20") problems.push(`count lost: "${countOn}"`);

  await advance(page);
  await advance(page);
  const chipsOn = await page.locator(".wiz-chip.is-on").evaluateAll((els) => els.map((e) => e.innerText.trim()));
  if (!chipsOn.includes("אירופה")) problems.push(`continent lost: ${chipsOn.join(", ")}`);
  if (!chipsOn.includes("איטליה")) problems.push(`country lost: ${chipsOn.join(", ")}`);

  record(
    problems.length === 0,
    `back navigation preserves selections @ ${viewport}`,
    problems.length === 0 ? "every earlier answer survived" : problems.join("; ")
  );
}

// ---------------------------------------------------------------------------
// Quick Start: never Expert, never Impossible
// ---------------------------------------------------------------------------
async function checkQuickStart(page, viewport) {
  const seen = { byBand: {}, quizzes: 0, expert: 0, impossible: 0, presets: new Set() };

  const onResponse = async (response) => {
    const url = response.url();
    if (!url.includes("/api/quiz") || url.includes("/count")) return;
    if (response.request().method() !== "POST") return;
    try {
      const sent = JSON.parse(response.request().postData() ?? "null");
      if (sent?.preset !== "QUICK_START") return;
      const payload = await response.json();
      seen.quizzes++;
      for (const question of payload.questions ?? []) {
        seen.byBand[question.difficulty] = (seen.byBand[question.difficulty] ?? 0) + 1;
        if (question.difficulty === "EXPERT") seen.expert++;
        if (question.difficulty === "IMPOSSIBLE") seen.impossible++;
      }
    } catch {
      /* a failed body read is not a difficulty violation */
    }
  };
  page.on("response", onResponse);

  try {
    for (let run = 0; run < QUICK_RUNS; run++) {
      await page.goto(BASE, { waitUntil: "domcontentloaded" });
      await page.waitForTimeout(700);
      const presets = page.locator(".quick-btn");
      const count = await presets.count();
      const buttons = count > 0 ? presets : page.locator("main button");
      const total = await buttons.count();
      if (total === 0) break;
      const target = buttons.nth(run % Math.min(total, 4));
      const label = (await target.innerText()).replace(/\s+/g, " ").trim();
      seen.presets.add(label);
      await target.click();
      await page.waitForTimeout(500);
      // A quick preset may open a mode sheet first; take whatever starts a game.
      const sheet = page.locator(".mode-opt");
      if ((await sheet.count()) > 0) {
        await sheet.first().click().catch(() => {});
      }
      await page.waitForURL(/\/play/, { timeout: 20000 }).catch(() => {});
      await page.waitForTimeout(300);
    }
  } finally {
    page.off("response", onResponse);
  }

  record(
    seen.quizzes > 0,
    `Quick Start observed @ ${viewport}`,
    `${seen.quizzes} quiz(zes) from ${[...seen.presets].join(", ") || "no preset"}`
  );
  record(
    seen.expert === 0 && seen.impossible === 0,
    `Quick Start has no Expert or Impossible @ ${viewport}`,
    `bands ${JSON.stringify(seen.byBand)} (expert ${seen.expert}, impossible ${seen.impossible})`
  );
  const bands = Object.keys(seen.byBand);
  record(
    seen.quizzes === 0 || bands.length >= 2,
    `Quick Start mixes difficulties @ ${viewport}`,
    `${bands.length} band(s): ${JSON.stringify(seen.byBand)}`
  );
  return seen;
}

// ---------------------------------------------------------------------------
// Daily Challenge: one or two above HARD, and they come last
// ---------------------------------------------------------------------------
async function checkDaily(page, viewport) {
  const runs = [];
  const onResponse = async (response) => {
    if (!response.url().includes("/api/daily")) return;
    try {
      const payload = await response.json();
      const bands = (payload.quiz?.questions ?? payload.questions ?? []).map((q) => q.difficulty);
      if (bands.length > 0) runs.push(bands);
    } catch {
      /* ignore */
    }
  };
  page.on("response", onResponse);

  try {
    for (let run = 0; run < DAILY_RUNS; run++) {
      await page.goto(`${BASE}/daily`, { waitUntil: "domcontentloaded" });
      await page.waitForTimeout(900);
    }
  } finally {
    page.off("response", onResponse);
  }

  if (runs.length === 0) {
    record(false, `Daily Challenge observed @ ${viewport}`, "no daily payload was captured");
    return runs;
  }

  const ABOVE = new Set(["EXPERT", "IMPOSSIBLE"]);
  const first = runs[0];
  const aboveHard = first.filter((b) => ABOVE.has(b)).length;
  const playable = first.length - aboveHard;

  record(true, `Daily Challenge observed @ ${viewport}`, `${runs.length} load(s), sequence: ${first.join(" → ")}`);
  record(
    aboveHard >= 1 && aboveHard <= 2,
    `Daily Challenge has 1–2 questions above HARD @ ${viewport}`,
    `${aboveHard} above HARD, ${playable} playable`
  );
  const lastTwo = first.slice(-2);
  record(
    aboveHard === 0 || lastTwo.some((b) => ABOVE.has(b)),
    `Daily Challenge saves the hardest for last @ ${viewport}`,
    `closes with ${lastTwo.join(", ")}`
  );
  const identical = runs.every((r) => r.join() === first.join());
  record(identical, `Daily Challenge is stable within the day @ ${viewport}`, `${runs.length} identical load(s)`);
  return runs;
}

// ---------------------------------------------------------------------------
// Desktop layout
// ---------------------------------------------------------------------------
async function checkDesktopLayout(page, viewport) {
  await page.goto(`${BASE}/build`, { waitUntil: "domcontentloaded" });
  await page.locator("h1.wiz-title").first().waitFor({ timeout: 20000 });
  await page.waitForTimeout(400);

  const metrics = await page.evaluate(() => {
    const wiz = document.querySelector(".wiz");
    if (!wiz) return null;
    const box = wiz.getBoundingClientRect();
    const dock = document.querySelector(".wiz-dock");
    return {
      width: Math.round(box.width),
      left: Math.round(box.left),
      right: Math.round(window.innerWidth - box.right),
      viewport: window.innerWidth,
      dockFixed: dock ? getComputedStyle(dock).position : null,
    };
  });

  if (!metrics) {
    record(false, `desktop layout @ ${viewport}`, "the wizard did not render");
    return;
  }

  // A centred, focused column — not a narrow strip beside an empty half-screen.
  const centred = Math.abs(metrics.left - metrics.right) <= 2;
  const bounded = metrics.width <= 620 && metrics.width >= 420;
  record(
    centred && bounded,
    `desktop layout is a centred focused column @ ${viewport}`,
    `width ${metrics.width}px in ${metrics.viewport}px, margins ${metrics.left}/${metrics.right}`
  );
  record(
    metrics.dockFixed === "static",
    `desktop retires the fixed dock @ ${viewport}`,
    `dock position: ${metrics.dockFixed}`
  );
}

// ---------------------------------------------------------------------------
// Drive it
// ---------------------------------------------------------------------------
console.log(`\nFootball IQ builder QA → ${BASE}\n`);

for (const engine of ENGINES) {
  const browser = await launch(engine);
  try {
    for (const profile of MOBILE) {
      console.log(`\n[${engine}] ${profile.label}`);
      const context = await browser.newContext({ ...profile.device, locale: "he-IL" });
      const page = await context.newPage();
      // The privacy gate, dismissed the way a returning visitor has it.
      await page.addInitScript(() => {
        try {
          localStorage.setItem("fiq_privacy_v1", JSON.stringify({ decided: true, preferences: true, history: true }));
        } catch {
          /* private mode */
        }
      });
      try {
        for (const flow of FLOWS) await runFlow(page, flow, profile.label, true);
        await checkBackNavigation(page, profile.label);
        if (profile === MOBILE[0]) {
          await checkQuickStart(page, profile.label);
          await checkDaily(page, profile.label);
        }
      } catch (error) {
        record(false, `${profile.label} crashed`, String(error).slice(0, 300));
      } finally {
        await context.close();
      }
    }

    for (const profile of DESKTOP) {
      console.log(`\n[${engine}] ${profile.label}`);
      const context = await browser.newContext({ ...profile.device, locale: "he-IL" });
      const page = await context.newPage();
      await page.addInitScript(() => {
        try {
          localStorage.setItem("fiq_privacy_v1", JSON.stringify({ decided: true, preferences: true, history: true }));
        } catch {
          /* private mode */
        }
      });
      try {
        await checkDesktopLayout(page, profile.label);
        await runFlow(page, FLOWS[1], profile.label, false);
      } catch (error) {
        record(false, `${profile.label} crashed`, String(error).slice(0, 300));
      } finally {
        await context.close();
      }
    }
  } finally {
    await browser.close();
  }
}

const failed = results.filter((r) => !r.ok);
console.log(`\n${results.length - failed.length}/${results.length} check(s) passed.`);
if (failed.length > 0) {
  console.log(`\nFailures:`);
  for (const f of failed) console.log(`  ${f.area} — ${f.detail}`);
  process.exit(1);
}
console.log("");
