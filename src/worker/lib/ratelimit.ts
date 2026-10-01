// Rate limiting at the trust boundary.
//
// Everything expensive or stateful in this app is reachable by anyone with the
// URL — there are no accounts, so there is no cheaper identity to meter than the
// client address. What that buys, per endpoint:
//
//   room creation    a loop with no limit mints Durable Objects for free and
//                    walks the six-digit code space towards exhaustion
//   room lookup      `GET /api/mp/rooms/:code` answers 200 or 404, which is an
//                    oracle. A million codes at full speed enumerates every live
//                    room in the product; metered, it is a thousand years
//   quiz / count     each one reads 15,000-25,000 D1 rows (measured), so this is
//                    the one route where a single request has real server cost
//   attempts         one unauthenticated D1 *write* per request, against a daily
//                    row budget that is not large
//
// WHY THE NATIVE BINDING rather than a Durable Object counter. A DO limiter
// means an extra round trip on the hot path and a storage write per request,
// which is more expensive than the thing it protects. The platform limiter is
// in-colo and free. The trade is that its counters are per Cloudflare location
// rather than global, so a widely distributed attacker gets one bucket per
// location — that is a stated limitation of the mechanism, and it is still the
// difference between "unbounded" and "bounded per site".
//
// WHY FAIL-OPEN. `limit()` is infrastructure; if it throws, the choice is to
// serve the request or to take the product down. For abuse mitigation — as
// opposed to authorisation, which is enforced in the room engine and does not
// live here — serving it is correct.

import type { Context } from "hono";
import type { Env, RateLimiterName } from "../env";

/**
 * The metering key.
 *
 * `CF-Connecting-IP` is set by Cloudflare's own edge and cannot be spoofed by
 * the client; the `X-Forwarded-For` header, which can be, is deliberately not
 * consulted. The key is passed to the limiter and never logged or stored.
 */
function clientKey(request: Request): string {
  return request.headers.get("CF-Connecting-IP") ?? "unknown";
}

/**
 * Consumes one token. True means "serve it".
 *
 * The scope prefix keeps endpoints that share a binding from sharing a bucket —
 * exhausting the room-lookup allowance should not also stop you creating a room.
 */
export async function allow(env: Env, request: Request, name: RateLimiterName, scope: string): Promise<boolean> {
  const limiter = env[name];
  if (!limiter) return true;
  try {
    const { success } = await limiter.limit({ key: `${scope}:${clientKey(request)}` });
    return success;
  } catch {
    return true;
  }
}

/**
 * The 429 body.
 *
 * Hebrew, because a player sees it, and deliberately phrased as "slow down"
 * rather than "you are blocked" — the overwhelmingly common cause is a real
 * person tapping a button repeatedly, not an attacker.
 */
export function tooManyRequests<E extends { Bindings: Env }>(c: Context<E>, retryAfterSeconds = 60) {
  return c.json(
    { error: "RATE_LIMITED", messageHe: "רגע, לאט יותר. נסו שוב בעוד דקה." },
    429,
    { "Retry-After": String(retryAfterSeconds) }
  );
}

/** `allow` plus the 429, for the common case. Returns null when the request may proceed. */
export async function gate<E extends { Bindings: Env }>(
  c: Context<E>,
  name: RateLimiterName,
  scope: string
) {
  const ok = await allow(c.env as Env, c.req.raw, name, scope);
  return ok ? null : tooManyRequests(c);
}
