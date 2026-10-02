// Loading the normalised football context out of D1.
//
// Both the generator and the audit need the same picture of the knowledge base:
// every team classified, every club and player scored, every position resolved.
// If they built it from separate SQL they would drift, and the audit's whole
// value is being able to say "this stored question would not be generated
// today" — which is only true if it applies the same rules to the same inputs.
//
// WHY AGGREGATES RATHER THAN CORRELATED SUBQUERIES
//
// The obvious shape is one big SELECT over `players` with a subquery per fame
// signal. With 5,993 players and eight signals that is ~48,000 index probes per
// run, and D1 bills rows read. The tables involved are all under 16,000 rows, so
// one GROUP BY scan per signal is both simpler and an order of magnitude
// cheaper. They are joined in memory here instead.
//
// WHAT IS MISSING, AND WHY IT MATTERS. `player_season_stats` and
// `player_trophies` are empty in production — nothing has harvested them yet. So
// appearances and trophies, the two strongest fame signals the model knows how
// to use, are unavailable, and fame falls back to squad coverage plus the clubs
// a player is recorded at. That makes most provider-only players score as
// obscure, which is the honest answer: we genuinely do not know that they are
// not. The queries are written to use the stats the moment they arrive.

import { CORE_COMPETITIONS } from "./prominence.ts";
import {
  buildFootballContext,
  type CuratedRecognition,
  type FootballContext,
  type PlayerContextRow,
  type TeamContextRow,
} from "./context.ts";

/** A minimal query runner, so this module does not care how D1 is reached. */
export interface FactReader {
  query<T = Record<string, unknown>>(sql: string): Promise<T[]>;
}

const sqlList = (values: Iterable<string>) =>
  [...values].map((v) => `'${v.replace(/'/g, "''")}'`).join(",");

const CORE_LIST = sqlList(CORE_COMPETITIONS);
const EUROPEAN_LIST = sqlList(["UCL", "UEL", "UECL"]);

/**
 * Teams, with everything the classifier and the prominence model need.
 *
 * `is_national` is the column that was being read at import and then dropped on
 * the floor; it is the single most important field in this query.
 */
export const TEAMS_SQL = `
  SELECT t.id, t.name, t.name_he, t.country_name, t.founded, t.is_national,
         v.name AS venue_name,
         MIN(c.priority) AS competition_priority,
         -- A club's own division, preferred over whatever competition the join
         -- happens to reach first. Without the type filter a club that has
         -- played in Europe gets local_code 'UCL', and then its "league" hint
         -- names the Champions League while its cup hint names it again.
         (SELECT c2.local_code
            FROM team_seasons ts2
            JOIN competitions c2 ON c2.id = ts2.competition_id
           WHERE ts2.team_id = t.id AND c2.local_code IS NOT NULL
           ORDER BY CASE WHEN c2.type = 'LEAGUE' THEN 0 ELSE 1 END, c2.priority, c2.id
           LIMIT 1) AS local_code,
         (SELECT COUNT(*)
            FROM team_seasons ts3
            JOIN competitions c3 ON c3.id = ts3.competition_id
           WHERE ts3.team_id = t.id AND c3.local_code IN (${EUROPEAN_LIST})) AS european_seasons,
         (SELECT COUNT(*) FROM competition_winners cw WHERE cw.team_id = t.id) AS titles,
         (SELECT COUNT(*) FROM team_seasons ts4 WHERE ts4.team_id = t.id) AS harvested_seasons
    FROM teams t
    LEFT JOIN venues v ON v.id = t.venue_id
    LEFT JOIN team_seasons ts ON ts.team_id = t.id
    LEFT JOIN competitions c ON c.id = ts.competition_id
   GROUP BY t.id
`;

/** Players, bare. The fame signals arrive from the aggregates below. */
export const PLAYERS_SQL = `SELECT id, name, name_he, nationality, position FROM players`;

/** One row per player: how many distinct clubs, and how many are in core leagues. */
export const PLAYER_CLUB_COUNTS_SQL = `
  SELECT pt.player_id,
         COUNT(DISTINCT pt.team_id) AS recorded_clubs,
         COUNT(DISTINCT CASE WHEN core.team_id IS NOT NULL THEN pt.team_id END) AS core_clubs,
         MAX(CASE WHEN t.is_national = 1 THEN 1 ELSE 0 END) AS has_senior_national_team
    FROM player_teams pt
    JOIN teams t ON t.id = pt.team_id
    LEFT JOIN (
      SELECT DISTINCT ts.team_id
        FROM team_seasons ts
        JOIN competitions c ON c.id = ts.competition_id
       WHERE c.local_code IN (${CORE_LIST})
    ) core ON core.team_id = pt.team_id
   GROUP BY pt.player_id
`;

export const PLAYER_TRANSFER_COUNTS_SQL = `
  SELECT player_id, COUNT(*) AS recorded_transfers FROM player_transfers GROUP BY player_id
`;

/**
 * Appearance and trophy counts.
 *
 * Both tables are empty today, so these return nothing and the fame model falls
 * back to coverage. Kept because they are the correct queries and because a
 * single harvest run makes them live.
 */
export const PLAYER_APPEARANCE_COUNTS_SQL = `
  SELECT s.player_id,
         COALESCE(SUM(CASE WHEN c.local_code IN (${CORE_LIST}) THEN s.appearances ELSE 0 END), 0) AS core_appearances,
         COALESCE(SUM(CASE WHEN c.local_code IN (${EUROPEAN_LIST}) THEN s.appearances ELSE 0 END), 0) AS european_appearances,
         COUNT(DISTINCT s.season) AS recorded_seasons
    FROM player_season_stats s
    JOIN competitions c ON c.id = s.competition_id
   GROUP BY s.player_id
`;

export const PLAYER_TROPHY_COUNTS_SQL = `
  SELECT player_id, COUNT(*) AS trophies
    FROM player_trophies
   WHERE LOWER(COALESCE(place, '')) = 'winner'
   GROUP BY player_id
`;

/** Every club a player is recorded at, for the best-club-prominence signal. */
export const PLAYER_TEAM_LINKS_SQL = `
  SELECT DISTINCT player_id, team_id FROM player_teams
`;

const num = (value: unknown): number => {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : 0;
};

/**
 * Builds the context from D1.
 *
 * Two passes over `buildFootballContext`, which is pure and cheap. The first
 * scores the teams; the second needs those scores, because "the best club this
 * player is recorded at" is a fame signal and it cannot exist before the clubs
 * have been scored. Doing it in two honest passes beats a single pass that
 * pretends the dependency is not there.
 */
export async function loadFootballContext(
  db: FactReader,
  curated: CuratedRecognition = {}
): Promise<{ context: FootballContext; teams: TeamContextRow[]; players: PlayerContextRow[] }> {
  const [teamRows, playerRows, clubCounts, transferCounts, appearanceCounts, trophyCounts, links] =
    await Promise.all([
      db.query<TeamContextRow>(TEAMS_SQL),
      db.query<Record<string, unknown>>(PLAYERS_SQL),
      db.query<Record<string, unknown>>(PLAYER_CLUB_COUNTS_SQL),
      db.query<Record<string, unknown>>(PLAYER_TRANSFER_COUNTS_SQL),
      db.query<Record<string, unknown>>(PLAYER_APPEARANCE_COUNTS_SQL),
      db.query<Record<string, unknown>>(PLAYER_TROPHY_COUNTS_SQL),
      db.query<Record<string, unknown>>(PLAYER_TEAM_LINKS_SQL),
    ]);

  const teams: TeamContextRow[] = teamRows.map((row) => ({
    ...row,
    id: num(row.id),
    founded: row.founded === null || row.founded === undefined ? null : num(row.founded),
    competition_priority:
      row.competition_priority === null || row.competition_priority === undefined
        ? null
        : num(row.competition_priority),
    european_seasons: num(row.european_seasons),
    titles: num(row.titles),
    harvested_seasons: num(row.harvested_seasons),
  }));

  // Pass one: teams only, so club prominence exists.
  const teamsOnly = buildFootballContext({ teams, curated });

  const bestClubByPlayer = new Map<number, number>();
  for (const link of links) {
    const playerId = num(link.player_id);
    const profile = teamsOnly.teamById.get(num(link.team_id));
    if (!profile || profile.kind !== "CLUB") continue;
    const current = bestClubByPlayer.get(playerId);
    if (current === undefined || profile.prominence < current) {
      bestClubByPlayer.set(playerId, profile.prominence);
    }
  }

  const index = <T extends Record<string, unknown>>(rows: T[]) =>
    new Map(rows.map((row) => [num(row.player_id), row]));
  const clubs = index(clubCounts);
  const transfers = index(transferCounts);
  const appearances = index(appearanceCounts);
  const trophies = index(trophyCounts);

  const players: PlayerContextRow[] = playerRows.map((row) => {
    const id = num(row.id);
    const club = clubs.get(id);
    const appearance = appearances.get(id);
    return {
      id,
      name: String(row.name ?? ""),
      name_he: (row.name_he as string | null) ?? null,
      nationality: (row.nationality as string | null) ?? null,
      position: (row.position as string | null) ?? null,
      recorded_clubs: club ? num(club.recorded_clubs) : 0,
      core_clubs: club ? num(club.core_clubs) : 0,
      has_senior_national_team: club ? num(club.has_senior_national_team) : 0,
      recorded_transfers: transfers.has(id) ? num(transfers.get(id)!.recorded_transfers) : 0,
      core_appearances: appearance ? num(appearance.core_appearances) : 0,
      european_appearances: appearance ? num(appearance.european_appearances) : 0,
      recorded_seasons: appearance ? num(appearance.recorded_seasons) : 0,
      trophies: trophies.has(id) ? num(trophies.get(id)!.trophies) : 0,
      best_club_prominence: bestClubByPlayer.get(id) ?? null,
    };
  });

  // Pass two: the full context, with player fame.
  return { context: buildFootballContext({ teams, players, curated }), teams, players };
}
