import { Hono } from "hono";
import type { Env } from "./env";
import { quizRoutes } from "./routes/quiz";
import { challengeRoutes } from "./routes/challenges";
import { dailyRoutes } from "./routes/daily";
import { attemptRoutes } from "./routes/attempts";
import { multiplayerRoutes } from "./routes/multiplayer";
import { healthRoutes } from "./routes/health";
import { cspNonce, harden, HASHED_ASSET_PREFIX, securityHeaders } from "./lib/security";

const app = new Hono<{ Bindings: Env }>();

// ---------------------------------------------------------------- every response

/**
 * Security headers on everything, including errors and 404s.
 *
 * A header that is only present on the happy path is not a security control. It
 * runs as middleware rather than per route so a route added later cannot forget.
 * The HTML shell is the exception and handles its own headers below, because it
 * is the only response that needs a CSP nonce.
 */
app.use("*", async (c, next) => {
  await next();
  // A 101 is a WebSocket handshake: its headers belong to the protocol upgrade
  // and the Response carries the live socket, so it is left exactly as the
  // Durable Object produced it. Nothing in this file protects a socket anyway —
  // that is the room engine's job, over the socket, per message.
  if (c.res.status === 101) return;
  if (c.res.headers.has("Content-Security-Policy")) return;
  const url = new URL(c.req.url);
  for (const [key, value] of Object.entries(securityHeaders(url, null))) {
    c.res.headers.set(key, value);
  }
});

/**
 * API responses are never cached.
 *
 * A quiz is random, a room summary is live, and the daily challenge rolls over
 * at midnight Israel time. An intermediary caching any of them produces a bug
 * that only reproduces for whoever is behind that intermediary. Count responses
 * opt back in explicitly, inside the route, because those genuinely are stable.
 */
app.use("/api/*", async (c, next) => {
  await next();
  if (c.res.status === 101) return;
  if (!c.res.headers.has("Cache-Control")) {
    c.res.headers.set("Cache-Control", "no-store");
  }
});

app.route("/api/quiz", quizRoutes);
app.route("/api/challenges", challengeRoutes);
app.route("/api/daily", dailyRoutes);
app.route("/api/attempts", attemptRoutes);
app.route("/api/mp", multiplayerRoutes);
app.route("/api/health", healthRoutes);

// --------------------------------------------------------------------- failures

/**
 * The one place an unhandled exception turns into a response.
 *
 * Hono's default error handler returns the thrown message in the body. For a
 * route that forgot a try/catch that means a D1 error string — table names,
 * column names, sometimes a fragment of SQL — is handed to whoever sent the
 * request. This replaces all of it with a fixed shape, and keeps the detail in
 * the Worker log where it belongs.
 */
app.onError((err, c) => {
  console.error("unhandled", {
    path: new URL(c.req.url).pathname,
    method: c.req.method,
    name: err?.name,
    message: err?.message,
  });
  const url = new URL(c.req.url);
  if (url.pathname.startsWith("/api/")) {
    return c.json({ error: "Internal error", messageHe: "משהו השתבש אצלנו. נסו שוב." }, 500);
  }
  return new Response("Internal error", { status: 500, headers: securityHeaders(url, null) });
});

// ----------------------------------------------------------------------- assets

/**
 * Static assets, served by the Worker rather than past it.
 *
 * THIS FUNCTION IS THE BLANK-SCREEN FIX. The mechanism it closes, which was
 * reproduced against production before it was written:
 *
 *   1. a visitor holds index.html from deployment N (a restored iOS tab, a
 *      back/forward entry, an edge or browser cache that had not revalidated)
 *   2. that HTML asks for /assets/index-<hash N>.js
 *   3. deployment N+1 deleted that file, because the hash changed
 *   4. `not_found_handling: single-page-application` answered the missing file
 *      with 200 OK and index.html, Content-Type text/html
 *   5. the browser refuses it — "Expected a JavaScript-or-Wasm module script but
 *      the server responded with a MIME type of text/html. Strict MIME type
 *      checking is enforced for module scripts per HTML spec."
 *   6. React never mounts. #root stays empty. The stale CSS is missing too, so
 *      the page is not merely empty, it is white.
 *
 * Nothing in that chain produces an error the app can catch, which is why it
 * sat there indefinitely until the visitor happened to reload.
 *
 * So: a request under /assets/ that does not match a file gets a real 404. The
 * browser then fires an `error` event on the script element, which index.html's
 * bootstrap listens for and turns into a one-shot reload onto the current
 * shell — the recovery that used to require the visitor to think of it.
 *
 * SPA fallback still exists, for its actual purpose: /daily and /room/482731 are
 * client-side routes with no file behind them and must return the shell.
 */
async function serveAsset(request: Request, env: Env, url: URL): Promise<Response> {
  const asset = await env.ASSETS.fetch(request);

  if (url.pathname.startsWith(HASHED_ASSET_PREFIX)) {
    // A missing hashed asset is a stale client, not a route. Say 404 and mean it.
    if (asset.status === 404) {
      return new Response("Not found", {
        status: 404,
        headers: { ...securityHeaders(url, null), "Cache-Control": "no-store", "Content-Type": "text/plain" },
      });
    }
    return harden(asset, url);
  }

  if (asset.status === 404) return shell(env, url);
  // A real file: index.html itself arrives here too, and needs its nonce.
  const type = asset.headers.get("Content-Type") ?? "";
  if (type.includes("text/html")) return shell(env, url);
  return harden(asset, url);
}

/**
 * The app shell, with a nonce stitched into it.
 *
 * index.html carries one inline bootstrap script — the loading shell, the
 * startup-stage tracker and the failsafe — and that script is what lets a
 * failed startup say something instead of showing a white page. Under a CSP
 * strict enough to be worth having, inline script needs a nonce, and a nonce
 * must differ per response, so the placeholder is substituted here. The file is
 * about two kilobytes; reading it as text costs nothing worth measuring.
 */
async function shell(env: Env, url: URL): Promise<Response> {
  const indexUrl = new URL("/index.html", url.origin);
  const response = await env.ASSETS.fetch(new Request(indexUrl.toString(), { method: "GET" }));

  if (!response.ok) {
    // There is no shell. Nothing the client can do with this, but it must not be
    // a white page either.
    return new Response("Application unavailable", {
      status: 503,
      headers: { ...securityHeaders(url, null), "Content-Type": "text/plain", "Cache-Control": "no-store" },
    });
  }

  const nonce = cspNonce();
  const html = (await response.text()).replaceAll("__CSP_NONCE__", nonce);

  return new Response(html, {
    status: 200,
    headers: {
      ...securityHeaders(url, nonce),
      "Content-Type": "text/html; charset=utf-8",
      // Never cached, anywhere. This is the document that points at the hashed
      // bundles, so a stale copy of it is the one thing that breaks startup.
      "Cache-Control": "no-store, must-revalidate",
    },
  });
}

/**
 * Anything that is not an API route is the client's business.
 *
 * API 404s stay JSON so the client's one error path keeps working; everything
 * else is a client-side route and gets the shell.
 */
app.notFound(async (c) => {
  const url = new URL(c.req.url);
  if (url.pathname.startsWith("/api/")) {
    return c.json({ error: "Not found" }, 404);
  }
  return serveAsset(c.req.raw, c.env, url);
});

export default app;

// Durable Object classes have to be exported from the Worker's entry module for
// the runtime to be able to construct them; the bindings in wrangler.jsonc refer
// to these class names.
export { RoomDurableObject } from "./durable/RoomDurableObject";
export { MatchmakerDurableObject } from "./durable/MatchmakerDurableObject";
