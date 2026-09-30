# Football IQ ⚽

Hebrew-first, mobile-first football trivia platform. Players build a custom quiz —
geographic scope, leagues, categories, difficulty, question count, game mode — and the
question engine assembles a quiz from a curated, verified question bank.

Deployed as a single Cloudflare Worker that serves both the React SPA (Workers Static
Assets) and the `/api/*` routes, backed by Cloudflare D1.

## Stack

| Layer | Technology |
| --- | --- |
| Frontend | React 19 + TypeScript + Vite 8, React Router |
| Backend | Cloudflare Workers + Hono |
| Database | Cloudflare D1 (SQLite) with migrations |
| Realtime | Cloudflare Durable Objects + WebSockets (hibernation API) |
| Hosting | Cloudflare Workers + Workers Static Assets (no Pages, no Workers Sites) |
| Build | `@cloudflare/vite-plugin` (single integrated build) |

## Project structure

```
src/
  shared/      Domain types, constants and scoring — imported by BOTH the Worker and the client
    multiplayer/  Room state machine, protocol, scoring, standings — pure, no platform code
  worker/      Cloudflare Worker: Hono API, question engine, D1 query layer
    engine/    Question engine (quiz assembly) — framework-free domain logic
    db/        D1 access: questions, challenges, daily, attempts
    durable/   Durable Objects: one per live room, plus the matchmaking queue
    routes/    /api/quiz, /api/challenges, /api/daily, /api/attempts, /api/mp
  client/      React SPA: pages, components, design system
    lib/mp/    Room socket hook, matchmaking hook, player identity, QR rendering
    components/mp/  Multiplayer boards, stage moments and atoms
migrations/    D1 schema migrations
seed/          Curated question bank (questions.ts) + generated seed.sql
scripts/       Seed generator, API smoke test, UI test, multiplayer E2E, screenshot capture
```

The design deliberately keeps Cloudflare-specific code confined to `src/worker`. The
question engine and scoring rules are plain TypeScript with no framework or platform
dependency, so they are testable and portable.

## Local development

```bash
npm install
npm run cf-typegen                 # generate binding types (worker-configuration.d.ts)
npm run db:migrate:local           # apply schema to the local D1
npm run db:seed:local              # load the question bank locally
npm run dev                        # Vite dev server (client + Worker API together)
```

Then open http://localhost:5173.

## Answer modes

Players choose between **אמריקאי** (multiple choice) and **תשובה חופשית** (free text)
in the builder. Free text is only offered for questions with a single unambiguous
canonical answer plus stored aliases — `questions.supports_free_text`. Club-connection
questions stay multiple-choice on purpose, because players outside the dataset may also
satisfy "played for both X and Y".

### Answer matching

`src/shared/answerMatching.ts` is the single matcher, used by the client and covered by
64 unit tests. It applies, in order:

1. **normalize** — case, Unicode NFD, Latin diacritics, Hebrew niqqud, punctuation
   (so `Vinícius`, `vinicius` and `Paris Saint-Germain` / `Paris Saint Germain` converge)
2. **exact / alias** — against the canonical answer and every stored alias
3. **token** — same words in a different order
4. **fuzzy** — Damerau-Levenshtein within a length-scaled budget: 0 edits at ≤4 chars,
   1 at ≤7, 2 at ≤12, 3 beyond. So `Vinicuis` passes but `Kang` never matches `Kane`.

Arbitrary substrings are never accepted — `Ronaldo` matches Cristiano Ronaldo only
because that alias is stored on the question, and `Junior` alone is rejected.

### Hints and reveal

Free-text questions carry ordered hints (`question_hints`) revealed one at a time by
**רמז**, and a **גלה תשובה** button that requires a second, deliberate click. A revealed
answer is scored as not-correct and reported separately in the results.

## Sound

All cues are synthesised at runtime with the Web Audio API — there are no audio files to
download or cache. The engine creates nothing until the first user gesture (respecting
autoplay policy), persists the on/off choice in localStorage, and swallows every audio
error so sound can never break gameplay. Toggle lives in the header.

## Testing

```bash
npm test                                               # 390 unit tests (node --test)
node scripts/smoke-test.mjs      http://localhost:5173 # 34 API assertions
node scripts/ui-test.mjs         http://localhost:5173 # 31 browser assertions
node scripts/freetext-ui-test.mjs http://localhost:5173 # 30 free-text assertions
node scripts/challenge-e2e.mjs   http://localhost:5173 # 4 challenge round-trip assertions
node scripts/viewport-qa.mjs     http://localhost:5173 # 147 layout checks across 7 viewports
npm run test:mp                                        # 169 multiplayer protocol assertions
npm run test:mp:browser                                # 74 multi-browser assertions
node scripts/screenshots.mjs                           # visual snapshots
```

### Multiplayer testing, in two layers

`scripts/mp-e2e.mjs` speaks the WebSocket protocol directly against real Durable Objects.
It proves the SERVER is right: that the reveal stays hidden until the last player answers,
that an out-of-turn submission is refused, that eleven players entering matchmaking at once
produce five unique pairs and one still-searching player, that twenty players in one room
end on one leaderboard that is byte-identical on all twenty sockets, and that an abandoned
duel ends in a forfeit rather than hanging. A failure points at a message, not a selector.

`scripts/mp-browser.mjs` runs four players in four separate `BrowserContext`s — separate
storage, so each mints its own player token exactly as four phones would. It proves the
PRODUCT is right: the QR is on screen and is dark-on-light (an inverted QR does not scan),
a locked answer is marked as chosen and *not* as right or wrong, four screens show the same
question and the same final table, a reload mid-round lands back in the game with the score
intact, number keys answer, and no page has horizontal overflow at 320px.

Both accept a URL, so the same suites run against a deployment:

```bash
npm run test:mp:prod                                   # protocol suite against production
node scripts/mp-browser.mjs https://football-iq.naorl.workers.dev
```

The UI test drives a locally installed Chrome via Playwright (`channel: "chrome"`), so no
browser download is required. It checks RTL rendering, mobile layout (390×844), tap-target
sizes, answer locking/reveal behaviour, the full play-through to results, builder
availability counts, and console-error cleanliness.

## Deployment

```bash
npm run db:migrate:remote          # apply schema to the production D1
npm run db:seed:remote             # load the question bank into production
npm run deploy                     # typecheck + vite build + wrangler deploy
```

The Durable Object namespaces are declared in `wrangler.jsonc` under `migrations` as
`new_sqlite_classes`. SQLite-backed Durable Objects are what makes multiplayer available
without a paid Durable Objects plan; changing them to the key-value storage backend would
not be a like-for-like swap.

## Question engine

Input is a `QuizConfiguration` (region, countries, competitions, categories, difficulty,
questionCount, gameMode). The engine:

- filters on `mode`, `category`, `difficulty` and `active`
- matches scope tags (`REGION` / `COUNTRY` / `COMPETITION` / `CLUB`) via an `EXISTS`
  subquery, expanding competition **groups** (`TOP_5_EUROPE`, `TOP_6_EUROPE`, `ALL`)
  declaratively from `src/shared/constants.ts` — group behaviour is never hardcoded in
  components
- selects distinct questions at random (`ORDER BY RANDOM() LIMIT n`), so a quiz can never
  contain a duplicate
- **never pads a short pool with repeats.** If fewer questions exist than requested, it
  returns every available question and reports `availableCount` vs `requestedCount` so the
  client can tell the player exactly what is available
- shuffles answer options per request, so the correct answer is never in a fixed position

Scope matching is "question carries ANY requested scope tag". Because the builder leaves
region at `WORLD` (unfiltered) in the common flow, choosing a specific competition filters
exactly; combining an explicit region *and* a competition broadens rather than narrows.
This is a deliberate v1 simplification — the safer failure mode is too many questions
rather than an empty quiz.

### Scoring

All scoring lives in `src/shared/scoring.ts` and is used by both the client (live score)
and the Worker (authoritative attempt logging) — never recomputed inside presentation
components. Current rule is 1 point per correct answer; difficulty weighting, speed
bonuses, streaks and per-mode multipliers can be added in that one function.

Rank labels (צופה מזדמן → אוהד → פרשן → מומחה → אגדה) are derived deterministically from
accuracy.

## Game modes

| Mode | Status |
| --- | --- |
| Classic quiz | ✅ implemented |
| Club connection ("איזה שחקן שיחק גם ב…") | ✅ implemented |
| Who am I? (ordered clues) | ✅ implemented |
| Career path (chronological clubs) | ✅ implemented |
| Guess the club | ✅ implemented |
| Higher or lower | ⛔ architected, intentionally disabled — see below |

Every mode shares one data shape (question + 4 options + optional ordered clues), so a new
mode needs a renderer, not a schema change.

## Multiplayer

Real-time rooms on Cloudflare Durable Objects. One object per live room, addressed by its
six-digit code; one more object for the random-duel queue.

```
browser ──WebSocket──► Worker ──► RoomDurableObject   (state, clock, scoring, questions)
                          │
                          └────►  MatchmakerDurableObject  (the random-duel queue)
                                        │
                                        └─► claims a new room for each pair
```

### Why a Durable Object per room

A room needs one authority and one clock. A Durable Object gives both: it handles one
request at a time, so "two players answered simultaneously" and "two people created a room
with the same code" are resolved by the runtime rather than by a lock we have to get right.
Room codes need no registry at all — `idFromName("482731")` always reaches the same object,
and that object claims itself on first use (`RoomDurableObject.claim`), so a collision is
simply a refused claim and a retry.

WebSockets are accepted with `ctx.acceptWebSocket`, the hibernation API, so a lobby waiting
for a seventh player costs nothing while it waits. Each socket carries its own identity in
its attachment, and the room's state is rehydrated from storage on every entry point,
because in-memory state cannot survive an eviction.

**D1 is not involved in a live room.** Not a join, not an answer, not a score change. A
finished game writes exactly one `multiplayer_games` row plus one row per player. That is a
rule rather than an optimisation — see [Living within a 100-request/day plan](#living-within-a-100requestday-plan)
for the incident the same restraint exists to prevent.

### Where the rules live

All of them are in `src/shared/multiplayer/roomEngine.ts`: a plain class with an injected
clock that knows nothing about sockets, storage or D1. The Durable Object is plumbing —
sockets in, effects out, state persisted, one alarm always set to the engine's next wake
time. Two things fall out of that: there is no game logic in the platform layer to get wrong
twice, and a three-player turn-based game with a disconnect at exactly the grace boundary is
a dozen lines of unit test rather than a browser run.

### Modes

| Mode | Hebrew | Shape |
| --- | --- | --- |
| `CLASSIC_BATTLE` | קרב רגיל | Everyone answers; correctness + speed + streak |
| `TURN_BASED` | תורות | One player owns each question, round-robin |
| `EVERYONE_ANSWERS` | כולם עונים | Everyone answers; no streak bonus |
| `DUEL` | דו קרב | Exactly two, VS intro, head-to-head scoreboard |
| `TEAM_BATTLE` | קרב קבוצות | Two teams, aggregate score, MVP across both |
| `RANDOM_DUEL` | דו קרב אקראי | Matchmade, fixed rules, starts itself |

### Server authority

The client is a renderer. It is never sent a score it did not receive from the server, a
correct answer before the reveal, or a question it is not currently on — the room keeps the
whole question set and hands out one sanitized question at a time, with `isCorrect`,
`canonicalAnswer`, `aliases` and hint text stripped. `parseClientMessage` rebuilds every
inbound message field by field from `unknown` rather than casting, so a client that sends
its own score, correctness flag or player id gets a message carrying none of them.

Refused by the room: answering twice, answering after the deadline, answering out of turn,
answering a question that is not in play, an option id from another question, starting or
reconfiguring as a non-host, and hint usage the client tries not to declare (hints are
counted server-side before the text is handed over).

### Scoring

```
correct answer          100
+ speed                 0-50, linear in the time left
+ streak                10 per consecutive correct beyond the first, max 50
- hints                 20 each, floor of 10 for a correct answer
wrong / timed out / revealed   0
```

Points are computed when an answer arrives but **banked at the reveal**. The room view
carries every player's score, so applying them immediately would announce "that was right"
to the whole room the instant somebody tapped.

Tie-breaking, in order: score, then correct answers, then average response time (a player
who answered nothing sorts last). Players identical on all three **share a position** and
`winnerIds` holds more than one id, so the UI says שוויון rather than inventing a winner.

### Reconnect

Each browser mints a random token into `sessionStorage`. The socket carries it, the room
recognises it, and a refresh or a dropped tunnel restores the same player with their score
and seat — plus the question on screen, the reveal, and any hints they already paid for
(`RoomEngine.resumeMessages`). A dropped player is held for a 25-second grace window,
shown as מתחבר מחדש, and only then swept: in the lobby they lose their seat, mid-game they
keep their row in the standings, and in a duel their absence hands the win to the opponent
by forfeit.

### Shared screen

`/room/:code/display` connects the same protocol with `display=1`. The server treats it as
a spectator — broadcast to, never able to act — so there is no display mode in the state
machine at all. The room does not know one of its sockets is a television.

## Challenges and the daily quiz

- `POST /api/challenges` freezes the exact ordered question ids into `quiz_challenges`.
  Opening `/challenge/:id` **replays that stored set** — it never regenerates a random
  quiz. The results screen shares the link via the Web Share API, falling back to clipboard.
- `/daily` resolves the calendar date in `Asia/Jerusalem` and get-or-creates a row in
  `daily_challenges`, so every player on a given Israeli date gets the identical 10
  questions. The `UNIQUE(challenge_date)` constraint plus `INSERT OR IGNORE` makes the
  first-request race safe.

## Data accuracy

This is a hard product rule: **no invented football facts.**

- All 139 seeded questions are written from well-established, widely documented facts —
  tournament results and hosts, famous transfers, club nicknames and stadiums, and the
  career histories of globally known players.
- Statistics that shift season to season were avoided unless the record has been stable
  for years (e.g. Alan Shearer's Premier League goal record). No "current top scorer"
  style questions.
- Every row carries `verified` and `active` flags plus a `source_label`. The engine only
  serves `active = 1` questions, and the schema can distinguish verified facts from
  demo/placeholder content should unverified rows ever be loaded.
- No LLM generates questions at runtime. The bank is static, reviewed content;
  `seed/questions.ts` is the single source of truth and `scripts/build-seed.mjs`
  regenerates `seed/seed.sql` with validation (exactly 4 options, exactly one correct
  answer, clue counts, scope presence).

### Documented limitations

- **Higher or Lower is disabled.** It needs reliable head-to-head statistics (career goal
  counts, appearances) that could not be verified to a trustworthy source in this build.
  Rather than fabricate numbers to make the mode work, the mode exists in the type system
  and validation layer but is excluded from `ENABLED_GAME_MODES`, so it never reaches
  players.
- **Question bank: 139 questions**, exceeding the 100-question target, spread
  25 EASY / 50 NORMAL / 32 HARD / 22 EXPERT / 10 IMPOSSIBLE — at or above the suggested
  20/30/25/15/10 in every tier. Coverage spans the top five European leagues, the
  Champions League, the World Cup and Euros, Copa Libertadores, club history, coaches,
  stadiums and Israeli football. Narrow filter combinations (e.g. `בלתי אפשרי` on its own)
  still yield small pools, which is why the builder always shows a live availability count
  before the player commits.
- **No timer.** The brief listed it as optional; a half-implemented timer would hurt more
  than help, so scoring records per-answer `timeMs` (ready for speed bonuses) without
  putting a clock in the UI.
- **Leaderboards** are out of scope for this build. `quiz_attempts` already records score,
  question count and duration, so they are additive later.

## Adding questions

1. **Append** entries to `seed/questions.ts` (typed; the generator validates them).
2. `npm run seed:build`
3. `npm run db:seed:local` (and `db:seed:remote` to publish)

The generated SQL assigns each question an explicit id from its position in the file, so
reloading the bank is stable: previously shared challenge links and stored daily quizzes
keep pointing at the same questions. Treat `seed/questions.ts` as **append-only** —
reordering or deleting entries reassigns ids and would orphan existing challenges. The
daily quiz additionally self-heals: if its stored question set no longer resolves, it is
rebuilt once and re-persisted for that date.

## Data ingestion (API-Football)

The knowledge base is populated from an external provider and then served
entirely from D1. **Gameplay never calls the provider** — starting a quiz issues
zero external requests.

```
API-Football -> Provider adapter -> Sync queue + budget -> D1 knowledge base
                                                                |
                                          question generators <-+
                                                                |
                                            quality gates + dedupe
                                                                |
                                                  D1 questions -> quiz engine
```

### Provider abstraction

`src/server/providers/football/types.ts` defines `FootballDataProvider` plus the
normalized domain types. `ApiFootballProvider.ts` is the only file that knows
API-Football's URLs, headers or response shapes, so adding Sportmonks or
football-data.org means writing one adapter, not touching the import layer.
`MockProvider.ts` implements the same interface, so the whole pipeline is
testable without spending quota.

### Configuring the key

`API_FOOTBALL_KEY` is read only by local ingestion scripts. It is never bundled
into the Worker and never reaches the browser.

```bash
cp .env.example .dev.vars          # .dev.vars is gitignored
# edit .dev.vars:  API_FOOTBALL_KEY=your_key_here
npm run data:harvest
```

Ingestion deliberately does not run in the Worker, so no Cloudflare secret is
needed. For a future scheduled server-side sync, add it with
`npx wrangler secret put API_FOOTBALL_KEY` and put the harvester behind an
authenticated route.

### Commands

| Command | What it does |
| --- | --- |
| `npm run data:harvest` | Import within today's budget, resuming where the last run stopped |
| `npm run data:harvest -- --remote` | Same, against production D1 |
| `npm run data:harvest -- --max 20` | Cap this run at 20 requests |
| `npm run data:harvest -- --historical` | Also queue deeper league history |
| `npm run data:status` | Real row counts, queue state, recent runs, requests used today |
| `npm run questions:generate` | Turn stored facts into playable questions |
| `npm run questions:stats` | Real question-bank breakdown from D1 |

### Living within a 100-request/day plan

The free plan allows ~100 requests/day. The harvester:

- operates at **95/day** by default, keeping ~5 in reserve for retries
- counts spend from `api_request_log`, so a crash cannot lose track of requests
- reads `x-ratelimit-requests-remaining` on every response and stops on exhaustion
- throttles to ~9 requests/minute to respect the per-minute cap
- **skips any resource already imported**, without spending a request
- treats completed historical seasons as `ARCHIVED` — immutable, never re-fetched
- writes every response to D1 *before* the next request, so a crash after
  request 73 keeps all 73 results
- queues the next page rather than looping through pagination past the budget
- re-plans as data lands: season work is only queued for competitions the
  provider actually returned, so quota is never spent on uncovered competitions

Work is ordered by expected **questions per request** — squads and transfers
first, fixtures last. Odds, predictions, injuries and live scores are never
requested: they cost quota and generate no questions.

Daily runs need no manual bookkeeping; the queue and `data_sync_state` carry
progress across days.

### Generation and quality gates

`src/server/questions/knowledgeGenerators.ts` reads only from D1. A candidate is
rejected unless it survives every gate: an unambiguous stored answer (never an
inference), four distinct options, exactly one correct, no distractor that is
also correct, no alias colliding with a distractor, certain career ordering
(a chain with an undated move is dropped), and no duplicate semantic key.

Semantic keys — `KB_CAREER_PATH:<playerId>`, `KB_TRANSFER_TO:<playerId>:<teamId>:<year>`,
`KB_COMPETITION_WINNER:<competitionId>:<season>` — make generation idempotent.

Difficulty is classified by deterministic rules (fact age, competition tier,
subject prominence, question type), never by an LLM, so a question always lands
in the same tier.

Auto-derived free-text aliases stay conservative: full name, ASCII-folded form,
and a distinctive surname. Nicknames like "Vini" are curated, never invented.
