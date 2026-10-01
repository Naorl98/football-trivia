# Security

Football IQ is an anonymous, account-free trivia game: a React client, one
Cloudflare Worker, one D1 database, and Durable Objects for live multiplayer.
There are no user accounts, no cookies, no payments, no personal data beyond a
display name the player types for one game, and no third-party scripts.

That shapes everything below. The things worth protecting here are the integrity
of a live game, the provider API key, and the server's own resources — not a
user database, because there isn't one.

---

## Trust boundaries

There are four, and only the first two carry real weight.

### 1. The browser → the Worker (HTTP)

Everything from a browser is untrusted. Every request body is parsed and
validated field by field against an allowlist (`src/worker/lib/validate.ts`,
`src/worker/routes/attempts.ts`): unknown values are dropped rather than
coerced, enums must match a constant the product defines, arrays are capped, and
strings are length-bounded. A malformed body is a 400, never a 500 with the
reason in it.

### 2. The browser → a room's Durable Object (WebSocket)

**This is the boundary that matters.** A room decides the score, so a client
that could lie to it could win by lying. The rules live in `RoomEngine`
(`src/shared/multiplayer/roomEngine.ts`), which is pure and unit-tested, and the
Durable Object is the only thing that may call it.

### 3. The Worker → D1

Every value is a bound parameter. There is no string interpolation into SQL
anywhere in the codebase (see *SQL* below).

### 4. The Worker → API-Football

Outbound only, from ingestion scripts that are never part of a request. Its
responses are validated before they reach D1 and are treated as untrusted text.

---

## What the client is never allowed to decide

The client is a renderer. It is told what phase it is in and what to draw. It
cannot set, influence or assert:

| | Decided by |
|---|---|
| whether an answer is correct | the room, against its own frozen question set |
| score, streak, speed bonus | the room (`scoring.ts`), from its own clock |
| the timer and every deadline | the room; the client only animates it |
| who is host | the room; it is the first player to join, reassigned on exit |
| game progression and phase | the room's alarm |
| the question set and its order | the room, drawn once from D1 at kickoff |
| team assignment | the room |
| the final result | the room |
| a player's identity | the socket's attachment, not any message field |

That last row is the important one. A player's id is **never read from a message
body**. It is stored in the socket's attachment when the socket is accepted,
derived from the reconnect token, and every incoming message is attributed to the
socket it arrived on. So there is no field to forge: a client cannot submit an
answer, send a message, or take a turn as anybody but itself.

Host-only actions (start, settings, mode, teams, auto-balance, kick, end) are
re-checked against `state.hostId` inside the engine on every call. Hiding a
button is not authorisation and is not relied on anywhere.

### Replay and ordering

Every answer carries the question index it is answering, and the engine rejects
it unless it matches the round currently open (`TOO_LATE`). On top of that:
one answer per player per round (`ALREADY_ANSWERED`), turn ownership in
turn-based mode (`NOT_YOUR_TURN`), the phase must be one that accepts answers,
and the deadline must not have passed. A replayed or stale message changes
nothing.

---

## Secrets

| Secret | Where it lives |
|---|---|
| `API_FOOTBALL_KEY` | `.dev.vars` locally (gitignored, untracked), Cloudflare secret storage in production |
| Cloudflare credentials | the operator's `wrangler` login; never in the repo |

The Worker's `Env` interface does not include the provider key, because the
Worker never reads it — only the ingestion scripts in `src/server/` do, and those
run on a developer's machine, never in a request. `src/server/` is not imported
by `src/worker/`, `src/client/` or `src/shared/`.

**`VITE_*` variables are public.** Anything with that prefix is compiled into the
client bundle and readable by anyone. The app currently uses no `import.meta.env`
at all, and no secret may ever be given a `VITE_` name.

Verified by `scripts/security-qa.mjs`, which fetches the published bundle and
asserts it contains no credential name and no key-shaped value, and that
`.dev.vars`, `.env*`, `wrangler.json`, the migrations and the seed SQL are not
served.

### Source maps

Not published. `vite build` emits none, nothing references a
`sourceMappingURL`, and a request for `<bundle>.map` is a 404. Asserted in the
security suite.

---

## SQL

All D1 access uses `prepare(...).bind(...)`. There is no template literal, no
concatenation and no interpolation of any value into SQL text.

This used to have one exception, and it no longer does. Recently-seen question
ids were rendered into the statement as integer literals, to get around D1's
100-bound-parameter ceiling — safe, because every element was proven to be a
finite integer first, but still a value in the SQL text. Since the selection
rewrite (migration 0007) the exclude list is applied in memory and never reaches
the database at all.

Dynamic SQL is limited to the *shape* of the WHERE clause — how many `?`
placeholders a filter needs — which is derived from allowlisted constants, never
from input. Column and ordering names are fixed string literals in the source.

---

## XSS

The product has **no HTML sink**. There is no `dangerouslySetInnerHTML`, no
`innerHTML`, no `outerHTML`, no `document.write`, no `eval` and no
`new Function` anywhere in `src/`. All text is rendered as JSX children or
attributes, which React escapes.

That is the real defence. On top of it, player-typed text — display names and
trash-talk messages — is sanitised once at the door
(`src/shared/multiplayer/names.ts`) and stored clean, because a name that is only
safe in JSX is a name that becomes unsafe the first time someone puts it in a
QR payload or a `title` attribute. Removed: C0/C1 controls, zero-width marks,
bidi overrides and isolates (which in an RTL product can visually reorder the
text around them and let a name escape its own row), and `<`, `>`, `&`. Kept:
Hebrew geresh and gershayim, apostrophes, hyphens — ordinary parts of real names.

Messages additionally have a length cap, a per-player cooldown, a per-question
ceiling, and a short blocklist for the handful of words whose only purpose is
abuse. That list is explicitly **not** moderation; it catches the lazy case.

---

## Content-Security-Policy and headers

Built per request in `src/worker/lib/security.ts` and applied by middleware to
every response, including errors and 404s.

```
default-src 'self'
script-src 'self' 'nonce-<fresh per response>'
style-src 'self' 'unsafe-inline' https://fonts.googleapis.com
font-src 'self' https://fonts.gstatic.com data:
img-src 'self' data:
connect-src 'self' wss://<this host>
media-src 'none'; object-src 'none'; frame-src 'none'
worker-src 'self'; manifest-src 'self'
base-uri 'self'; form-action 'self'; frame-ancestors 'none'
upgrade-insecure-requests
```

Plus `X-Content-Type-Options: nosniff`, `Referrer-Policy:
strict-origin-when-cross-origin`, a `Permissions-Policy` that denies every
feature the app does not use, `X-Frame-Options: DENY`,
`Cross-Origin-Opener-Policy: same-origin`,
`Cross-Origin-Resource-Policy: same-origin`, and `Strict-Transport-Security:
max-age=31536000; includeSubDomains` over HTTPS only.

Two deliberate decisions:

- **`connect-src` is per request.** The multiplayer socket is `wss://<this
  host>`, which differs between production, a preview deployment and a dev
  server. Deriving it from the request keeps the directive exact instead of
  resorting to a wildcard.
- **`style-src` allows `'unsafe-inline'`.** React writes inline style
  attributes (eighteen components use `style={{…}}`, and the accessibility
  text-scale is a custom property set on `<html>`), so blocking them means
  blocking the product. An inline style attribute is not a script execution
  path, and with no HTML sink anywhere it is not a route to one. `script-src`
  has no `unsafe-inline`; the one inline bootstrap block carries a 128-bit
  nonce, regenerated per response.

There is no `unsafe-eval` and no wildcard source anywhere. Both are asserted in
`tests/startupSafety.test.ts` and against a live deployment in
`scripts/security-qa.mjs`.

---

## Clickjacking, CORS, CSRF

**Clickjacking:** refused twice — `frame-ancestors 'none'` and
`X-Frame-Options: DENY`. Nothing embeds this app.

**CORS:** no CORS headers are sent at all, so the browser's same-origin policy
applies in full. The client is served from the same origin as the API, so it
needs nothing. There is no `Access-Control-Allow-Origin: *` anywhere.

**CSRF:** not applicable, and the reason is structural rather than a mitigation.
The app sets no cookies, uses no `Authorization` header and has no ambient
credential of any kind, so a cross-site request carries no authority — it is
just an anonymous request, which any client could make directly. There is
nothing a forged request could do in a victim's name, because nothing is done in
anyone's name. The multiplayer reconnect token is held in `sessionStorage` and
sent explicitly as a query parameter, which is not ambient and is not attached
by the browser to cross-site requests.

If a cookie or a session is ever introduced, this section stops being true and
state-changing routes will need CSRF protection.

---

## Rate limiting

Enforced server-side with Cloudflare's rate-limit bindings, keyed on
`CF-Connecting-IP` (set by Cloudflare's edge; the spoofable
`X-Forwarded-For` is deliberately not consulted). One binding per surface, so
the counters do not share.

| Surface | Limit | What it protects |
|---|---|---|
| `POST /api/mp/rooms` | 60/min | Durable Object allocation, room-code space |
| `GET /api/mp/rooms/:code` | 120/min | the code-enumeration oracle |
| socket opens | 300/min | connection flooding |
| `POST /api/quiz`, `/api/quiz/count` | 200/min | the D1 reads |
| `POST /api/attempts`, `/api/challenges` | 30/min | the only unauthenticated D1 writes |

These are deliberately generous, and the reason is the key. **An IP is not a
person.** Mobile carriers place very large numbers of subscribers behind one
address, and so does any school, office or household, so a limit tuned to "more
than one device could need" is a limit that locks a whole carrier out of
multiplayer.

The first version of this table was tuned that way and was wrong. `RL_SOCKET`
at 60/min began refusing connections at attempt ~72 of a burst, which broke a
different handful of multiplayer tests on each production run — a self-inflicted
availability bug, and a worse one than the abuse it was preventing. The numbers
above are set against a plausible *shared* address instead.

The write limit is the one real tension: the D1 daily row budget is finite, so
it cannot be as generous as the rest. 30/min covers a group of thirty finishing
a quiz in the same minute and bounds a single-location attacker to roughly
43,000 writes a day instead of an unbounded number.

Inside a room, limits are enforced by the engine per player: a message cooldown,
a per-question message ceiling, and a reaction cooldown. The client also disables
the controls for the cooldown, so the limit is visible rather than arriving as an
error — but that is presentation. The enforcement is in the engine.

### Room-code brute force

A room code is six digits, and it is **not a secret** — it is read aloud across a
room, and anyone holding it is meant to be able to join. What is defended is the
code *space*, so that it cannot be swept to find every live room:

- lookups are metered, which turns a full sweep from minutes into years
- a malformed code and a well-formed absent one get the same 404, on the same
  path, after the same work — neither the status nor the response shape
  distinguishes "not a code" from "no such room"
- rooms are short-lived: empty after 10 minutes, idle after 2 hours, so a
  harvested list goes stale

### Matchmaking abuse

The queue *is* the set of live sockets — there is no stored list, so a closed tab
leaves the queue by construction and there is no stale entry to garbage-collect.
A Durable Object processes one request at a time, so no player can be double-
booked and no pair formed twice. A player's token holds one place, not one per
tab, which is what stops someone being matched against themselves. A
half-dead socket is evicted by the 2.5-second heartbeat.

---

## Randomness

Everything security-sensitive comes from the CSRNG:

- **reconnect tokens**: 128 bits from `crypto.getRandomValues`, hex-encoded
  (`src/client/lib/mp/identity.ts`). Not `crypto.randomUUID`, which is Safari
  15.4+ and secure-context only — on an older iPhone it is `undefined` and
  calling it threw multiplayer out entirely. There is deliberately no
  `Math.random` fallback: this token is what proves which seat and which score
  belong to a client, so if there is no CSRNG the honest outcome is a throw.
- **room codes**: `crypto.getRandomValues` with rejection sampling.
- **challenge public ids**: `crypto.getRandomValues` with rejection sampling.
  Previously `byte % 57`, which skewed the first 28 characters of the alphabet
  by about 30%.
- **CSP nonces**: 128 bits per response.

`Math.random` is used only where bias is harmless and the value is not a secret:
shuffling answer options and shuffling a question candidate window.

---

## Logging and privacy

Worker logs record the path, method, error name and error message. They never
record an API key, a reconnect token, a request header, a full message body, a
player name, or the contents of browser storage. The in-page startup diagnostic
(`window.__FIQ_ERRORS__`) is bounded, never transmitted anywhere, and holds only
the route, startup stage, error type and a truncated stack.

Error responses to clients are fixed shapes with Hebrew copy. No stack trace, no
SQL, no internal path and no Cloudflare detail is ever returned — asserted
against a live deployment in the security suite.

Persisted personal data is minimal and consent-gated (`src/client/lib/privacy.ts`,
and `/privacy` in the app): three categories, with `allows()` consulted at every
write site and withdrawal purging the stored keys immediately rather than only
stopping future writes. Trash-talk messages are never written to D1, never
replayed on reconnect, and exist only in the receiving tab's memory. The only
multiplayer data that outlives a game is one row per finished game and one per
player — a display name, a score and some counts.

---

## Dependencies

Four runtime dependencies: `hono`, `react`, `react-dom`, `react-router-dom`,
plus `qrcode-generator`. `npm audit` reports zero vulnerabilities at any
severity. The only packages with install hooks are `esbuild` and `workerd`,
both first-party binary downloaders for tooling. `package-lock.json` is
committed.

---

## Known residual risks

Stated plainly, because a security document that claims everything is covered is
not useful.

1. **Rate limits are per Cloudflare location, and keyed on a shared address.**
   Two limitations, same mechanism. The platform's rate-limit binding counts
   per location, so a widely distributed attacker gets one bucket per location
   rather than one globally. And because the key is the client IP — the only
   identity an account-free product has — the limits must stay loose enough for
   a carrier-NAT address shared by many real players, which necessarily means
   loose enough for one determined script. These are speed bumps that make
   sustained abuse expensive, not walls. Tightening them trades availability
   for real users against a protection that more addresses already defeat.

2. **Single-player answer correctness is the client's account of its own quiz.**
   `/api/attempts` recomputes the score from the submitted answers, so the stored
   number is the server's arithmetic — but the per-answer `correct` flags come
   from the client. An attempt row is a private statistic: there is no
   leaderboard, nothing is awarded, and nothing else reads it. Re-deriving every
   answer against the question bank would cost a multi-row D1 read per
   submission to protect a number nobody competes on. **Multiplayer is
   different and is not affected**: there, correctness is decided entirely by the
   room.

3. **A room code is not a secret.** Anyone who has it can join. That is the
   design. Private rooms are private by obscurity plus a short lifetime, not by
   authentication.

4. **The message blocklist is not moderation.** It catches lazy abuse; a
   determined person routes around any word list. The length cap, the cooldown
   and the per-question ceiling do the rest.

5. **`style-src` permits inline styles.** Reasoning above. It is a real
   relaxation of the policy, justified by there being no HTML sink to exploit it
   through.

6. **No bot protection.** There is no CAPTCHA and no proof of work. A scripted
   client can play the game. With nothing to win and nothing to steal, the only
   cost is server resources, which is what the rate limits address.

7. **WebKit was not tested empirically in this pass.** The reliability suite ran
   against real Chrome; Playwright's WebKit build could not be downloaded in the
   environment. The failures it covers — module-script MIME enforcement,
   `SecurityError` from a blocked storage accessor, React unmounting on a render
   throw — are specified behaviour that WebKit implements, and the storage cases
   were modelled on Safari's specific behaviour, but the engine itself was not
   driven.

---

## Reporting

Open a GitHub issue at
<https://github.com/Naorl98/football-trivia/issues>. There is no bounty and no
SLA; this is a personal project.
