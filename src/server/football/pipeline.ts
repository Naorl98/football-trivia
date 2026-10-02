// The knowledge-base question pipeline.
//
// D1 facts → normalised context → generators → quality gates → questions.
//
// WHY THIS IS A MODULE AND NOT A SCRIPT
//
// Two commands need to produce the same questions from the same facts:
//
//   npm run questions:generate   writes new questions
//   npm run questions:audit      compares the stored bank against what the
//                                rules would produce today, and repairs it
//
// The audit's entire value rests on that being literally the same computation.
// If it re-implemented the SQL or the generator wiring, a question could look
// wrong to the audit because the audit was built differently — and a repair
// pass driven by a disagreement between two copies of the rules is worse than
// no repair pass.
//
// So the pipeline lives here, both commands call it, and neither contains any
// generation logic of its own.

import {
  generateCareerPaths,
  generateClubConnections,
  generateCompetitionParticipation,
  generateCompetitionWinners,
  generateCupFinalQuestions,
  generateDidNotPlayFor,
  generateGuessTheClub,
  generateKnockoutProgressionQuestions,
  generateManagerQuestions,
  generatePreviousClubQuestions,
  generateTopScorerQuestions,
  generateTransferQuestions,
  generateTrophyQuestions,
  generateVenueQuestions,
  generateWhoAmI,
  indexCareers,
  indexClubFacts,
  notableClubNames,
  seasonLabel,
  type GeneratorOptions,
  type KnowledgeQuestion,
} from "../questions/knowledgeGenerators.ts";
import { loadFootballContext, type FactReader } from "./facts.ts";
import type { CuratedRecognition, FootballContext } from "./context.ts";

/**
 * Tidies provider-supplied names before they reach question text.
 *
 * API-Football returns the odd "Tomasz  Kuszczak" with a doubled space, which
 * reads as a typo in a question and, worse, normalises to a different free-text
 * answer than the same name written once. Whitespace only — nothing here renames
 * or re-spells anybody.
 */
const cleanName = (value: unknown) =>
  typeof value === "string" ? value.replace(/\s+/g, " ").trim() : value;

const NAME_COLUMNS = [
  "player_name", "team_name", "from_team_name", "to_team_name", "coach_name",
  "name", "runner_up_name", "competition_name", "venue_name",
  "home_team_name", "away_team_name",
];

function tidyNames<T extends Record<string, unknown>>(rows: T[]): T[] {
  for (const row of rows) {
    for (const column of NAME_COLUMNS) {
      if (row[column] != null) (row as Record<string, unknown>)[column] = cleanName(row[column]);
    }
  }
  return rows;
}

export interface KnowledgeFacts {
  context: FootballContext;
  teams: Record<string, unknown>[];
  players: Record<string, unknown>[];
  winners: Record<string, unknown>[];
  transfers: Record<string, unknown>[];
  trophies: Record<string, unknown>[];
  playerTeams: Record<string, unknown>[];
  coachSpells: Record<string, unknown>[];
  seasonStats: Record<string, unknown>[];
  cupFixtures: Record<string, unknown>[];
  participationRows: Record<string, unknown>[];
  competitionClubs: Record<string, unknown>[];
}

/** Reads every fact the generators consume. One query per resource. */
export async function loadKnowledgeFacts(
  db: FactReader,
  curated: CuratedRecognition = {}
): Promise<KnowledgeFacts> {
  const { context, teams, players } = await loadFootballContext(db, curated);

  const [
    winners,
    transfers,
    trophies,
    playerTeams,
    coachSpells,
    seasonStats,
    cupFixtures,
    participationRows,
    competitionClubs,
  ] = await Promise.all([
    db.query(`
      SELECT cw.competition_id, c.name AS competition_name, c.local_code AS competition_local_code,
             c.priority AS competition_priority, c.type AS competition_type, cw.season,
             w.name AS team_name, r.name AS runner_up_name, w.country_name AS team_country,
             cs.start_date, cs.end_date
        FROM competition_winners cw
        JOIN competitions c ON c.id = cw.competition_id
        JOIN teams w ON w.id = cw.team_id
        LEFT JOIN teams r ON r.id = cw.runner_up_team_id
        LEFT JOIN competition_seasons cs
               ON cs.competition_id = cw.competition_id AND cs.season = cw.season
    `),
    db.query(`
      SELECT pt.player_id, p.name AS player_name,
             pt.from_team_id, ft.name AS from_team_name,
             pt.to_team_id, tt.name AS to_team_name,
             pt.transfer_date, pt.transfer_type
        FROM player_transfers pt
        JOIN players p ON p.id = pt.player_id
        LEFT JOIN teams ft ON ft.id = pt.from_team_id
        LEFT JOIN teams tt ON tt.id = pt.to_team_id
    `),
    db.query(`
      SELECT tr.player_id, p.name AS player_name, tr.competition_name, tr.country_name, tr.season, tr.place
        FROM player_trophies tr
        JOIN players p ON p.id = tr.player_id
    `),
    // Every known player-at-club relationship, however it was learned — a squad
    // listing, a transfer, or a scoring record. Club Connection and Who Am I are
    // both built from this, so they see a career assembled from all three sources
    // rather than transfers alone.
    db.query(`
      SELECT pt.player_id, p.name AS player_name, p.position, p.nationality,
             pt.team_id, t.name AS team_name, t.country_name, pt.season, pt.start_date
        FROM player_teams pt
        JOIN players p ON p.id = pt.player_id
        JOIN teams t ON t.id = pt.team_id
    `),
    db.query(`
      SELECT ct.coach_id, co.name AS coach_name, co.nationality,
             ct.team_id, t.name AS team_name, ct.start_date, ct.end_date
        FROM coach_teams ct
        JOIN coaches co ON co.id = ct.coach_id
        JOIN teams t ON t.id = ct.team_id
    `),
    db.query(`
      SELECT s.player_id, p.name AS player_name, t.name AS team_name,
             c.name AS competition_name, c.local_code AS competition_local_code,
             c.priority AS competition_priority, s.season, s.goals, s.assists, s.appearances,
             cs.start_date, cs.end_date
        FROM player_season_stats s
        JOIN players p ON p.id = s.player_id
        JOIN competitions c ON c.id = s.competition_id
        LEFT JOIN teams t ON t.id = s.team_id
        LEFT JOIN competition_seasons cs
               ON cs.competition_id = s.competition_id AND cs.season = s.season
    `),
    // Cup fixtures. Only the rounds the generators reason about are read: a group
    // or league phase is hundreds of rows that settle nothing on their own.
    db.query(`
      SELECT f.id, f.competition_id, c.name AS competition_name, c.local_code AS competition_local_code,
             c.priority AS competition_priority, c.type AS competition_type, f.season, f.round,
             f.home_team_id, f.away_team_id, h.name AS home_team_name, a.name AS away_team_name,
             f.home_goals, f.away_goals, f.home_penalties, f.away_penalties, f.status,
             cs.start_date, cs.end_date
        FROM fixtures f
        JOIN competitions c ON c.id = f.competition_id
        LEFT JOIN teams h ON h.id = f.home_team_id
        LEFT JOIN teams a ON a.id = f.away_team_id
        LEFT JOIN competition_seasons cs ON cs.competition_id = f.competition_id AND cs.season = f.season
       WHERE LOWER(TRIM(f.round)) IN ('final','semi-finals','quarter-finals','round of 16')
    `),
    // Who took part in each competition-season, and for which of them the fixture
    // list is complete enough to argue from absence.
    db.query(`
      SELECT ts.competition_id, ts.season, t.name AS team_name,
             c.name AS competition_name, c.local_code AS competition_local_code,
             c.priority AS competition_priority, c.type AS competition_type,
             cs.start_date, cs.end_date,
             (SELECT COUNT(*) FROM fixtures f
               WHERE f.competition_id = ts.competition_id AND f.season = ts.season) AS fixture_count
        FROM team_seasons ts
        JOIN teams t ON t.id = ts.team_id
        JOIN competitions c ON c.id = ts.competition_id
        LEFT JOIN competition_seasons cs ON cs.competition_id = ts.competition_id AND cs.season = ts.season
       WHERE c.type = 'CUP'
    `),
    db.query(`
      SELECT ts.competition_id, t.name AS team_name
        FROM team_seasons ts
        JOIN teams t ON t.id = ts.team_id
    `),
  ]);

  for (const rows of [
    teams, players, winners, transfers, trophies, playerTeams,
    coachSpells, seasonStats, cupFixtures, participationRows, competitionClubs,
  ]) {
    tidyNames(rows as Record<string, unknown>[]);
  }

  for (const row of winners) {
    row.season_label = seasonLabel(Number(row.season), row.start_date as string, row.end_date as string);
  }
  for (const row of seasonStats) {
    row.season_label = seasonLabel(Number(row.season), row.start_date as string, row.end_date as string);
  }
  for (const row of cupFixtures) {
    row.season_label = seasonLabel(Number(row.season), row.start_date as string, row.end_date as string);
  }

  return {
    context,
    teams: teams as unknown as Record<string, unknown>[],
    players: players as unknown as Record<string, unknown>[],
    winners,
    transfers,
    trophies,
    playerTeams,
    coachSpells,
    seasonStats,
    cupFixtures,
    participationRows,
    competitionClubs,
  };
}

export interface KnowledgeGeneration {
  byGenerator: Record<string, KnowledgeQuestion[]>;
  candidates: KnowledgeQuestion[];
  options: GeneratorOptions;
  /** Non-club player-club links dropped while indexing careers, by team kind. */
  droppedCareerLinks: Record<string, number>;
  teamKindCounts: Record<string, number>;
}

/** Runs every generator over the facts. Pure: the same facts give the same questions. */
export function generateKnowledgeQuestions(facts: KnowledgeFacts): KnowledgeGeneration {
  const { context } = facts;

  const transfersByPlayer = new Map<number, Record<string, unknown>[]>();
  for (const row of facts.transfers) {
    const id = Number(row.player_id);
    transfersByPlayer.set(id, [...(transfersByPlayer.get(id) ?? []), row]);
  }

  const careers = indexCareers(facts.playerTeams as never, context);
  const notable = notableClubNames(facts.teams as never);

  const clubsByCompetition = new Map<number, string[]>();
  for (const row of facts.competitionClubs) {
    const id = Number(row.competition_id);
    clubsByCompetition.set(id, [...(clubsByCompetition.get(id) ?? []), String(row.team_name)]);
  }

  const clubCountryById = new Map<number, string | null>(
    facts.teams.map((t) => [Number(t.id), (t.country_name as string | null) ?? null])
  );

  // Grouped by competition-season. Only seasons with a stored fixture list get
  // participation questions, because those are the only ones where a club's
  // absence from the team sheet actually means it did not play.
  const cupParticipants = new Map<string, string[]>();
  const cupSeasonMeta = new Map<string, Record<string, unknown>>();
  for (const row of facts.participationRows) {
    if (Number(row.fixture_count) === 0) continue;
    const key = `${row.competition_id}:${row.season}`;
    cupParticipants.set(key, [...(cupParticipants.get(key) ?? []), String(row.team_name)]);
    if (!cupSeasonMeta.has(key)) {
      cupSeasonMeta.set(key, {
        competitionId: Number(row.competition_id),
        competitionName: String(row.competition_name),
        localCode: (row.competition_local_code as string | null) ?? null,
        priority: (row.competition_priority as number | null) ?? null,
        type: (row.competition_type as string | null) ?? null,
        season: Number(row.season),
        seasonLabel: seasonLabel(Number(row.season), row.start_date as string, row.end_date as string),
      });
    }
  }

  /*
    Which cups each club has played in, by club name.

    Gives career questions a competition scope, so a Champions League quiz reaches
    the transfers and team-mates of the clubs that contested it rather than only
    the two finals we hold. A scope, not a category: the question is still a
    transfer question and is still counted as one.
  */
  const cupScopeSets = new Map<string, Set<string>>();
  for (const row of facts.participationRows) {
    if (!row.competition_local_code) continue;
    const name = String(row.team_name);
    const codes = cupScopeSets.get(name) ?? new Set<string>();
    codes.add(String(row.competition_local_code));
    cupScopeSets.set(name, codes);
  }
  const cupScopes = new Map<string, string[]>(
    [...cupScopeSets].map(([name, codes]) => [name, [...codes]])
  );

  const clubFacts = indexClubFacts(facts.teams as never, cupScopes);
  const options: GeneratorOptions = { context, cupScopes, clubFacts, clubCountryById };

  const byGenerator: Record<string, KnowledgeQuestion[]> = {
    competitionWinners: generateCompetitionWinners(facts.winners as never, clubsByCompetition, context),
    transferTo: generateTransferQuestions(facts.transfers as never, options),
    transferFrom: generatePreviousClubQuestions(facts.transfers as never, options),
    careerPath: generateCareerPaths(transfersByPlayer as never, facts.players as never, options),
    clubConnection: generateClubConnections(careers, options),
    didNotPlayFor: generateDidNotPlayFor(careers, options),
    whoAmI: generateWhoAmI(careers, options),
    guessTheClub: generateGuessTheClub(facts.teams as never, options),
    managers: generateManagerQuestions(facts.coachSpells as never, options),
    topScorers: generateTopScorerQuestions(facts.seasonStats as never, options),
    cupFinals: generateCupFinalQuestions(facts.cupFixtures as never, cupParticipants, options),
    knockouts: generateKnockoutProgressionQuestions(facts.cupFixtures as never, cupParticipants, options),
    cupParticipation: generateCompetitionParticipation(
      cupParticipants,
      cupSeasonMeta as never,
      [...notable],
      options
    ),
    venues: generateVenueQuestions(facts.teams as never, options),
    trophies: generateTrophyQuestions(facts.trophies as never, options),
  };

  const teamKindCounts: Record<string, number> = {};
  for (const profile of context.teamById.values()) {
    teamKindCounts[profile.kind] = (teamKindCounts[profile.kind] ?? 0) + 1;
  }

  return {
    byGenerator,
    candidates: Object.values(byGenerator).flat(),
    options,
    droppedCareerLinks: careers.droppedByKind,
    teamKindCounts,
  };
}

/**
 * Semantic-key prefixes the pipeline can produce.
 *
 * Used by the audit to tell "this question's fact no longer supports a question"
 * from "this question came from somewhere this pipeline knows nothing about".
 * The difference decides whether a stored question is deactivated or left alone,
 * so it is derived from the generators' own output rather than hardcoded.
 */
export function knowledgeKeyPrefixes(generation: KnowledgeGeneration): Set<string> {
  const prefixes = new Set<string>();
  for (const q of generation.candidates) {
    const at = q.semanticKey.indexOf(":");
    prefixes.add(at === -1 ? q.semanticKey : q.semanticKey.slice(0, at));
  }
  // Prefixes the generators no longer emit at all still have to be recognised,
  // or their stored questions would be treated as foreign and left active for
  // ever. These are the ones this phase retired.
  for (const retired of ["KB_TROPHY_PLAYER", "KB_TOP_SCORER", "KB_CUP_FINAL_SCORE"]) {
    prefixes.add(retired);
  }
  return prefixes;
}
