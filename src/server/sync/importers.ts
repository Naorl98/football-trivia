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

const playerRef = (provider: string, externalId: string) =>
  `(SELECT id FROM players WHERE provider = ${sqlValue(provider)} AND external_id = ${sqlValue(externalId)})`;

const competitionRef = (provider: string, externalId: string | null | undefined) =>
  externalId
    ? `(SELECT id FROM competitions WHERE provider = ${sqlValue(provider)} AND external_id = ${sqlValue(externalId)})`
    : "NULL";

const venueRef = (provider: string, externalId: string | null | undefined) =>
  externalId
    ? `(SELECT id FROM venues WHERE provider = ${sqlValue(provider)} AND external_id = ${sqlValue(externalId)})`
    : "NULL";

export function upsertCountries(countries: NormalizedCountry[]): string[] {
  return countries
    .filter((c) => c.externalId && c.name)
    .map(
      (c) => `INSERT INTO countries (provider, external_id, code, name)
              VALUES (${sqlValue(c.provider)}, ${sqlValue(c.externalId)}, ${sqlValue(c.code)}, ${sqlValue(c.name)})
              ON CONFLICT(provider, external_id) DO UPDATE SET
                code = excluded.code, name = excluded.name, updated_at = datetime('now');`
    );
}

export function upsertVenue(venue: NormalizedVenue): string {
  return `INSERT INTO venues (provider, external_id, name, city, country_name, capacity)
          VALUES (${sqlValue(venue.provider)}, ${sqlValue(venue.externalId)}, ${sqlValue(venue.name)},
                  ${sqlValue(venue.city)}, ${sqlValue(venue.countryName)}, ${sqlValue(venue.capacity)})
          ON CONFLICT(provider, external_id) DO UPDATE SET
            name = excluded.name, city = excluded.city,
            country_name = excluded.country_name, capacity = excluded.capacity,
            updated_at = datetime('now');`;
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
       ON CONFLICT(provider, external_id) DO UPDATE SET
         name = excluded.name, type = excluded.type, country_name = excluded.country_name,
         country_code = excluded.country_code, local_code = excluded.local_code,
         priority = excluded.priority, updated_at = datetime('now');`
    );

    for (const season of comp.seasons) {
      if (!Number.isFinite(season.season)) continue;
      statements.push(
        `INSERT INTO competition_seasons (competition_id, season, start_date, end_date, is_current, coverage_json)
         VALUES (${competitionRef(comp.provider, comp.externalId)}, ${sqlValue(season.season)},
                 ${sqlValue(season.startDate)}, ${sqlValue(season.endDate)}, ${sqlValue(season.isCurrent)},
                 ${sqlValue(season.coverage ? JSON.stringify(season.coverage) : null)})
         ON CONFLICT(competition_id, season) DO UPDATE SET
           start_date = excluded.start_date, end_date = excluded.end_date,
           is_current = excluded.is_current, coverage_json = excluded.coverage_json;`
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
       ON CONFLICT(provider, external_id) DO UPDATE SET
         name = excluded.name, code = excluded.code, country_name = excluded.country_name,
         founded = excluded.founded, is_national = excluded.is_national,
         venue_id = COALESCE(excluded.venue_id, teams.venue_id), updated_at = datetime('now');`
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
              ON CONFLICT(provider, external_id) DO UPDATE SET
                name = excluded.name, firstname = excluded.firstname, lastname = excluded.lastname,
                nationality = COALESCE(excluded.nationality, players.nationality),
                birth_date = COALESCE(excluded.birth_date, players.birth_date),
                position = COALESCE(excluded.position, players.position),
                updated_at = datetime('now');`
    );
}

export function upsertSquad(members: NormalizedSquadMember[]): string[] {
  const statements: string[] = [];
  statements.push(...upsertPlayers(members.map((m) => m.player)));
  for (const member of members) {
    if (!member.player.externalId || !member.teamExternalId) continue;
    statements.push(
      `INSERT OR IGNORE INTO player_teams (player_id, team_id, season, source)
       VALUES (${playerRef(member.player.provider, member.player.externalId)},
               ${teamRef(member.player.provider, member.teamExternalId)},
               ${sqlValue(member.season)}, 'squad');`
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
  for (const t of transfers) {
    if (!t.playerExternalId) continue;
    const key = [t.playerExternalId, t.fromTeamExternalId ?? "-", t.toTeamExternalId ?? "-", t.date ?? "-"].join(":");
    const isLoan = /loan/i.test(t.type ?? "");

    statements.push(
      `INSERT INTO player_transfers (player_id, from_team_id, to_team_id, transfer_date, transfer_type, fee_text, source, transfer_key)
       VALUES (${playerRef(provider, t.playerExternalId)}, ${teamRef(provider, t.fromTeamExternalId)},
               ${teamRef(provider, t.toTeamExternalId)}, ${sqlValue(t.date)}, ${sqlValue(t.type)},
               ${sqlValue(t.feeText)}, ${sqlValue(provider)}, ${sqlValue(key)})
       ON CONFLICT(transfer_key) DO UPDATE SET
         transfer_type = excluded.transfer_type, fee_text = excluded.fee_text;`
    );

    if (t.toTeamExternalId) {
      const season = t.date ? Number(t.date.slice(0, 4)) : null;
      statements.push(
        `INSERT OR IGNORE INTO player_teams (player_id, team_id, season, start_date, is_loan, source)
         VALUES (${playerRef(provider, t.playerExternalId)}, ${teamRef(provider, t.toTeamExternalId)},
                 ${sqlValue(season)}, ${sqlValue(t.date)}, ${sqlValue(isLoan)}, 'transfer');`
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
      return `INSERT INTO player_trophies (player_id, competition_name, country_name, season, place, trophy_key)
              VALUES (${playerRef(provider, t.personExternalId)}, ${sqlValue(t.competitionName)},
                      ${sqlValue(t.countryName)}, ${sqlValue(t.season)}, ${sqlValue(t.place)}, ${sqlValue(key)})
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
       ON CONFLICT(provider, external_id) DO UPDATE SET
         name = excluded.name, nationality = excluded.nationality, birth_date = excluded.birth_date;`
    );
    for (const career of coach.careers) {
      if (!career.teamExternalId) continue;
      statements.push(
        `INSERT OR IGNORE INTO coach_teams (coach_id, team_id, start_date, end_date)
         VALUES ((SELECT id FROM coaches WHERE provider = ${sqlValue(coach.provider)} AND external_id = ${sqlValue(
          coach.externalId
        )}), ${teamRef(coach.provider, career.teamExternalId)}, ${sqlValue(career.start)}, ${sqlValue(career.end)});`
      );
    }
  }
  return statements;
}

export function upsertFixtures(fixtures: NormalizedFixture[]): string[] {
  const statements: string[] = [];
  for (const f of fixtures) {
    if (!f.externalId) continue;
    if (f.venue) statements.push(upsertVenue(f.venue));
    statements.push(
      `INSERT INTO fixtures (provider, external_id, competition_id, season, round, kickoff, venue_id,
                             home_team_id, away_team_id, home_goals, away_goals, status)
       VALUES (${sqlValue(f.provider)}, ${sqlValue(f.externalId)}, ${competitionRef(f.provider, f.competitionExternalId)},
               ${sqlValue(f.season)}, ${sqlValue(f.round)}, ${sqlValue(f.kickoff)},
               ${venueRef(f.provider, f.venue?.externalId)}, ${teamRef(f.provider, f.homeTeamExternalId)},
               ${teamRef(f.provider, f.awayTeamExternalId)}, ${sqlValue(f.homeGoals)}, ${sqlValue(f.awayGoals)},
               ${sqlValue(f.status)})
       ON CONFLICT(provider, external_id) DO UPDATE SET
         home_goals = excluded.home_goals, away_goals = excluded.away_goals,
         status = excluded.status, round = excluded.round;`
    );
  }
  return statements;
}

export function upsertStandings(
  provider: string,
  competitionExternalId: string,
  season: number,
  rows: NormalizedStandingRow[]
): string[] {
  const statements = rows
    .filter((r) => r.teamExternalId)
    .map(
      (r) => `INSERT INTO standings (competition_id, season, team_id, rank, points, played, won, drawn, lost, goals_for, goals_against)
              VALUES (${competitionRef(provider, competitionExternalId)}, ${sqlValue(season)},
                      ${teamRef(provider, r.teamExternalId)}, ${sqlValue(r.rank)}, ${sqlValue(r.points)},
                      ${sqlValue(r.played)}, ${sqlValue(r.won)}, ${sqlValue(r.drawn)}, ${sqlValue(r.lost)},
                      ${sqlValue(r.goalsFor)}, ${sqlValue(r.goalsAgainst)})
              ON CONFLICT(competition_id, season, team_id) DO UPDATE SET
                rank = excluded.rank, points = excluded.points, played = excluded.played,
                won = excluded.won, drawn = excluded.drawn, lost = excluded.lost,
                goals_for = excluded.goals_for, goals_against = excluded.goals_against;`
    );

  // A finished league season's rank-1 team is the champion — the fact behind
  // "who won competition X in season Y".
  const champion = rows.find((r) => r.rank === 1);
  const runnerUp = rows.find((r) => r.rank === 2);
  if (champion) {
    statements.push(
      `INSERT INTO competition_winners (competition_id, season, team_id, runner_up_team_id, derived_from)
       VALUES (${competitionRef(provider, competitionExternalId)}, ${sqlValue(season)},
               ${teamRef(provider, champion.teamExternalId)},
               ${runnerUp ? teamRef(provider, runnerUp.teamExternalId) : "NULL"}, 'standings')
       ON CONFLICT(competition_id, season) DO UPDATE SET
         team_id = excluded.team_id, runner_up_team_id = excluded.runner_up_team_id,
         derived_from = excluded.derived_from;`
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
       VALUES (${playerRef(provider, s.player.externalId)}, ${teamRef(provider, s.teamExternalId)},
               ${competitionRef(provider, competitionExternalId)}, ${sqlValue(season)},
               ${sqlValue(s.appearances)}, ${sqlValue(s.goals)}, ${sqlValue(s.assists)})
       ON CONFLICT(player_id, team_id, competition_id, season) DO UPDATE SET
         appearances = excluded.appearances, goals = excluded.goals, assists = excluded.assists;`
    );
    if (s.teamExternalId) {
      statements.push(
        `INSERT OR IGNORE INTO player_teams (player_id, team_id, season, source)
         VALUES (${playerRef(provider, s.player.externalId)}, ${teamRef(provider, s.teamExternalId)},
                 ${sqlValue(season)}, 'stats');`
      );
    }
  }
  return statements;
}
