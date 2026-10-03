#!/usr/bin/env node
// The blank-screen hunt.
//
//   npm run qa:blank                       # production, the full matrix
//   npm run qa:blank -- --loads=40         # a shorter pass while iterating
//   npm run qa:blank -- --engines=webkit
//   npm run qa:blank -- --phase=hold       # one phase only
//
// WHY THIS EXISTS RATHER THAN MORE reliability-qa
//
// reliability-qa.mjs asks "did the page render?" and the answer has been yes for
// three releases while a real phone kept going blank. Two things it cannot see:
//
//   1. a page that renders and then STOPS being visible. Every previous check
//      sampled once, shortly after load. The report is "it was there and then it
//      wasn't", so the sample has to be held for fifteen seconds, and for a
//      minute on a slice of the runs.
//
//   2. WHICH KIND of blank. "#root is empty" and "#root is full and something
//      is on top of it" are different bugs with different fixes, and the
//      existing suite collapses both into one boolean. Every failure here is
//      classified, with the evidence attached, before anything is reloaded.
//
// THE CLASSIFICATION IS THE POINT. See classify() below: nine outcomes, each
// naming a distinct mechanism. A failure that cannot be classified is reported
// as UNKNOWN with its full probe, which is itself a finding — it means the
// product can break in a way nobody has modelled yet.

import { chromium, webkit, devices } from "playwright";
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";

const arg = (name, fallback) => {
  const hit = process.argv.find((a) => a.startsWith(`--${name}=`));
  return hit ? hit.slice(name.length + 3) : fallback;
};
const flag = (name) => process.argv.includes(`--${name}`);

const BASE = arg("base", "https://football-iq.naorl.workers.dev").replace(/\/$/, "");
const ENGINES = arg("engines", "chromium,webkit").split(",").filter(Boolean);
const LOADS = Number(arg("loads", "200"));
const HARD_RELOADS = Number(arg("hard-reloads", "100"));
const DEEP_LINKS = Number(arg("deep-links", "50"));
const NAV_RUNS = Number(arg("nav", "50"));
const SLOW_RUNS = Number(arg("slow", "50"));
const OFFLINE_RUNS = Number(arg("offline", "50"));
const STORAGE_RUNS = Number(arg("storage", "50"));
const API_RUNS = Number(arg("api", "50"));
const LONG_HOLD_RUNS = Number(arg("long", "50"));
const HOLD_MS = Number(arg("hold", "15")) * 1000;
const LONG_HOLD_MS = Number(arg("long-hold", "60")) * 1000;
const CONCURRENCY = Number(arg("concurrency", "6"));
const PHASE = arg("phase", "all");
const ARTIFACTS = arg("artifacts", "blank-artifacts");

mkdirSync(ARTIFACTS, { recursive: true });

/** Every key the app persists. Fuzzed in the storage phase. */
const STORAGE_KEYS = [
  "fiq_a11y_v1",
  "fiq_privacy_v1",
  "fiq_active_quiz",
  "fiq_last_result",
  "fiq_recent_questions",
  "fiq_sound_enabled",
  "fiq_mp_name",
  "fiq_mp_stats",
  "fiq_mp_token",
  "fiq:privacy-open",
];

/** The shapes a persisted value can be corrupted into. */
const CORRUPTIONS = [
  "",
  "   ",
  "null",
  "undefined",
  "{",
  "[}",
  '{"a":',
  "not json at all",
  "0",
  "false",
  '"a string where an object goes"',
  "[1,2,3]",
  '{"version":-1}',
  '{"schema":"ancient","questions":{"nested":{"too":{"deep":1}}}}',
  JSON.stringify({ huge: "x".repeat(200000) }),
  '{"__proto__":{"polluted":true}}',
  "\u0000\u0001\u0002",
  "😀".repeat(5000),
];

const DEEP_PATHS = [
  "/",
  "/build",
  "/daily",
  "/privacy",
  "/multiplayer",
  "/play",
  "/results",
  "/room/ABCDEF",
  "/challenge/does-not-exist",
  "/no-such-route",
];

const results = [];
const failures = [];
let checked = 0;

const record = (ok, area, detail) => {
  checked++;
  results.push({ ok, area, detail });
  // Both outcomes printed. A passing check's DETAIL is the evidence — "0 blank
  // out of 200" is the finding, and a suite that only prints failures makes a
  // clean run indistinguishable from a run that did nothing.
  console.log(`  ${ok ? "PASS" : "FAIL"}  ${area}${detail ? ` — ${detail}` : ""}`);
};

// ---------------------------------------------------------------------------
// The probe
// ---------------------------------------------------------------------------

/**
 * Everything knowable about the page's visible state, in one evaluate.
 *
 * One round trip on purpose: the state being measured is unstable by nature, and
 * a probe spread over six calls describes six different moments.
 */
const PROBE = () => {
  const out = {};
  const root = document.getElementById("root");
  const boot = document.getElementById("boot");
  const vw = window.innerWidth || 0;
  const vh = window.innerHeight || 0;

  out.url = location.href;
  out.visibility = document.visibilityState;
  out.viewport = { w: vw, h: vh };
  out.stage = window.__FIQ_STAGE__ ?? null;
  out.timeline = (window.__FIQ_TIMELINE__ ?? []).slice(0, 40);
  out.errors = (window.__FIQ_ERRORS__ ?? []).slice(0, 12);
  out.counts = window.__FIQ_COUNTS__ ? { ...window.__FIQ_COUNTS__ } : null;
  out.bootRecord = window.__FIQ_BOOT__ ?? null;

  const cs = (el) => {
    const s = getComputedStyle(el);
    return {
      position: s.position,
      zIndex: s.zIndex,
      opacity: s.opacity,
      visibility: s.visibility,
      display: s.display,
      background: s.backgroundColor,
      transform: s.transform,
      overflow: s.overflow,
      height: s.height,
    };
  };

  out.body = { style: cs(document.body) };

  if (!root) {
    out.root = null;
  } else {
    const r = root.getBoundingClientRect();
    out.root = {
      childElementCount: root.childElementCount,
      textLength: (root.textContent || "").trim().length,
      rect: { w: Math.round(r.width), h: Math.round(r.height), top: Math.round(r.top) },
      style: cs(root),
      // The router's own container. Empty <main> with a full #root means the
      // chrome rendered and the ROUTE rendered nothing, which is a different
      // bug from React failing.
      mainTextLength: (() => {
        const main = document.getElementById("main");
        return main ? (main.textContent || "").trim().length : -1;
      })(),
    };
  }

  out.boot = boot
    ? { present: true, hidden: boot.hasAttribute("hidden"), style: cs(boot), textLength: (boot.textContent || "").trim().length }
    : { present: false };

  // The error boundary's own screen, if it is up.
  out.boundary = !!document.querySelector("[data-fiq-boundary]");

  // ---- what is actually at the points a thumb would touch
  const describe = (el) => {
    if (!el) return null;
    const r = el.getBoundingClientRect();
    return {
      tag: el.tagName,
      id: el.id || null,
      cls: (el.className && String(el.className).slice(0, 80)) || null,
      insideRoot: !!(root && (el === root || root.contains(el))),
      isBoot: el === boot || (boot && boot.contains(el)),
      rect: { w: Math.round(r.width), h: Math.round(r.height) },
      style: cs(el),
    };
  };

  out.hits = [];
  if (vw && vh && typeof document.elementFromPoint === "function") {
    for (const f of [0.3, 0.5, 0.7]) {
      out.hits.push(describe(document.elementFromPoint(Math.round(vw * 0.5), Math.round(vh * f))));
    }
  }

  /*
    Every element that is CURRENTLY covering most of the viewport.

    Not "every fixed element" — the question is which of them is in front of the
    app right now, so the test is geometric: does its box cover 80% of the
    viewport, and is it actually painted. `insideRoot` is the field that matters:
    a curtain outside #root is the boot overlay's family of bug, one inside it is
    React rendering something over its own app, and those have different fixes.
  */
  out.covering = [];
  if (vw && vh) {
    const area = vw * vh;
    for (const el of Array.from(document.querySelectorAll("body *"))) {
      const s = getComputedStyle(el);
      if (s.position !== "fixed" && s.position !== "absolute") continue;
      if (s.display === "none" || s.visibility === "hidden") continue;
      if (Number(s.opacity) === 0) continue;
      const r = el.getBoundingClientRect();
      if (r.width * r.height < area * 0.8) continue;
      const bg = s.backgroundColor || "";
      // Transparent curtains do not hide anything; a scrim at 0.6 does.
      const transparent = bg === "transparent" || /rgba\([^)]*,\s*0\)$/.test(bg);
      out.covering.push({
        tag: el.tagName,
        id: el.id || null,
        cls: (el.className && String(el.className).slice(0, 80)) || null,
        insideRoot: !!(root && (el === root || root.contains(el))),
        zIndex: s.zIndex,
        opacity: s.opacity,
        background: bg,
        transparent,
      });
      if (out.covering.length > 14) break;
    }
  }

  return out;
};

/**
 * Nine named mechanisms, and UNKNOWN when none of them fits.
 *
 * Ordered so the most specific wins: an empty #root with the shell still up is
 * reported as the shell, because that is the thing to fix.
 */
function classify(probe) {
  if (!probe) return { blank: true, kind: "NO_PROBE", why: "the page could not be measured at all" };
  const root = probe.root;

  if (probe.boundary) {
    return { blank: false, kind: "ERROR_BOUNDARY", why: "the boundary's recovery screen is up, which is a handled failure" };
  }

  // The recovery screen inside the boot layer is also a handled outcome — it
  // explains itself and offers a retry — but it still means startup failed.
  const bootUp = probe.boot.present && !probe.boot.hidden;
  const bootIsRecovery = bootUp && probe.boot.textLength > 40;

  if (!root) return { blank: true, kind: "NO_ROOT", why: "#root is not in the document" };

  const rootEmpty = root.childElementCount === 0 || root.textLength === 0;

  if (bootUp && rootEmpty) {
    return {
      blank: true,
      kind: bootIsRecovery ? "BOOT_RECOVERY" : "BOOT_STILL_LOADING",
      why: bootIsRecovery
        ? "startup failed and the recovery screen is showing"
        : "the loading shell is still up and #root was never populated",
    };
  }

  if (bootUp && !rootEmpty) {
    return {
      blank: true,
      kind: "BOOT_OVER_APP",
      why: "the app rendered and the boot overlay is still on top of it",
    };
  }

  if (rootEmpty) {
    return { blank: true, kind: "ROOT_EMPTIED", why: "React rendered nothing or unmounted the tree" };
  }

  // Hidden by CSS on #root itself.
  const st = root.style;
  if (st.display === "none") return { blank: true, kind: "ROOT_DISPLAY_NONE", why: "#root has display:none" };
  if (st.visibility === "hidden") return { blank: true, kind: "ROOT_HIDDEN", why: "#root has visibility:hidden" };
  if (Number(st.opacity) === 0) return { blank: true, kind: "ROOT_OPACITY_0", why: "#root has opacity:0" };
  if (root.rect.h < 24) return { blank: true, kind: "ROOT_COLLAPSED", why: `#root is ${root.rect.h}px tall` };

  // A curtain in front of the app.
  const opaqueCover = probe.covering.filter((c) => !c.transparent);
  const outside = opaqueCover.find((c) => !c.insideRoot);
  if (outside) {
    return {
      blank: true,
      kind: "CURTAIN_OUTSIDE_ROOT",
      why: `${outside.tag}#${outside.id ?? ""}.${outside.cls ?? ""} z${outside.zIndex} covers the viewport from outside #root`,
    };
  }

  // The chrome rendered but the route did not.
  if (root.mainTextLength === 0) {
    return { blank: true, kind: "ROUTE_RENDERED_NOTHING", why: "#main is empty while #root is not" };
  }

  // Nothing belonging to the app answers a hit test anywhere down the middle.
  const anyHit = probe.hits.some((h) => h && h.insideRoot && !h.isBoot);
  if (probe.hits.length > 0 && !anyHit) {
    const top = probe.hits.find(Boolean);
    return {
      blank: true,
      kind: "NOTHING_HIT_TESTABLE",
      why: top ? `the centre of the screen belongs to ${top.tag}.${top.cls ?? ""}` : "no element answers a hit test",
    };
  }

  // A React-rendered curtain: inside #root, so every previous guard called this
  // healthy, and the person holding the phone sees a dark rectangle.
  const inside = opaqueCover.find((c) => c.insideRoot);
  if (inside && !probe.hits.some((h) => h && h.insideRoot && !h.isBoot && h.rect.h < probe.viewport.h * 0.9)) {
    return {
      blank: true,
      kind: "CURTAIN_INSIDE_ROOT",
      why: `${inside.tag}.${inside.cls ?? ""} z${inside.zIndex} covers the app from inside #root`,
    };
  }

  return { blank: false, kind: "OK", why: "" };
}

let artifactSeq = 0;

/** Everything about one failure, on disk, before anything is reloaded. */
async function saveArtifacts(page, label, probe, verdict, logs) {
  const id = `${String(++artifactSeq).padStart(3, "0")}-${label.replace(/[^a-z0-9]+/gi, "-")}`;
  const dir = join(ARTIFACTS, id);
  try {
    mkdirSync(dir, { recursive: true });
    await page.screenshot({ path: join(dir, "screen.png") }).catch(() => {});
    const html = await page.content().catch(() => "");
    writeFileSync(join(dir, "dom.html"), html);
    writeFileSync(
      join(dir, "probe.json"),
      JSON.stringify({ label, verdict, probe, logs }, null, 2)
    );
  } catch {
    /* an artifact we cannot write is not worth failing the run for */
  }
  return id;
}

/**
 * Loads the page, waits for it to look alive, HOLDS, and re-checks.
 *
 * The hold is the whole reason this harness exists. Everything before it was
 * already being tested; "it was there and then it wasn't" was not.
 */
async function openAndHold(context, path, opts = {}) {
  const holdMs = opts.holdMs ?? HOLD_MS;
  const page = await context.newPage();
  const logs = { console: [], pageErrors: [], failedRequests: [] };

  page.on("console", (m) => {
    if (m.type() === "error" && logs.console.length < 12) logs.console.push(m.text().slice(0, 300));
  });
  page.on("pageerror", (e) => {
    if (logs.pageErrors.length < 12) logs.pageErrors.push(String(e.message).slice(0, 300));
  });
  page.on("requestfailed", (r) => {
    if (logs.failedRequests.length < 12) {
      logs.failedRequests.push(`${r.method()} ${r.url().slice(0, 120)} ${r.failure()?.errorText ?? ""}`);
    }
  });

  try {
    if (opts.before) await opts.before(page);

    await page.goto(`${BASE}${path}`, { waitUntil: "domcontentloaded", timeout: 45000 }).catch(() => {});

    // Give startup a fair chance before judging it — the boot layer's own
    // failsafe is nine seconds, so anything shorter would be racing it.
    const deadline = Date.now() + 12000;
    let probe = null;
    while (Date.now() < deadline) {
      probe = await page.evaluate(PROBE).catch(() => null);
      if (probe && classify(probe).blank === false) break;
      await page.waitForTimeout(400);
    }

    let verdict = classify(probe);
    if (verdict.blank) {
      return { page, probe, verdict, logs, phase: "load" };
    }

    // ---- the hold. Sampled throughout, not only at the end: a page that goes
    // blank for two seconds and recovers is still a page that went blank.
    const until = Date.now() + holdMs;
    let worst = null;
    while (Date.now() < until) {
      await page.waitForTimeout(2000);
      if (opts.during) await opts.during(page).catch(() => {});
      const p = await page.evaluate(PROBE).catch(() => null);
      const v = classify(p);
      if (v.blank) {
        worst = { probe: p, verdict: v };
        break;
      }
      probe = p;
    }

    if (worst) return { page, probe: worst.probe, verdict: worst.verdict, logs, phase: "hold" };
    return { page, probe, verdict: { blank: false, kind: "OK", why: "" }, logs, phase: "hold" };
  } catch (error) {
    const probe = await page.evaluate(PROBE).catch(() => null);
    return {
      page,
      probe,
      verdict: { blank: true, kind: "HARNESS_ERROR", why: String(error).slice(0, 200) },
      logs,
      phase: "error",
    };
  }
}

/** Runs `total` attempts, `CONCURRENCY` at a time, each one a fresh context. */
async function sweep(browser, label, total, makeAttempt) {
  let blanks = 0;
  const kinds = {};
  for (let done = 0; done < total; done += CONCURRENCY) {
    const batch = Math.min(CONCURRENCY, total - done);
    const runs = await Promise.all(
      Array.from({ length: batch }, (_, i) => makeAttempt(browser, done + i))
    );
    for (const run of runs) {
      if (!run) continue;
      const { page, probe, verdict, logs } = run;
      kinds[verdict.kind] = (kinds[verdict.kind] ?? 0) + 1;
      if (verdict.blank) {
        blanks++;
        const id = await saveArtifacts(page, `${label}-${verdict.kind}`, probe, verdict, logs);
        failures.push({ label, kind: verdict.kind, why: verdict.why, artifact: id, stage: probe?.stage ?? null });
      }
      await page.context().close().catch(() => {});
    }
    process.stdout.write(`\r    ${label}: ${Math.min(done + batch, total)}/${total}  blanks=${blanks}   `);
  }
  process.stdout.write("\n");
  record(blanks === 0, `${label}`, `${total} run(s), ${blanks} blank — ${JSON.stringify(kinds)}`);
  return blanks;
}

const mobile = (engine) =>
  engine === "webkit"
    ? devices["iPhone 14"] ?? { viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true }
    : devices["Pixel 7"] ?? { viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true };

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

// ---------------------------------------------------------------------------
// The phases
// ---------------------------------------------------------------------------

async function runEngine(engine) {
  console.log(`\n[${engine}] mobile, ${BASE}\n`);
  const browser = await launch(engine);
  const device = mobile(engine);
  const ctx = () => browser.newContext({ ...device });

  const want = (phase) => PHASE === "all" || PHASE === phase;

  try {
    if (want("load")) {
      await sweep(browser, `${engine} plain loads`, LOADS, async (_b) => {
        const context = await ctx();
        return openAndHold(context, "/");
      });
    }

    if (want("hold")) {
      await sweep(browser, `${engine} 60s holds`, LONG_HOLD_RUNS, async () => {
        const context = await ctx();
        return openAndHold(context, "/", { holdMs: LONG_HOLD_MS });
      });
    }

    if (want("reload")) {
      await sweep(browser, `${engine} hard reloads`, HARD_RELOADS, async () => {
        const context = await ctx();
        return openAndHold(context, "/", {
          during: async (page) => {
            await page.reload({ waitUntil: "domcontentloaded" }).catch(() => {});
          },
        });
      });
    }

    if (want("deep")) {
      await sweep(browser, `${engine} deep links`, DEEP_LINKS, async (_b, i) => {
        const context = await ctx();
        return openAndHold(context, DEEP_PATHS[i % DEEP_PATHS.length]);
      });
    }

    if (want("nav")) {
      await sweep(browser, `${engine} back/forward`, NAV_RUNS, async () => {
        const context = await ctx();
        return openAndHold(context, "/", {
          during: async (page) => {
            // Back and forward exercises the BFCache, which on WebKit restores
            // a page that never re-ran its startup — a state nothing else here
            // produces.
            await page.goto(`${BASE}/privacy`, { waitUntil: "domcontentloaded" }).catch(() => {});
            await page.goBack({ waitUntil: "domcontentloaded" }).catch(() => {});
            await page.goForward({ waitUntil: "domcontentloaded" }).catch(() => {});
            await page.goBack({ waitUntil: "domcontentloaded" }).catch(() => {});
          },
        });
      });
    }

    if (want("background")) {
      await sweep(browser, `${engine} background/resume`, NAV_RUNS, async () => {
        const context = await ctx();
        return openAndHold(context, "/", {
          before: async (page) => {
            /*
              Hidden BEFORE navigation, which is the condition the last fix was
              about and the one a phone produces constantly: a link opened in a
              background tab, or an in-app webview that pre-warms off-screen.
              requestAnimationFrame does not run in that state.
            */
            await page.addInitScript(() => {
              Object.defineProperty(document, "visibilityState", { get: () => "hidden", configurable: true });
              Object.defineProperty(document, "hidden", { get: () => true, configurable: true });
            });
          },
          during: async (page) => {
            await page.evaluate(() => {
              document.dispatchEvent(new Event("visibilitychange"));
              window.dispatchEvent(new Event("pageshow"));
            });
          },
        });
      });
    }

    if (want("slow")) {
      await sweep(browser, `${engine} slow network`, SLOW_RUNS, async () => {
        const context = await ctx();
        await context.route("**/*", async (route) => {
          await new Promise((r) => setTimeout(r, 300 + Math.random() * 900));
          await route.continue().catch(() => {});
        });
        return openAndHold(context, "/");
      });
    }

    if (want("offline")) {
      await sweep(browser, `${engine} network loss`, OFFLINE_RUNS, async () => {
        const context = await ctx();
        return openAndHold(context, "/", {
          during: async (page) => {
            await page.context().setOffline(true);
            await page.waitForTimeout(1500);
            await page.context().setOffline(false);
          },
        });
      });
    }

    if (want("storage")) {
      await sweep(browser, `${engine} corrupt storage`, STORAGE_RUNS, async (_b, i) => {
        const context = await ctx();
        const key = STORAGE_KEYS[i % STORAGE_KEYS.length];
        const value = CORRUPTIONS[i % CORRUPTIONS.length];
        return openAndHold(context, "/", {
          before: async (page) => {
            // Written before the app runs, and ALL keys are poisoned on some
            // runs: one bad key is the easy case, and a browser that has been
            // through several versions of this product has a whole store of
            // them.
            await page.addInitScript(
              ({ key, value, all, corruptions, poisonAll }) => {
                try {
                  if (poisonAll) {
                    all.forEach((k, idx) => localStorage.setItem(k, corruptions[idx % corruptions.length]));
                  } else {
                    localStorage.setItem(key, value);
                  }
                } catch {
                  /* a browser that refuses storage is its own test */
                }
              },
              { key, value, all: STORAGE_KEYS, corruptions: CORRUPTIONS, poisonAll: i % 3 === 0 }
            );
          },
        });
      });
    }

    if (want("api")) {
      // Each optional endpoint failed in turn. Home must survive every one.
      const endpoints = [
        "**/api/health*",
        "**/api/quiz/count*",
        "**/api/quiz/options*",
        "**/api/daily*",
        "**/api/quiz",
        "**/api/**",
      ];
      await sweep(browser, `${engine} api failures`, API_RUNS, async (_b, i) => {
        const context = await ctx();
        const pattern = endpoints[i % endpoints.length];
        const mode = i % 3;
        await context.route(pattern, async (route) => {
          if (mode === 0) return route.abort("failed").catch(() => {});
          if (mode === 1) return route.fulfill({ status: 500, body: "{}" }).catch(() => {});
          // A hang, which is the one that actually breaks things: a promise that
          // never settles and a spinner that never stops.
          await new Promise((r) => setTimeout(r, 30000));
          return route.abort("timedout").catch(() => {});
        });
        return openAndHold(context, "/");
      });
    }
  } finally {
    await browser.close().catch(() => {});
  }
}

// ---------------------------------------------------------------------------
// Request-loop audit: one 30-second homepage session, counted per endpoint
// ---------------------------------------------------------------------------
async function auditRequestLoop(engine) {
  const browser = await launch(engine);
  try {
    const context = await browser.newContext({ ...mobile(engine) });
    const page = await context.newPage();
    const byPath = {};
    page.on("request", (r) => {
      try {
        const u = new URL(r.url());
        if (u.origin !== new URL(BASE).origin) return;
        const key = u.pathname;
        byPath[key] = (byPath[key] ?? 0) + 1;
      } catch {
        /* ignore */
      }
    });
    await page.goto(`${BASE}/`, { waitUntil: "domcontentloaded" });
    await page.waitForTimeout(30000);

    const counts = await page.evaluate(() => window.__FIQ_COUNTS__ ?? null);
    const sockets = await page.evaluate(() =>
      // A WebSocket on the home page would mean multiplayer is not lazy.
      typeof window.__FIQ_SOCKETS__ === "number" ? window.__FIQ_SOCKETS__ : null
    );

    const loud = Object.entries(byPath).filter(([, n]) => n > 4);
    record(
      loud.length === 0,
      `${engine} no request loop in 30s`,
      loud.length === 0
        ? JSON.stringify(byPath)
        : `repeated: ${loud.map(([p, n]) => `${p} x${n}`).join(", ")}`
    );

    // Remount loop. App, Home and Header mount once in a healthy session.
    const unmounts = Object.entries(counts ?? {}).filter(([k, n]) => k.endsWith(".unmount") && n > 0);
    const renders = Object.entries(counts ?? {}).filter(([k]) => k.endsWith(".render"));
    record(
      unmounts.length === 0,
      `${engine} no remount loop in 30s`,
      unmounts.length === 0
        ? `renders: ${renders.map(([k, n]) => `${k}=${n}`).join(", ")}`
        : `unmounted: ${unmounts.map(([k, n]) => `${k}=${n}`).join(", ")} | all: ${JSON.stringify(counts)}`
    );

    const wild = renders.filter(([, n]) => n > 12);
    record(
      wild.length === 0,
      `${engine} no render storm in 30s`,
      wild.length === 0 ? "every component rendered a handful of times" : JSON.stringify(Object.fromEntries(wild))
    );

    if (sockets !== null) {
      record(sockets === 0, `${engine} home opens no WebSocket`, `${sockets} socket(s)`);
    }

    await context.close();
  } finally {
    await browser.close().catch(() => {});
  }
}

// ---------------------------------------------------------------------------
// No-JS floor: block the bundle and check the visitor still sees something
// ---------------------------------------------------------------------------
async function auditNoScriptFloor(engine) {
  const browser = await launch(engine);
  try {
    const context = await browser.newContext({ ...mobile(engine) });
    await context.route("**/assets/*.js", (route) => route.abort("failed").catch(() => {}));
    const page = await context.newPage();
    await page.goto(`${BASE}/`, { waitUntil: "domcontentloaded" }).catch(() => {});
    await page.waitForTimeout(12000);
    const probe = await page.evaluate(PROBE).catch(() => null);
    const text = probe?.boot?.textLength ?? 0;
    const bg = probe?.body?.style?.background ?? "";
    const white = /rgba?\(\s*255,\s*255,\s*255/.test(bg) || bg === "" || bg === "transparent";
    record(
      text > 10 && !white,
      `${engine} blocked bundle still shows a Football IQ screen`,
      `boot text ${text} chars, body background ${bg}`
    );
    if (!(text > 10 && !white)) {
      await saveArtifacts(page, `${engine}-nojs`, probe, { kind: "NO_JS_FLOOR" }, {});
    }
    await context.close();
  } finally {
    await browser.close().catch(() => {});
  }
}

// ---------------------------------------------------------------------------
// Concurrency
// ---------------------------------------------------------------------------
async function auditConcurrency(engine) {
  const browser = await launch(engine);
  try {
    for (const n of [1, 5, 10, 25, 50]) {
      const device = mobile(engine);
      const started = Date.now();
      const latencies = [];
      let blanks = 0;
      const runs = await Promise.all(
        Array.from({ length: n }, async () => {
          const context = await browser.newContext({ ...device });
          const page = await context.newPage();
          const t0 = Date.now();
          try {
            await page.goto(`${BASE}/`, { waitUntil: "domcontentloaded", timeout: 60000 });
            const deadline = Date.now() + 25000;
            let ok = false;
            while (Date.now() < deadline) {
              const probe = await page.evaluate(PROBE).catch(() => null);
              if (probe && !classify(probe).blank) {
                ok = true;
                break;
              }
              await page.waitForTimeout(400);
            }
            latencies.push(Date.now() - t0);
            if (!ok) blanks++;
          } catch {
            blanks++;
          } finally {
            await context.close().catch(() => {});
          }
        })
      );
      void runs;
      latencies.sort((a, b) => a - b);
      const at = (q) => latencies.length ? latencies[Math.min(latencies.length - 1, Math.floor(latencies.length * q))] : 0;
      record(
        blanks === 0,
        `${engine} ${n} concurrent visitors`,
        `p50 ${at(0.5)}ms p95 ${at(0.95)}ms p99 ${at(0.99)}ms, ${blanks} blank, wall ${Date.now() - started}ms`
      );
    }
  } finally {
    await browser.close().catch(() => {});
  }
}

// ---------------------------------------------------------------------------
// Negative control: can this harness detect a blank screen at all?
// ---------------------------------------------------------------------------
/*
  A SUITE THAT CANNOT FAIL PROVES NOTHING, and that is the trap this whole
  investigation has been in: three releases were reported healthy by checks that
  sampled the one moment the page was fine. So four known-broken states are
  injected into a working page, and the classifier has to name each one. If it
  cannot, every "0 blank" result below is worthless — and this runs first so it
  says so before anything else is believed.
*/
/**
 * The root cause, as a standing regression test.
 *
 * Freezes pending timers the way iOS freezes them for a backgrounded page, with
 * the quiz's opening curtain on screen, and asserts two things: that the curtain
 * stops covering the app anyway (the CSS failsafe), and that it leaves the DOM
 * when the page comes back (the visibility handler). Before the fix this left a
 * 92%-opaque full-screen element over a perfectly rendered quiz, with no
 * recovery and a watchdog reporting health.
 */
async function auditFrozenCurtain(engine) {
  const browser = await launch(engine);
  try {
    const context = await browser.newContext({ ...mobile(engine) });
    const page = await context.newPage();
    await page.addInitScript(`
      window.__frozen__ = false;
      var realSetTimeout = window.setTimeout.bind(window);
      window.setTimeout = function (fn, ms) {
        var rest = Array.prototype.slice.call(arguments, 2);
        return realSetTimeout(function () {
          if (window.__frozen__) return;
          try { fn.apply(null, rest); } catch (e) {}
        }, ms);
      };
    `);

    await page.goto(`${BASE}/`, { waitUntil: "domcontentloaded" });
    await page.waitForTimeout(3500);
    await page.evaluate(() => {
      const b = document.querySelector(".quick-btn") || document.querySelector("main button");
      if (b) b.click();
    });
    await page.waitForTimeout(900);
    await page.evaluate(() => {
      const b = document.querySelector(".mode-sheet button");
      if (b) b.click();
    });
    const reached = await page
      .waitForURL(/\/play/, { timeout: 30000 })
      .then(() => true)
      .catch(() => false);

    if (!reached) {
      record(false, `${engine} frozen-curtain setup`, "never reached /play");
      await context.close();
      return;
    }

    await page.evaluate(() => {
      window.__frozen__ = true;
    });
    await page.waitForTimeout(6000);

    const frozen = await page.evaluate(() => {
      const k = document.querySelector(".kick");
      if (!k) return { covering: false, opacity: null };
      const cs = getComputedStyle(k);
      const r = k.getBoundingClientRect();
      const fullBleed = r.width >= innerWidth && r.height >= innerHeight;
      return {
        covering: fullBleed && cs.visibility !== "hidden" && Number(cs.opacity) > 0.05,
        opacity: cs.opacity,
        visibility: cs.visibility,
      };
    });
    record(
      !frozen.covering,
      `${engine} curtain cannot survive frozen timers`,
      `opacity ${frozen.opacity}, visibility ${frozen.visibility}`
    );

    const probe = await page.evaluate(PROBE);
    const verdict = classify(probe);
    record(!verdict.blank, `${engine} quiz usable with timers frozen`, `${verdict.kind} ${verdict.why ?? ""}`);

    // And the page comes back.
    await page.evaluate(() => {
      window.__frozen__ = false;
      document.dispatchEvent(new Event("visibilitychange"));
      window.dispatchEvent(new Event("pageshow"));
    });
    await page.waitForTimeout(1500);
    const gone = await page.evaluate(() => !document.querySelector(".kick"));
    record(gone, `${engine} curtain leaves the DOM on visibility restore`, gone ? "removed" : "still present");

    await context.close();
  } finally {
    await browser.close().catch(() => {});
  }
}


async function selfTest(engine) {
  const browser = await launch(engine);
  const cases = [
    {
      name: "ROOT_EMPTIED",
      inject: () => {
        document.getElementById("root").innerHTML = "";
      },
    },
    {
      name: "CURTAIN_OUTSIDE_ROOT",
      inject: () => {
        const d = document.createElement("div");
        d.id = "injected-curtain";
        d.style.cssText = "position:fixed;inset:0;z-index:99999;background:#0d1522";
        document.body.appendChild(d);
      },
    },
    {
      name: "ROOT_OPACITY_0",
      inject: () => {
        document.getElementById("root").style.opacity = "0";
      },
    },
    {
      /*
        The one that matters most, and the one production's own watchdog cannot
        see. index.html hit-tests the centre of the screen and passes if the
        element there is INSIDE #root — which every legitimate overlay in this
        product is. A React-rendered opaque full-screen element therefore reads
        as a healthy app while the person holding the phone sees a dark
        rectangle with nothing on it.
      */
      name: "CURTAIN_INSIDE_ROOT",
      inject: () => {
        const d = document.createElement("div");
        d.id = "injected-inner-curtain";
        d.style.cssText = "position:fixed;inset:0;z-index:9000;background:#0d1522";
        document.getElementById("root").appendChild(d);
      },
    },
    {
      /*
        A collapsed #root needs min-height defeated as well as height set:
        global.css pins `min-height: 100dvh`. Which is itself worth knowing —
        it means #root always fills the screen, so the production watchdog's
        height check can never fire and the hit test is doing all the work.
      */
      name: "ROOT_COLLAPSED",
      also: ["NOTHING_HIT_TESTABLE", "ROUTE_RENDERED_NOTHING"],
      inject: () => {
        const r = document.getElementById("root");
        r.style.minHeight = "0px";
        r.style.height = "0px";
        r.style.overflow = "hidden";
      },
    },
  ];
  try {
    for (const c of cases) {
      const context = await browser.newContext({ ...mobile(engine) });
      const page = await context.newPage();
      await page.goto(`${BASE}/`, { waitUntil: "domcontentloaded" });
      await page.waitForTimeout(4000);
      const before = classify(await page.evaluate(PROBE));
      await page.evaluate(c.inject);
      await page.waitForTimeout(300);
      const after = classify(await page.evaluate(PROBE));
      /*
        Detection is what is being asserted, not the label. A collapsed #root is
        reported as NOTHING_HIT_TESTABLE because that check sits earlier in
        classify() and is equally true — both say "blank", which is the thing a
        clean run has to be able to say is absent. `also` lists the labels that
        are a correct answer for a given injection.
      */
      const acceptable = [c.name, ...(c.also ?? [])];
      record(
        before.kind === "OK" && after.blank === true && acceptable.includes(after.kind),
        `${engine} self-test detects ${c.name}`,
        `healthy first (${before.kind}), then ${after.kind}`
      );
      await context.close();
    }
  } finally {
    await browser.close().catch(() => {});
  }
}


// ---------------------------------------------------------------------------
console.log(`\nFootball IQ blank-screen hunt → ${BASE}`);
console.log(`engines: ${ENGINES.join(", ")} | phase: ${PHASE} | artifacts: ${ARTIFACTS}\n`);

for (const engine of ENGINES) {
  try {
    if (PHASE === "all" || PHASE === "selftest") await selfTest(engine);
    if (PHASE === "all" || PHASE === "curtain") await auditFrozenCurtain(engine);
    if (PHASE === "all" || PHASE === "loop") await auditRequestLoop(engine);
    if (PHASE === "all" || PHASE === "nojs") await auditNoScriptFloor(engine);
    await runEngine(engine);
    if (PHASE === "all" || PHASE === "concurrency") await auditConcurrency(engine);
  } catch (error) {
    record(false, `${engine} crashed`, String(error).slice(0, 300));
  }
}

// ---------------------------------------------------------------------------
const passed = results.filter((r) => r.ok).length;
console.log(`\n${passed}/${checked} check(s) passed.`);

if (failures.length > 0) {
  const byKind = {};
  for (const f of failures) byKind[f.kind] = (byKind[f.kind] ?? 0) + 1;
  console.log(`\nBLANK SCREENS: ${failures.length}`);
  console.log(`by mechanism: ${JSON.stringify(byKind, null, 2)}`);
  console.log(`\nfirst few:`);
  for (const f of failures.slice(0, 10)) {
    console.log(`  [${f.kind}] ${f.label} — stage ${f.stage} — ${f.why}`);
    console.log(`      artifact: ${join(ARTIFACTS, f.artifact)}`);
  }
}

if (!flag("no-exit-code")) process.exit(failures.length > 0 || passed !== checked ? 1 : 0);
