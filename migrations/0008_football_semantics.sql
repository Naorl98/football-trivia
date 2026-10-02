-- The football semantic layer, persisted.
--
-- NOTE ON COMMENT STYLE: line comments only, no /* ... */ blocks. Wrangler's
-- remote migration path splits the file on semicolons and rejects any resulting
-- chunk that contains no statement, so a block comment sitting between two
-- statements fails with "SQL code did not contain a statement" — which it does
-- only against --remote, after passing locally. Every other migration here uses
-- line comments; this one briefly did not, and that is how the difference was
-- found.
--
-- WHY THESE COLUMNS EXIST
--
-- Everything added here was already being computed somewhere and then thrown
-- away. `teams.is_national` was read at import and never used again, so the
-- question generators could not tell a club from a country. A player's position
-- was stored as the provider's broad category and asked as if it were a precise
-- role. A question's difficulty was stored but not the signals that produced it,
-- so nothing could later ask "is this still right?".
--
-- Storing them turns three things from impossible into routine:
--
--   * the audit (npm run questions:audit) can compare a stored question against
--     what the current rules would generate, instead of re-deriving the rules
--   * Quick Start can filter on familiarity server-side, which is the only place
--     a filter cannot be bypassed by a client
--   * a reclassification can report what moved and why
--
-- WRITE COST, because this is a production database on a 100,000-rows-a-day
-- allowance. Every ALTER TABLE ADD COLUMN below is metadata-only in SQLite and
-- costs nothing. The single UPDATE costs about 12,700 rows. No index is created
-- or rebuilt, which is a deliberate trade — see the note on quick_start_safe.

-- ---------------------------------------------------------------- entities

-- CLUB | NATIONAL_TEAM | YOUTH_NATIONAL_TEAM | RESERVE_TEAM | YOUTH_TEAM.
-- See src/server/football/entities.ts, which is the one place the rules live.
ALTER TABLE teams ADD COLUMN team_type TEXT;

-- For a reserve or youth side: the first team, where it could be traced.
-- "Barcelona B" -> Barcelona. Null when no senior club of that name is known,
-- which is common and is not an error.
ALTER TABLE teams ADD COLUMN parent_team_id INTEGER REFERENCES teams(id);

-- 0 = a club everybody knows, 3 = one that entered the database as the far end
-- of somebody's transfer. Drives both difficulty and distractor plausibility.
ALTER TABLE teams ADD COLUMN prominence REAL;

-- ---------------------------------------------------------------- positions

-- The precise role (RW, CB, DM, ...) and the unit (FORWARD, DEFENDER, ...),
-- kept apart on purpose. API-Football returns only the unit, so
-- position_detailed is null for almost every row and position_confidence says
-- so -- which is what stops a generator asking "what is X's position?" and
-- answering "חלוץ" from data that only said "Attacker".
ALTER TABLE players ADD COLUMN position_detailed TEXT;
ALTER TABLE players ADD COLUMN position_broad TEXT;
ALTER TABLE players ADD COLUMN position_confidence TEXT;

-- 0 = Messi, 3 = a fringe squad member. The signal the old difficulty model did
-- not have, and the reason an obscure full-back's 2024 transfer was labelled
-- HARD rather than EXPERT.
ALTER TABLE players ADD COLUMN fame_score REAL;

-- ---------------------------------------------------------------- questions

-- The question's shape, as named in src/server/football/archetypes.ts. Stored
-- so the audit can apply the right rules to a question it did not generate.
ALTER TABLE questions ADD COLUMN archetype TEXT;

-- CLUB | NATIONAL_TEAM | PLAYER | COUNTRY | COMPETITION | STADIUM | COACH |
-- POSITION | POSITION_GROUP | SCORELINE | COUNT. The invariant the whole phase
-- turns on: every option of a question must be this type and nothing else.
ALTER TABLE questions ADD COLUMN answer_entity_type TEXT;

-- HIGH | MEDIUM | LOW. Only HIGH and MEDIUM are production-eligible.
ALTER TABLE questions ADD COLUMN fact_confidence TEXT;

-- The difficulty signals, kept so a reclassification can explain itself.
ALTER TABLE questions ADD COLUMN subject_fame REAL;
ALTER TABLE questions ADD COLUMN entity_prominence REAL;
ALTER TABLE questions ADD COLUMN domain_tier TEXT;

-- QUICK START ELIGIBILITY.
--
-- "Hard but recognisable" is the bar for a Quick Start question, and a
-- difficulty band cannot express it: a question can be correctly labelled HARD
-- and still be the wrong thing to put in front of somebody who tapped one
-- button on the home page. So eligibility is its own flag, set by the audit from
-- the subject's fame and the competition's tier.
--
-- DEFAULT 0, AND THEN IMMEDIATELY SET FOR THE EASY AND NORMAL BANDS. That is not
-- belt and braces -- it is what makes Quick Start correct from the moment this
-- migration lands, rather than from whenever the audit next runs. EASY and
-- NORMAL need no familiarity guard; by definition a casual fan is expected to
-- know them. Only HARD does, and until the audit has judged them, HARD is
-- excluded. Quick Start therefore degrades to "easier than intended", never to
-- "empty" and never to "Expert questions leaked in".
--
-- NO INDEX IS ADDED FOR THIS, deliberately. Appending the column to
-- idx_questions_pick would mean dropping and rebuilding a 15,186-row index
-- (~15,000 rows written) to save a table lookup on a query that is already
-- narrowed by difficulty. The column is tested against the table row instead. If
-- Quick Start latency measures badly, rebuilding that index is the fix and it is
-- a one-line migration.
ALTER TABLE questions ADD COLUMN quick_start_safe INTEGER NOT NULL DEFAULT 0;

UPDATE questions SET quick_start_safe = 1 WHERE difficulty IN ('EASY', 'NORMAL');
