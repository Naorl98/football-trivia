// Concurrency and latency, measured against a real deployment.
//
// NOT A STRESS TEST. It is deliberately sized to stay inside the configured
// rate limits, because the point is to measure what the product does when
// several people use it at once — not to find out what happens when it is
// attacked, which the limits already answer. A 429 here would be the limiter
// working and would tell us nothing about latency.
//
// What it is for: the reliability and security work in this phase added
// per-request work on every path — security headers and a CSP nonce on every
// response, a rate-limit call before every handler, the shell read as text so a
// nonce can be substituted, and a rewritten question-selection query. Each of
// those is defensible on its own; together they could easily have made the thing
// slower while every correctness test stayed green. This is the check that they
// did not.
//
// Usage: node scripts/load-qa.mjs [baseUrl]

const BASE = (process.argv[2] ?? "https://football-iq.naorl.workers.dev").replace(/\/+$/, "");

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

function percentile(sorted, p) {
  if (sorted.length === 0) return 0;
  const index = Math.min(sorted.length - 1, Math.floor((p / 100) * sorted.length));
  return sorted[index];
}

/** Runs `count` requests `concurrency` at a time, and reports the distribution. */
async function measure(label, count, concurrency, make) {
  const timings = [];
  const statuses = {};
  let errors = 0;

  const queue = Array.from({ length: count }, (_, i) => i);
  async function worker() {
    for (;;) {
      const job = queue.shift();
      if (job === undefined) return;
      const started = performance.now();
      try {
        const response = await make(job);
        timings.push(performance.now() - started);
        statuses[response.status] = (statuses[response.status] ?? 0) + 1;
        // Bodies must be drained or the connection is held open.
        await response.arrayBuffer().catch(() => {});
      } catch {
        errors++;
      }
    }
  }

  await Promise.all(Array.from({ length: concurrency }, worker));

  const sorted = [...timings].sort((a, b) => a - b);
  const row = {
    label,
    count,
    concurrency,
    statuses,
    errors,
    p50: Math.round(percentile(sorted, 50)),
    p95: Math.round(percentile(sorted, 95)),
    max: Math.round(sorted.at(-1) ?? 0),
  };

  console.log(
    `  ${label.padEnd(34)} n=${String(count).padStart(3)} c=${String(concurrency).padStart(2)}  ` +
      `p50=${String(row.p50).padStart(5)}ms p95=${String(row.p95).padStart(5)}ms max=${String(row.max).padStart(5)}ms  ` +
      `${JSON.stringify(statuses)}${errors ? ` errors=${errors}` : ""}`
  );
  return row;
}

console.log(`\n======== load / latency @ ${BASE} ========\n`);

const rows = [];

// The shell. Every visit pays for this one, and it is the response that now
// carries a freshly generated nonce and a text read of index.html.
rows.push(await measure("shell (GET /)", 60, 10, () => fetch(`${BASE}/`)));

// A hashed asset, which is the request the immutable cache policy is for.
const shell = await (await fetch(`${BASE}/`)).text();
const bundle = shell.match(/\/assets\/index-[A-Za-z0-9_-]+\.js/)?.[0];
if (bundle) {
  rows.push(await measure("hashed bundle", 40, 10, () => fetch(`${BASE}${bundle}`)));
}

rows.push(await measure("health", 40, 10, () => fetch(`${BASE}/api/health`)));

// Quiz generation: the query that was rewritten. Varying the question count
// also varies the candidate window, so this is not one cached shape.
rows.push(
  await measure("quiz generation", 60, 8, (i) =>
    fetch(`${BASE}/api/quiz`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ ...CONFIG, questionCount: [5, 10, 20, 30][i % 4] }),
    })
  )
);

// Availability counts, which are now cached at the edge. The first call for a
// given filter pays for it; the rest should be visibly cheaper, and that gap is
// the whole justification for the cache.
const COLD_FILTERS = ["EASY", "NORMAL", "HARD", "EXPERT"];
rows.push(
  await measure("availability count (4 filters)", 40, 8, (i) =>
    fetch(`${BASE}/api/quiz/count`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ ...CONFIG, difficulty: COLD_FILTERS[i % COLD_FILTERS.length] }),
    })
  )
);

rows.push(await measure("daily challenge", 30, 6, () => fetch(`${BASE}/api/daily`)));

// Rooms: Durable Object allocation, concurrently. Each one is a real room, and
// each is left to expire on its own (an empty room is swept after ten minutes),
// which is why this count is modest.
const roomRow = await measure("room creation", 24, 6, () =>
  fetch(`${BASE}/api/mp/rooms`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ mode: "CLASSIC_BATTLE" }),
  })
);
rows.push(roomRow);

// Many sockets into one room at once — the Durable Object is single-threaded,
// so this is the one place concurrency could serialise into something slow.
{
  const created = await fetch(`${BASE}/api/mp/rooms`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ mode: "CLASSIC_BATTLE" }),
  });
  if (created.ok) {
    const { code } = await created.json();
    const started = performance.now();
    const sockets = [];
    const outcomes = await Promise.all(
      Array.from({ length: 16 }, (_, i) => {
        const url = `${BASE.replace(/^http/, "ws")}/api/mp/rooms/${code}/ws?t=${String(i).padStart(32, "s")}`;
        const socket = new WebSocket(url);
        sockets.push(socket);
        return new Promise((resolve) => {
          const at = performance.now();
          socket.onopen = () => resolve({ ok: true, ms: performance.now() - at });
          socket.onerror = () => resolve({ ok: false });
          socket.onclose = () => resolve({ ok: false });
          setTimeout(() => resolve({ ok: false, timeout: true }), 15000);
        });
      })
    );
    const opened = outcomes.filter((o) => o.ok);
    const times = opened.map((o) => o.ms).sort((a, b) => a - b);
    console.log(
      `  ${"16 sockets into one room".padEnd(34)} opened=${opened.length}/16  ` +
        `p50=${Math.round(percentile(times, 50))}ms p95=${Math.round(percentile(times, 95))}ms ` +
        `wall=${Math.round(performance.now() - started)}ms`
    );
    rows.push({ label: "16 sockets into one room", opened: opened.length, p50: Math.round(percentile(times, 50)) });
    for (const socket of sockets) {
      try {
        socket.close();
      } catch {
        /* already closing */
      }
    }
  }
}

// ------------------------------------------------------------------- verdict

console.log("");

const limits = {
  "shell (GET /)": 1200,
  "hashed bundle": 2500,
  health: 800,
  "quiz generation": 3000,
  "availability count (4 filters)": 1500,
  "daily challenge": 3000,
  "room creation": 2500,
};

let bad = 0;
for (const row of rows) {
  if (row.errors) {
    console.log(`FAIL ${row.label}: ${row.errors} request(s) failed outright`);
    bad++;
  }
  // A 429 here means the harness outgrew the limits, which is a problem with the
  // harness; anything 5xx is a problem with the product.
  for (const status of Object.keys(row.statuses ?? {})) {
    if (Number(status) >= 500) {
      console.log(`FAIL ${row.label}: served ${row.statuses[status]} x ${status}`);
      bad++;
    }
    if (status === "429") {
      console.log(`NOTE ${row.label}: ${row.statuses[status]} x 429 — the harness hit a rate limit, not a fault`);
    }
  }
  const limit = limits[row.label];
  if (limit && row.p95 > limit) {
    console.log(`FAIL ${row.label}: p95 ${row.p95}ms over the ${limit}ms budget`);
    bad++;
  }
  if (row.label === "16 sockets into one room" && row.opened < 16) {
    console.log(`FAIL ${row.label}: only ${row.opened}/16 opened`);
    bad++;
  }
}

console.log(bad === 0 ? "\n======== all within budget ========" : `\n======== ${bad} problem(s) ========`);
process.exit(bad ? 1 : 0);
