#!/usr/bin/env node
// The conditions a desk cannot produce, and a phone produces constantly.
//
//   node scripts/blank-stress.mjs --runs=40
//   node scripts/blank-stress.mjs --engines=webkit --runs=60
//
// WHY A SECOND SCRIPT
//
// blankscreen-qa.mjs runs the volume matrix on a fast machine with an idle CPU
// and a fast network, and 200 clean loads there say nothing about a four-year-old
// handset on a train. The failure being chased is intermittent, has survived
// three fixes, and has only ever been seen on a real phone — which means the
// thing that triggers it is a condition the matrix does not create.
//
// So this one stacks the conditions instead of isolating them:
//
//   CPU throttled 6x          startup takes long enough to race its own failsafe
//   slow, jittery network     the bundle arrives in pieces, late
//   hidden during load        requestAnimationFrame never fires
//   viewport churn            a phone rotating, or a URL bar collapsing
//   interrupted navigation    a tap during load, then back
//   memory pressure           large allocations while React mounts
//
// Each run reports the last startup stage reached and the classification, so a
// failure here names its own mechanism.

import { chromium, webkit, devices } from "playwright";
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";

const arg = (name, fallback) => {
  const hit = process.argv.find((a) => a.startsWith(`--${name}=`));
  return hit ? hit.slice(name.length + 3) : fallback;
};

const BASE = arg("base", "https://football-iq.naorl.workers.dev").replace(/\/$/, "");
const ENGINES = arg("engines", "chromium,webkit").split(",").filter(Boolean);
const RUNS = Number(arg("runs", "40"));
const HOLD_MS = Number(arg("hold", "20")) * 1000;
const CPU_RATE = Number(arg("cpu", "6"));
const ARTIFACTS = arg("artifacts", "blank-artifacts-stress");

mkdirSync(ARTIFACTS, { recursive: true });

const PROBE = () => {
  const root = document.getElementById("root");
  const boot = document.getElementById("boot");
  const vw = window.innerWidth || 0;
  const vh = window.innerHeight || 0;
  const cs = (el) => {
    const s = getComputedStyle(el);
    return { position: s.position, zIndex: s.zIndex, opacity: s.opacity, visibility: s.visibility, display: s.display, background: s.backgroundColor, height: s.height };
  };
  const hits = [];
  if (vw && vh && typeof document.elementFromPoint === "function") {
    for (const f of [0.3, 0.5, 0.7]) {
      const el = document.elementFromPoint(Math.round(vw / 2), Math.round(vh * f));
      hits.push(el ? { tag: el.tagName, id: el.id || null, cls: String(el.className || "").slice(0, 60), insideRoot: !!(root && (el === root || root.contains(el))), isBoot: el === boot || !!(boot && boot.contains(el)) } : null);
    }
  }
  const covering = [];
  if (vw && vh) {
    for (const el of Array.from(document.querySelectorAll("body *"))) {
      const s = getComputedStyle(el);
      if (s.position !== "fixed" && s.position !== "absolute") continue;
      if (s.display === "none" || s.visibility === "hidden" || Number(s.opacity) === 0) continue;
      const r = el.getBoundingClientRect();
      if (r.width * r.height < vw * vh * 0.8) continue;
      covering.push({ tag: el.tagName, id: el.id || null, cls: String(el.className || "").slice(0, 60), insideRoot: !!(root && (el === root || root.contains(el))), z: s.zIndex, bg: s.backgroundColor });
      if (covering.length > 10) break;
    }
  }
  return {
    url: location.href,
    stage: window.__FIQ_STAGE__ ?? null,
    timeline: window.__FIQ_TIMELINE__ ?? [],
    errors: window.__FIQ_ERRORS__ ?? [],
    counts: window.__FIQ_COUNTS__ ? { ...window.__FIQ_COUNTS__ } : null,
    bootRecord: window.__FIQ_BOOT__ ?? null,
    boot: boot ? { hidden: boot.hasAttribute("hidden"), textLength: (boot.textContent || "").trim().length } : null,
    root: root
      ? {
          children: root.childElementCount,
          textLength: (root.textContent || "").trim().length,
          h: Math.round(root.getBoundingClientRect().height),
          style: cs(root),
          mainTextLength: (() => {
            const m = document.getElementById("main");
            return m ? (m.textContent || "").trim().length : -1;
          })(),
        }
      : null,
    hits,
    covering,
    viewport: { w: vw, h: vh },
  };
};

function classify(p) {
  if (!p) return { blank: true, kind: "NO_PROBE" };
  if (!p.root) return { blank: true, kind: "NO_ROOT" };
  const bootUp = p.boot && !p.boot.hidden;
  const empty = p.root.children === 0 || p.root.textLength === 0;
  if (bootUp && empty) return { blank: true, kind: p.boot.textLength > 40 ? "BOOT_RECOVERY" : "BOOT_STILL_LOADING" };
  if (bootUp && !empty) return { blank: true, kind: "BOOT_OVER_APP" };
  if (empty) return { blank: true, kind: "ROOT_EMPTIED" };
  if (p.root.style.display === "none") return { blank: true, kind: "ROOT_DISPLAY_NONE" };
  if (p.root.style.visibility === "hidden") return { blank: true, kind: "ROOT_HIDDEN" };
  if (Number(p.root.style.opacity) === 0) return { blank: true, kind: "ROOT_OPACITY_0" };
  const opaque = p.covering.filter((c) => c.bg && c.bg !== "transparent" && !/,\s*0\)$/.test(c.bg));
  const outside = opaque.find((c) => !c.insideRoot);
  if (outside) return { blank: true, kind: "CURTAIN_OUTSIDE_ROOT", why: `${outside.tag}#${outside.id} z${outside.z}` };
  if (p.root.mainTextLength === 0) return { blank: true, kind: "ROUTE_RENDERED_NOTHING" };
  const anyHit = p.hits.some((h) => h && h.insideRoot && !h.isBoot);
  if (p.hits.length && !anyHit) return { blank: true, kind: "NOTHING_HIT_TESTABLE" };
  return { blank: false, kind: "OK" };
}

async function launch(engine) {
  if (engine === "webkit") return webkit.launch();
  for (const o of [{}, { channel: "chrome" }, { channel: "msedge" }]) {
    try {
      return await chromium.launch(o);
    } catch {
      /* next */
    }
  }
  throw new Error("no usable Chromium");
}

let seq = 0;
async function save(page, label, probe, verdict, logs) {
  const id = `${String(++seq).padStart(3, "0")}-${label}`;
  const dir = join(ARTIFACTS, id);
  try {
    mkdirSync(dir, { recursive: true });
    await page.screenshot({ path: join(dir, "screen.png") }).catch(() => {});
    writeFileSync(join(dir, "dom.html"), await page.content().catch(() => ""));
    writeFileSync(join(dir, "probe.json"), JSON.stringify({ verdict, probe, logs }, null, 2));
  } catch {
    /* ignore */
  }
  return id;
}

const summary = {};
const blanks = [];

async function oneRun(browser, engine, index) {
  const device = devices[engine === "webkit" ? "iPhone 14" : "Pixel 7"] ?? {
    viewport: { width: 390, height: 844 },
    isMobile: true,
    hasTouch: true,
  };
  const context = await browser.newContext({ ...device });
  const page = await context.newPage();
  const logs = { console: [], pageErrors: [], failed: [] };
  page.on("console", (m) => m.type() === "error" && logs.console.length < 10 && logs.console.push(m.text().slice(0, 200)));
  page.on("pageerror", (e) => logs.pageErrors.length < 10 && logs.pageErrors.push(String(e.message).slice(0, 200)));
  page.on("requestfailed", (r) => logs.failed.length < 10 && logs.failed.push(`${r.url().slice(0, 100)} ${r.failure()?.errorText ?? ""}`));

  const mode = index % 4;

  try {
    // ---- CPU throttling, Chromium only: there is no WebKit equivalent, so
    // WebKit gets main-thread contention from the allocator below instead.
    if (engine === "chromium") {
      const cdp = await context.newCDPSession(page).catch(() => null);
      if (cdp) await cdp.send("Emulation.setCPUThrottlingRate", { rate: CPU_RATE }).catch(() => {});
    }

    // ---- a slow, jittery network
    await context.route("**/*", async (route) => {
      await new Promise((r) => setTimeout(r, 200 + Math.random() * 1400));
      await route.continue().catch(() => {});
    });

    // ---- hidden during load on half the runs: rAF never fires in that state
    if (mode === 0 || mode === 2) {
      await page.addInitScript(() => {
        Object.defineProperty(document, "visibilityState", { get: () => "hidden", configurable: true });
        Object.defineProperty(document, "hidden", { get: () => true, configurable: true });
      });
    }

    // ---- memory pressure while React mounts
    if (mode === 1 || mode === 3) {
      await page.addInitScript(() => {
        // Held in a global so it is not collected before it has cost anything.
        window.__ballast__ = [];
        const grow = () => {
          try {
            if (window.__ballast__.length < 24) window.__ballast__.push(new Array(400000).fill("x"));
          } catch {
            /* an allocation that fails is itself the condition */
          }
        };
        for (let i = 0; i < 6; i++) setTimeout(grow, i * 120);
      });
    }

    await page.goto(`${BASE}/`, { waitUntil: "commit", timeout: 60000 }).catch(() => {});

    // ---- viewport churn during startup: a phone rotating, a URL bar collapsing
    if (mode === 2 || mode === 3) {
      for (const size of [
        { width: 390, height: 664 },
        { width: 844, height: 390 },
        { width: 390, height: 844 },
      ]) {
        await page.waitForTimeout(500);
        await page.setViewportSize(size).catch(() => {});
      }
    }

    // ---- an interrupted navigation on a quarter of the runs
    if (mode === 3) {
      await page.waitForTimeout(600);
      await page.goto(`${BASE}/privacy`, { waitUntil: "commit" }).catch(() => {});
      await page.goBack({ waitUntil: "commit" }).catch(() => {});
    }

    // ---- let it settle. Generous, because the CPU is throttled 6x and the
    // boot layer's own failsafe is nine seconds of WALL time.
    const deadline = Date.now() + 40000;
    let probe = null;
    let verdict = { blank: true, kind: "NEVER_SETTLED" };
    while (Date.now() < deadline) {
      probe = await page.evaluate(PROBE).catch(() => null);
      verdict = classify(probe);
      if (!verdict.blank) break;
      await page.waitForTimeout(700);
    }

    // ---- and then hold, which is the part that catches disappearance
    if (!verdict.blank) {
      const until = Date.now() + HOLD_MS;
      while (Date.now() < until) {
        await page.waitForTimeout(2000);
        const p = await page.evaluate(PROBE).catch(() => null);
        const v = classify(p);
        if (v.blank) {
          probe = p;
          verdict = { ...v, kind: `HOLD_${v.kind}` };
          break;
        }
      }
    }

    summary[verdict.kind] = (summary[verdict.kind] ?? 0) + 1;
    if (verdict.blank) {
      const id = await save(page, `${engine}-m${mode}-${verdict.kind}`, probe, verdict, logs);
      blanks.push({ engine, mode, kind: verdict.kind, stage: probe?.stage ?? null, why: verdict.why ?? "", artifact: id });
      console.log(`\n  BLANK [${verdict.kind}] ${engine} mode${mode} stage=${probe?.stage} ${verdict.why ?? ""}`);
      console.log(`        artifact ${join(ARTIFACTS, id)}`);
    }
  } catch (error) {
    summary.HARNESS = (summary.HARNESS ?? 0) + 1;
    void error;
  } finally {
    await context.close().catch(() => {});
  }
}

console.log(`\nFootball IQ blank-screen STRESS → ${BASE}`);
console.log(`engines ${ENGINES.join(",")} | runs ${RUNS} each | cpu ${CPU_RATE}x | hold ${HOLD_MS / 1000}s\n`);

for (const engine of ENGINES) {
  const browser = await launch(engine);
  try {
    for (let i = 0; i < RUNS; i += 3) {
      await Promise.all(
        Array.from({ length: Math.min(3, RUNS - i) }, (_, k) => oneRun(browser, engine, i + k))
      );
      process.stdout.write(`\r  ${engine}: ${Math.min(i + 3, RUNS)}/${RUNS}  blanks=${blanks.length}   `);
    }
    process.stdout.write("\n");
  } finally {
    await browser.close().catch(() => {});
  }
}

console.log(`\noutcomes: ${JSON.stringify(summary, null, 2)}`);
console.log(`\nBLANK SCREENS: ${blanks.length}`);
for (const b of blanks.slice(0, 20)) {
  console.log(`  [${b.kind}] ${b.engine} mode${b.mode} stage=${b.stage} ${b.why}`);
}
