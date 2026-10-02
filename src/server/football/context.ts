// The normalised football context.
//
// One pass over the knowledge base turns provider rows into typed, scored
// entities: every team classified, every club and player given a prominence,
// every position resolved with its confidence. Generation and the production
// audit both build this from the same function, which is what makes the audit
// able to say "this stored question would not be generated today" rather than
// re-implementing the rules and hoping they match.
//
// Everything here is pure. The SQL that feeds it lives in the scripts; this
// module never touches D1, so it is testable with a handful of literal rows.

import {
  classifyTeam,
  clubCandidate,
  nationalTeamCandidate,
  parentClubName,
  playerCandidate,
  type Candidate,
  type TeamKind,
} from "./entities.ts";
import { competitionTier, clubProminence, playerFame, type DomainTier } from "./prominence.ts";
import { resolvePosition, type DetailedPosition, type ResolvedPosition } from "./positions.ts";
import { reserveParentOverride, teamKindOverride, providerPositionOverride } from "./overrides.ts";

// ---------------------------------------------------------------------------
// Input rows — what the scripts read out of D1
// ---------------------------------------------------------------------------

export interface TeamContextRow {
  id: number;
  name: string;
  name_he?: string | null;
  country_name?: string | null;
  founded?: number | null;
  venue_name?: string | null;
  /** The club's own division code, where it maps to one of the app's. */
  local_code?: string | null;
  /** Best (lowest) provider priority over the competitions it has played in. */
  competition_priority?: number | null;
  /** The provider's `national` flag. */
  is_national?: number | boolean | null;
  /** Harvested seasons in UCL/UEL/UECL. */
  european_seasons?: number | null;
  /** Competition titles on record. */
  titles?: number | null;
  /** Harvested competition-seasons of any kind. */
  harvested_seasons?: number | null;
}

export interface PlayerContextRow {
  id: number;
  name: string;
  name_he?: string | null;
  nationality?: string | null;
  /** The provider's broad position string. */
  position?: string | null;
  core_appearances?: number | null;
  european_appearances?: number | null;
  core_clubs?: number | null;
  trophies?: number | null;
  recorded_clubs?: number | null;
  recorded_transfers?: number | null;
  recorded_seasons?: number | null;
  has_senior_national_team?: number | boolean | null;
  /** Best (lowest) prominence among the clubs on record for this player. */
  best_club_prominence?: number | null;
}

/**
 * Recognition data from the curated registries.
 *
 * Passed in rather than imported, so this module stays free of build-time data
 * and the dependency runs one way: scripts know about both seed data and the
 * football layer; the football layer knows about neither.
 */
export interface CuratedRecognition {
  /** Club names (and aliases) a Hebrew-speaking fan is expected to recognise. */
  clubNames?: Iterable<string>;
  /** Titles per curated club name, for separating Barcelona from the rest. */
  clubTitles?: Map<string, number>;
  /** Player name (and alias) -> curated fame tier, 1 = global icon. */
  playerTiers?: Map<string, 1 | 2 | 3>;
  /** Curated precise roles, by player name/alias. */
  playerRoles?: Map<string, DetailedPosition>;
}

// ---------------------------------------------------------------------------
// Profiles
// ---------------------------------------------------------------------------

export interface TeamProfile {
  id: number;
  /** The provider's name, which is what option text and transfer rows carry. */
  name: string;
  /** What a player sees: the Hebrew name where we have one. */
  displayName: string;
  kind: TeamKind;
  /** 0 = Real Madrid, 3 = a club that entered the database via one transfer. */
  prominence: number;
  tier: DomainTier;
  country: string | null;
  competitionCode: string | null;
  founded: number | null;
  venueName: string | null;
  /** For a reserve or youth side: the first team, where it could be traced. */
  parentName: string | null;
  curated: boolean;
}

export interface PlayerProfile {
  id: number;
  name: string;
  displayName: string;
  /** 0 = Messi, 3 = a fringe squad member. */
  fame: number;
  position: ResolvedPosition;
  nationality: string | null;
  curatedTier: 1 | 2 | 3 | null;
}

export interface FootballContext {
  teamById: Map<number, TeamProfile>;
  /** By provider name — the key transfer and fixture rows actually carry. */
  teamByName: Map<string, TeamProfile>;
  playerById: Map<number, PlayerProfile>;
  playerByName: Map<string, PlayerProfile>;
  /** Candidate pools, pre-filtered to what each entity type may legally offer. */
  clubPool: Candidate[];
  nationalTeamPool: Candidate[];
  /** Club names eligible to be asked about at all. */
  askableClubNames: Set<string>;
  /** Every team name classified as something other than an askable club. */
  nonClubTeamNames: Map<string, TeamKind>;
}

const fold = (value: string) =>
  (value ?? "").normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase().replace(/\s+/g, " ").trim();

/**
 * Builds the context.
 *
 * Two passes over the teams, because club prominence feeds player fame and
 * player fame does not feed club prominence — so teams are scored first and
 * completely, then players.
 */
export function buildFootballContext(input: {
  teams: TeamContextRow[];
  players?: PlayerContextRow[];
  curated?: CuratedRecognition;
}): FootballContext {
  const curatedClubs = new Set([...(input.curated?.clubNames ?? [])].map(fold));
  const curatedTitles = new Map(
    [...(input.curated?.clubTitles ?? new Map())].map(([name, count]) => [fold(name), count])
  );
  const curatedPlayerTiers = new Map(
    [...(input.curated?.playerTiers ?? new Map())].map(([name, tier]) => [fold(name), tier])
  );
  const curatedPlayerRoles = new Map(
    [...(input.curated?.playerRoles ?? new Map())].map(([name, role]) => [fold(name), role])
  );

  const teamById = new Map<number, TeamProfile>();
  const teamByName = new Map<string, TeamProfile>();
  const nonClubTeamNames = new Map<string, TeamKind>();
  const askableClubNames = new Set<string>();

  // First pass: classification only, so the senior-club set exists before any
  // reserve side needs to look its parent up in it.
  const kinds = new Map<number, TeamKind>();
  for (const row of input.teams) {
    kinds.set(
      row.id,
      classifyTeam({ name: row.name, isNational: row.is_national, override: teamKindOverride(row.name) })
    );
  }
  const seniorClubNames = new Set(
    input.teams.filter((row) => kinds.get(row.id) === "CLUB").map((row) => row.name)
  );

  for (const row of input.teams) {
    const kind = kinds.get(row.id)!;
    const curated = curatedClubs.has(fold(row.name)) || curatedClubs.has(fold(row.name_he ?? ""));
    const tier = competitionTier({
      localCode: row.local_code ?? null,
      countryName: row.country_name ?? null,
      priority: row.competition_priority ?? null,
    });

    const profile: TeamProfile = {
      id: row.id,
      name: row.name,
      displayName: row.name_he || row.name,
      kind,
      tier,
      country: row.country_name ?? null,
      competitionCode: row.local_code ?? null,
      founded: row.founded ?? null,
      venueName: row.venue_name ?? null,
      parentName:
        kind === "RESERVE_TEAM" || kind === "YOUTH_TEAM"
          ? reserveParentOverride(row.name) ?? parentClubName(row.name, seniorClubNames)
          : null,
      curated,
      prominence:
        kind === "NATIONAL_TEAM"
          ? // A senior national team is as recognisable as its country. Scoring one
            // on club signals would make Brazil obscure, which it is not.
            0.4
          : clubProminence({
              localCode: row.local_code ?? null,
              countryName: row.country_name ?? null,
              competitionPriority: row.competition_priority ?? null,
              europeanSeasons: row.european_seasons ?? 0,
              titles: row.titles ?? curatedTitles.get(fold(row.name)) ?? 0,
              harvestedSeasons: row.harvested_seasons ?? 0,
              curated,
            }),
    };

    teamById.set(row.id, profile);
    // A duplicate provider name is possible (two clubs, one spelling). The first
    // wins, which is also what the old name-keyed lookups did, so nothing moves.
    if (!teamByName.has(row.name)) teamByName.set(row.name, profile);
    if (profile.displayName !== row.name && !teamByName.has(profile.displayName)) {
      teamByName.set(profile.displayName, profile);
    }

    if (kind === "CLUB") {
      askableClubNames.add(row.name);
      askableClubNames.add(profile.displayName);
    } else {
      nonClubTeamNames.set(row.name, kind);
      if (profile.displayName !== row.name) nonClubTeamNames.set(profile.displayName, kind);
    }
  }

  const playerById = new Map<number, PlayerProfile>();
  const playerByName = new Map<string, PlayerProfile>();

  for (const row of input.players ?? []) {
    const curatedTier = curatedPlayerTiers.get(fold(row.name)) ?? curatedPlayerTiers.get(fold(row.name_he ?? "")) ?? null;
    const position = resolvePosition({
      curatedRole:
        providerPositionOverride(row.name) ??
        curatedPlayerRoles.get(fold(row.name)) ??
        curatedPlayerRoles.get(fold(row.name_he ?? "")) ??
        null,
      providerBroad: row.position ?? null,
    });

    const profile: PlayerProfile = {
      id: row.id,
      name: row.name,
      displayName: row.name_he || row.name,
      curatedTier,
      nationality: row.nationality ?? null,
      position,
      fame: playerFame({
        curatedTier,
        hasSeniorNationalTeam: row.has_senior_national_team === 1 || row.has_senior_national_team === true,
        coreAppearances: row.core_appearances ?? 0,
        europeanAppearances: row.european_appearances ?? 0,
        coreClubs: row.core_clubs ?? 0,
        trophies: row.trophies ?? 0,
        recordedClubs: row.recorded_clubs ?? 0,
        recordedTransfers: row.recorded_transfers ?? 0,
        recordedSeasons: row.recorded_seasons ?? 0,
        bestClubProminence: row.best_club_prominence ?? null,
      }),
    };

    playerById.set(row.id, profile);
    if (!playerByName.has(row.name)) playerByName.set(row.name, profile);
    if (profile.displayName !== row.name && !playerByName.has(profile.displayName)) {
      playerByName.set(profile.displayName, profile);
    }
  }

  return {
    teamById,
    teamByName,
    playerById,
    playerByName,
    clubPool: [...teamById.values()].filter((t) => t.kind === "CLUB").map(toClubCandidate),
    nationalTeamPool: [...teamById.values()].filter((t) => t.kind === "NATIONAL_TEAM").map(toNationalCandidate),
    askableClubNames,
    nonClubTeamNames,
  };
}

/**
 * A club profile as a distractor-engine candidate.
 *
 * The candidate's text is the PROVIDER name, not `displayName`. Two reasons:
 * transfer rows, fixture team sheets and every stored option in the bank carry
 * the provider spelling, so matching on it is what lets the audit compare a
 * stored question against what would be generated today; and `teams.name_he` is
 * null for all 1,699 rows, so there is no Hebrew name being discarded. If
 * Hebrew club names are ever imported, this is the one line to change — and the
 * audit's name matching has to change with it.
 */
export function toClubCandidate(team: TeamProfile): Candidate {
  return clubCandidate(team.name, {
    id: team.id,
    prominence: team.prominence,
    country: team.country,
    competitionCode: team.competitionCode,
    era: team.founded,
  });
}

export function toNationalCandidate(team: TeamProfile): Candidate {
  return nationalTeamCandidate(team.name, {
    id: team.id,
    prominence: team.prominence,
    country: team.country,
  });
}

export function toPlayerCandidate(player: PlayerProfile): Candidate {
  return playerCandidate(player.name, {
    id: player.id,
    prominence: player.fame,
    country: player.nationality,
  });
}

/** Whether a team may be asked about, or offered, in a club question. */
export const isAskableClubName = (context: FootballContext, name: string | null | undefined): boolean =>
  Boolean(name) && context.askableClubNames.has(name!);

/** Which non-club kind a name is, or null when it is an askable club. */
export const nonClubKindOf = (context: FootballContext, name: string | null | undefined): TeamKind | null =>
  name ? context.nonClubTeamNames.get(name) ?? null : null;
