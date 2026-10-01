// Startup reliability harness.
//
// This exists because "the page is sometimes white" is not a bug report you can
// act on — it is a symptom with several possible mechanisms, and the only way to
// tell them apart is to drive each mechanism deliberately and watch what the
// browser does.
//
// Every scenario below answers one question: does the app reach a rendered state,
// and if not, what did the browser say on the way down? The pass/fail signal is
// deliberately crude and honest — `#root` either has content or it does not.
//
// Usage:
//   node scripts/reliability-qa.mjs [baseUrl] [--engine=chromium|webkit|both]
//                                   [--loads=N] [--only=scenario,scenario]

import { chromium, webkit, devices } from "playwright";

const args = process.argv.slice(2);
const BASE = (args.find((a) => !a.startsWith("--")) ?? "https://football-iq.naorl.workers.dev").replace(/\/+$/, "");
const flag = (name, fallback) => {
  const hit = args.find((a) => a.startsWith(`--${name}=`));
  return hit ? hit.slice(name.length + 3) : fallback;
};
const ENGINE = flag("engine", "both");
const LOADS = Number(flag("loads", "100"));
const ONLY = flag("only", "").split(",").filter(Boolean);

const VIEWPORTS = [
  { name: "iphone-390", width: 390, height: 844 },
  { name: "iphone-393", width: 393, height: 852 },
  { name: "iphone-430", width: 430, height: 932 },
  { name: "desktop", width: 1280, height: 800 },
];

// ---------------------------------------------------------------- observation

/**
 * Attaches every error channel a page has to one bucket.
 *
 * Module-script MIME failures are the reason `requestfailed` and `response` are
 * both watched: a script that is answered with HTML does not "fail" at the
 * network layer, it fails at the parse layer, and only the console says so.
 */
function watch(page) {
  const log = { console: [], pageerrors: [], requestfailed: [], badStatus: [], badModuleMime: [] };

  page.on("console", (m) => {
    if (m.type() === "error" || m.type() === "warning") log.console.push(`[${m.type()}] ${m.text()}`);
  });
  page.on("pageerror", (e) => log.pageerrors.push(String(e && e.message ? e.message : e)));
  page.on("requestfailed", (r) => log.requestfailed.push(`${r.method()} ${r.url()} :: ${r.failure()?.errorText}`));
  page.on("response", (r) => {
    const status = r.status();
    const url = r.url();
    if (status >= 400) log.badStatus.push(`${status} ${url}`);
    // The exact production trap: a hashed bundle answered with the SPA shell.
    const type = (r.headers()["content-type"] ?? "").toLowerCase();
    if (/\.(js|mjs)(\?|$)/.test(url) && status === 200 && type.includes("text/html")) {
      log.badModuleMime.push(`${url} -> ${type}`);
    }
  });

  return log;
}

/** Did the app actually draw? Not "did it 200" — did pixels of Football IQ exist. */
async function mounted(page, timeoutMs = 10000) {
  try {
    await page.waitForFunction(
      () => {
        const root = document.getElementById("root");
        return !!root && root.childElementCount > 0 && (root.textContent ?? "").trim().length > 0;
      },
      { timeout: timeoutMs }
    );
    return true;
  } catch {
    return false;
  }
}

/**
 * The weaker, and for some scenarios the only honest, success condition.
 *
 * When the bundle genuinely does not exist there is no way for React to mount,
 * so "did it mount" is the wrong question — the app cannot pass it and should
 * not be asked to. What the visitor is entitled to is a screen that is
 * recognisably Football IQ, says what went wrong, and offers a way out. That is
 * what this checks: real text, a Football IQ background rather than white, and
 * something to press.
 *
 * It is deliberately NOT accepted as success for scenarios where mounting is
 * possible. A recovery screen instead of the product is a failure there.
 */
async function recovered(page, timeoutMs = 12000) {
  try {
    await page.waitForFunction(
      () => {
        const body = document.body;
        if (!body) return false;
        const text = (body.innerText ?? "").trim();
        if (text.length === 0) return false;
        // A button or a link out. Without one it is a dead end with prose on it.
        return !!document.querySelector("button, a[href]");
      },
      { timeout: timeoutMs }
    );
    const painted = await page.evaluate(() => {
      const bg = getComputedStyle(document.body).backgroundColor;
      // Transparent or white is the symptom under investigation.
      return bg !== "rgba(0, 0, 0, 0)" && bg !== "rgb(255, 255, 255)" && bg !== "transparent";
    });
    return painted;
  } catch {
    return false;
  }
}

async function rootReport(page) {
  return page
    .evaluate(() => {
      const root = document.getElementById("root");
      const body = document.body;
      return {
        rootExists: !!root,
        rootChildren: root ? root.childElementCount : -1,
        rootText: root ? (root.textContent ?? "").trim().slice(0, 120) : null,
        bodyText: body ? (body.innerText ?? "").trim().slice(0, 200) : null,
        bodyBg: body ? getComputedStyle(body).backgroundColor : null,
        stage: window.__FIQ_STAGE__ ?? null,
      };
    })
    .catch(() => null);
}

// ------------------------------------------------------------------ scenarios

const results = [];
function record(row) {
  results.push(row);
  const mark = row.ok ? "ok  " : "FAIL";
  const extra = row.note ? ` — ${row.note}` : "";
  console.log(`  ${mark} ${row.scenario} [${row.engine}/${row.viewport}]${extra}`);
}

/** Plain repeated navigation: the baseline nobody should ever fail. */
async function scenarioRepeatedLoads(browser, engine, viewport, loads) {
  const context = await browser.newContext({ viewport: { width: viewport.width, height: viewport.height } });
  let blanks = 0;
  const errors = [];
  for (let i = 0; i < loads; i++) {
    const page = await context.newPage();
    const log = watch(page);
    try {
      await page.goto(`${BASE}/`, { waitUntil: "commit", timeout: 30000 });
      const ok = await mounted(page);
      if (!ok) {
        blanks++;
        errors.push({ i, root: await rootReport(page), log });
      }
      if (log.badModuleMime.length) errors.push({ i, mime: log.badModuleMime });
      if (log.pageerrors.length) errors.push({ i, pageerrors: log.pageerrors });
    } catch (e) {
      blanks++;
      errors.push({ i, threw: String(e).slice(0, 200) });
    }
    await page.close();
  }
  await context.close();
  record({
    scenario: `repeated-loads x${loads}`,
    engine,
    viewport: viewport.name,
    ok: blanks === 0,
    note: `${blanks} blank`,
    detail: errors.slice(0, 5),
  });
}

/** Hard reload, which is a different code path from a fresh navigation. */
async function scenarioHardReloads(browser, engine, viewport, loads) {
  const context = await browser.newContext({ viewport: { width: viewport.width, height: viewport.height } });
  const page = await context.newPage();
  const log = watch(page);
  let blanks = 0;
  await page.goto(`${BASE}/`, { waitUntil: "commit" });
  for (let i = 0; i < loads; i++) {
    await page.reload({ waitUntil: "commit", timeout: 30000 });
    if (!(await mounted(page))) blanks++;
  }
  await page.close();
  await context.close();
  record({
    scenario: `hard-reloads x${loads}`,
    engine,
    viewport: viewport.name,
    ok: blanks === 0,
    note: `${blanks} blank`,
    detail: log.pageerrors.slice(0, 5),
  });
}

/** Deep links, which depend on the SPA fallback returning the shell. */
async function scenarioDeepLinks(browser, engine, viewport) {
  // Twenty loads, not eight: these are the routes that would break if the SPA
  // fallback regressed, and a single pass through them would not catch an
  // intermittent failure, which is the kind this whole harness exists for.
  const routes = ["/build", "/daily", "/multiplayer", "/privacy", "/play", "/results", "/room/482731", "/nope-404"];
  const paths = Array.from({ length: 20 }, (_, i) => routes[i % routes.length]);
  const context = await browser.newContext({ viewport: { width: viewport.width, height: viewport.height } });
  const failures = [];
  for (const path of paths) {
    const page = await context.newPage();
    const log = watch(page);
    await page.goto(`${BASE}${path}`, { waitUntil: "commit", timeout: 30000 }).catch(() => {});
    const ok = await mounted(page);
    if (!ok) failures.push({ path, root: await rootReport(page), pageerrors: log.pageerrors, console: log.console.slice(0, 4) });
    await page.close();
  }
  await context.close();
  record({
    scenario: "deep-links",
    engine,
    viewport: viewport.name,
    ok: failures.length === 0,
    note: `${failures.length}/${paths.length} blank`,
    detail: failures,
  });
}

/**
 * THE STALE DEPLOY. The one that matters.
 *
 * A returning visitor holds an index.html from the previous deployment, so it
 * asks for a bundle hash that no longer exists. This rewrites the shell's script
 * tag to an absent hash to stand in for exactly that, and then watches what the
 * SPA fallback does to a module script.
 */
async function scenarioStaleBundle(browser, engine, viewport) {
  const context = await browser.newContext({ viewport: { width: viewport.width, height: viewport.height } });
  const page = await context.newPage();
  const log = watch(page);

  await page.route(`${BASE}/`, async (route) => {
    const response = await route.fetch();
    const html = await response.text();
    route.fulfill({
      response,
      body: html
        .replace(/\/assets\/index-[A-Za-z0-9_-]+\.js/g, "/assets/index-STALEHASH.js")
        .replace(/\/assets\/index-[A-Za-z0-9_-]+\.css/g, "/assets/index-STALECSS.css"),
      headers: { ...response.headers(), "content-type": "text/html" },
    });
  });

  await page.goto(`${BASE}/`, { waitUntil: "commit", timeout: 30000 }).catch(() => {});

  // Mounting is impossible here by construction — the bundle does not exist —
  // so the bar is the recovery screen, not the product. What must NOT happen is
  // a white page, and what must not happen either is the SPA fallback answering
  // a module request with HTML, which is the mechanism that caused all of this.
  const ok = await recovered(page, 12000);
  const root = await rootReport(page);
  await page.close();
  await context.close();

  const mimeTrap = log.badModuleMime.length > 0;

  record({
    scenario: "stale-bundle (previous deploy's index.html)",
    engine,
    viewport: viewport.name,
    ok: ok && !mimeTrap,
    note: mimeTrap
      ? "SPA fallback answered a module request with text/html"
      : ok
        ? `recovery screen shown: ${(root?.bodyText ?? "").split("\n")[0]}`
        : `white screen; root children=${root?.rootChildren}`,
    detail: { root, badModuleMime: log.badModuleMime, console: log.console.slice(0, 6), badStatus: log.badStatus.slice(0, 4) },
  });
}

/** Garbage in every key the app reads. */
async function scenarioCorruptStorage(browser, engine, viewport) {
  const junk = [
    "{",
    "null",
    "[]",
    '{"decided":"yes"}',
    "undefined",
    '" "',
    '{"quiz":null}',
    '{"quiz":{"questions":null}}',
    "9e999",
  ];
  const keys = [
    "fiq_privacy_v1", "fiq_a11y_v1", "fiq_sound_enabled", "fiq_recent_questions",
    "fiq_mp_name", "fiq_mp_stats",
  ];
  const sessionKeys = ["fiq_active_quiz", "fiq_last_result", "fiq_mp_token"];

  const context = await browser.newContext({ viewport: { width: viewport.width, height: viewport.height } });
  const failures = [];
  for (const value of junk) {
    const page = await context.newPage();
    const log = watch(page);
    await page.addInitScript(
      ([ks, ss, v]) => {
        try { for (const k of ks) localStorage.setItem(k, v); } catch {}
        try { for (const k of ss) sessionStorage.setItem(k, v); } catch {}
      },
      [keys, sessionKeys, value]
    );
    for (const path of ["/", "/play", "/results", "/build"]) {
      await page.goto(`${BASE}${path}`, { waitUntil: "commit", timeout: 30000 }).catch(() => {});
      if (!(await mounted(page, 8000))) {
        failures.push({ value, path, root: await rootReport(page), pageerrors: log.pageerrors.slice(0, 3) });
      }
    }
    await page.close();
  }
  await context.close();
  record({
    scenario: "corrupted-storage",
    engine,
    viewport: viewport.name,
    ok: failures.length === 0,
    note: `${failures.length} blank`,
    detail: failures.slice(0, 6),
  });
}

/**
 * Storage that throws on every access.
 *
 * Safari with "Block all cookies" does exactly this: touching sessionStorage
 * raises SecurityError rather than returning null. Any read that is not wrapped
 * therefore throws inside render, and React 19 unmounts the whole root when a
 * render throws with no boundary above it — which is a white screen, not an
 * error message.
 */
async function scenarioThrowingStorage(browser, engine, viewport) {
  const context = await browser.newContext({ viewport: { width: viewport.width, height: viewport.height } });
  const failures = [];
  for (const path of ["/", "/play", "/results", "/build", "/multiplayer", "/daily"]) {
    const page = await context.newPage();
    const log = watch(page);
    await page.addInitScript(() => {
      const boom = () => {
        throw new DOMException("The operation is insecure.", "SecurityError");
      };
      const hostile = { getItem: boom, setItem: boom, removeItem: boom, clear: boom, key: boom, get length() { return boom(); } };
      try { Object.defineProperty(window, "sessionStorage", { configurable: true, get: () => hostile }); } catch {}
      try { Object.defineProperty(window, "localStorage", { configurable: true, get: () => hostile }); } catch {}
    });
    await page.goto(`${BASE}${path}`, { waitUntil: "commit", timeout: 30000 }).catch(() => {});
    if (!(await mounted(page, 8000))) {
      failures.push({ path, root: await rootReport(page), pageerrors: log.pageerrors.slice(0, 3), console: log.console.slice(0, 3) });
    }
    await page.close();
  }
  await context.close();
  record({
    scenario: "storage-throws (Safari block-all-cookies)",
    engine,
    viewport: viewport.name,
    ok: failures.length === 0,
    note: `${failures.length} blank`,
    detail: failures,
  });
}

/** Every /api call refused. The app should say so, not vanish. */
async function scenarioApiDown(browser, engine, viewport) {
  const context = await browser.newContext({ viewport: { width: viewport.width, height: viewport.height } });
  const failures = [];
  for (const mode of ["abort", "500", "hang"]) {
    for (const path of ["/", "/daily", "/build", "/multiplayer", "/results", "/play", "/privacy"]) {
      const page = await context.newPage();
      const log = watch(page);
      await page.route("**/api/**", async (route) => {
        if (mode === "abort") return route.abort("failed");
        if (mode === "500") return route.fulfill({ status: 500, contentType: "application/json", body: '{"error":"boom"}' });
        await new Promise((r) => setTimeout(r, 25000));
        return route.abort("timedout");
      });
      await page.goto(`${BASE}${path}`, { waitUntil: "commit", timeout: 30000 }).catch(() => {});
      if (!(await mounted(page, 9000))) {
        failures.push({ mode, path, root: await rootReport(page), pageerrors: log.pageerrors.slice(0, 3) });
      }
      await page.close();
    }
  }
  await context.close();
  record({
    scenario: "api-down (abort/500/hang)",
    engine,
    viewport: viewport.name,
    ok: failures.length === 0,
    note: `${failures.length} blank`,
    detail: failures,
  });
}

/** Slow link, then offline→online. */
async function scenarioNetwork(browser, engine, viewport) {
  const context = await browser.newContext({ viewport: { width: viewport.width, height: viewport.height } });
  const failures = [];

  for (let i = 0; i < 20; i++) {
    const page = await context.newPage();
    await page.route("**/*", async (route) => {
      await new Promise((r) => setTimeout(r, 450));
      route.continue();
    });
    await page.goto(`${BASE}/`, { waitUntil: "commit", timeout: 60000 }).catch(() => {});
    if (!(await mounted(page, 20000))) failures.push({ kind: "slow", i, root: await rootReport(page) });
    await page.close();
  }

  const page = await context.newPage();
  await context.setOffline(true);
  await page.goto(`${BASE}/`, { waitUntil: "commit", timeout: 20000 }).catch(() => {});
  await context.setOffline(false);
  await page.goto(`${BASE}/`, { waitUntil: "commit", timeout: 30000 }).catch(() => {});
  if (!(await mounted(page, 12000))) failures.push({ kind: "offline-online", root: await rootReport(page) });
  await page.close();
  await context.close();

  record({
    scenario: "network (slow, offline->online)",
    engine,
    viewport: viewport.name,
    ok: failures.length === 0,
    note: `${failures.length} blank`,
    detail: failures,
  });
}

/** Back/forward and interrupted navigation — the route-transition traps. */
async function scenarioNavigation(browser, engine, viewport) {
  const context = await browser.newContext({ viewport: { width: viewport.width, height: viewport.height } });
  const page = await context.newPage();
  const log = watch(page);
  const failures = [];

  await page.goto(`${BASE}/`, { waitUntil: "commit" });
  await mounted(page);

  for (const path of ["/build", "/daily", "/multiplayer", "/privacy"]) {
    await page.goto(`${BASE}${path}`, { waitUntil: "commit" }).catch(() => {});
    await mounted(page, 8000);
  }
  for (let i = 0; i < 4; i++) {
    await page.goBack({ waitUntil: "commit" }).catch(() => {});
    if (!(await mounted(page, 8000))) failures.push({ kind: "back", i, root: await rootReport(page) });
  }
  for (let i = 0; i < 4; i++) {
    await page.goForward({ waitUntil: "commit" }).catch(() => {});
    if (!(await mounted(page, 8000))) failures.push({ kind: "forward", i, root: await rootReport(page) });
  }

  // Interrupt a navigation mid-flight, then land somewhere real.
  for (let i = 0; i < 5; i++) {
    page.goto(`${BASE}/build`, { waitUntil: "commit" }).catch(() => {});
    await page.waitForTimeout(40 + i * 25);
    await page.goto(`${BASE}/`, { waitUntil: "commit" }).catch(() => {});
    if (!(await mounted(page, 8000))) failures.push({ kind: "interrupted", i, root: await rootReport(page) });
  }

  // Nothing may be left invisible by a transition.
  const invisible = await page.evaluate(() => {
    const main = document.querySelector("main");
    if (!main) return "no main";
    const s = getComputedStyle(main);
    return s.opacity === "0" || s.visibility === "hidden" || s.display === "none"
      ? `main opacity=${s.opacity} visibility=${s.visibility} display=${s.display}`
      : null;
  });
  if (invisible) failures.push({ kind: "stuck-invisible", invisible });

  await page.close();
  await context.close();
  record({
    scenario: "navigation (back/forward/interrupted)",
    engine,
    viewport: viewport.name,
    ok: failures.length === 0,
    note: `${failures.length} problems`,
    detail: { failures, pageerrors: log.pageerrors.slice(0, 5) },
  });
}

/** No JavaScript at all: the floor below which there is nothing to fall back to. */
async function scenarioNoJs(browser, engine, viewport) {
  const context = await browser.newContext({
    viewport: { width: viewport.width, height: viewport.height },
    javaScriptEnabled: false,
  });
  const page = await context.newPage();
  await page.goto(`${BASE}/`, { waitUntil: "commit", timeout: 30000 }).catch(() => {});
  await page.waitForTimeout(1200);
  const seen = await page
    .evaluate(() => ({
      text: (document.body.innerText ?? "").trim().slice(0, 160),
      bg: getComputedStyle(document.body).backgroundColor,
    }))
    .catch(() => null);
  await page.close();
  await context.close();
  // With no JavaScript at all there is no app, and there is no pretending
  // otherwise. The requirement is only that the visitor is not shown a blank
  // white rectangle — the shell's markup and its inline CSS are both inert HTML
  // and must still be there.
  const ok = !!seen && seen.text.length > 0 && seen.bg !== "rgba(0, 0, 0, 0)" && seen.bg !== "rgb(255, 255, 255)";
  record({
    scenario: "no-javascript",
    engine,
    viewport: viewport.name,
    ok,
    note: ok ? `shows: ${seen.text.slice(0, 50)}` : `blank body (bg ${seen?.bg})`,
    detail: seen,
  });
}

// ----------------------------------------------------------------------- main

const SCENARIOS = {
  "stale-bundle": scenarioStaleBundle,
  "storage-throws": scenarioThrowingStorage,
  "no-javascript": scenarioNoJs,
  "corrupted-storage": scenarioCorruptStorage,
  "api-down": scenarioApiDown,
  "deep-links": scenarioDeepLinks,
  navigation: scenarioNavigation,
  network: scenarioNetwork,
};

async function run(engineName, launcher) {
  // Driven through installed system browsers rather than Playwright's pinned
  // downloads: this machine cannot reach the download host, and the mechanisms
  // under test here (module-script MIME enforcement, storage exceptions, React
  // unmount-on-throw) are engine-level behaviour that a real Chrome exercises
  // just as well as a pinned build. WebKit could not be installed at all, which
  // is stated in the report rather than papered over.
  const channel = { chromium: "chrome", msedge: "msedge" }[engineName];
  const browser = await launcher.launch(channel ? { channel } : {});
  console.log(`\n=== ${engineName} @ ${BASE} ===`);

  const quick = VIEWPORTS[0];
  for (const [name, fn] of Object.entries(SCENARIOS)) {
    if (ONLY.length && !ONLY.includes(name)) continue;
    await fn(browser, engineName, quick);
  }

  if (!ONLY.length || ONLY.includes("repeated-loads")) {
    for (const viewport of VIEWPORTS) {
      const n = viewport.name === "iphone-390" ? LOADS : Math.max(10, Math.round(LOADS / 5));
      await scenarioRepeatedLoads(browser, engineName, viewport, n);
    }
    await scenarioHardReloads(browser, engineName, quick, Math.max(10, Math.round(LOADS / 2)));
  }

  await browser.close();
}

if (ENGINE === "chromium" || ENGINE === "both") await run("chromium", chromium);
if (ENGINE === "webkit" || ENGINE === "both") await run("webkit", webkit);

const failed = results.filter((r) => !r.ok);
console.log(`\n======== ${results.length - failed.length}/${results.length} passed ========`);
for (const f of failed) {
  console.log(`\nFAIL ${f.scenario} [${f.engine}/${f.viewport}] — ${f.note}`);
  console.log(JSON.stringify(f.detail, null, 2).slice(0, 2600));
}
process.exit(failed.length ? 1 : 0);
