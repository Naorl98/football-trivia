// Does one visitor's traffic affect another visitor's availability?
//
// That is the question behind "it goes blank sometimes, and it may be happening
// while other people are on the site", and it is not answerable by loading the
// page a hundred times in a row — which is what every harness here did until
// now. Sequential loads cannot see contention.
//
// So this measures, at rising concurrency, the only three things that stand
// between a visitor and a rendered page:
//
//   the shell       GET / — now served by Worker code, which is a change worth
//                   testing hard: before `run_worker_first` this response came
//                   from the asset layer and no Worker bug could affect it
//   the bundles     the hashed JS and CSS, same reasoning
//   the API         quiz generation and availability counts, which are the only
//                   requests that touch D1
//
// A blank page needs one of the first two to fail. The API cannot cause one —
// the home page makes no API calls at all — but it can make the product useless,
// so it is measured on the same axis.
//
// SAFETY. Nothing here writes. Room creation is included at low volume because
// it allocates Durable Objects, and every room it makes is left to expire on its
// own (empty rooms are swept after ten minutes). Concurrency tops out at 50,
// which is well inside the configured rate limits, and a 429 is reported
// separately from a failure because being throttled is the limiter working.
//
// Usage: node scripts/concurrency-qa.mjs [baseUrl] [--max=50]

const args = process.argv.slice(2);
const BASE = (args.find((a) => !a.startsWith("--")) ?? "https://football-iq.naorl.workers.dev").replace(/\/+$/, "");
const MAX = Number((args.find((a) => a.startsWith("--max=")) ?? "--max=50").slice(6));

const LEVELS = [1, 5, 10, 25, 50].filter((n) => n <= MAX);

const CONFIG = {
  region: "WORLD",
  countries: [],
  competitions: ["ALL"],
  categories: [],
  difficulty: "MIXED",
  questionCount: 10,
  gameMode: "CLASSIC",
  answerMode: "MULTIPLE_CHOICE",
};

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
const section = (t) => console.log(`\n--- ${t} ---`);

function stats(values) {
  if (values.length === 0) return { p50: 0, p95: 0, p99: 0, max: 0 };
  const s = [...values].sort((a, b) => a - b);
  const at = (p) => s[Math.min(s.length - 1, Math.floor((p / 100) * s.length))];
  return { p50: Math.round(at(50)), p95: Math.round(at(95)), p99: Math.round(at(99)), max: Math.round(s[s.length - 1]) };
}

/**
 * Fires `total` requests with exactly `concurrency` of them in flight.
 *
 * A fixed in-flight count rather than `Promise.all` over everything: firing 500
 * requests at once measures the local machine's socket pool, not the server.
 */
async function run(total, concurrency, make) {
  const timings = [];
  const statuses = {};
  const errors = [];
  const queue = Array.from({ length: total }, (_, i) => i);

  async function worker() {
    for (;;) {
      const job = queue.shift();
      if (job === undefined) return;
      const started = performance.now();
      try {
        const response = await make(job);
        const ms = performance.now() - started;
        statuses[response.status] = (statuses[response.status] ?? 0) + 1;
        // Draining the body is part of the request; not doing it holds the
        // connection open and makes every later timing a lie.
        const body = await response.arrayBuffer().catch(() => null);
        timings.push(performance.now() - started);
        if (response.status >= 500 || body === null) {
          errors.push(`${response.status} after ${Math.round(ms)}ms`);
        }
      } catch (error) {
        errors.push(String(error?.message ?? error).slice(0, 120));
      }
    }
  }

  await Promise.all(Array.from({ length: concurrency }, worker));
  return { ...stats(timings), statuses, errors, completed: timings.length, total };
}

function report(label, result) {
  const flags = [];
  if (result.errors.length) flags.push(`errors=${result.errors.length}`);
  const throttled = result.statuses["429"] ?? 0;
  if (throttled) flags.push(`429=${throttled}`);
  const server = Object.entries(result.statuses).filter(([s]) => Number(s) >= 500);
  if (server.length) flags.push(`5xx=${JSON.stringify(Object.fromEntries(server))}`);

  console.log(
    `  ${label.padEnd(30)} p50=${String(result.p50).padStart(5)} p95=${String(result.p95).padStart(5)} ` +
      `p99=${String(result.p99).padStart(5)} max=${String(result.max).padStart(5)}ms  ` +
      `${result.completed}/${result.total}${flags.length ? "  " + flags.join(" ") : ""}`
  );
}

// ========================================== 1. the shell, at rising concurrency

async function shellUnderLoad() {
  section("GET / — the one response a blank page requires");

  const rows = [];
  for (const concurrency of LEVELS) {
    const result = await run(concurrency * 4, concurrency, () => fetch(`${BASE}/`));
    report(`concurrency ${concurrency}`, result);
    rows.push({ concurrency, ...result });

    check(
      `shell @ ${concurrency}: every request answered`,
      result.completed === result.total && result.errors.length === 0,
      result.errors.slice(0, 3).join(" | ")
    );
    check(
      `shell @ ${concurrency}: no 5xx`,
      !Object.keys(result.statuses).some((s) => Number(s) >= 500),
      JSON.stringify(result.statuses)
    );
    check(
      `shell @ ${concurrency}: every response was 200`,
      (result.statuses["200"] ?? 0) === result.total,
      JSON.stringify(result.statuses)
    );
  }

  // The question the user actually asked: does load from others degrade a new
  // visitor's experience? A blank page needs a FAILED shell, not a slow one, so
  // the pass condition above is about errors — but a p95 that climbs with
  // concurrency is the early warning, so it is asserted too.
  const alone = rows[0];
  const busiest = rows[rows.length - 1];
  check(
    `shell: p95 does not collapse under ${busiest.concurrency} concurrent visitors`,
    busiest.p95 < Math.max(2000, alone.p95 * 8),
    `p95 ${alone.p95}ms alone -> ${busiest.p95}ms at ${busiest.concurrency}`
  );

  return rows;
}

// =================================================== 2. the bundles under load

async function assetsUnderLoad() {
  section("hashed assets — the other half of a blank page");

  const shell = await (await fetch(`${BASE}/`)).text();
  const js = shell.match(/\/assets\/index-[A-Za-z0-9_-]+\.js/)?.[0];
  const css = shell.match(/\/assets\/index-[A-Za-z0-9_-]+\.css/)?.[0];
  check("the shell names both bundles", !!js && !!css, `${js} ${css}`);
  if (!js || !css) return [];

  const rows = [];
  for (const concurrency of LEVELS) {
    // Alternating, so neither is measured in isolation.
    const result = await run(concurrency * 3, concurrency, (i) => fetch(`${BASE}${i % 2 ? css : js}`));
    report(`concurrency ${concurrency}`, result);
    rows.push({ concurrency, ...result });

    check(
      `assets @ ${concurrency}: every request answered 200`,
      (result.statuses["200"] ?? 0) === result.total && result.errors.length === 0,
      `${JSON.stringify(result.statuses)} ${result.errors.slice(0, 2).join(" | ")}`
    );
  }

  // A bundle answered as HTML is the stale-deploy trap; a bundle answered 5xx is
  // the new one that routing assets through the Worker introduced. Neither may
  // ever happen, so both are checked explicitly rather than inferred.
  const probe = await fetch(`${BASE}${js}`);
  check(
    "the bundle still has a JavaScript content type under load",
    (probe.headers.get("content-type") ?? "").includes("javascript"),
    probe.headers.get("content-type")
  );

  return rows;
}

// ======================================================= 3. D1 under load

async function d1UnderLoad() {
  section("D1 — quiz generation and availability counts");

  const generation = [];
  for (const concurrency of LEVELS) {
    const result = await run(concurrency * 2, concurrency, (i) =>
      fetch(`${BASE}/api/quiz`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        // Varying the shape so this is not one cached plan: the question count
        // changes the candidate window, and the difficulty changes which part of
        // the index is walked.
        body: JSON.stringify({
          ...CONFIG,
          questionCount: [5, 10, 20, 30][i % 4],
          difficulty: ["MIXED", "EASY", "NORMAL", "HARD", "EXPERT"][i % 5],
        }),
      })
    );
    report(`quiz @ ${concurrency}`, result);
    generation.push({ concurrency, ...result });

    const throttled = result.statuses["429"] ?? 0;
    check(
      `quiz @ ${concurrency}: no server errors`,
      !Object.keys(result.statuses).some((s) => Number(s) >= 500) && result.errors.length === 0,
      `${JSON.stringify(result.statuses)} ${result.errors.slice(0, 2).join(" | ")}`
    );
    if (throttled) {
      console.log(`       note: ${throttled} throttled at this level — the limiter, not a fault`);
    }
  }

  const counts = [];
  for (const concurrency of LEVELS) {
    const result = await run(concurrency * 2, concurrency, (i) =>
      fetch(`${BASE}/api/quiz/count`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          ...CONFIG,
          // Half repeat (cache hits), half fresh (cache misses), so neither the
          // cached nor the uncached path is measured alone.
          categories: i % 2 ? [] : [["PLAYERS"], ["CLUBS"], ["TRANSFERS"], ["TITLES"]][i % 4],
        }),
      })
    );
    report(`count @ ${concurrency}`, result);
    counts.push({ concurrency, ...result });
    check(
      `count @ ${concurrency}: no server errors`,
      !Object.keys(result.statuses).some((s) => Number(s) >= 500) && result.errors.length === 0,
      JSON.stringify(result.statuses)
    );
  }

  // The specific worry: a hot query that serialises. If p95 grows roughly in
  // proportion to concurrency, requests are queueing behind each other.
  const alone = generation[0];
  const busiest = generation[generation.length - 1];
  const growth = alone.p95 > 0 ? busiest.p95 / alone.p95 : 1;
  check(
    `quiz generation: p95 grows sub-linearly from 1 to ${busiest.concurrency} concurrent`,
    growth < busiest.concurrency / 2,
    `p95 ${alone.p95}ms -> ${busiest.p95}ms (x${growth.toFixed(1)}) at x${busiest.concurrency} load`
  );

  return { generation, counts };
}

// ============================= 4. does a busy site break a NEW visitor's load?

/**
 * The actual question, asked directly.
 *
 * Everything above measures one thing at a time. This runs heavy traffic in the
 * background and, while it is running, loads the shell and both bundles the way
 * a brand-new visitor would — because that is the reported scenario: it goes
 * blank "while other users are accessing the site".
 */
async function newVisitorDuringLoad() {
  section("a new visitor arriving while the site is busy");

  let stop = false;
  const background = [];

  // Heavy, mixed, and sustained: quiz generation (D1), counts (D1 + cache),
  // health, and the shell itself.
  for (let i = 0; i < 25; i++) {
    background.push(
      (async () => {
        while (!stop) {
          const pick = i % 4;
          try {
            if (pick === 0) {
              await fetch(`${BASE}/api/quiz`, {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ ...CONFIG, questionCount: 30 }),
              }).then((r) => r.arrayBuffer());
            } else if (pick === 1) {
              await fetch(`${BASE}/api/quiz/count`, {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ ...CONFIG, difficulty: "HARD" }),
              }).then((r) => r.arrayBuffer());
            } else if (pick === 2) {
              await fetch(`${BASE}/api/daily`).then((r) => r.arrayBuffer());
            } else {
              await fetch(`${BASE}/`).then((r) => r.arrayBuffer());
            }
          } catch {
            /* the background is load, not a measurement */
          }
        }
      })()
    );
  }

  // Let the load establish itself.
  await new Promise((r) => setTimeout(r, 3000));

  const visits = [];
  for (let i = 0; i < 30; i++) {
    const started = performance.now();
    let ok = false;
    let detail = "";
    try {
      const shellResponse = await fetch(`${BASE}/`);
      const html = await shellResponse.text();
      const js = html.match(/\/assets\/index-[A-Za-z0-9_-]+\.js/)?.[0];
      const css = html.match(/\/assets\/index-[A-Za-z0-9_-]+\.css/)?.[0];

      if (shellResponse.status !== 200) {
        detail = `shell ${shellResponse.status}`;
      } else if (!js || !css) {
        detail = "shell named no bundle";
      } else {
        const [jsResponse, cssResponse] = await Promise.all([fetch(`${BASE}${js}`), fetch(`${BASE}${css}`)]);
        await Promise.all([jsResponse.arrayBuffer(), cssResponse.arrayBuffer()]);
        const jsType = jsResponse.headers.get("content-type") ?? "";
        if (jsResponse.status !== 200 || cssResponse.status !== 200) {
          detail = `js ${jsResponse.status} css ${cssResponse.status}`;
        } else if (!jsType.includes("javascript")) {
          detail = `js content-type ${jsType}`;
        } else {
          ok = true;
        }
      }
    } catch (error) {
      detail = String(error?.message ?? error).slice(0, 100);
    }
    visits.push({ ok, ms: performance.now() - started, detail });
  }

  stop = true;
  await Promise.all(background);

  const broken = visits.filter((v) => !v.ok);
  const timings = stats(visits.map((v) => v.ms));
  console.log(
    `  full first visit (shell + js + css) under 25 busy clients: ` +
      `p50=${timings.p50} p95=${timings.p95} max=${timings.max}ms`
  );
  check(
    "a new visitor can always load the app while the site is busy",
    broken.length === 0,
    `${broken.length}/30 failed: ${broken.slice(0, 3).map((b) => b.detail).join(" | ")}`
  );

  return { visits: visits.length, broken: broken.length, timings };
}

// ======================================= 5. rooms, and whether they interfere

async function roomsUnderLoad() {
  section("durable objects — several rooms at once");

  const result = await run(10, 10, () =>
    fetch(`${BASE}/api/mp/rooms`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ mode: "CLASSIC_BATTLE" }),
    })
  );
  report("10 rooms at once", result);
  const throttled = result.statuses["429"] ?? 0;
  check(
    "concurrent room creation produces no server error",
    !Object.keys(result.statuses).some((s) => Number(s) >= 500) && result.errors.length === 0,
    JSON.stringify(result.statuses)
  );
  if (throttled) console.log(`       note: ${throttled} throttled — the limiter, not a fault`);

  // And with rooms live, the shell must still be fine. This is the "multiplayer
  // must never affect homepage availability" requirement, asked of the server.
  const after = await run(20, 10, () => fetch(`${BASE}/`));
  report("shell with rooms live", after);
  check(
    "live rooms do not affect the shell",
    (after.statuses["200"] ?? 0) === after.total && after.errors.length === 0,
    JSON.stringify(after.statuses)
  );
}

// ================================================================== driver

console.log(`\n======== concurrency QA @ ${BASE} ========`);
console.log(`levels: ${LEVELS.join(", ")}\n`);

const shellRows = await shellUnderLoad();
const assetRows = await assetsUnderLoad();
const d1Rows = await d1UnderLoad();
const visitor = await newVisitorDuringLoad();
await roomsUnderLoad();

console.log("\n--- summary ---");
console.log("shell p95 by concurrency:  ", shellRows.map((r) => `${r.concurrency}:${r.p95}ms`).join("  "));
console.log("assets p95 by concurrency: ", assetRows.map((r) => `${r.concurrency}:${r.p95}ms`).join("  "));
console.log("quiz p95 by concurrency:   ", d1Rows.generation.map((r) => `${r.concurrency}:${r.p95}ms`).join("  "));
console.log("count p95 by concurrency:  ", d1Rows.counts.map((r) => `${r.concurrency}:${r.p95}ms`).join("  "));
console.log(`new-visitor failures while busy: ${visitor.broken}/${visitor.visits}`);

console.log(`\n======== ${passed}/${passed + failures.length} passed ========`);
for (const f of failures) console.log(`FAIL ${f.name}${f.detail ? `\n     ${f.detail}` : ""}`);
process.exit(failures.length ? 1 : 0);
