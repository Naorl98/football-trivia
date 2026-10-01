// The security suite that needs a running deployment.
//
// Everything testable as a pure function is in tests/ and runs with `npm test`.
// What is left is the stuff that only exists once the Worker, D1, the Durable
// Objects and the assets binding are all wired together: headers actually on
// the wire, validation actually rejecting, rate limits actually counting, and
// the stale-asset 404 that the blank-screen fix depends on.
//
// Usage:
//   node scripts/security-qa.mjs [baseUrl]
//
// It is deliberately safe to run against production: nothing it sends is
// destructive, the write-path probes stop at the first 429 rather than pushing
// through it, and the rate-limit checks are the only ones that spend an
// allowance — which recovers in a minute.

const BASE = (process.argv[2] ?? "https://football-iq.naorl.workers.dev").replace(/\/+$/, "");

let passed = 0;
const failures = [];

function check(name, condition, detail) {
  if (condition) {
    passed++;
    console.log(`  ok   ${name}`);
  } else {
    failures.push({ name, detail });
    console.log(`  FAIL ${name}${detail ? ` — ${detail}` : ""}`);
  }
}

function section(title) {
  console.log(`\n--- ${title} ---`);
}

async function json(path, init) {
  const response = await fetch(`${BASE}${path}`, init);
  const text = await response.text();
  let body = null;
  try {
    body = JSON.parse(text);
  } catch {
    /* not JSON, which is sometimes the point */
  }
  return { response, text, body, status: response.status };
}

const VALID_CONFIG = {
  region: "WORLD",
  countries: [],
  competitions: ["ALL"],
  categories: [],
  difficulty: "MIXED",
  questionCount: 10,
  gameMode: "CLASSIC",
  answerMode: "MULTIPLE_CHOICE",
};

function post(body) {
  return {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: typeof body === "string" ? body : JSON.stringify(body),
  };
}

// ===================================================== 1. security headers

async function headers() {
  section("security headers");

  const { response } = await json("/");
  const get = (name) => response.headers.get(name) ?? "";

  const csp = get("content-security-policy");
  check("Content-Security-Policy present", csp.length > 0);
  check("CSP: default-src locked to self", csp.includes("default-src 'self'"));
  check("CSP: no unsafe-eval", !csp.includes("unsafe-eval"), csp);
  check(
    "CSP: script-src has no unsafe-inline",
    !/script-src[^;]*'unsafe-inline'/.test(csp),
    csp.match(/script-src[^;]*/)?.[0]
  );
  check("CSP: script-src carries a nonce", /script-src[^;]*'nonce-/.test(csp));
  check("CSP: object-src none", csp.includes("object-src 'none'"));
  check("CSP: base-uri self", csp.includes("base-uri 'self'"));
  check("CSP: frame-ancestors none", csp.includes("frame-ancestors 'none'"));
  check("CSP: websocket origin allowed", /connect-src[^;]*wss?:\/\//.test(csp), csp.match(/connect-src[^;]*/)?.[0]);

  check("X-Content-Type-Options nosniff", get("x-content-type-options") === "nosniff");
  check("Referrer-Policy set", get("referrer-policy").length > 0, get("referrer-policy"));
  check("Permissions-Policy set", get("permissions-policy").length > 0);
  check("X-Frame-Options DENY", get("x-frame-options") === "DENY");
  check(
    "HSTS present over https",
    BASE.startsWith("https") ? /max-age=\d{7,}/.test(get("strict-transport-security")) : true,
    get("strict-transport-security")
  );

  // The nonce in the header has to be the one in the document, or the inline
  // bootstrap — the thing that shows a recovery screen instead of a white page —
  // is blocked by our own policy.
  //
  // Header and body must come from the SAME response. Reading the header from
  // one fetch and the body from another can never match, because the nonce is
  // regenerated per response — which is the next assertion.
  const shellResponse = await fetch(`${BASE}/`);
  const shellCsp = shellResponse.headers.get("content-security-policy") ?? "";
  const html = await shellResponse.text();
  const headerNonce = shellCsp.match(/'nonce-([^']+)'/)?.[1];

  check(
    "document nonce matches the header nonce from the same response",
    !!headerNonce && html.includes(`nonce="${headerNonce}"`),
    headerNonce ? `header said ${headerNonce}` : "no nonce in header"
  );
  check("no unsubstituted nonce placeholder left in the document", !html.includes("__CSP_NONCE__"));

  // Two responses must not share a nonce.
  const second = await fetch(`${BASE}/`);
  const secondNonce = (second.headers.get("content-security-policy") ?? "").match(/'nonce-([^']+)'/)?.[1];
  check("nonce differs per response", !!secondNonce && secondNonce !== headerNonce, `${headerNonce} vs ${secondNonce}`);

  const api = await json("/api/health");
  check("headers are on API responses too", (api.response.headers.get("content-security-policy") ?? "").length > 0);
  check("API responses are not cached", (api.response.headers.get("cache-control") ?? "").includes("no-store"));
}

// ========================================== 2. the stale-asset blank screen

async function staleAssets() {
  section("stale assets (the blank-screen root cause)");

  const missing = await fetch(`${BASE}/assets/index-DOESNOTEXIST.js`);
  const type = missing.headers.get("content-type") ?? "";

  // THE REGRESSION TEST FOR THE WHITE SCREEN. This used to be 200 + text/html,
  // which a module script refuses with a MIME error that nothing can catch.
  check("a missing hashed asset is 404, not 200", missing.status === 404, `got ${missing.status}`);
  check("a missing hashed asset is not served as HTML", !type.includes("text/html"), type);

  const missingCss = await fetch(`${BASE}/assets/index-DOESNOTEXIST.css`);
  check("the same holds for stylesheets", missingCss.status === 404, `got ${missingCss.status}`);

  // The live bundle, which the shell names, must be immutably cacheable.
  const shell = await (await fetch(`${BASE}/`)).text();
  const bundle = shell.match(/\/assets\/index-[A-Za-z0-9_-]+\.js/)?.[0];
  check("the shell names a hashed bundle", !!bundle, bundle);

  if (bundle) {
    const asset = await fetch(`${BASE}${bundle}`);
    const cache = asset.headers.get("cache-control") ?? "";
    check("the live bundle is served 200", asset.status === 200);
    check("hashed assets are immutable", cache.includes("immutable"), cache);
    check("hashed assets are long-lived", /max-age=\d{7,}/.test(cache), cache);
    check(
      "the bundle has a JavaScript MIME type",
      (asset.headers.get("content-type") ?? "").includes("javascript"),
      asset.headers.get("content-type")
    );
  }

  const shellResponse = await fetch(`${BASE}/`);
  check(
    "the shell is never stored",
    (shellResponse.headers.get("cache-control") ?? "").includes("no-store"),
    shellResponse.headers.get("cache-control")
  );

  // A client-side route still has to get the shell, or deep links break.
  for (const route of ["/daily", "/build", "/multiplayer", "/room/482731", "/privacy"]) {
    const page = await fetch(`${BASE}${route}`);
    const ok = page.status === 200 && (page.headers.get("content-type") ?? "").includes("text/html");
    check(`deep link ${route} returns the shell`, ok, `${page.status} ${page.headers.get("content-type")}`);
  }

  check(
    "the boot shell is in the HTML, so there is something to see before React",
    shell.includes('id="boot"') && shell.includes("טוען"),
    "no boot shell found"
  );
}

// =========================================== 3. no secrets or files leaked

async function leaks() {
  section("static asset / secret exposure");

  const forbidden = [
    "/.dev.vars", "/.env", "/.env.local", "/.env.production", "/wrangler.json", "/wrangler.jsonc",
    "/package.json", "/package-lock.json", "/tsconfig.json", "/seed/seed.sql", "/seed.sql",
    "/migrations/0001_init.sql", "/.git/config", "/src/worker/index.ts", "/scripts/seed-apply.mjs",
    "/dist/football_iq/index.js", "/vite.config.ts", "/.assetsignore",
  ];

  for (const path of forbidden) {
    const response = await fetch(`${BASE}${path}`);
    const text = await response.text();
    const type = response.headers.get("content-type") ?? "";

    // Returning the SPA shell for an unknown path is fine and expected; what
    // must never happen is the real file coming back.
    const servedTheShell = response.status === 200 && type.includes("text/html") && text.includes('id="root"');
    const leaked = response.status === 200 && !servedTheShell;
    check(`${path} is not served`, !leaked, `${response.status} ${type} ${text.slice(0, 80)}`);
  }

  // The one that matters most: the provider key, by name and by shape, anywhere
  // a client can reach.
  const shell = await (await fetch(`${BASE}/`)).text();
  const bundleName = shell.match(/\/assets\/index-[A-Za-z0-9_-]+\.js/)?.[0];
  const bundle = bundleName ? await (await fetch(`${BASE}${bundleName}`)).text() : "";

  for (const needle of ["API_FOOTBALL_KEY", "x-apisports-key", "x-rapidapi-key", "CLOUDFLARE_API_TOKEN", "account_id"]) {
    check(`the client bundle does not contain "${needle}"`, !bundle.includes(needle));
  }
  // A 32-or-more-character hex run is the shape of the provider key and of a
  // Cloudflare id. The bundle legitimately contains hashes, so this looks for
  // the key names above being adjacent to one, not for hex on its own.
  check(
    "no key-shaped value sits next to a credential name in the bundle",
    !/(key|token|secret)["'\s:=]+[A-Za-z0-9]{24,}/i.test(bundle),
    bundle.match(/(key|token|secret)["'\s:=]+[A-Za-z0-9]{24,}/i)?.[0]?.slice(0, 40)
  );

  check("no source map is published next to the bundle", bundleName ? (await fetch(`${BASE}${bundleName}.map`)).status !== 200 : true);
  check("sourceMappingURL is absent from the bundle", !bundle.includes("sourceMappingURL"));
}

// ============================================ 4. input validation at the API

async function validation() {
  section("input validation");

  // Malformed bodies must be 400s, not 500s with an internal message in them.
  for (const [label, body] of [
    ["unparseable JSON", "{not json"],
    ["a bare string", '"hello"'],
    ["null", "null"],
    ["an array", "[]"],
    ["a number", "42"],
  ]) {
    for (const path of ["/api/quiz", "/api/quiz/count", "/api/attempts", "/api/challenges"]) {
      const { status, text } = await json(path, post(body));
      // 429 means the rate limiter spoke first, which is also a correct refusal.
      const refused = status === 400 || status === 429;
      check(`${path} refuses ${label}`, refused, `${status} ${text.slice(0, 90)}`);
    }
  }

  // Oversized and hostile values.
  const huge = "x".repeat(200_000);
  const cases = [
    ["oversized answers array", "/api/attempts", { answers: Array.from({ length: 5000 }, () => ({ correct: true })), durationSeconds: 1 }],
    ["answers of the wrong type", "/api/attempts", { answers: "nope", durationSeconds: 1 }],
    ["answers containing junk", "/api/attempts", { answers: [1, "x", null], durationSeconds: 1 }],
    ["NaN duration", "/api/attempts", { answers: [{ correct: true }], durationSeconds: "NaN" }],
    ["enormous challenge id", "/api/attempts", { answers: [{ correct: true }], durationSeconds: 1, challengePublicId: huge }],
    ["invalid difficulty", "/api/quiz", { ...VALID_CONFIG, difficulty: "IMPOSSIBLE" }],
    ["invalid gameMode", "/api/quiz", { ...VALID_CONFIG, gameMode: "../../etc/passwd" }],
    ["invalid questionCount", "/api/quiz", { ...VALID_CONFIG, questionCount: 99999 }],
    ["negative questionCount", "/api/quiz", { ...VALID_CONFIG, questionCount: -5 }],
    ["unknown countries", "/api/quiz", { ...VALID_CONFIG, countries: Array.from({ length: 400 }, (_, i) => `X${i}`) }],
    ["unknown competitions", "/api/quiz", { ...VALID_CONFIG, competitions: Array.from({ length: 400 }, (_, i) => `C${i}`) }],
    ["SQL in a region", "/api/quiz", { ...VALID_CONFIG, region: "WORLD' OR 1=1 --" }],
    ["SQL in a category", "/api/quiz", { ...VALID_CONFIG, categories: ["PLAYERS'); DROP TABLE questions;--"] }],
    ["oversized exclude list", "/api/quiz", { ...VALID_CONFIG, excludeQuestionIds: Array.from({ length: 50_000 }, (_, i) => i) }],
    ["hostile exclude list", "/api/quiz", { ...VALID_CONFIG, excludeQuestionIds: ["1); DROP TABLE questions;--", 3.5, null, NaN] }],
  ];

  for (const [label, path, body] of cases) {
    const { status, text } = await json(path, post(body));
    // Either refused outright, or accepted after the bad parts were filtered
    // away — both are correct, as long as it is never a 500 and never an error
    // that quotes the database.
    const sane = status !== 500 && status < 600;
    check(`${label} does not 500`, sane, `${status} ${text.slice(0, 120)}`);
    check(
      `${label} leaks no internals`,
      !/SQLITE|D1_ERROR|sqlite|at Object\.|\/src\/|node_modules|SELECT |INSERT /i.test(text),
      text.slice(0, 160)
    );
  }

  // Route params.
  for (const code of ["abc", "12345", "1234567", "%2e%2e%2f", "0' OR '1'='1", "../../etc/passwd", "1".repeat(500)]) {
    const { status, text } = await json(`/api/mp/rooms/${encodeURIComponent(code)}`);
    const sane = status === 400 || status === 404 || status === 429;
    check(`room code "${code.slice(0, 20)}" is refused cleanly`, sane, `${status} ${text.slice(0, 80)}`);
  }

  for (const id of ["../../etc/passwd", "' OR 1=1 --", "x".repeat(500), "<script>", "%00"]) {
    const { status, text } = await json(`/api/challenges/${encodeURIComponent(id)}`);
    check(`challenge id "${id.slice(0, 16)}" is refused cleanly`, status === 404 || status === 400, `${status}`);
    check(`challenge id "${id.slice(0, 16)}" leaks nothing`, !/SQLITE|D1_ERROR|SELECT /i.test(text), text.slice(0, 120));
  }

  // XSS payloads in the one place the API takes free text that is echoed back.
  // They must come back as data, never as executable markup, and must not be
  // reflected into an HTML response at all.
  for (const payload of [
    "<script>alert(1)</script>",
    '<img src=x onerror=alert(1)>',
    "javascript:alert(1)",
    "&lt;script&gt;",
    "‮evil",
    "';alert(1);//",
  ]) {
    const { response, text } = await json("/api/attempts", post({
      answers: [{ correct: true, questionId: 1 }],
      durationSeconds: 5,
      challengePublicId: payload,
    }));
    const type = response.headers.get("content-type") ?? "";
    check(
      `XSS payload is not reflected as HTML (${payload.slice(0, 22)})`,
      !type.includes("text/html") && !text.includes("<script>"),
      `${type} ${text.slice(0, 80)}`
    );
  }
}

// ============================================= 5. errors reveal nothing

async function errorHygiene() {
  section("error responses");

  const notFound = await json("/api/nope");
  check("unknown API route is a JSON 404", notFound.status === 404 && notFound.body !== null, notFound.text.slice(0, 80));
  check("unknown API route leaks no stack", !/at |\/src\/|node_modules/.test(notFound.text));

  const badMethod = await json("/api/daily", { method: "DELETE" });
  check("wrong method does not 500", badMethod.status !== 500, String(badMethod.status));

  const health = await json("/api/health");
  check("health is 200", health.status === 200);
  check("health says only that it is ok", JSON.stringify(health.body) === '{"status":"ok"}', health.text);

  const deep = await json("/api/health?deep=1");
  check("deep health reports D1 and the DO bindings", deep.body?.database === "ok" && deep.body?.room === "ok", deep.text);
  check(
    "deep health exposes no infrastructure detail",
    !/colo|database_id|f9fccac0|durable|account/i.test(deep.text),
    deep.text
  );
}

// ================================================ 6. CORS and clickjacking

async function crossOrigin() {
  section("cross-origin");

  const { response } = await json("/api/health", { headers: { Origin: "https://evil.example" } });
  const allow = response.headers.get("access-control-allow-origin");
  check("no wildcard CORS on API routes", allow !== "*", String(allow));
  check("no CORS grant to an arbitrary origin", allow !== "https://evil.example", String(allow));

  const page = await fetch(`${BASE}/`);
  const csp = page.headers.get("content-security-policy") ?? "";
  check("framing is refused by CSP", csp.includes("frame-ancestors 'none'"));
  check("framing is refused by X-Frame-Options", page.headers.get("x-frame-options") === "DENY");
}

// ==================================================== 7. rate limits exist

async function rateLimits() {
  section("rate limiting");

  // The enumeration oracle. Fire past the limit and expect to be stopped.
  //
  // The attempt counts here track the configured limits in wrangler.jsonc, which
  // are deliberately generous — they are set against a shared carrier address,
  // not a single device, because the first version was tight enough to deny
  // service to legitimate users. Raise these if the limits are raised.
  let lookupLimited = false;
  for (let i = 0; i < 170 && !lookupLimited; i++) {
    const response = await fetch(`${BASE}/api/mp/rooms/${String(100000 + i)}`);
    if (response.status === 429) lookupLimited = true;
  }
  check("room-code lookups are rate limited", lookupLimited, "no 429 within 170 attempts");

  // And the refusal has to be usable: a status and a Retry-After, not a hang.
  if (lookupLimited) {
    const response = await fetch(`${BASE}/api/mp/rooms/482731`);
    check("a throttled response carries Retry-After", !!response.headers.get("retry-after") || response.status !== 429);
  }

  let writeLimited = false;
  for (let i = 0; i < 45 && !writeLimited; i++) {
    const { status } = await json("/api/attempts", post({
      answers: [{ correct: true, questionId: 1, selectedOptionId: null, timeMs: 1000 }],
      durationSeconds: 10,
    }));
    if (status === 429) writeLimited = true;
  }
  check("D1 writes are rate limited", writeLimited, "no 429 within 45 attempts");
}

// ================================================================== driver

console.log(`\n======== security QA @ ${BASE} ========`);

await headers();
await staleAssets();
await leaks();
await validation();
await errorHygiene();
await crossOrigin();
await rateLimits();

console.log(`\n======== ${passed}/${passed + failures.length} passed ========`);
for (const failure of failures) {
  console.log(`FAIL ${failure.name}${failure.detail ? `\n     ${failure.detail}` : ""}`);
}
process.exit(failures.length ? 1 : 0);
