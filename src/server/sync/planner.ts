// Harvest planner.
//
// With ~95 usable requests a day, what matters is questions generated per API
// request. The planner scores work by that yield, not by how much data a call
// returns:
//
//   squad   -> ~25 players x several career questions each   VERY HIGH
//   transfers (per team) -> whole transfer histories          VERY HIGH
//   standings -> a champion + runner-up + a full table        HIGH
//   teams   -> the club metadata every other question needs   HIGH
//   topscorers -> stats plus player/team links                MEDIUM
//   fixtures -> many rows, few unambiguous questions          LOW
//
// Betting, odds, predictions, injuries and live data are never requested:
// they cost quota and produce no Football IQ questions.

import type { ResourceType, SyncTask } from "./queue.ts";
import { buildTaskKey } from "./queue.ts";

/** API-Football league ids for the competitions Football IQ cares about. */
export interface CompetitionTarget {
  externalId: string;
  localCode: string | null;
  label: string;
  /** 1 = highest value, 3 = nice to have. */
  priority: 1 | 2 | 3;
  /** Seasons to import, newest first. */
  seasons: number[];
  type: "LEAGUE" | "CUP";
}

// API-Football labels a European 2025/26 campaign as season 2025, so 2025 is
// the most recent *completed* season and 2026 is in progress.
const CURRENT_SEASON = 2026;

/**
 * Seasons this subscription may actually request, inclusive.
 *
 * Not a tuning choice — the provider enforces it. On the Free plan every other
 * season answers with
 *   {"plan":"Free plans do not have access to this season, try from 2022 to 2024."}
 * and that answer costs a request from the same 100/day allowance as real data.
 * Planning outside the window would spend a third of a day's budget rediscovering
 * the same sentence, so the window is applied when work is planned and again
 * before a queued task is claimed.
 *
 * Widen this after a plan upgrade and the parked seasons become runnable again;
 * nothing else needs to change.
 */
export const SEASON_WINDOW = { min: 2022, max: 2024 } as const;

export function isSeasonAccessible(season: number | null | undefined): boolean {
  if (season === null || season === undefined) return true;
  return season >= SEASON_WINDOW.min && season <= SEASON_WINDOW.max;
}

const RECENT_LEAGUE_SEASONS = [2024, 2023, 2022];
// Empty on the Free plan: nothing before 2022 can be fetched at all. Kept so a
// paid plan only has to extend this list.
const DEEPER_LEAGUE_SEASONS: number[] = [];

/**
 * Priority 1 competitions with their API-Football league ids. These ids are
 * stable and published in the provider's /leagues catalogue; the harvester
 * still verifies each one against the stored competition catalogue before
 * queueing season work.
 */
export const COMPETITION_TARGETS: CompetitionTarget[] = [
  { externalId: "39", localCode: "PREMIER_LEAGUE", label: "Premier League", priority: 1, type: "LEAGUE", seasons: RECENT_LEAGUE_SEASONS },
  { externalId: "140", localCode: "LA_LIGA", label: "La Liga", priority: 1, type: "LEAGUE", seasons: RECENT_LEAGUE_SEASONS },
  { externalId: "135", localCode: "SERIE_A", label: "Serie A", priority: 1, type: "LEAGUE", seasons: RECENT_LEAGUE_SEASONS },
  { externalId: "78", localCode: "BUNDESLIGA", label: "Bundesliga", priority: 1, type: "LEAGUE", seasons: RECENT_LEAGUE_SEASONS },
  { externalId: "61", localCode: "LIGUE_1", label: "Ligue 1", priority: 1, type: "LEAGUE", seasons: RECENT_LEAGUE_SEASONS },
  { externalId: "94", localCode: "LIGA_PORTUGAL", label: "Primeira Liga", priority: 1, type: "LEAGUE", seasons: RECENT_LEAGUE_SEASONS },
  { externalId: "2", localCode: "UCL", label: "UEFA Champions League", priority: 1, type: "CUP", seasons: RECENT_LEAGUE_SEASONS },
  // Tournament years are filtered to the window below, so the World Cup means
  // Qatar 2022 only, and the Euro and Copa América mean their 2024 editions.
  { externalId: "1", localCode: "WORLD_CUP", label: "FIFA World Cup", priority: 1, type: "CUP", seasons: [2022, 2018, 2014, 2010] },

  { externalId: "3", localCode: "UEL", label: "UEFA Europa League", priority: 2, type: "CUP", seasons: RECENT_LEAGUE_SEASONS },
  { externalId: "4", localCode: "EURO", label: "UEFA European Championship", priority: 2, type: "CUP", seasons: [2024, 2020, 2016] },
  { externalId: "9", localCode: "COPA_AMERICA", label: "Copa América", priority: 2, type: "CUP", seasons: [2024, 2021, 2019] },
  { externalId: "88", localCode: "EREDIVISIE", label: "Eredivisie", priority: 2, type: "LEAGUE", seasons: RECENT_LEAGUE_SEASONS },
  { externalId: "383", localCode: "ISRAELI_PREMIER_LEAGUE", label: "Ligat ha'Al", priority: 2, type: "LEAGUE", seasons: RECENT_LEAGUE_SEASONS },
  { externalId: "71", localCode: null, label: "Brasileirão Série A", priority: 2, type: "LEAGUE", seasons: RECENT_LEAGUE_SEASONS },
  { externalId: "128", localCode: null, label: "Liga Profesional (Argentina)", priority: 2, type: "LEAGUE", seasons: RECENT_LEAGUE_SEASONS },

  { externalId: "253", localCode: null, label: "Major League Soccer", priority: 3, type: "LEAGUE", seasons: RECENT_LEAGUE_SEASONS },
];

/** Deeper history for the biggest leagues, queued only after the recent years. */
export const HISTORICAL_TARGETS: CompetitionTarget[] = COMPETITION_TARGETS.filter(
  (c) => c.priority === 1 && c.type === "LEAGUE"
).map((c) => ({ ...c, seasons: DEEPER_LEAGUE_SEASONS, priority: 3 as const }));

/**
 * Base score per resource type — lower runs first.
 * Tuned by expected questions generated per request.
 *
 * Two things drive this order, and both are consequences of the budget being
 * ~95 requests a day rather than thousands:
 *
 * `standings` runs early and `teams` runs late. A league table names every club
 * in the division, and the importer stubs a row for each, so standings delivers
 * the club graph *and* a champion for one request. A /teams call on the same
 * league-season returns the same clubs again, adding only venue, founded year
 * and country — metadata almost nothing asks about. Ordering teams first, as
 * this did, spent the entire daily budget re-listing clubs that standings would
 * have produced for free, and left no quota for a single career fact.
 *
 * `transfers` outranks everything per-team: one request returns the full move
 * history of every player who passed through a club, which is many careers, not
 * one. /transfers?player= would cost one request per player for the same rows.
 */
const RESOURCE_BASE_PRIORITY: Record<ResourceType, number> = {
  competitions: 5,
  standings: 10,
  // /teams is the only source of a club's founding year, country and stadium.
  // Those three facts are what Guess The Club and the stadium questions are made
  // of, and standings cannot supply them — a club stubbed from a league table has
  // a name and nothing else. Ranked below transfers because a marginal transfer
  // request still yields more raw questions, but well above the rest: without a
  // handful of these, two whole game modes generate nothing at all.
  teams: 15,
  transfers: 20,
  squad: 30,
  coaches: 40,
  topscorers: 50,
  trophies: 70,
  countries: 80,
  players: 85,
  fixtures: 95,
};

/**
 * How much worse one extra season of age makes a competition-level request.
 *
 * This is large on purpose. With ~95 requests a day, a stride of 1 — which is
 * what a plain `2026 - season` gives — leaves five seasons of every league
 * scoring within a few points of each other, so the whole budget goes on league
 * tables and the first per-club request is never reached. A stride wider than
 * the gap between resource tiers means the current season's tables are gathered
 * everywhere first, and 2021's wait behind a round of club work.
 */
const SEASON_DEPTH_STRIDE = 150;

export function scoreTask(
  resourceType: ResourceType,
  competitionPriority: number,
  season: number | null
): number {
  const base = RESOURCE_BASE_PRIORITY[resourceType];
  // Newer seasons first: they are cheaper to reason about and more recognisable.
  const seasonsOld = season ? Math.max(0, CURRENT_SEASON - season) : 0;
  return base * 10 + competitionPriority * 3 + seasonsOld * SEASON_DEPTH_STRIDE;
}

export interface PlanOptions {
  /** Resource keys already COMPLETE/ARCHIVED — never re-queued. */
  satisfied: Set<string>;
  /** Competitions confirmed to exist in the stored catalogue. */
  knownCompetitionIds?: Set<string>;
  includeHistorical?: boolean;
}

/**
 * Builds the full ordered wish-list of import work. The harvester then takes
 * as much of it as today's quota allows; the rest stays queued for tomorrow.
 */
export function planTasks(options: PlanOptions): SyncTask[] {
  const tasks: SyncTask[] = [];
  const push = (task: Omit<SyncTask, "taskKey">) => {
    const taskKey = buildTaskKey(task);
    // resourceKey mirrors taskKey for single-page resources.
    if (options.satisfied.has(taskKey)) return;
    tasks.push({ ...task, taskKey });
  };

  // 1. Cheap, one-off metadata that everything else references.
  push({ resourceType: "countries", priority: scoreTask("countries", 1, null) });
  push({ resourceType: "competitions", priority: scoreTask("competitions", 1, null) });

  // Season work is only planned once the competition catalogue is known.
  // Queueing it earlier would spend quota on competitions this provider or
  // plan does not actually cover; the harvester re-plans as soon as the
  // catalogue lands.
  if (!options.knownCompetitionIds || options.knownCompetitionIds.size === 0) {
    return tasks.sort((a, b) => a.priority - b.priority);
  }

  const targets = [
    ...COMPETITION_TARGETS,
    ...(options.includeHistorical ? HISTORICAL_TARGETS : []),
  ];

  for (const target of targets) {
    if (!options.knownCompetitionIds.has(target.externalId)) continue;

    for (const season of target.seasons) {
      // A season the plan cannot reach is not queued at all: the request would
      // be spent and answered with a refusal.
      if (!isSeasonAccessible(season)) continue;
      // Teams first: squads, standings and fixtures all reference them.
      push({
        resourceType: "teams",
        competitionExternalId: target.externalId,
        season,
        priority: scoreTask("teams", target.priority, season),
      });

      // Standings give a champion + runner-up per season in one request.
      if (target.type === "LEAGUE") {
        push({
          resourceType: "standings",
          competitionExternalId: target.externalId,
          season,
          priority: scoreTask("standings", target.priority, season),
        });
      }

      // Top scorers: one request, ~20 players plus their club links.
      push({
        resourceType: "topscorers",
        competitionExternalId: target.externalId,
        season,
        priority: scoreTask("topscorers", target.priority, season),
      });
    }
  }

  return tasks.sort((a, b) => a.priority - b.priority);
}

/** Per-club requests, in the order they are spent on any one club. */
const TEAM_RESOURCES = ["transfers", "squad", "coaches"] as const;

/**
 * Club work is scored on its own scale rather than through RESOURCE_BASE_PRIORITY.
 *
 * The tiers there are 100 points apart, which is wider than the gap between one
 * club and the next — so borrowing them would sort every club's transfers ahead
 * of any club's squad and lose the depth-first grouping this function exists to
 * produce. These constants keep a club's three requests adjacent, and place the
 * whole block just after the current season's league tables.
 */
/**
 * Placed just above one season's worth of league tables (base 100 + a single
 * SEASON_DEPTH_STRIDE step), so the most recent accessible season is swept
 * across every priority league before any club is opened up.
 *
 * That ordering is what gives the club pool its spread. Diving into the first
 * league whose table happens to land would fill the budget with twenty clubs
 * from one country, and "which two of these were team-mates" is a far better
 * question when the candidates span England, Spain, Italy and Germany.
 */
const TEAM_BLOCK_START = 420;
const TEAM_STRIDE = 15;
const TEAM_RESOURCE_STRIDE = 5;

/**
 * Follow-up work unlocked by data already imported: transfer histories, squads
 * and coaches for known clubs. Generated after clubs exist, because each is a
 * per-club request and would otherwise have nothing to point at.
 *
 * These are scored club-by-club rather than resource-by-resource, so the budget
 * finishes a handful of clubs completely instead of starting hundreds. That is
 * deliberate, and it is what the question generators reward:
 *
 *   * "which two players were team-mates at X" and "which of these never played
 *     for X" need *many* known players at one club. Half a squad each for
 *     fifty clubs answers neither.
 *   * a squad pass fills in nationality, position and date of birth for the
 *     players the same club's transfer list created as name-only stubs, so the
 *     pair together support Who Am I where either alone does not.
 *
 * Within a club, transfers go first: it is the one request whose value does not
 * depend on any other having been spent.
 */
export function planTeamFollowUps(
  teams: { externalId: string; competitionPriority: number }[],
  satisfied: Set<string>,
  limit: number
): SyncTask[] {
  const tasks: SyncTask[] = [];
  for (const [index, team] of teams.entries()) {
    for (const [offset, resourceType] of TEAM_RESOURCES.entries()) {
      const partial = { resourceType, teamExternalId: team.externalId, page: 1 };
      const taskKey = buildTaskKey(partial);
      if (satisfied.has(taskKey)) continue;
      tasks.push({
        ...partial,
        taskKey,
        // Club rank dominates; the offset only orders the three requests within
        // one club, and stays inside one club's stride.
        priority: TEAM_BLOCK_START + index * TEAM_STRIDE + offset * TEAM_RESOURCE_STRIDE,
      });
      if (tasks.length >= limit) return tasks.sort((a, b) => a.priority - b.priority);
    }
  }
  return tasks.sort((a, b) => a.priority - b.priority);
}
