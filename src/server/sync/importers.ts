// Normalized entities -> idempotent D1 upserts.
//
// Every statement here is an UPSERT keyed on (provider, external_id) or a
// deterministic *_key, so running the same import twice changes nothing.
// Nothing in this file knows which provider produced the data.

import { sqlValue } from "./d1Client.ts";
import type {
  NormalizedCoach,
  NormalizedCompetition,
  NormalizedCountry,
  NormalizedFixture,
  NormalizedPlayer,
  NormalizedSquadMember,
  NormalizedStandingRow,
  NormalizedTeam,
  NormalizedTopScorer,
  NormalizedTransfer,
  NormalizedTrophy,
  NormalizedVenue,
} from "../providers/football/types.ts";

/** Sub-select resolving a provider id to our internal row id. */
const teamRef = (provider: string, externalId: string | null | undefined) =>
  externalId
    ? `(SELECT id FROM teams WHERE provider = ${sqlValue(provider)} AND external_id = ${sqlValue(externalId)})`
    : "NULL";

const competitionRef = (provider: string, externalId: string | null | undefined) =>
  externalId
    ? `(SELECT id FROM competitions WHERE provider = ${sqlValue(provider)} AND external_id = ${sqlValue(externalId)})`
    : "NULL";

const venueRef = (provider: string, externalId: string | null | undefined) =>
  externalId
    ? `(SELECT id FROM venues WHERE provider = ${sqlValue(provider)} AND external_id = ${sqlValue(externalId)})`
    : "NULL";

/**
 * Stub rows for entities named by a relationship we are importing.
 *
 * A transfer list, coach career or league table names players and clubs this
 * harvest may never import in full — the Brazilian club a player left in 2011,
 * say. With no row to point at, the sub-select above yields NULL, and because
 * player_teams.team_id / player_transfers.player_id are NOT NULL the insert
 * fails and takes the rest of the batch — an entire paid-for API response —
 * with it.
 *
 * A stub keyed on the same (provider, external_id) keeps the fact. It is not a
 * second copy: a later full import of that club or player hits the same UNIQUE
 * key and enriches this row in place.
 */
function playerStub(provider: string, externalId: string, name: string): string {
  return `INSERT OR IGNORE INTO players (provider, external_id, name)
          VALUES (${sqlValue(provider)}, ${sqlValue(externalId)}, ${sqlValue(name)});`;
}

function teamStub(provider: string, externalId: string, name: string): string {
  return `INSERT OR IGNORE INTO teams (provider, external_id, name)
          VALUES (${sqlValue(provider)}, ${sqlValue(externalId)}, ${sqlValue(name)});`;
}

/**
 * A player_teams row that writes only when both sides actually resolve.
 *
 * Selecting the ids instead of sub-selecting them into VALUES turns a missing
 * player or club into zero rows rather than a NOT NULL failure, so one
 * unknown club cannot cost us the whole response.
 */
function playerTeamLink(
  provider: string,
  playerExternalId: string,
  teamExternalId: string,
  columns: { season?: number | null; startDate?: string | null; isLoan?: boolean; source: string }
): string {
  return `INSERT OR IGNORE INTO player_teams (player_id, team_id, season, start_date, is_loan, source)
          SELECT p.id, t.id, ${sqlValue(columns.season ?? null)}, ${sqlValue(columns.startDate ?? null)},
                 ${sqlValue(columns.isLoan ?? false)}, ${sqlValue(columns.source)}
            FROM players p, teams t
           WHERE p.provider = ${sqlValue(provider)} AND p.external_id = ${sqlValue(playerExternalId)}
             AND t.provider = ${sqlValue(provider)} AND t.external_id = ${sqlValue(teamExternalId)};`;
}

export function upsertCountries(countries: NormalizedCountry[]): string[] {
  return countries
    .filter((c) => c.externalId && c.name)
    .map(
      (c) => `INSERT INTO countries (provider, external_id, code, name)
              VALUES (${sqlValue(c.provider)}, ${sqlValue(c.externalId)}, ${sqlValue(c.code)}, ${sqlValue(c.name)})
              ON CONFLICT(provider, external_id) DO UPDATE SET code = excluded.code, name = excluded.name, updated_at = datetime('now')
                WHERE code IS NOT excluded.code OR name IS NOT excluded.name;`
    );
}

export function upsertVenue(venue: NormalizedVenue): string {
  return `INSERT INTO venues (provider, external_id, name, city, country_name, capacity)
          VALUES (${sqlValue(venue.provider)}, ${sqlValue(venue.externalId)}, ${sqlValue(venue.name)},
                  ${sqlValue(venue.city)}, ${sqlValue(venue.countryName)}, ${sqlValue(venue.capacity)})
          ON CONFLICT(provider, external_id) DO UPDATE SET name = excluded.name, city = excluded.city,
            country_name = excluded.country_name, capacity = excluded.capacity,
            updated_at = datetime('now')
                WHERE name IS NOT excluded.name OR city IS NOT excluded.city OR country_name IS NOT excluded.country_name OR capacity IS NOT excluded.capacity;`;
}

export function upsertCompetitions(
  competitions: NormalizedCompetition[],
  localCodeFor: (c: NormalizedCompetition) => string | null,
  priorityFor: (c: NormalizedCompetition) => number
): string[] {
  const statements: string[] = [];
  for (const comp of competitions) {
    if (!comp.externalId || !comp.name) continue;
    statements.push(
      `INSERT INTO competitions (provider, external_id, name, type, country_name, country_code, local_code, priority)
       VALUES (${sqlValue(comp.provider)}, ${sqlValue(comp.externalId)}, ${sqlValue(comp.name)},
               ${sqlValue(comp.type)}, ${sqlValue(comp.countryName)}, ${sqlValue(comp.countryCode)},
               ${sqlValue(localCodeFor(comp))}, ${sqlValue(priorityFor(comp))})
       ON CONFLICT(provider, external_id) DO UPDATE SET name = excluded.name, type = excluded.type, country_name = excluded.country_name,
         country_code = excluded.country_code, local_code = excluded.local_code,
         priority = excluded.priority, updated_at = datetime('now')
                WHERE name IS NOT excluded.name OR type IS NOT excluded.type OR country_name IS NOT excluded.country_name OR country_code IS NOT excluded.country_code OR local_code IS NOT excluded.local_code OR priority IS NOT excluded.priority;`
    );

    for (const season of comp.seasons) {
      if (!Number.isFinite(season.season)) continue;
      statements.push(
        `INSERT INTO competition_seasons (competition_id, season, start_date, end_date, is_current, coverage_json)
         VALUES (${competitionRef(comp.provider, comp.externalId)}, ${sqlValue(season.season)},
                 ${sqlValue(season.startDate)}, ${sqlValue(season.endDate)}, ${sqlValue(season.isCurrent)},
                 ${sqlValue(season.coverage ? JSON.stringify(season.coverage) : null)})
         ON CONFLICT(competition_id, season) DO UPDATE SET start_date = excluded.start_date, end_date = excluded.end_date,
           is_current = excluded.is_current, coverage_json = excluded.coverage_json
                WHERE start_date IS NOT excluded.start_date OR end_date IS NOT excluded.end_date OR is_current IS NOT excluded.is_current OR coverage_json IS NOT excluded.coverage_json;`
      );
    }
  }
  return statements;
}

export function upsertTeams(
  teams: NormalizedTeam[],
  context?: { competitionExternalId?: string | null; season?: number | null }
): string[] {
  const statements: string[] = [];
  for (const team of teams) {
    if (!team.externalId || !team.name) continue;
    if (team.venue) statements.push(upsertVenue(team.venue));

    statements.push(
      `INSERT INTO teams (provider, external_id, name, code, country_name, founded, is_national, venue_id)
       VALUES (${sqlValue(team.provider)}, ${sqlValue(team.externalId)}, ${sqlValue(team.name)},
               ${sqlValue(team.code)}, ${sqlValue(team.countryName)}, ${sqlValue(team.founded)},
               ${sqlValue(team.isNational)}, ${venueRef(team.provider, team.venue?.externalId)})
       ON CONFLICT(provider, external_id) DO UPDATE SET name = excluded.name, code = excluded.code, country_name = excluded.country_name,
         founded = excluded.founded, is_national = excluded.is_national,
         venue_id = COALESCE(excluded.venue_id, teams.venue_id), updated_at = datetime('now')
                WHERE name IS NOT excluded.name OR code IS NOT excluded.code OR country_name IS NOT excluded.country_name OR founded IS NOT excluded.founded OR is_national IS NOT excluded.is_national
                   OR (excluded.venue_id IS NOT NULL AND teams.venue_id IS NOT excluded.venue_id);`
    );

    if (context?.competitionExternalId && context.season != null) {
      statements.push(
        `INSERT OR IGNORE INTO team_seasons (team_id, competition_id, season)
         VALUES (${teamRef(team.provider, team.externalId)},
                 ${competitionRef(team.provider, context.competitionExternalId)}, ${sqlValue(context.season)});`
      );
    }
  }
  return statements;
}

export function upsertPlayers(players: NormalizedPlayer[]): string[] {
  return players
    .filter((p) => p.externalId && p.name)
    .map(
      (p) => `INSERT INTO players (provider, external_id, name, firstname, lastname, nationality, birth_date, position)
              VALUES (${sqlValue(p.provider)}, ${sqlValue(p.externalId)}, ${sqlValue(p.name)},
                      ${sqlValue(p.firstname)}, ${sqlValue(p.lastname)}, ${sqlValue(p.nationality)},
                      ${sqlValue(p.birthDate)}, ${sqlValue(p.position)})
              ON CONFLICT(provider, external_id) DO UPDATE SET name = excluded.name, firstname = excluded.firstname, lastname = excluded.lastname,
                nationality = COALESCE(excluded.nationality, players.nationality),
                birth_date = COALESCE(excluded.birth_date, players.birth_date),
                position = COALESCE(excluded.position, players.position),
                updated_at = datetime('now')
                -- Every column the SET touches has to appear here, or the
                -- unchanged-row guard silently discards the new information.
                -- Listing only the name columns meant a player first created as a
                -- name-only stub by a transfer list could never gain a position
                -- from the squad import that followed: the name already matched,
                -- so the whole UPDATE was skipped and the COALESCE never ran.
                WHERE name IS NOT excluded.name
                   OR firstname IS NOT excluded.firstname
                   OR lastname IS NOT excluded.lastname
                   OR (excluded.nationality IS NOT NULL AND players.nationality IS NOT excluded.nationality)
                   OR (excluded.birth_date IS NOT NULL AND players.birth_date IS NOT excluded.birth_date)
                   OR (excluded.position IS NOT NULL AND players.position IS NOT excluded.position);`
    );
}

export function upsertSquad(members: NormalizedSquadMember[]): string[] {
  const statements: string[] = [];
  statements.push(...upsertPlayers(members.map((m) => m.player)));
  for (const member of members) {
    if (!member.player.externalId || !member.teamExternalId) continue;
    statements.push(
      playerTeamLink(member.player.provider, member.player.externalId, member.teamExternalId, {
        season: member.season,
        source: "squad",
      })
    );
  }
  return statements;
}

/**
 * Transfers. The key includes date + both clubs so the same move is never
 * stored twice, and the pair also lands in player_teams so career questions
 * can use transfer-derived history.
 */
export function upsertTransfers(provider: string, transfers: NormalizedTransfer[]): string[] {
  const statements: string[] = [];
  // One request covers a whole club's transfer traffic, so the same player and
  // the same clubs recur many times over. Stub each only once per batch.
  const stubbedPlayers = new Set<string>();
  const stubbedTeams = new Set<string>();

  for (const t of transfers) {
    // Without a name there is no way to create a referenceable player row, and
    // a transfer whose subject we cannot identify carries no question value.
    if (!t.playerExternalId || !t.playerName) continue;

    if (!stubbedPlayers.has(t.playerExternalId)) {
      stubbedPlayers.add(t.playerExternalId);
      statements.push(playerStub(provider, t.playerExternalId, t.playerName));
    }
    for (const club of [
      { id: t.fromTeamExternalId, name: t.fromTeamName },
      { id: t.toTeamExternalId, name: t.toTeamName },
    ]) {
      if (!club.id || !club.name || stubbedTeams.has(club.id)) continue;
      stubbedTeams.add(club.id);
      statements.push(teamStub(provider, club.id, club.name));
    }

    const key = [t.playerExternalId, t.fromTeamExternalId ?? "-", t.toTeamExternalId ?? "-", t.date ?? "-"].join(":");
    const isLoan = /loan/i.test(t.type ?? "");

    // from/to may legitimately be NULL (a debut, or a club the provider did not
    // name), but player_id may not be — hence SELECT ... WHERE over VALUES.
    statements.push(
      `INSERT INTO player_transfers (player_id, from_team_id, to_team_id, transfer_date, transfer_type, fee_text, source, transfer_key)
       SELECT p.id, ${teamRef(provider, t.fromTeamExternalId)}, ${teamRef(provider, t.toTeamExternalId)},
              ${sqlValue(t.date)}, ${sqlValue(t.type)}, ${sqlValue(t.feeText)}, ${sqlValue(provider)}, ${sqlValue(key)}
         FROM players p
        WHERE p.provider = ${sqlValue(provider)} AND p.external_id = ${sqlValue(t.playerExternalId)}
       ON CONFLICT(transfer_key) DO UPDATE SET transfer_type = excluded.transfer_type, fee_text = excluded.fee_text
                WHERE transfer_type IS NOT excluded.transfer_type OR fee_text IS NOT excluded.fee_text;`
    );

    if (t.toTeamExternalId) {
      statements.push(
        playerTeamLink(provider, t.playerExternalId, t.toTeamExternalId, {
          season: t.date ? Number(t.date.slice(0, 4)) : null,
          startDate: t.date,
          isLoan,
          source: "transfer",
        })
      );
    }
  }
  return statements;
}

export function upsertTrophies(provider: string, trophies: NormalizedTrophy[]): string[] {
  return trophies
    .filter((t) => t.personExternalId && t.competitionName)
    .map((t) => {
      const key = [t.personExternalId, t.competitionName, t.season ?? "-", t.place ?? "-"].join(":");
      // /trophies is queried per person, so the player is normally already
      // stored — but a trophy with no player to hang it on is silently dropped
      // rather than failing the batch it shares.
      return `INSERT INTO player_trophies (player_id, competition_name, country_name, season, place, trophy_key)
              SELECT p.id, ${sqlValue(t.competitionName)}, ${sqlValue(t.countryName)},
                     ${sqlValue(t.season)}, ${sqlValue(t.place)}, ${sqlValue(key)}
                FROM players p
               WHERE p.provider = ${sqlValue(provider)} AND p.external_id = ${sqlValue(t.personExternalId)}
              ON CONFLICT(trophy_key) DO NOTHING;`;
    });
}

export function upsertCoaches(coaches: NormalizedCoach[]): string[] {
  const statements: string[] = [];
  for (const coach of coaches) {
    if (!coach.externalId || !coach.name) continue;
    statements.push(
      `INSERT INTO coaches (provider, external_id, name, nationality, birth_date)
       VALUES (${sqlValue(coach.provider)}, ${sqlValue(coach.externalId)}, ${sqlValue(coach.name)},
               ${sqlValue(coach.nationality)}, ${sqlValue(coach.birthDate)})
       ON CONFLICT(provider, external_id) DO UPDATE SET name = excluded.name, nationality = excluded.nationality, birth_date = excluded.birth_date
                WHERE name IS NOT excluded.name OR nationality IS NOT excluded.nationality OR birth_date IS NOT excluded.birth_date;`
    );
    // A coach's career spans clubs far outside the harvested competitions —
    // exactly the spread that makes manager questions interesting — so each
    // club named gets a stub, and the link writes only once both ends resolve.
    for (const career of coach.careers) {
      if (!career.teamExternalId) continue;
      if (career.teamName) statements.push(teamStub(coach.provider, career.teamExternalId, career.teamName));
      statements.push(
        `INSERT OR IGNORE INTO coach_teams (coach_id, team_id, start_date, end_date)
         SELECT c.id, t.id, ${sqlValue(career.start)}, ${sqlValue(career.end)}
           FROM coaches c, teams t
          WHERE c.provider = ${sqlValue(coach.provider)} AND c.external_id = ${sqlValue(coach.externalId)}
            AND t.provider = ${sqlValue(coach.provider)} AND t.external_id = ${sqlValue(career.teamExternalId)};`
      );
    }
  }
  return statements;
}

/**
 * Records every cup champion that the stored finals settle.
 *
 * A cup's champion cannot come from its /standings, which returns group tables —
 * rank 1 there is a group winner, not a trophy. It comes from the final, and this
 * reads the finals already in the database rather than only the ones in the batch
 * being imported, so it doubles as a backfill after a schema change and costs no
 * API request either way.
 *
 * Three things it refuses to guess at:
 *
 *  * Penalties outrank goals. The 2022 World Cup final finished 3-3; comparing
 *    goals finds no winner and Argentina's 4-2 shootout win is invisible.
 *  * A level final with no shootout on record yields nothing, rather than a coin
 *    toss between two sides.
 *  * Only a round named exactly "Final" counts. "3rd Place Final" contains the
 *    word and settles no trophy, and a two-legged semi-final is not one either.
 */
export function deriveCupWinnersFromFinals(): string {
  const shootoutDecided = `f.home_penalties IS NOT NULL AND f.away_penalties IS NOT NULL AND f.home_penalties <> f.away_penalties`;
  const goalsDecided = `f.home_goals IS NOT NULL AND f.away_goals IS NOT NULL AND f.home_goals <> f.away_goals`;
  const pick = (better: "home" | "away") => `
    CASE WHEN ${shootoutDecided}
           THEN CASE WHEN f.home_penalties > f.away_penalties THEN f.${better}_team_id ELSE f.${better === "home" ? "away" : "home"}_team_id END
         WHEN ${goalsDecided}
           THEN CASE WHEN f.home_goals > f.away_goals THEN f.${better}_team_id ELSE f.${better === "home" ? "away" : "home"}_team_id END
    END`;

  return `INSERT INTO competition_winners (competition_id, season, team_id, runner_up_team_id, derived_from)
          SELECT competition_id, season, winner, runner_up, 'final-fixture' FROM (
            SELECT f.competition_id AS competition_id, f.season AS season,
                   ${pick("home")} AS winner,
                   ${pick("away")} AS runner_up
              FROM fixtures f
             WHERE LOWER(TRIM(f.round)) = 'final'
               AND UPPER(COALESCE(f.status,'')) IN ('FT','AET','PEN')
               AND f.competition_id IS NOT NULL AND f.season IS NOT NULL
               AND f.home_team_id IS NOT NULL AND f.away_team_id IS NOT NULL
          ) settled
          WHERE winner IS NOT NULL
          ON CONFLICT(competition_id, season) DO UPDATE SET team_id = excluded.team_id,
            runner_up_team_id = excluded.runner_up_team_id, derived_from = excluded.derived_from
                WHERE team_id IS NOT excluded.team_id OR runner_up_team_id IS NOT excluded.runner_up_team_id OR derived_from IS NOT excluded.derived_from;`;
}

export function upsertFixtures(fixtures: NormalizedFixture[]): string[] {
  const statements: string[] = [];
  // A cup fixture list is the only place many of its clubs appear. One request
  // for the Champions League names every side that played in it, most of which
  // no domestic league table we hold would have introduced.
  const stubbedTeams = new Set<string>();

  for (const f of fixtures) {
    if (!f.externalId) continue;
    if (f.venue) statements.push(upsertVenue(f.venue));

    for (const side of [
      { id: f.homeTeamExternalId, name: f.homeTeamName },
      { id: f.awayTeamExternalId, name: f.awayTeamName },
    ]) {
      if (!side.id || !side.name || stubbedTeams.has(side.id)) continue;
      stubbedTeams.add(side.id);
      statements.push(teamStub(f.provider, side.id, side.name));
    }

    statements.push(
      `INSERT INTO fixtures (provider, external_id, competition_id, season, round, kickoff, venue_id,
                             home_team_id, away_team_id, home_goals, away_goals, home_penalties, away_penalties, status)
       VALUES (${sqlValue(f.provider)}, ${sqlValue(f.externalId)}, ${competitionRef(f.provider, f.competitionExternalId)},
               ${sqlValue(f.season)}, ${sqlValue(f.round)}, ${sqlValue(f.kickoff)},
               ${venueRef(f.provider, f.venue?.externalId)}, ${teamRef(f.provider, f.homeTeamExternalId)},
               ${teamRef(f.provider, f.awayTeamExternalId)}, ${sqlValue(f.homeGoals)}, ${sqlValue(f.awayGoals)},
               ${sqlValue(f.homePenalties)}, ${sqlValue(f.awayPenalties)}, ${sqlValue(f.status)})
       ON CONFLICT(provider, external_id) DO UPDATE SET home_goals = excluded.home_goals, away_goals = excluded.away_goals,
         home_penalties = excluded.home_penalties, away_penalties = excluded.away_penalties,
         status = excluded.status, round = excluded.round
                WHERE home_goals IS NOT excluded.home_goals OR away_goals IS NOT excluded.away_goals OR status IS NOT excluded.status OR round IS NOT excluded.round
                   OR home_penalties IS NOT excluded.home_penalties OR away_penalties IS NOT excluded.away_penalties;`
    );

    // Playing a fixture in a competition is proof of participation in it, which
    // is what "which of these clubs played in the 2024 Champions League" rests
    // on — and it makes those clubs askable subjects everywhere else.
    if (f.competitionExternalId && f.season != null) {
      for (const teamExternalId of [f.homeTeamExternalId, f.awayTeamExternalId]) {
        if (!teamExternalId) continue;
        statements.push(
          `INSERT OR IGNORE INTO team_seasons (team_id, competition_id, season)
           SELECT t.id, c.id, ${sqlValue(f.season)}
             FROM teams t, competitions c
            WHERE t.provider = ${sqlValue(f.provider)} AND t.external_id = ${sqlValue(teamExternalId)}
              AND c.provider = ${sqlValue(f.provider)} AND c.external_id = ${sqlValue(f.competitionExternalId)};`
        );
      }
    }
  }

  // Runs once per batch rather than per fixture: it is a set operation over the
  // finals now in the database.
  if (statements.length > 0) statements.push(deriveCupWinnersFromFinals());
  return statements;
}

export function upsertStandings(
  provider: string,
  competitionExternalId: string,
  season: number,
  rows: NormalizedStandingRow[],
  options: { seasonComplete: boolean }
): string[] {
  const statements: string[] = [];

  for (const r of rows) {
    if (!r.teamExternalId) continue;
    // A table is a complete list of a division's clubs and names every one of
    // them, so standings can stand alone: it no longer depends on a /teams
    // request having been spent on the same league-season first.
    if (r.teamName) statements.push(teamStub(provider, r.teamExternalId, r.teamName));
    statements.push(
      `INSERT INTO standings (competition_id, season, team_id, rank, points, played, won, drawn, lost, goals_for, goals_against)
       SELECT c.id, ${sqlValue(season)}, t.id, ${sqlValue(r.rank)}, ${sqlValue(r.points)},
              ${sqlValue(r.played)}, ${sqlValue(r.won)}, ${sqlValue(r.drawn)}, ${sqlValue(r.lost)},
              ${sqlValue(r.goalsFor)}, ${sqlValue(r.goalsAgainst)}
         FROM competitions c, teams t
        WHERE c.provider = ${sqlValue(provider)} AND c.external_id = ${sqlValue(competitionExternalId)}
          AND t.provider = ${sqlValue(provider)} AND t.external_id = ${sqlValue(r.teamExternalId)}
       ON CONFLICT(competition_id, season, team_id) DO UPDATE SET rank = excluded.rank, points = excluded.points, played = excluded.played,
         won = excluded.won, drawn = excluded.drawn, lost = excluded.lost,
         goals_for = excluded.goals_for, goals_against = excluded.goals_against
                WHERE rank IS NOT excluded.rank OR points IS NOT excluded.points OR played IS NOT excluded.played OR won IS NOT excluded.won OR drawn IS NOT excluded.drawn OR lost IS NOT excluded.lost OR goals_for IS NOT excluded.goals_for OR goals_against IS NOT excluded.goals_against;`
    );
    // Appearing in a league table is proof the club played that season, and it
    // is what lets the planner rank clubs by competition when it decides where
    // to spend the expensive per-team requests.
    statements.push(
      `INSERT OR IGNORE INTO team_seasons (team_id, competition_id, season)
       SELECT t.id, c.id, ${sqlValue(season)}
         FROM teams t, competitions c
        WHERE t.provider = ${sqlValue(provider)} AND t.external_id = ${sqlValue(r.teamExternalId)}
          AND c.provider = ${sqlValue(provider)} AND c.external_id = ${sqlValue(competitionExternalId)};`
    );
  }

  // A finished single-table season's rank-1 team is the champion — the fact
  // behind "who won competition X in season Y". Two guards keep that inference
  // honest, because a wrong champion is worse than no champion:
  //
  //  * The provider flattens a grouped competition's tables into one list, so a
  //    Champions League group stage arrives as eight rank-1 rows. Taking the
  //    first would crown whoever topped Group A. Exactly one rank-1 row is what
  //    distinguishes a real single table from that.
  //  * A season still being played also has a rank-1 team, in September. That is
  //    the current leader, not the champion.
  const leaders = rows.filter((r) => r.rank === 1);
  const champion = leaders.length === 1 ? leaders[0] : undefined;
  const runnerUp = rows.filter((r) => r.rank === 2).length === 1 ? rows.find((r) => r.rank === 2) : undefined;
  if (champion && options.seasonComplete) {
    statements.push(
      `INSERT INTO competition_winners (competition_id, season, team_id, runner_up_team_id, derived_from)
       SELECT c.id, ${sqlValue(season)}, t.id,
              ${runnerUp ? teamRef(provider, runnerUp.teamExternalId) : "NULL"}, 'standings'
         FROM competitions c, teams t
        WHERE c.provider = ${sqlValue(provider)} AND c.external_id = ${sqlValue(competitionExternalId)}
          AND t.provider = ${sqlValue(provider)} AND t.external_id = ${sqlValue(champion.teamExternalId)}
       ON CONFLICT(competition_id, season) DO UPDATE SET team_id = excluded.team_id, runner_up_team_id = excluded.runner_up_team_id,
         derived_from = excluded.derived_from
                WHERE team_id IS NOT excluded.team_id OR runner_up_team_id IS NOT excluded.runner_up_team_id OR derived_from IS NOT excluded.derived_from;`
    );
  }
  return statements;
}

export function upsertTopScorers(
  provider: string,
  competitionExternalId: string,
  season: number,
  scorers: NormalizedTopScorer[]
): string[] {
  const statements: string[] = [];
  statements.push(...upsertPlayers(scorers.map((s) => s.player)));
  for (const s of scorers) {
    if (!s.player.externalId) continue;
    statements.push(
      `INSERT INTO player_season_stats (player_id, team_id, competition_id, season, appearances, goals, assists)
       SELECT p.id, ${teamRef(provider, s.teamExternalId)}, ${competitionRef(provider, competitionExternalId)},
              ${sqlValue(season)}, ${sqlValue(s.appearances)}, ${sqlValue(s.goals)}, ${sqlValue(s.assists)}
         FROM players p
        WHERE p.provider = ${sqlValue(provider)} AND p.external_id = ${sqlValue(s.player.externalId)}
       ON CONFLICT(player_id, team_id, competition_id, season) DO UPDATE SET appearances = excluded.appearances, goals = excluded.goals, assists = excluded.assists
                WHERE appearances IS NOT excluded.appearances OR goals IS NOT excluded.goals OR assists IS NOT excluded.assists;`
    );
    // The scorers feed carries no club name, so an unimported club simply
    // yields no link rather than a stub with a placeholder name.
    if (s.teamExternalId) {
      statements.push(
        playerTeamLink(provider, s.player.externalId, s.teamExternalId, { season, source: "stats" })
      );
    }
  }
  return statements;
}
