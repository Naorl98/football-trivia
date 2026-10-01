// Post-mount stability.
//
// The reliability harness asked "did the app render?". This one asks "is it
// STILL there ten seconds later, and did it stay still?" — which is a different
// question, and the one a report of content appearing and then vanishing is
// actually about.
//
// HOW IT MEASURES, AND WHY THAT WAY. Everything here is observed from outside
// the app, through an init script injected before any bundle runs. No
// instrumentation is added to the product, so what is measured is exactly what
// production serves:
//
//   MutationObserver on #root    every node added to or removed from the app
//                                tree, with a timestamp. A remount shows up as
//                                a removal followed by an addition; a render
//                                loop shows up as hundreds of them.
//
//   animationstart events        the entrance animations (`a-fade-up`,
//                                `a-stagger`, `a-pop`) fire once per mount. If
//                                the headline's animation starts five times,
//                                the headline was mounted five times — which is
//                                precisely the reported "shaking".
//
//   fetch and XHR counts         per URL, so a polling loop is visible as a
//                                count rather than inferred from a waterfall.
//
//   element census over time     the headline, the primary call to action and
//                                #root itself, sampled on an interval with
//                                their computed opacity, visibility and
//                                display, so "disappeared" can be told apart
//                                from "removed".
//
// Usage:
//   node scripts/stability-qa.mjs [baseUrl] [--loads=N] [--hold=SECONDS]
//                                 [--only=scenario,...]

import { chromium } from "playwright";

const args = process.argv.slice(2);
const BASE = (args.find((a) => !a.startsWith("--")) ?? "https://football-iq.naorl.workers.dev").replace(/\/+$/, "");
const flag = (name, fallback) => {
  const hit = args.find((a) => a.startsWith(`--${name}=`));
  return hit ? hit.slice(name.length + 3) : fallback;
};
const LOADS = Number(flag("loads", "100"));
const HOLD_MS = Number(flag("hold", "10")) * 1000;
const ONLY = flag("only", "").split(",").filter(Boolean);

/**
 * Instagram's in-app browser on an iPhone.
 *
 * The reported failure happened here specifically, so it is the default
 * environment rather than an afterthought. The user agent is the real one these
 * webviews send — the trailing Instagram build token is what some scripts
 * sniff for, and it is also what makes this worth testing separately from
 * Safari.
 */
const INSTAGRAM_IOS =
  "Mozilla/5.0 (iPhone; CPU iPhone OS 17_5_1 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) " +
  "Mobile/15E148 Instagram 334.0.0.25.94 (iPhone15,2; iOS 17_5_1; en_US; en; scale=3.00; 1179x2556; 614318767)";

const SAFARI_IOS =
  "Mozilla/5.0 (iPhone; CPU iPhone OS 17_5_1 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) " +
  "Version/17.5 Mobile/15E148 Safari/604.1";

let passed = 0;
const failures = [];

function check(name, condition, detail = "") {
  if (condition) {
    passed++;
    console.log(`  ok   ${name}`);
  } else {
    failures.push({ name, detail });
    console.log(`  FAIL ${name}${detail ? ` — ${detail}` : ""}`);
  }
}

const section = (title) => console.log(`\n--- ${title} ---`);

async function launch() {
  for (const options of [{}, { channel: "chrome" }, { channel: "msedge" }]) {
    try {
      return await chromium.launch({ headless: true, ...options });
    } catch {
      /* try the next one */
    }
  }
  throw new Error("no usable Chromium");
}

/**
 * The probe, injected before the app loads.
 *
 * Deliberately self-contained and defensive: it runs in whatever browser is
 * under test, and a probe that throws would take down the page it is measuring.
 */
const PROBE = () => {
  const started = Date.now();
  const since = () => Date.now() - started;

  const data = {
    mutations: [],
    animations: [],
    requests: {},
    census: [],
    errors: [],
    rootRemovals: 0,
    rootAdditions: 0,
  };
  window.__FIQ_PROBE__ = data;

  // --- errors
  window.addEventListener("error", (event) => {
    if (event.target && event.target !== window) return;
    data.errors.push({ at: since(), kind: "error", message: String(event.message ?? "").slice(0, 200) });
  });
  window.addEventListener("unhandledrejection", (event) => {
    const reason = event.reason;
    data.errors.push({
      at: since(),
      kind: "rejection",
      message: String((reason && reason.message) || reason || "").slice(0, 200),
    });
  });

  // --- entrance animations: one start per mount
  /*
    Counted PER ELEMENT, not per animation name.

    The first version of this counted by `animationName` and reported `fade-up: 8`
    as a failure on a page that was behaving perfectly — eight different elements
    (headline, subtitle, the CTA row, the quick-start tiles, the privacy bar)
    each legitimately play `fade-up` once. The number that means something is how
    many times ONE element plays its entrance animation: an element that fades up
    five times was mounted five times, and that is the reported "shaking".

    Identity is tracked with a WeakSet-ish tag on the node, so a node that is
    destroyed and recreated counts as a new element — which is exactly right. A
    remount therefore shows as many tags each with a count of one AND a
    corresponding burst of mutations, while a re-triggered animation on a
    surviving element shows as one tag with a high count. Both are reported.
  */
  let tagSeq = 0;
  data.byNode = {};
  window.addEventListener(
    "animationstart",
    (event) => {
      const target = event.target;
      if (!target || !target.tagName) return;

      if (!target.__fiqTag) {
        tagSeq += 1;
        target.__fiqTag = `${target.tagName.toLowerCase()}#${tagSeq}`;
      }
      const key = `${target.__fiqTag}:${event.animationName}`;
      data.byNode[key] = (data.byNode[key] ?? 0) + 1;

      if (data.animations.length > 400) return;
      const name = typeof target.className === "string" ? target.className : "";
      data.animations.push({
        at: since(),
        animation: event.animationName,
        tag: target.__fiqTag,
        node: `${target.tagName.toLowerCase()}.${name.slice(0, 48)}`,
      });
    },
    true
  );

  // --- requests
  const note = (url) => {
    try {
      const path = new URL(url, location.href).pathname;
      data.requests[path] = (data.requests[path] ?? 0) + 1;
    } catch {
      /* opaque url */
    }
  };
  const realFetch = window.fetch;
  window.fetch = function (input, init) {
    note(typeof input === "string" ? input : input && input.url ? input.url : "");
    return realFetch.call(this, input, init);
  };
  const realOpen = XMLHttpRequest.prototype.open;
  XMLHttpRequest.prototype.open = function (method, url, ...rest) {
    note(String(url));
    return realOpen.call(this, method, url, ...rest);
  };

  // --- WebSocket opens, which the home page should never need
  const RealWebSocket = window.WebSocket;
  data.sockets = [];
  window.WebSocket = function (url, protocols) {
    data.sockets.push({ at: since(), url: String(url).slice(0, 120) });
    return new RealWebSocket(url, protocols);
  };
  window.WebSocket.prototype = RealWebSocket.prototype;
  for (const key of ["CONNECTING", "OPEN", "CLOSING", "CLOSED"]) {
    window.WebSocket[key] = RealWebSocket[key];
  }

  // --- the app tree
  function watchRoot() {
    const root = document.getElementById("root");
    if (!root) return false;
    const observer = new MutationObserver((records) => {
      for (const record of records) {
        if (record.removedNodes.length) {
          data.rootRemovals += record.removedNodes.length;
          if (data.mutations.length < 400) {
            data.mutations.push({
              at: since(),
              kind: "removed",
              count: record.removedNodes.length,
              from: record.target === root ? "#root" : String(record.target.className ?? "").slice(0, 40),
            });
          }
        }
        if (record.addedNodes.length) {
          data.rootAdditions += record.addedNodes.length;
          if (data.mutations.length < 400) {
            data.mutations.push({
              at: since(),
              kind: "added",
              count: record.addedNodes.length,
              into: record.target === root ? "#root" : String(record.target.className ?? "").slice(0, 40),
            });
          }
        }
      }
    });
    observer.observe(root, { childList: true, subtree: true });
    return true;
  }
  if (!watchRoot()) {
    document.addEventListener("DOMContentLoaded", watchRoot);
  }

  // --- a periodic census of the things that must stay on screen
  function visible(node) {
    if (!node) return null;
    const style = getComputedStyle(node);
    const box = node.getBoundingClientRect();
    return {
      opacity: style.opacity,
      visibility: style.visibility,
      display: style.display,
      w: Math.round(box.width),
      h: Math.round(box.height),
    };
  }

  window.__FIQ_CENSUS__ = () => {
    const root = document.getElementById("root");
    return {
      at: since(),
      stage: window.__FIQ_STAGE__ ?? null,
      rootChildren: root ? root.childElementCount : -1,
      rootText: root ? (root.textContent ?? "").trim().length : -1,
      /*
        `#root` is a flex column, and `.topbar` (flex: none) / `.app-main`
        (flex: 1) / the footer have to be its DIRECT children for that to mean
        anything. Wrapping them in one unstyled element — which the root error
        boundary briefly did, to carry a retry key — leaves #root with a single
        child, makes `flex: 1` inert, and stops the main region filling the
        viewport. Recorded as a list so a regression names the culprit.
      */
      rootChildClasses: root
        ? [...root.children].map((node) => (typeof node.className === "string" ? node.className.split(" ")[0] : node.tagName))
        : [],
      mainIsRootChild: !!(root && [...root.children].some((node) => node.classList && node.classList.contains("app-main"))),
      mainFillsViewport: (() => {
        const main = document.querySelector(".app-main");
        if (!main) return null;
        // `flex: 1` working means main is at least most of what is left of the
        // viewport under the header.
        return main.getBoundingClientRect().height >= window.innerHeight * 0.4;
      })(),
      title: visible(document.querySelector("h1.home-title")),
      cta: visible(document.querySelector(".home-cta")),
      header: visible(document.querySelector(".topbar")),
      main: visible(document.querySelector(".app-main")),
      boot: (() => {
        const boot = document.getElementById("boot");
        return boot ? { hidden: boot.hasAttribute("hidden"), ...visible(boot) } : null;
      })(),
      recovery: !!document.querySelector(".boot-recover"),
    };
  };

  setInterval(() => {
    try {
      if (data.census.length < 200) data.census.push(window.__FIQ_CENSUS__());
    } catch {
      /* never let the probe be the failure */
    }
  }, 500);
};

/** Opens the home page in a given environment and holds it, then reports. */
async function observe(browser, { label, userAgent, viewport, hold = HOLD_MS, prepare, during }) {
  const context = await browser.newContext({
    userAgent,
    viewport,
    locale: "he-IL",
    isMobile: true,
    hasTouch: true,
    deviceScaleFactor: 3,
  });
  const page = await context.newPage();

  const consoleErrors = [];
  page.on("pageerror", (e) => consoleErrors.push(`pageerror: ${e.message}`));
  page.on("console", (m) => {
    if (m.type() === "error") consoleErrors.push(`console: ${m.text()}`);
  });

  await page.addInitScript(PROBE);
  if (prepare) await prepare(page, context);

  await page.goto(`${BASE}/`, { waitUntil: "commit", timeout: 40000 }).catch(() => {});

  // Wait for the headline, which is the thing reported as appearing and then
  // vanishing. If it never arrives that is a different bug.
  const appeared = await page
    .waitForFunction(() => !!document.querySelector("h1.home-title"), { timeout: 20000 })
    .then(() => true)
    .catch(() => false);

  if (during) await during(page, context);
  await page.waitForTimeout(hold);

  const probe = await page.evaluate(() => ({
    ...window.__FIQ_PROBE__,
    final: window.__FIQ_CENSUS__ ? window.__FIQ_CENSUS__() : null,
  }));

  await context.close();
  return { label, appeared, probe, consoleErrors };
}

/** Shared verdict for one observation. */
function judge(result, { label = result.label, maxAnimationsPerName = 3, maxRequestsPerPath = 4, skipConsole = false } = {}) {
  const { probe, consoleErrors } = result;
  const final = probe.final ?? {};

  check(`${label}: the headline appeared`, result.appeared);

  // The core assertion: still there after the hold.
  const titleGone = !final.title;
  const titleInvisible =
    final.title && (final.title.opacity === "0" || final.title.visibility === "hidden" || final.title.h === 0);
  check(
    `${label}: the headline is still in the DOM after the hold`,
    !titleGone,
    JSON.stringify(final).slice(0, 220)
  );
  check(
    `${label}: the headline is still visible`,
    !titleInvisible,
    final.title ? JSON.stringify(final.title) : "absent"
  );
  check(`${label}: the primary call to action is still there`, !!final.cta, JSON.stringify(final.cta));
  check(`${label}: the header is still there`, !!final.header);
  check(`${label}: #root still has content`, (final.rootText ?? 0) > 20, `rootText=${final.rootText}`);
  check(
    `${label}: the boot shell did not come back`,
    !final.boot || final.boot.hidden === true,
    JSON.stringify(final.boot)
  );
  check(`${label}: the error boundary did not fire`, final.recovery === false);

  // Layout integrity: the flex column's children must be the real chrome, not
  // one wrapper standing in for all of it.
  check(
    `${label}: .app-main is a direct child of #root`,
    final.mainIsRootChild === true,
    JSON.stringify(final.rootChildClasses)
  );
  check(
    `${label}: the main region fills the viewport`,
    final.mainFillsViewport !== false,
    `main height vs viewport: ${final.mainFillsViewport}`
  );

  // Remount / loop detection, two ways.
  //
  // 1. One element replaying its entrance animation — the animation is being
  //    re-triggered on a node that survived.
  const perNode = Object.entries(probe.byNode ?? {}).sort((a, b) => b[1] - a[1]);
  const worstNode = perNode[0];
  check(
    `${label}: no element replays its entrance animation`,
    !worstNode || worstNode[1] <= maxAnimationsPerName,
    worstNode ? `${worstNode[0]} x${worstNode[1]}` : ""
  );

  // 2. The same entrance animation played by many DIFFERENT nodes over time —
  //    the signature of a remount, where each mount brings a fresh element.
  //    The headline is the one to watch, because there is only ever one of it.
  const titleRuns = (probe.animations ?? []).filter((row) => row.node.includes("home-title"));
  const titleNodes = new Set(titleRuns.map((row) => row.tag));
  check(
    `${label}: the headline was mounted once`,
    titleNodes.size <= 1 && titleRuns.length <= 1,
    `${titleNodes.size} distinct headline element(s), ${titleRuns.length} animation run(s)`
  );

  // After the app has settled, the tree should be quiet. A handful of mutations
  // is normal (the boot shell being hidden, a lazy image); hundreds is a loop.
  const lateMutations = (probe.mutations ?? []).filter((m) => m.at > 4000);
  check(
    `${label}: the app tree is quiet once settled`,
    lateMutations.length <= 10,
    `${lateMutations.length} mutations after 4s; first: ${JSON.stringify(lateMutations.slice(0, 3))}`
  );

  // Fetch loops.
  const chatty = Object.entries(probe.requests ?? {}).filter(([, n]) => n > maxRequestsPerPath);
  check(`${label}: no endpoint is polled`, chatty.length === 0, JSON.stringify(chatty));

  // The home page has no business opening a socket.
  check(
    `${label}: no WebSocket is opened from the home page`,
    (probe.sockets ?? []).length === 0,
    JSON.stringify(probe.sockets)
  );

  check(
    `${label}: nothing threw after mount`,
    (probe.errors ?? []).length === 0,
    JSON.stringify((probe.errors ?? []).slice(0, 3))
  );
  if (!skipConsole) {
    check(`${label}: the console stayed clean`, consoleErrors.length === 0, consoleErrors.slice(0, 3).join(" | "));
  } else {
    // The FeatureBoundary logs a warning when it drops a subtree, which is the
    // designed outcome here, so only a hard pageerror counts.
    check(
      `${label}: nothing escaped as an uncaught error`,
      !consoleErrors.some((line) => line.startsWith("pageerror:")),
      consoleErrors.slice(0, 3).join(" | ")
    );
  }

  return { perNode, titleMounts: titleNodes.size, lateMutations: lateMutations.length, chatty };
}

// ======================================================= scenario: baselines

async function baselines(browser) {
  section("hold the home page in each environment");

  for (const [label, userAgent] of [
    ["instagram-ios", INSTAGRAM_IOS],
    ["safari-ios", SAFARI_IOS],
    ["desktop", undefined],
  ]) {
    const result = await observe(browser, {
      label,
      userAgent,
      viewport: label === "desktop" ? { width: 1280, height: 800 } : { width: 393, height: 852 },
    });
    judge(result);
  }
}

// ================================= scenario: the in-app browser's lifecycle

/**
 * What an in-app browser actually does to a page.
 *
 * Instagram's webview is not a quiet environment: it resizes the viewport as
 * its own chrome slides in and out, it backgrounds and foregrounds the page
 * when the user switches apps, and it fires the page-lifecycle events that
 * Safari fires on a restore. Any of those is a plausible trigger for something
 * that happens shortly after the first render, which is why they are driven
 * deliberately rather than waited for.
 */
async function lifecycle(browser) {
  section("in-app browser lifecycle events");

  const result = await observe(browser, {
    label: "lifecycle",
    userAgent: INSTAGRAM_IOS,
    viewport: { width: 393, height: 852 },
    during: async (page) => {
      // The toolbar sliding away, repeatedly.
      for (const height of [852, 760, 852, 700, 852]) {
        await page.setViewportSize({ width: 393, height });
        await page.waitForTimeout(400);
      }

      // Backgrounded and brought back, twice.
      for (let i = 0; i < 2; i++) {
        await page.evaluate(() => {
          Object.defineProperty(document, "visibilityState", { configurable: true, get: () => "hidden" });
          document.dispatchEvent(new Event("visibilitychange"));
          window.dispatchEvent(new Event("blur"));
          window.dispatchEvent(new PageTransitionEvent("pagehide", { persisted: true }));
        });
        await page.waitForTimeout(600);
        await page.evaluate(() => {
          Object.defineProperty(document, "visibilityState", { configurable: true, get: () => "visible" });
          document.dispatchEvent(new Event("visibilitychange"));
          window.dispatchEvent(new Event("focus"));
          window.dispatchEvent(new PageTransitionEvent("pageshow", { persisted: true }));
        });
        await page.waitForTimeout(600);
      }

      // Orientation, which in a webview is just another resize.
      await page.setViewportSize({ width: 852, height: 393 });
      await page.waitForTimeout(500);
      await page.setViewportSize({ width: 393, height: 852 });
      await page.waitForTimeout(500);
    },
  });

  judge(result, { label: "lifecycle" });
}

// ============================== scenario: hostile storage and failed APIs

async function degraded(browser) {
  section("degraded environments");

  // Storage that throws from the accessor, which is Safari with cookies
  // blocked — and an in-app browser is more likely than Safari to be in that
  // state, because the webview may not share the cookie store at all.
  const blocked = await observe(browser, {
    label: "storage-blocked",
    userAgent: INSTAGRAM_IOS,
    viewport: { width: 393, height: 852 },
    prepare: async (page) => {
      await page.addInitScript(() => {
        const boom = () => {
          throw new DOMException("The operation is insecure.", "SecurityError");
        };
        const hostile = {
          getItem: boom, setItem: boom, removeItem: boom, clear: boom, key: boom,
          get length() { return boom(); },
        };
        for (const name of ["localStorage", "sessionStorage"]) {
          try {
            Object.defineProperty(window, name, { configurable: true, get: () => hostile });
          } catch {
            /* some engines refuse the redefinition; the test is then a no-op */
          }
        }
      });
    },
  });
  judge(blocked, { label: "storage-blocked" });

  // Every optional API refused. An already-rendered page must stay rendered.
  const apiDown = await observe(browser, {
    label: "api-refused",
    userAgent: INSTAGRAM_IOS,
    viewport: { width: 393, height: 852 },
    prepare: async (page) => {
      await page.route("**/api/**", (route) => route.abort("failed"));
    },
  });
  judge(apiDown, { label: "api-refused" });

  /*
    THE STRUCTURAL TEST, as opposed to the specific one.

    Guarding the `new ResizeObserver` call fixes that one bug. It does not prove
    that the next optional feature to throw cannot take the product down, which
    is the property that actually matters — so these two break something else,
    in two different ways, and the game must survive both.

      scrollTo throws        ScrollToTop's effect raises from a passive effect,
                             which is the same mechanism as the original bug in
                             a different component. The FeatureBoundary around
                             it must absorb it.

      ResizeObserver exists
      but throws             the API is present, so feature detection passes and
                             the constructor is reached anyway. This is the case
                             a `typeof` check alone would miss.
  */
  const scrollBroken = await observe(browser, {
    label: "scrollTo throws",
    userAgent: INSTAGRAM_IOS,
    viewport: { width: 393, height: 852 },
    hold: 6000,
    prepare: async (page) => {
      await page.addInitScript(() => {
        Object.defineProperty(window, "scrollTo", {
          configurable: true,
          value: () => {
            throw new Error("scrollTo is not available in this webview");
          },
        });
      });
    },
  });
  // The console will carry the FeatureBoundary's warning, which is the designed
  // outcome rather than a fault, so console cleanliness is not asserted here.
  judge(scrollBroken, { label: "scrollTo throws", skipConsole: true });

  const observerThrows = await observe(browser, {
    label: "ResizeObserver throws",
    userAgent: INSTAGRAM_IOS,
    viewport: { width: 393, height: 852 },
    hold: 6000,
    prepare: async (page) => {
      await page.addInitScript(() => {
        Object.defineProperty(window, "ResizeObserver", {
          configurable: true,
          value: function BrokenResizeObserver() {
            throw new TypeError("Illegal constructor");
          },
        });
      });
    },
  });
  judge(observerThrows, { label: "ResizeObserver throws", skipConsole: true });

  // Missing modern APIs, each removed on its own, so a failure names the API.
  for (const api of ["ResizeObserver", "IntersectionObserver", "matchMedia", "AudioContext", "ResizeObserver+IntersectionObserver"]) {
    const result = await observe(browser, {
      label: `without ${api}`,
      userAgent: INSTAGRAM_IOS,
      viewport: { width: 393, height: 852 },
      hold: 6000,
      prepare: async (page) => {
        await page.addInitScript((names) => {
          for (const name of String(names).split("+")) {
            try {
              Object.defineProperty(window, name, { configurable: true, get: () => undefined });
            } catch {
              /* ignore */
            }
          }
        }, api);
      },
    });
    judge(result, { label: `without ${api}` });
  }
}

// ================================ scenario: the long hold, left completely alone

/**
 * Thirty seconds of nothing.
 *
 * The ten-second holds elsewhere catch anything triggered by startup. This one
 * catches the slower shapes: an interval that fires every few seconds and
 * accumulates, a timer that eventually resolves into a state change, a retry
 * schedule that only becomes visible on its third attempt. Nothing is driven —
 * no resize, no focus, no navigation — because the point is to prove the page
 * is stable when left alone, which is what a visitor reading the home page is
 * actually doing.
 *
 * The census is sampled every 500ms throughout, so a disappearance that lasted
 * one second and recovered would still be caught rather than missed by a single
 * check at the end.
 */
async function longHold(browser) {
  section("thirty seconds, untouched");

  const result = await observe(browser, {
    label: "30s hold",
    userAgent: INSTAGRAM_IOS,
    viewport: { width: 393, height: 852 },
    hold: 30000,
  });

  judge(result, { label: "30s hold" });

  // Every sample, not just the last: content that vanished and came back is
  // still a bug, and a single end-of-run assertion cannot see it.
  const census = result.probe.census ?? [];
  const settled = census.filter((row) => row.at > 3000);
  const blanks = settled.filter((row) => !row.title || !row.cta || (row.rootText ?? 0) < 20);

  check(
    "30s hold: the headline was present in every sample after settling",
    blanks.length === 0,
    `${blanks.length}/${settled.length} samples were blank; first: ${JSON.stringify(blanks[0] ?? null).slice(0, 200)}`
  );
  check("30s hold: enough samples were taken to mean something", settled.length >= 40, `${settled.length} samples`);

  // Layout must not drift either — a heading whose height changes every sample
  // is the "shaking" the report described.
  const heights = new Set(settled.map((row) => row.title?.h));
  check(
    "30s hold: the headline's height is stable",
    heights.size <= 2,
    `heights seen: ${[...heights].join(", ")}`
  );
}

// ====================================== scenario: repeated loads, held open

/**
 * The acceptance test.
 *
 * The earlier reliability harness loaded the page and asked whether it
 * rendered. That cannot see a page that renders and then empties, which is why
 * every load here is held open and re-checked.
 */
async function repeated(browser, loads) {
  section(`${loads} loads, each held ${HOLD_MS / 1000}s`);

  const context = await browser.newContext({
    userAgent: INSTAGRAM_IOS,
    viewport: { width: 393, height: 852 },
    locale: "he-IL",
    isMobile: true,
    hasTouch: true,
  });

  let vanished = 0;
  let neverAppeared = 0;
  let replayed = 0;
  let noisy = 0;
  const samples = [];

  for (let i = 0; i < loads; i++) {
    const page = await context.newPage();
    await page.addInitScript(PROBE);
    await page.goto(`${BASE}/`, { waitUntil: "commit", timeout: 40000 }).catch(() => {});

    const appeared = await page
      .waitForFunction(() => !!document.querySelector("h1.home-title"), { timeout: 20000 })
      .then(() => true)
      .catch(() => false);

    if (!appeared) {
      neverAppeared++;
      samples.push({ i, kind: "never-appeared" });
      await page.close();
      continue;
    }

    await page.waitForTimeout(HOLD_MS);

    const probe = await page.evaluate(() => ({
      final: window.__FIQ_CENSUS__ ? window.__FIQ_CENSUS__() : null,
      animations: window.__FIQ_PROBE__.animations.length,
      byNode: window.__FIQ_PROBE__.byNode,
      titleRuns: window.__FIQ_PROBE__.animations.filter((r) => r.node.includes("home-title")).length,
      late: window.__FIQ_PROBE__.mutations.filter((m) => m.at > 4000).length,
      errors: window.__FIQ_PROBE__.errors,
      requests: window.__FIQ_PROBE__.requests,
    }));

    const final = probe.final ?? {};
    const stillThere =
      !!final.title && final.title.opacity !== "0" && final.title.visibility !== "hidden" && final.title.h > 0 && !!final.cta;

    if (!stillThere) {
      vanished++;
      samples.push({ i, kind: "vanished", final, errors: probe.errors });
    }
    const worst = Math.max(0, ...Object.values(probe.byNode ?? {}));
    if (worst > 3 || (probe.titleRuns ?? 0) > 1) {
      replayed++;
      if (samples.length < 6) samples.push({ i, kind: "animation-replay", worst, titleRuns: probe.titleRuns });
    }
    if (probe.late > 10) {
      noisy++;
      if (samples.length < 6) samples.push({ i, kind: "late-mutations", late: probe.late });
    }

    await page.close();
  }

  await context.close();

  check(`${loads} loads: the headline always appeared`, neverAppeared === 0, `${neverAppeared} never appeared`);
  check(`${loads} loads: nothing rendered and then vanished`, vanished === 0, `${vanished} vanished`);
  check(`${loads} loads: no repeated entrance animations`, replayed === 0, `${replayed} replayed`);
  check(`${loads} loads: the tree stayed quiet`, noisy === 0, `${noisy} noisy`);
  if (samples.length) console.log("    samples:", JSON.stringify(samples.slice(0, 4), null, 1).slice(0, 1200));
}

// ================================================================== driver

console.log(`\n======== stability QA @ ${BASE} ========`);

const browser = await launch();
try {
  if (!ONLY.length || ONLY.includes("baselines")) await baselines(browser);
  if (!ONLY.length || ONLY.includes("lifecycle")) await lifecycle(browser);
  if (!ONLY.length || ONLY.includes("degraded")) await degraded(browser);
  if (!ONLY.length || ONLY.includes("long-hold")) await longHold(browser);
  if (!ONLY.length || ONLY.includes("repeated")) await repeated(browser, LOADS);
} finally {
  await browser.close();
}

console.log(`\n======== ${passed}/${passed + failures.length} passed ========`);
for (const failure of failures) {
  console.log(`FAIL ${failure.name}${failure.detail ? `\n     ${failure.detail}` : ""}`);
}
process.exit(failures.length ? 1 : 0);
