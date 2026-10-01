// The mobile matrix.
//
// WHY THIS EXISTS WHEN THREE HARNESSES ALREADY DO. Every earlier harness asked
// "is the headline in the DOM?". The symptom now reported is a DARK screen with
// no content and no recovery — and a dark screen is not the same failure as a
// white one. White meant the stylesheet never arrived. Dark means the stylesheet
// DID arrive and painted the background, so the app's own CSS is running and the
// content is either gone or invisible.
//
// "Invisible" is the case nothing here could see. The collapse watchdog in
// index.html fires on an EMPTY #root; content that is present but covered by an
// opaque overlay, or collapsed to zero height, leaves #root full and the
// watchdog silent. That is precisely "dark screen, no content, no recovery".
//
// So the central diagnostic in this file is not presence, it is VISIBILITY:
//
//   hit testing        elementFromPoint at nine points across the viewport. If
//                      the headline is in the DOM but something else answers at
//                      its own centre, it is covered, and the thing covering it
//                      is named.
//   overlay scan       every element whose box covers most of the viewport, with
//                      its opacity, background and z-index, so a full-screen
//                      curtain is reported rather than inferred.
//   geometry           the headline's rect, so zero-height and off-screen are
//                      distinguishable from hidden.
//
// Every failure captures a screenshot, the DOM, the console, the startup stage
// and the mount ledger, because an intermittent bug that is not captured when it
// happens has to be caught again.
//
// Usage:
//   node scripts/mobile-matrix-qa.mjs [baseUrl] [--phase=matrix|volume|long|conditions|all]
//        [--loads=100] [--hold=15] [--parallel=4] [--engines=webkit,chromium]

import { chromium, webkit, devices } from "playwright";
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";

const args = process.argv.slice(2);
const BASE = (args.find((a) => !a.startsWith("--")) ?? "https://football-iq.naorl.workers.dev").replace(/\/+$/, "");
const flag = (name, fallback) => {
  const hit = args.find((a) => a.startsWith(`--${name}=`));
  return hit ? hit.slice(name.length + 3) : fallback;
};
const PHASE = flag("phase", "all");
const LOADS = Number(flag("loads", "100"));
const HOLD_MS = Number(flag("hold", "15")) * 1000;
const PARALLEL = Number(flag("parallel", "4"));
const ENGINES = flag("engines", "webkit,chromium").split(",").filter(Boolean);
const OUT = flag("out", join(process.env.TEMP ?? ".", "fiq-mobile-failures"));

mkdirSync(OUT, { recursive: true });

let passed = 0;
const failures = [];
let captured = 0;

function check(name, condition, detail = "") {
  if (condition) {
    passed++;
    console.log(`  ok   ${name}`);
  } else {
    failures.push({ name, detail });
    console.log(`  FAIL ${name}${detail ? ` — ${detail}` : ""}`);
  }
}
const section = (t) => console.log(`\n=============== ${t} ===============`);

// ------------------------------------------------------------------ devices

/**
 * Real device descriptors where Playwright has them, so the user agent, DPR,
 * touch flags and viewport all match the hardware rather than just the size.
 *
 * WebKit gets the iPhones and the iPad — that pairing is the whole point, since
 * the reported failures are on iOS. Chromium gets the Androids. Each profile
 * says which engines it is meaningful on rather than running every combination,
 * because an "iPhone 15" on Blink is not an iPhone 15.
 */
function profiles() {
  const pick = (name) => devices[name];
  const list = [
    { label: "iPhone SE", engines: ["webkit"], device: pick("iPhone SE") ?? { viewport: { width: 375, height: 667 }, isMobile: true, hasTouch: true, deviceScaleFactor: 2 } },
    { label: "iPhone 14", engines: ["webkit"], device: pick("iPhone 14") ?? pick("iPhone 13") ?? { viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true, deviceScaleFactor: 3 } },
    { label: "iPhone 15 Pro", engines: ["webkit", "chromium"], device: pick("iPhone 15 Pro") ?? { viewport: { width: 393, height: 852 }, isMobile: true, hasTouch: true, deviceScaleFactor: 3 } },
    { label: "iPhone 15 Pro Max", engines: ["webkit"], device: pick("iPhone 15 Pro Max") ?? { viewport: { width: 430, height: 932 }, isMobile: true, hasTouch: true, deviceScaleFactor: 3 } },
    { label: "Android small", engines: ["chromium"], device: pick("Galaxy S9+") ?? { viewport: { width: 320, height: 658 }, isMobile: true, hasTouch: true, deviceScaleFactor: 3 } },
    { label: "Android large", engines: ["chromium"], device: pick("Pixel 7") ?? pick("Pixel 5") ?? { viewport: { width: 412, height: 915 }, isMobile: true, hasTouch: true, deviceScaleFactor: 2.6 } },
    { label: "iPad", engines: ["webkit"], device: pick("iPad (gen 7)") ?? pick("iPad Mini") ?? { viewport: { width: 810, height: 1080 }, isMobile: true, hasTouch: true, deviceScaleFactor: 2 } },
    { label: "desktop", engines: ["chromium", "webkit"], device: { viewport: { width: 1280, height: 800 } } },
  ];
  return list;
}

/** Instagram's iOS in-app webview, which is where this was first seen. */
const INSTAGRAM_UA =
  "Mozilla/5.0 (iPhone; CPU iPhone OS 17_5_1 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) " +
  "Mobile/15E148 Instagram 334.0.0.25.94 (iPhone15,2; iOS 17_5_1; en_US; en; scale=3.00; 1179x2556; 614318767)";

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

// ------------------------------------------------------------------- probe

/**
 * Injected before any bundle. Records mounts, requests, sockets and errors.
 *
 * Mount counting works by tagging each component's root element: React cannot
 * reuse a destroyed node, so a new tag means a genuine remount.
 */
const PROBE = () => {
  const started = Date.now();
  const since = () => Date.now() - started;
  const data = { mounts: {}, requests: {}, sockets: [], errors: [], animations: {}, longTasks: [] };
  window.__FIQ_PROBE__ = data;

  window.addEventListener("error", (e) => {
    if (e.target && e.target !== window) {
      data.errors.push({ at: since(), kind: "asset", message: String(e.target.src || e.target.href || "").slice(0, 160) });
      return;
    }
    data.errors.push({ at: since(), kind: "error", message: String(e.message ?? "").slice(0, 200) });
  }, true);
  window.addEventListener("unhandledrejection", (e) => {
    const r = e.reason;
    data.errors.push({ at: since(), kind: "rejection", message: String((r && r.message) || r || "").slice(0, 200) });
  });

  let tag = 0;
  window.addEventListener("animationstart", (e) => {
    const t = e.target;
    if (!t || !t.tagName) return;
    if (!t.__fiqA) { tag++; t.__fiqA = tag; }
    const k = `${t.__fiqA}:${e.animationName}`;
    data.animations[k] = (data.animations[k] ?? 0) + 1;
  }, true);

  const note = (u) => { try { data.requests[new URL(u, location.href).pathname] = (data.requests[new URL(u, location.href).pathname] ?? 0) + 1; } catch {} };
  const rf = window.fetch;
  window.fetch = function (i, n) { note(typeof i === "string" ? i : (i && i.url) || ""); return rf.call(this, i, n); };
  const ro = XMLHttpRequest.prototype.open;
  XMLHttpRequest.prototype.open = function (m, u, ...r) { note(String(u)); return ro.call(this, m, u, ...r); };

  const RWS = window.WebSocket;
  window.WebSocket = function (u, p) { data.sockets.push({ at: since(), url: String(u).slice(0, 140) }); return new RWS(u, p); };
  window.WebSocket.prototype = RWS.prototype;
  for (const k of ["CONNECTING", "OPEN", "CLOSING", "CLOSED"]) window.WebSocket[k] = RWS[k];

  // Long tasks block the main thread, which on a phone is what a frozen
  // startup looks like. PerformanceObserver and the longtask type are both
  // feature-detected, because neither exists everywhere.
  try {
    if (typeof PerformanceObserver === "function") {
      const supported = PerformanceObserver.supportedEntryTypes;
      if (!supported || supported.indexOf("longtask") !== -1) {
        new PerformanceObserver((list) => {
          for (const entry of list.getEntries()) {
            if (data.longTasks.length < 60) data.longTasks.push({ at: Math.round(entry.startTime), ms: Math.round(entry.duration) });
          }
        }).observe({ entryTypes: ["longtask"] });
      }
    }
  } catch {
    /* no long-task reporting on this engine */
  }

  const SEL = { App: ".app-main", Home: ".home", Header: ".topbar", Hero: ".hero", Footer: ".foot", PrivacyGate: ".pv-bar" };
  let mseq = 0;
  window.__FIQ_MOUNTS__ = () => {
    for (const [name, sel] of Object.entries(SEL)) {
      const n = document.querySelector(sel);
      if (!n) continue;
      if (!n.__fiqM) { mseq++; n.__fiqM = mseq; data.mounts[name] = (data.mounts[name] ?? 0) + 1; }
    }
    return data.mounts;
  };

  /**
   * THE VISIBILITY VERDICT.
   *
   * Presence is not visibility, and this bug is about the gap between them.
   * Three independent signals, so a disagreement is itself informative:
   * computed style, geometry, and hit testing.
   */
  window.__FIQ_VISIBLE__ = () => {
    const describe = (node) => {
      if (!node) return null;
      const s = getComputedStyle(node);
      const r = node.getBoundingClientRect();
      return {
        opacity: s.opacity, visibility: s.visibility, display: s.display,
        w: Math.round(r.width), h: Math.round(r.height),
        top: Math.round(r.top), left: Math.round(r.left),
        onScreen: r.bottom > 0 && r.top < innerHeight && r.right > 0 && r.left < innerWidth,
        // Does the element answer at its own centre, or is something on top?
        hitSelf: (() => {
          if (r.width === 0 || r.height === 0) return false;
          const x = Math.min(innerWidth - 1, Math.max(0, r.left + r.width / 2));
          const y = Math.min(innerHeight - 1, Math.max(0, r.top + r.height / 2));
          const hit = document.elementFromPoint(x, y);
          return !!hit && (hit === node || node.contains(hit) || hit.contains(node));
        })(),
      };
    };

    // What is actually on top, across the viewport.
    const grid = [];
    for (const fx of [0.15, 0.5, 0.85]) {
      for (const fy of [0.15, 0.5, 0.85]) {
        const el = document.elementFromPoint(Math.round(innerWidth * fx), Math.round(innerHeight * fy));
        grid.push(el ? `${el.tagName.toLowerCase()}.${(typeof el.className === "string" ? el.className : "").split(" ")[0]}` : "null");
      }
    }

    // Anything big enough and solid enough to be a curtain.
    const curtains = [];
    for (const el of document.querySelectorAll("body *")) {
      const s = getComputedStyle(el);
      if (s.position !== "fixed" && s.position !== "absolute" && s.position !== "sticky") continue;
      const r = el.getBoundingClientRect();
      const coverage = (r.width * r.height) / (innerWidth * innerHeight);
      if (coverage < 0.6) continue;
      const bg = s.backgroundColor;
      const transparent = bg === "rgba(0, 0, 0, 0)" || bg === "transparent";
      if (transparent && Number(s.opacity) === 0) continue;
      curtains.push({
        cls: (typeof el.className === "string" ? el.className : "").slice(0, 48),
        pos: s.position, z: s.zIndex, opacity: s.opacity, bg,
        coverage: Number(coverage.toFixed(2)),
        pointerEvents: s.pointerEvents,
        hidden: el.hasAttribute("hidden"),
      });
    }

    const root = document.getElementById("root");
    return {
      stage: window.__FIQ_STAGE__ ?? null,
      timeline: (window.__FIQ_TIMELINE__ ?? []).map((r) => r.stage),
      rootChildren: root ? root.childElementCount : -1,
      rootText: root ? (root.textContent ?? "").trim().length : -1,
      bodyBg: getComputedStyle(document.body).backgroundColor,
      htmlBg: getComputedStyle(document.documentElement).backgroundColor,
      title: describe(document.querySelector("h1.home-title")),
      cta: describe(document.querySelector(".home-cta")),
      header: describe(document.querySelector(".topbar")),
      hero: describe(document.querySelector(".hero")),
      main: describe(document.querySelector(".app-main")),
      boot: (() => { const b = document.getElementById("boot"); return b ? { hidden: b.hasAttribute("hidden"), ...describe(b) } : null; })(),
      recovery: !!document.querySelector(".boot-recover"),
      hitGrid: grid,
      curtains,
      viewport: { w: innerWidth, h: innerHeight, dvh: getComputedStyle(document.documentElement).getPropertyValue("--dock-offset") },
    };
  };
};

/**
 * The verdict for one held load.
 *
 * "Usable" means a visitor can see and press Football IQ. The headline must be
 * present, not transparent, not zero-height, on screen, AND answering at its own
 * centre — the last one is what catches a curtain.
 */
function verdict(v) {
  if (!v) return { ok: false, why: "page could not be evaluated" };
  if (v.recovery) return { ok: false, why: "error boundary is showing instead of the app" };
  if (!v.title) return { ok: false, why: `headline absent (rootChildren=${v.rootChildren}, rootText=${v.rootText})` };
  if (v.title.opacity === "0") return { ok: false, why: "headline opacity 0" };
  if (v.title.visibility === "hidden") return { ok: false, why: "headline visibility hidden" };
  if (v.title.display === "none") return { ok: false, why: "headline display none" };
  if (v.title.h === 0) return { ok: false, why: "headline has zero height" };
  if (!v.title.onScreen) return { ok: false, why: `headline off screen (top=${v.title.top})` };
  if (!v.title.hitSelf) {
    const top = v.curtains.filter((c) => !c.hidden).map((c) => `${c.cls}(z${c.z},op${c.opacity},${c.bg})`);
    return { ok: false, why: `headline is COVERED. curtains: ${top.join(", ") || "none found"}; hits: ${v.hitGrid.join(",")}` };
  }
  if (!v.cta) return { ok: false, why: "primary CTA absent" };
  if (!v.cta.hitSelf) return { ok: false, why: "primary CTA is covered" };
  if (!v.header) return { ok: false, why: "header absent" };
  if (v.boot && v.boot.hidden === false && !v.recovery) {
    return { ok: false, why: `boot overlay is visible over the app (bg ${v.boot.bg ?? "?"})` };
  }
  return { ok: true };
}

/** Everything needed to understand a failure without reproducing it again. */
async function capture(page, label, why, extra = {}) {
  captured++;
  const id = `${String(captured).padStart(3, "0")}-${label.replace(/[^a-z0-9]+/gi, "-")}`;
  try {
    await page.screenshot({ path: join(OUT, `${id}.png`), fullPage: false });
  } catch {
    /* a page that cannot be screenshotted is itself a data point */
  }
  try {
    const dump = {
      why,
      url: page.url(),
      at: new Date().toISOString(),
      visibility: await page.evaluate(() => window.__FIQ_VISIBLE__?.() ?? null).catch(() => null),
      probe: await page.evaluate(() => window.__FIQ_PROBE__ ?? null).catch(() => null),
      html: await page.content().catch(() => null),
      ...extra,
    };
    writeFileSync(join(OUT, `${id}.json`), JSON.stringify(dump, null, 1));
  } catch {
    /* ignore */
  }
  return id;
}

/**
 * One load, held, then judged.
 *
 * `hold` is the whole point: the reported failure appears after the page has
 * started rendering, so a check at first paint cannot see it.
 */
async function heldLoad(context, { hold = HOLD_MS, label = "load", prepare, during, path = "/" } = {}) {
  const page = await context.newPage();
  const consoleErrors = [];
  const netFailures = [];
  page.on("pageerror", (e) => consoleErrors.push(`pageerror: ${e.message}`));
  page.on("console", (m) => {
    if (m.type() === "error") consoleErrors.push(`console: ${m.text()}`);
  });
  page.on("requestfailed", (r) => netFailures.push(`${r.url().slice(-70)} :: ${r.failure()?.errorText}`));

  await page.addInitScript(PROBE);
  if (prepare) await prepare(page);

  let appeared = false;
  try {
    await page.goto(`${BASE}${path}`, { waitUntil: "commit", timeout: 45000 });
    appeared = await page
      .waitForFunction(() => !!document.querySelector("h1.home-title, .boot-recover, #boot:not([hidden])"), { timeout: 25000 })
      .then(() => true)
      .catch(() => false);
  } catch {
    appeared = false;
  }

  if (during) await during(page);
  await page.waitForTimeout(hold);

  await page.evaluate(() => window.__FIQ_MOUNTS__?.()).catch(() => {});
  const visibility = await page.evaluate(() => window.__FIQ_VISIBLE__?.() ?? null).catch(() => null);
  const probe = await page.evaluate(() => window.__FIQ_PROBE__ ?? null).catch(() => null);

  const v = verdict(visibility);
  const result = { ok: v.ok && appeared, why: v.ok ? (appeared ? "" : "nothing ever appeared") : v.why, visibility, probe, consoleErrors, netFailures };

  if (!result.ok) {
    result.capture = await capture(page, label, result.why, { consoleErrors, netFailures });
  }

  await page.close();
  return result;
}

/** Runs n held loads with bounded parallelism, and summarises. */
async function heldLoads(context, n, options = {}) {
  const results = [];
  const queue = Array.from({ length: n }, (_, i) => i);
  const parallel = Math.max(1, Math.min(PARALLEL, n));

  async function worker() {
    for (;;) {
      const i = queue.shift();
      if (i === undefined) return;
      results.push(await heldLoad(context, { ...options, label: `${options.label ?? "load"}-${i}` }));
    }
  }
  await Promise.all(Array.from({ length: parallel }, worker));

  const bad = results.filter((r) => !r.ok);
  const remounts = results.filter((r) => Object.values(r.probe?.mounts ?? {}).some((c) => c > 1));
  const replays = results.filter((r) => Object.values(r.probe?.animations ?? {}).some((c) => c > 3));
  const errored = results.filter((r) => (r.probe?.errors ?? []).length > 0 || r.consoleErrors.length > 0);
  const sockets = results.filter((r) => (r.probe?.sockets ?? []).length > 0);
  const chatty = results.filter((r) => Object.entries(r.probe?.requests ?? {}).some(([p, c]) => p.startsWith("/api/") && c > 3));

  return { results, bad, remounts, replays, errored, sockets, chatty };
}

function summarise(label, outcome, total) {
  const { bad, remounts, replays, errored, sockets, chatty } = outcome;
  check(`${label}: no dark/blank/covered screen in ${total} held loads`, bad.length === 0,
    `${bad.length} failed — ${[...new Set(bad.map((b) => b.why))].slice(0, 3).join(" | ")}`);
  check(`${label}: no component remounted`, remounts.length === 0,
    remounts.length ? JSON.stringify(remounts[0].probe?.mounts) : "");
  check(`${label}: no entrance animation replayed`, replays.length === 0, `${replays.length} runs`);
  check(`${label}: no uncaught errors`, errored.length === 0,
    errored.length ? JSON.stringify(errored[0].consoleErrors.slice(0, 2)) : "");
  check(`${label}: home opened no WebSocket`, sockets.length === 0,
    sockets.length ? JSON.stringify(sockets[0].probe?.sockets) : "");
  check(`${label}: no API request loop`, chatty.length === 0,
    chatty.length ? JSON.stringify(chatty[0].probe?.requests) : "");

  const longTasks = outcome.results.flatMap((r) => r.probe?.longTasks ?? []);
  const worst = longTasks.length ? Math.max(...longTasks.map((t) => t.ms)) : 0;
  if (longTasks.length) {
    console.log(`       long tasks: ${longTasks.length} total, worst ${worst}ms`);
  }
  check(`${label}: no main-thread task over 1.5s`, worst < 1500, `worst long task ${worst}ms`);
}

// =========================================================== phase: matrix

async function phaseMatrix() {
  section(`device matrix — every profile, ${Math.max(6, Math.round(LOADS / 10))} held loads each`);
  const per = Math.max(6, Math.round(LOADS / 10));

  for (const engine of ENGINES) {
    const browser = await launch(engine);
    for (const profile of profiles()) {
      if (!profile.engines.includes(engine)) continue;
      const context = await browser.newContext({ ...profile.device, locale: "he-IL" });
      const outcome = await heldLoads(context, per, { label: `${engine}-${profile.label}` });
      summarise(`${engine} / ${profile.label}`, outcome, per);
      await context.close();
    }
    await browser.close();
  }
}

// =========================================================== phase: volume

async function phaseVolume() {
  section(`volume — ${LOADS} held loads per engine on the primary phone profile`);

  for (const engine of ENGINES) {
    const browser = await launch(engine);
    const profile = profiles().find((p) => p.label === "iPhone 15 Pro");
    const context = await browser.newContext({
      ...(engine === "webkit" ? profile.device : { ...profile.device, userAgent: INSTAGRAM_UA }),
      locale: "he-IL",
    });
    const outcome = await heldLoads(context, LOADS, { label: `${engine}-volume` });
    summarise(`${engine} / ${LOADS} loads`, outcome, LOADS);
    await context.close();

    // Hard reloads, which take a different path from a fresh navigation.
    const reloadContext = await browser.newContext({ ...profile.device, locale: "he-IL" });
    const page = await reloadContext.newPage();
    await page.addInitScript(PROBE);
    await page.goto(`${BASE}/`, { waitUntil: "commit", timeout: 45000 });
    let badReloads = 0;
    const half = Math.max(10, Math.round(LOADS / 2));
    for (let i = 0; i < half; i++) {
      await page.reload({ waitUntil: "commit", timeout: 45000 }).catch(() => {});
      await page.waitForFunction(() => !!document.querySelector("h1.home-title"), { timeout: 20000 }).catch(() => {});
      await page.waitForTimeout(400);
      const v = await page.evaluate(() => window.__FIQ_VISIBLE__?.() ?? null).catch(() => null);
      const r = verdict(v);
      if (!r.ok) {
        badReloads++;
        await capture(page, `${engine}-hardreload-${i}`, r.why);
      }
    }
    check(`${engine}: ${half} hard reloads stay usable`, badReloads === 0, `${badReloads} failed`);
    await page.close();
    await reloadContext.close();
    await browser.close();
  }
}

// ============================================================= phase: long

async function phaseLong() {
  const runs = Number(flag("long-runs", "30"));
  section(`long stability — ${runs} sessions of 60 seconds`);

  for (const engine of ENGINES) {
    const browser = await launch(engine);
    const profile = profiles().find((p) => p.label === "iPhone 15 Pro");
    const context = await browser.newContext({ ...profile.device, locale: "he-IL" });
    const per = Math.max(1, Math.round(runs / ENGINES.length));
    const outcome = await heldLoads(context, per, { hold: 60000, label: `${engine}-60s` });
    summarise(`${engine} / 60s sessions`, outcome, per);
    await context.close();
    await browser.close();
  }
}

// ======================================================= phase: conditions

async function phaseConditions() {
  section("conditions — network, lifecycle, storage, failures");

  for (const engine of ENGINES) {
    const browser = await launch(engine);
    const profile = profiles().find((p) => p.label === "iPhone 15 Pro");
    const base = { ...profile.device, locale: "he-IL" };

    // ---------- network
    const networks = [
      { label: "slow 4G", delay: 300 },
      { label: "3G-like", delay: 700 },
      { label: "high latency", delay: 1500 },
    ];
    for (const net of networks) {
      const context = await browser.newContext(base);
      const r = await heldLoad(context, {
        hold: 8000,
        label: `${engine}-${net.label}`,
        prepare: async (page) => {
          await page.route("**/*", async (route) => {
            await new Promise((res) => setTimeout(res, net.delay));
            route.continue().catch(() => {});
          });
        },
      });
      check(`${engine}: usable on ${net.label}`, r.ok, r.why);
      await context.close();
    }

    // Packet loss: a fraction of requests simply aborted.
    {
      const context = await browser.newContext(base);
      const r = await heldLoad(context, {
        hold: 8000,
        label: `${engine}-packet-loss`,
        prepare: async (page) => {
          let n = 0;
          await page.route("**/*", (route) => {
            n++;
            // Never drop the document or the bundles — losing those is the
            // stale-asset case, which has its own test. This is about optional
            // traffic and retries.
            const url = route.request().url();
            const essential = url.endsWith("/") || /\/assets\//.test(url);
            if (!essential && n % 3 === 0) return route.abort("connectionfailed");
            route.continue().catch(() => {});
          });
        },
      });
      check(`${engine}: usable with one in three non-essential requests lost`, r.ok, r.why);
      await context.close();
    }

    // Offline windows, then back.
    for (const seconds of [2, 5]) {
      const context = await browser.newContext(base);
      const page = await context.newPage();
      await page.addInitScript(PROBE);
      await page.goto(`${BASE}/`, { waitUntil: "commit", timeout: 45000 }).catch(() => {});
      await page.waitForFunction(() => !!document.querySelector("h1.home-title"), { timeout: 25000 }).catch(() => {});
      await context.setOffline(true);
      await page.waitForTimeout(seconds * 1000);
      await context.setOffline(false);
      await page.waitForTimeout(4000);
      const v = await page.evaluate(() => window.__FIQ_VISIBLE__?.() ?? null).catch(() => null);
      const r = verdict(v);
      if (!r.ok) await capture(page, `${engine}-offline-${seconds}s`, r.why);
      check(`${engine}: survives ${seconds}s offline then online`, r.ok, r.why);
      await page.close();
      await context.close();
    }

    // ---------- iOS lifecycle: the toolbar, backgrounding, BFCache, history
    {
      const context = await browser.newContext(base);
      const r = await heldLoad(context, {
        hold: 6000,
        label: `${engine}-lifecycle`,
        during: async (page) => {
          // Dynamic toolbar resizing.
          for (const h of [852, 745, 852, 700, 852]) {
            await page.setViewportSize({ width: 393, height: h }).catch(() => {});
            await page.waitForTimeout(350);
          }
          // Orientation.
          await page.setViewportSize({ width: 852, height: 393 }).catch(() => {});
          await page.waitForTimeout(500);
          await page.setViewportSize({ width: 393, height: 852 }).catch(() => {});
          // Background and resume, twice, with the real lifecycle events.
          for (let i = 0; i < 2; i++) {
            await page.evaluate(() => {
              try { Object.defineProperty(document, "visibilityState", { configurable: true, get: () => "hidden" }); } catch {}
              document.dispatchEvent(new Event("visibilitychange"));
              window.dispatchEvent(new Event("blur"));
              window.dispatchEvent(new PageTransitionEvent("pagehide", { persisted: true }));
            }).catch(() => {});
            await page.waitForTimeout(600);
            await page.evaluate(() => {
              try { Object.defineProperty(document, "visibilityState", { configurable: true, get: () => "visible" }); } catch {}
              document.dispatchEvent(new Event("visibilitychange"));
              window.dispatchEvent(new Event("focus"));
              window.dispatchEvent(new PageTransitionEvent("pageshow", { persisted: true }));
            }).catch(() => {});
            await page.waitForTimeout(600);
          }
        },
      });
      check(`${engine}: survives toolbar resize, orientation and background/resume`, r.ok, r.why);
      await context.close();
    }

    // BFCache: navigate away to another document and come back.
    {
      const context = await browser.newContext(base);
      const page = await context.newPage();
      await page.addInitScript(PROBE);
      await page.goto(`${BASE}/`, { waitUntil: "commit", timeout: 45000 }).catch(() => {});
      await page.waitForFunction(() => !!document.querySelector("h1.home-title"), { timeout: 25000 }).catch(() => {});
      await page.goto(`${BASE}/privacy`, { waitUntil: "commit", timeout: 45000 }).catch(() => {});
      await page.waitForTimeout(800);
      await page.goBack({ waitUntil: "commit", timeout: 30000 }).catch(() => {});
      await page.waitForTimeout(3000);
      let v = await page.evaluate(() => window.__FIQ_VISIBLE__?.() ?? null).catch(() => null);
      let r = verdict(v);
      if (!r.ok) await capture(page, `${engine}-bfcache-back`, r.why);
      check(`${engine}: back from a real navigation restores the app`, r.ok, r.why);

      await page.goForward({ waitUntil: "commit", timeout: 30000 }).catch(() => {});
      await page.waitForTimeout(2000);
      await page.goBack({ waitUntil: "commit", timeout: 30000 }).catch(() => {});
      await page.waitForTimeout(3000);
      v = await page.evaluate(() => window.__FIQ_VISIBLE__?.() ?? null).catch(() => null);
      r = verdict(v);
      if (!r.ok) await capture(page, `${engine}-bfcache-fwdback`, r.why);
      check(`${engine}: forward then back restores the app`, r.ok, r.why);
      await page.close();
      await context.close();
    }

    // ---------- storage fuzz
    {
      const KEYS = ["fiq_privacy_v1", "fiq_a11y_v1", "fiq_sound_enabled", "fiq_recent_questions", "fiq_mp_name", "fiq_mp_stats"];
      const SESSION = ["fiq_active_quiz", "fiq_last_result", "fiq_mp_token", "fiq_boot_reloaded"];
      const JUNK = [
        "", "null", "undefined", "{", "[]", "{}", "0", "false", '"str"', "9e999", "NaN",
        '{"decided":"yes"}', '{"quiz":null}', '{"quiz":{"questions":[{}]}}',
        '{"textScale":"huge"}', '{"textScale":99999}',
        "x".repeat(100000),
      ];
      let bad = 0;
      for (const value of JUNK) {
        const context = await browser.newContext(base);
        const r = await heldLoad(context, {
          hold: 5000,
          label: `${engine}-storage-fuzz`,
          prepare: async (page) => {
            await page.addInitScript(([ks, ss, v]) => {
              for (const k of ks) { try { localStorage.setItem(k, v); } catch {} }
              for (const k of ss) { try { sessionStorage.setItem(k, v); } catch {} }
            }, [KEYS, SESSION, value]);
          },
        });
        if (!r.ok) { bad++; console.log(`       storage value ${JSON.stringify(value.slice(0, 24))} -> ${r.why}`); }
        await context.close();
      }
      check(`${engine}: every corrupt storage value still renders the app`, bad === 0, `${bad}/${JUNK.length} failed`);
    }

    // Storage that throws on access, which is Safari with cookies blocked.
    {
      const context = await browser.newContext(base);
      const r = await heldLoad(context, {
        hold: 6000,
        label: `${engine}-storage-blocked`,
        prepare: async (page) => {
          await page.addInitScript(() => {
            const boom = () => { throw new DOMException("The operation is insecure.", "SecurityError"); };
            const hostile = { getItem: boom, setItem: boom, removeItem: boom, clear: boom, key: boom, get length() { return boom(); } };
            for (const n of ["localStorage", "sessionStorage"]) {
              try { Object.defineProperty(window, n, { configurable: true, get: () => hostile }); } catch {}
            }
          });
        },
      });
      check(`${engine}: usable with storage access refused`, r.ok, r.why);
      await context.close();
    }

    // Stale multiplayer state on the home page.
    {
      const context = await browser.newContext(base);
      const r = await heldLoad(context, {
        hold: 6000,
        label: `${engine}-stale-mp`,
        prepare: async (page) => {
          await page.addInitScript(() => {
            try {
              sessionStorage.setItem("fiq_mp_token", "deadbeef".repeat(8));
              sessionStorage.setItem("fiq_active_quiz", '{"quiz":{"questions":[]},"startedAt":1}');
              localStorage.setItem("fiq_mp_name", "x".repeat(400));
              localStorage.setItem("fiq_mp_stats", '{"played":"many"}');
            } catch {}
          });
        },
      });
      check(`${engine}: stale multiplayer state does not affect home`, r.ok, r.why);
      await context.close();
    }

    // ---------- failure matrix: each dependency refused on its own
    {
      const endpoints = [
        ["quiz count", "**/api/quiz/count"],
        ["quiz generation", "**/api/quiz"],
        ["daily challenge", "**/api/daily"],
        ["health", "**/api/health*"],
        ["multiplayer rooms", "**/api/mp/**"],
        ["challenges", "**/api/challenges**"],
        ["attempts", "**/api/attempts"],
        ["every api", "**/api/**"],
      ];
      for (const [name, pattern] of endpoints) {
        for (const mode of ["abort", "500", "hang"]) {
          const context = await browser.newContext(base);
          const r = await heldLoad(context, {
            hold: 6000,
            label: `${engine}-${name}-${mode}`,
            prepare: async (page) => {
              await page.route(pattern, async (route) => {
                if (mode === "abort") return route.abort("failed");
                if (mode === "500") return route.fulfill({ status: 500, contentType: "application/json", body: '{"error":"boom"}' });
                await new Promise((res) => setTimeout(res, 30000));
                route.abort("timedout").catch(() => {});
              });
            },
          });
          check(`${engine}: home survives ${name} ${mode}`, r.ok, r.why);
          await context.close();
        }
      }
    }

    // WebSocket hostility, which must not reach the home page at all.
    {
      for (const mode of ["refused", "instant-close", "delayed"]) {
        const context = await browser.newContext(base);
        const r = await heldLoad(context, {
          hold: 6000,
          label: `${engine}-ws-${mode}`,
          prepare: async (page) => {
            await page.addInitScript((m) => {
              const Real = window.WebSocket;
              window.WebSocket = function (url) {
                if (m === "refused") throw new Error("SecurityError: WebSocket refused");
                const fake = { readyState: 0, close() {}, send() {}, addEventListener() {}, removeEventListener() {} };
                if (m === "instant-close") setTimeout(() => fake.onclose?.({ code: 1006 }), 0);
                return fake;
              };
              window.WebSocket.prototype = Real.prototype;
            }, mode);
          },
        });
        check(`${engine}: home unaffected by WebSocket ${mode}`, r.ok, r.why);
        await context.close();
      }
    }

    // Missing or broken browser APIs, one at a time.
    {
      for (const api of ["ResizeObserver", "IntersectionObserver", "matchMedia", "AudioContext", "PerformanceObserver", "requestAnimationFrame", "structuredClone"]) {
        const context = await browser.newContext(base);
        const r = await heldLoad(context, {
          hold: 6000,
          label: `${engine}-no-${api}`,
          prepare: async (page) => {
            await page.addInitScript((n) => {
              try { Object.defineProperty(window, n, { configurable: true, get: () => undefined }); } catch {}
            }, api);
          },
        });
        check(`${engine}: usable without ${api}`, r.ok, r.why);
        await context.close();
      }
    }

    // The blocked bundle: React never mounts, so the shell must speak.
    {
      const context = await browser.newContext(base);
      const page = await context.newPage();
      await page.route("**/assets/*.js", (route) => route.abort("failed"));
      await page.goto(`${BASE}/`, { waitUntil: "commit", timeout: 45000 }).catch(() => {});
      await page.waitForTimeout(13000);
      const seen = await page.evaluate(() => ({
        text: (document.body.innerText ?? "").trim().slice(0, 160),
        bg: getComputedStyle(document.body).backgroundColor,
        actions: [...document.querySelectorAll("button, a[href]")].map((e) => e.textContent?.trim()).filter(Boolean),
      })).catch(() => null);
      const ok = !!seen && seen.text.length > 0 && seen.actions.length > 0 && seen.bg !== "rgba(0, 0, 0, 0)" && seen.bg !== "rgb(255, 255, 255)";
      if (!ok) await capture(page, `${engine}-blocked-bundle`, `shell showed: ${JSON.stringify(seen)}`);
      check(`${engine}: a blocked bundle shows the recovery shell, not a blank page`, ok, JSON.stringify(seen));
      await page.close();
      await context.close();
    }

    await browser.close();
  }
}

// ================================================================== driver

console.log(`\n######## mobile matrix @ ${BASE} ########`);
console.log(`engines: ${ENGINES.join(", ")}   phase: ${PHASE}   failures -> ${OUT}\n`);

const started = Date.now();
if (PHASE === "all" || PHASE === "matrix") await phaseMatrix();
if (PHASE === "all" || PHASE === "conditions") await phaseConditions();
if (PHASE === "all" || PHASE === "volume") await phaseVolume();
if (PHASE === "all" || PHASE === "long") await phaseLong();

console.log(`\n######## ${passed}/${passed + failures.length} passed in ${Math.round((Date.now() - started) / 1000)}s ########`);
console.log(`failure artefacts captured: ${captured} -> ${OUT}`);
for (const f of failures) console.log(`FAIL ${f.name}${f.detail ? `\n     ${f.detail}` : ""}`);
process.exit(failures.length ? 1 : 0);
