-- Football IQ — initial schema
-- Reference/geo tables are kept for future data enrichment (player bios,
-- club browsing, etc). The question engine itself matches on lightweight
-- text scope codes in question_scopes, so it never requires these tables
-- to be fully populated to function.

CREATE TABLE countries (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  code TEXT NOT NULL UNIQUE,
  name_he TEXT NOT NULL,
  name_en TEXT NOT NULL,
  continent TEXT NOT NULL
);

CREATE TABLE clubs (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL,
  name_he TEXT,
  country_id INTEGER REFERENCES countries(id),
  founded_year INTEGER,
  stadium TEXT
);

CREATE TABLE players (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  full_name TEXT NOT NULL,
  display_name_he TEXT,
  nationality_country_id INTEGER REFERENCES countries(id),
  birth_date TEXT,
  position TEXT
);

CREATE TABLE player_clubs (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  player_id INTEGER NOT NULL REFERENCES players(id),
  club_id INTEGER NOT NULL REFERENCES clubs(id),
  from_year INTEGER,
  to_year INTEGER,
  sequence INTEGER
);

CREATE TABLE competitions (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  code TEXT NOT NULL UNIQUE,
  name TEXT NOT NULL,
  name_he TEXT NOT NULL,
  country_id INTEGER REFERENCES countries(id),
  continent TEXT,
  type TEXT NOT NULL
);

CREATE TABLE competition_groups (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  code TEXT NOT NULL,
  competition_code TEXT NOT NULL
);

-- Core question bank.
-- mode: CLASSIC | WHO_AM_I | CAREER_PATH | CLUB_CONNECTION | HIGHER_LOWER | GUESS_THE_CLUB
-- category: topical tag, see src/shared/constants.ts CATEGORIES
-- difficulty: EASY | NORMAL | HARD | EXPERT | IMPOSSIBLE
CREATE TABLE questions (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  public_id TEXT NOT NULL UNIQUE,
  mode TEXT NOT NULL,
  category TEXT NOT NULL,
  difficulty TEXT NOT NULL,
  question_he TEXT NOT NULL,
  explanation_he TEXT,
  verified INTEGER NOT NULL DEFAULT 0,
  active INTEGER NOT NULL DEFAULT 1,
  source_label TEXT,
  source_url TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE question_options (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  question_id INTEGER NOT NULL REFERENCES questions(id) ON DELETE CASCADE,
  answer_text TEXT NOT NULL,
  is_correct INTEGER NOT NULL DEFAULT 0,
  sort_order INTEGER NOT NULL DEFAULT 0
);

-- Ordered clues, used by WHO_AM_I (progressive hints) and CAREER_PATH
-- (chronological club sequence).
CREATE TABLE question_clues (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  question_id INTEGER NOT NULL REFERENCES questions(id) ON DELETE CASCADE,
  clue_he TEXT NOT NULL,
  sort_order INTEGER NOT NULL DEFAULT 0
);

-- Polymorphic scope tagging: lets a question be matched by region, country,
-- competition (or competition group), or club without requiring full FK
-- normalization for every seed question.
-- scope_type: REGION | COUNTRY | COMPETITION | CLUB
CREATE TABLE question_scopes (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  question_id INTEGER NOT NULL REFERENCES questions(id) ON DELETE CASCADE,
  scope_type TEXT NOT NULL,
  scope_value TEXT NOT NULL
);

CREATE TABLE quiz_challenges (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  public_id TEXT NOT NULL UNIQUE,
  configuration_json TEXT NOT NULL,
  question_ids_json TEXT NOT NULL,
  game_mode TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  expires_at TEXT
);

CREATE TABLE quiz_attempts (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  challenge_id INTEGER REFERENCES quiz_challenges(id),
  score INTEGER NOT NULL,
  question_count INTEGER NOT NULL,
  duration_seconds INTEGER NOT NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

-- One row per calendar date (Israel-local) so every visitor on that date
-- gets the exact same daily quiz.
CREATE TABLE daily_challenges (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  challenge_date TEXT NOT NULL UNIQUE,
  question_ids_json TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX idx_questions_mode ON questions(mode);
CREATE INDEX idx_questions_category ON questions(category);
CREATE INDEX idx_questions_difficulty ON questions(difficulty);
CREATE INDEX idx_questions_active ON questions(active);
CREATE INDEX idx_question_options_question_id ON question_options(question_id);
CREATE INDEX idx_question_clues_question_id ON question_clues(question_id);
CREATE INDEX idx_question_scopes_question_id ON question_scopes(question_id);
CREATE INDEX idx_question_scopes_lookup ON question_scopes(scope_type, scope_value);
CREATE INDEX idx_quiz_challenges_public_id ON quiz_challenges(public_id);
CREATE INDEX idx_player_clubs_player_id ON player_clubs(player_id);
