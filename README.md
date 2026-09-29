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
| Hosting | Cloudflare Workers + Workers Static Assets (no Pages, no Workers Sites) |
| Build | `@cloudflare/vite-plugin` (single integrated build) |

## Project structure

```
src/
  shared/      Domain types, constants and scoring — imported by BOTH the Worker and the client
  worker/      Cloudflare Worker: Hono API, question engine, D1 query layer
    engine/    Question engine (quiz assembly) — framework-free domain logic
    db/        D1 access: questions, challenges, daily, attempts
    routes/    /api/quiz, /api/challenges, /api/daily, /api/attempts
  client/      React SPA: pages, components, design system
migrations/    D1 schema migrations
seed/          Curated question bank (questions.ts) + generated seed.sql
scripts/       Seed generator, API smoke test, UI test, screenshot capture
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

## Testing

```bash
node scripts/smoke-test.mjs http://localhost:5173   # 34 API assertions
node scripts/ui-test.mjs    http://localhost:5173   # 31 browser assertions (headless Chrome)
node scripts/screenshots.mjs                         # visual snapshots into screenshots/
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
