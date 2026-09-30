-- Multiplayer game history.
--
-- Live rooms live entirely inside their Durable Object: the DO is the source of
-- truth for state, scores and progression, and nothing about an in-flight room
-- touches D1. These two tables are written exactly once per game, when a room
-- reaches FINISHED, so a 20-question game with 6 players costs 7 rows rather
-- than one row per WebSocket event.
--
-- That restraint is the point. The write budget added in 0004 exists because the
-- free tier's daily row allowance is small enough that a chatty design would
-- exhaust it; multiplayer must not reintroduce the problem it solved.

CREATE TABLE multiplayer_games (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  -- The room code is not unique across time: codes are recycled once a room
  -- expires, so a code may appear in many historical rows.
  room_code TEXT NOT NULL,
  mode TEXT NOT NULL,
  configuration_json TEXT NOT NULL,
  question_count INTEGER NOT NULL,
  player_count INTEGER NOT NULL,
  started_at TEXT NOT NULL,
  finished_at TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE multiplayer_game_players (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  game_id INTEGER NOT NULL REFERENCES multiplayer_games(id) ON DELETE CASCADE,
  player_name TEXT NOT NULL,
  team TEXT,
  score INTEGER NOT NULL,
  position INTEGER NOT NULL,
  correct_count INTEGER NOT NULL,
  wrong_count INTEGER NOT NULL,
  best_streak INTEGER NOT NULL,
  -- Milliseconds, averaged over the questions this player actually answered.
  -- NULL when they answered none.
  average_response_time INTEGER
);

CREATE INDEX idx_multiplayer_games_room_code ON multiplayer_games(room_code);
CREATE INDEX idx_multiplayer_games_finished_at ON multiplayer_games(finished_at);
CREATE INDEX idx_multiplayer_game_players_game_id ON multiplayer_game_players(game_id);
