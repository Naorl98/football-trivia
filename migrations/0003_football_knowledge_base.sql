-- Football knowledge base + provider sync infrastructure.
--
-- Phase 1 created empty placeholder reference tables (countries/clubs/players/
-- player_clubs/competitions/competition_groups) that nothing ever wrote to —
-- the question engine matches on text scope codes instead. They are replaced
-- here by the real, provider-backed knowledge model. Verified empty in both
-- local and production D1 before dropping.

DROP TABLE IF EXISTS player_clubs;
DROP TABLE IF EXISTS players;
DROP TABLE IF EXISTS clubs;
DROP TABLE IF EXISTS competition_groups;
DROP TABLE IF EXISTS competitions;
DROP TABLE IF EXISTS countries;

-- ===========================================================================
-- Entities
--
-- Every imported row keeps its provider identity (provider, external_id) with
-- a UNIQUE constraint, so re-running an import upserts instead of duplicating.
-- ===========================================================================

CREATE TABLE countries (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  provider TEXT NOT NULL,
  external_id TEXT NOT NULL,
  code TEXT,
  name TEXT NOT NULL,
  name_he TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now')),
  UNIQUE (provider, external_id)
);

CREATE TABLE venues (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  provider TEXT NOT NULL,
  external_id TEXT NOT NULL,
  name TEXT NOT NULL,
  name_he TEXT,
  city TEXT,
  country_name TEXT,
  capacity INTEGER,
  updated_at TEXT NOT NULL DEFAULT (datetime('now')),
  UNIQUE (provider, external_id)
);

CREATE TABLE competitions (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  provider TEXT NOT NULL,
  external_id TEXT NOT NULL,
  name TEXT NOT NULL,
  name_he TEXT,
  type TEXT,
  country_name TEXT,
  country_code TEXT,
  -- Maps to a competition code in src/shared/constants.ts when one exists, so
  -- generated questions can be scoped by the same filters the builder uses.
  local_code TEXT,
  priority INTEGER NOT NULL DEFAULT 3,
  updated_at TEXT NOT NULL DEFAULT (datetime('now')),
  UNIQUE (provider, external_id)
);

CREATE TABLE competition_seasons (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  competition_id INTEGER NOT NULL REFERENCES competitions(id) ON DELETE CASCADE,
  season INTEGER NOT NULL,
  start_date TEXT,
  end_date TEXT,
  is_current INTEGER NOT NULL DEFAULT 0,
  -- Provider coverage flags, so the planner never queues a resource the
  -- provider does not actually have for that season.
  coverage_json TEXT,
  UNIQUE (competition_id, season)
);

CREATE TABLE teams (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  provider TEXT NOT NULL,
  external_id TEXT NOT NULL,
  name TEXT NOT NULL,
  name_he TEXT,
  code TEXT,
  country_name TEXT,
  founded INTEGER,
  is_national INTEGER NOT NULL DEFAULT 0,
  venue_id INTEGER REFERENCES venues(id),
  updated_at TEXT NOT NULL DEFAULT (datetime('now')),
  UNIQUE (provider, external_id)
);

CREATE TABLE team_seasons (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  team_id INTEGER NOT NULL REFERENCES teams(id) ON DELETE CASCADE,
  competition_id INTEGER NOT NULL REFERENCES competitions(id) ON DELETE CASCADE,
  season INTEGER NOT NULL,
  UNIQUE (team_id, competition_id, season)
);

CREATE TABLE players (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  provider TEXT NOT NULL,
  external_id TEXT NOT NULL,
  name TEXT NOT NULL,
  firstname TEXT,
  lastname TEXT,
  name_he TEXT,
  nationality TEXT,
  birth_date TEXT,
  position TEXT,
  updated_at TEXT NOT NULL DEFAULT (datetime('now')),
  UNIQUE (provider, external_id)
);

-- Career history. `source` records how the relationship was learned, because a
-- squad listing and a transfer record carry different confidence.
CREATE TABLE player_teams (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  player_id INTEGER NOT NULL REFERENCES players(id) ON DELETE CASCADE,
  team_id INTEGER NOT NULL REFERENCES teams(id) ON DELETE CASCADE,
  season INTEGER,
  start_date TEXT,
  end_date TEXT,
  is_loan INTEGER NOT NULL DEFAULT 0,
  source TEXT NOT NULL,
  UNIQUE (player_id, team_id, season, source)
);

CREATE TABLE player_transfers (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  player_id INTEGER NOT NULL REFERENCES players(id) ON DELETE CASCADE,
  from_team_id INTEGER REFERENCES teams(id),
  to_team_id INTEGER REFERENCES teams(id),
  transfer_date TEXT,
  transfer_type TEXT,
  fee_text TEXT,
  source TEXT NOT NULL DEFAULT 'api-football',
  transfer_key TEXT NOT NULL UNIQUE
);

CREATE TABLE player_trophies (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  player_id INTEGER NOT NULL REFERENCES players(id) ON DELETE CASCADE,
  competition_name TEXT NOT NULL,
  country_name TEXT,
  season TEXT,
  place TEXT,
  trophy_key TEXT NOT NULL UNIQUE
);

CREATE TABLE coaches (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  provider TEXT NOT NULL,
  external_id TEXT NOT NULL,
  name TEXT NOT NULL,
  name_he TEXT,
  nationality TEXT,
  birth_date TEXT,
  UNIQUE (provider, external_id)
);

CREATE TABLE coach_teams (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  coach_id INTEGER NOT NULL REFERENCES coaches(id) ON DELETE CASCADE,
  team_id INTEGER NOT NULL REFERENCES teams(id) ON DELETE CASCADE,
  start_date TEXT,
  end_date TEXT,
  UNIQUE (coach_id, team_id, start_date)
);

CREATE TABLE fixtures (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  provider TEXT NOT NULL,
  external_id TEXT NOT NULL,
  competition_id INTEGER REFERENCES competitions(id),
  season INTEGER,
  round TEXT,
  kickoff TEXT,
  venue_id INTEGER REFERENCES venues(id),
  home_team_id INTEGER REFERENCES teams(id),
  away_team_id INTEGER REFERENCES teams(id),
  home_goals INTEGER,
  away_goals INTEGER,
  status TEXT,
  UNIQUE (provider, external_id)
);

CREATE TABLE fixture_events (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  fixture_id INTEGER NOT NULL REFERENCES fixtures(id) ON DELETE CASCADE,
  minute INTEGER,
  team_id INTEGER REFERENCES teams(id),
  player_id INTEGER REFERENCES players(id),
  type TEXT,
  detail TEXT,
  event_key TEXT NOT NULL UNIQUE
);

CREATE TABLE standings (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  competition_id INTEGER NOT NULL REFERENCES competitions(id) ON DELETE CASCADE,
  season INTEGER NOT NULL,
  team_id INTEGER NOT NULL REFERENCES teams(id) ON DELETE CASCADE,
  rank INTEGER,
  points INTEGER,
  played INTEGER,
  won INTEGER,
  drawn INTEGER,
  lost INTEGER,
  goals_for INTEGER,
  goals_against INTEGER,
  UNIQUE (competition_id, season, team_id)
);

-- Derived from standings/fixtures once a season is complete; the direct source
-- of "who won competition X in season Y" questions.
CREATE TABLE competition_winners (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  competition_id INTEGER NOT NULL REFERENCES competitions(id) ON DELETE CASCADE,
  season INTEGER NOT NULL,
  team_id INTEGER NOT NULL REFERENCES teams(id) ON DELETE CASCADE,
  runner_up_team_id INTEGER REFERENCES teams(id),
  derived_from TEXT NOT NULL,
  UNIQUE (competition_id, season)
);

CREATE TABLE player_season_stats (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  player_id INTEGER NOT NULL REFERENCES players(id) ON DELETE CASCADE,
  team_id INTEGER REFERENCES teams(id),
  competition_id INTEGER REFERENCES competitions(id),
  season INTEGER NOT NULL,
  appearances INTEGER,
  goals INTEGER,
  assists INTEGER,
  minutes INTEGER,
  UNIQUE (player_id, team_id, competition_id, season)
);

CREATE TABLE team_season_stats (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  team_id INTEGER NOT NULL REFERENCES teams(id) ON DELETE CASCADE,
  competition_id INTEGER NOT NULL REFERENCES competitions(id) ON DELETE CASCADE,
  season INTEGER NOT NULL,
  played INTEGER,
  wins INTEGER,
  draws INTEGER,
  losses INTEGER,
  goals_for INTEGER,
  goals_against INTEGER,
  UNIQUE (team_id, competition_id, season)
);

-- ===========================================================================
-- Sync infrastructure
-- ===========================================================================

-- What has been imported, keyed by a string built in code ("teams:39:2024").
-- ARCHIVED means a completed historical season that must never be re-fetched.
CREATE TABLE data_sync_state (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  provider TEXT NOT NULL,
  resource_key TEXT NOT NULL UNIQUE,
  resource_type TEXT NOT NULL,
  status TEXT NOT NULL,
  last_synced_at TEXT,
  record_count INTEGER NOT NULL DEFAULT 0,
  detail TEXT
);

-- Durable work queue. A harvest that stops on quota leaves PENDING rows that
-- the next run picks up, so imports resume exactly where they left off.
CREATE TABLE data_sync_queue (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  task_key TEXT NOT NULL UNIQUE,
  resource_type TEXT NOT NULL,
  competition_external_id TEXT,
  season INTEGER,
  team_external_id TEXT,
  player_external_id TEXT,
  page INTEGER NOT NULL DEFAULT 1,
  priority INTEGER NOT NULL DEFAULT 100,
  status TEXT NOT NULL DEFAULT 'PENDING',
  attempt_count INTEGER NOT NULL DEFAULT 0,
  last_attempt_at TEXT,
  completed_at TEXT,
  error TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE data_sync_runs (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  provider TEXT NOT NULL,
  started_at TEXT NOT NULL,
  finished_at TEXT,
  requests_used INTEGER NOT NULL DEFAULT 0,
  requests_limit INTEGER,
  requests_remaining INTEGER,
  tasks_completed INTEGER NOT NULL DEFAULT 0,
  tasks_failed INTEGER NOT NULL DEFAULT 0,
  entities_json TEXT,
  status TEXT NOT NULL,
  notes TEXT
);

-- One row per outbound API call. `day_key` is the provider-quota day, which is
-- how the budget knows how much of today's allowance is already spent.
CREATE TABLE api_request_log (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  provider TEXT NOT NULL,
  endpoint TEXT NOT NULL,
  params TEXT,
  day_key TEXT NOT NULL,
  requested_at TEXT NOT NULL DEFAULT (datetime('now')),
  status_code INTEGER,
  results INTEGER,
  rate_limit_remaining INTEGER
);

CREATE INDEX idx_player_teams_player ON player_teams(player_id);
CREATE INDEX idx_player_teams_team ON player_teams(team_id);
CREATE INDEX idx_player_transfers_player ON player_transfers(player_id);
CREATE INDEX idx_player_trophies_player ON player_trophies(player_id);
CREATE INDEX idx_fixtures_competition_season ON fixtures(competition_id, season);
CREATE INDEX idx_standings_competition_season ON standings(competition_id, season);
CREATE INDEX idx_sync_queue_status ON data_sync_queue(status, priority);
CREATE INDEX idx_api_request_log_day ON api_request_log(provider, day_key);
CREATE INDEX idx_teams_name ON teams(name);
CREATE INDEX idx_players_name ON players(name);
