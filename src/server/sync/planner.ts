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

const RECENT_LEAGUE_SEASONS = [2024, 2023, 2022, 2021, 2020];
const DEEPER_LEAGUE_SEASONS = [2019, 2018, 2017, 2016, 2015, 2014, 2013, 2012, 2011, 2010];

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
 */
const RESOURCE_BASE_PRIORITY: Record<ResourceType, number> = {
  countries: 5,
  competitions: 10,
  teams: 20,
  squad: 30,
  transfers: 35,
  standings: 40,
  trophies: 50,
  topscorers: 60,
  players: 70,
  coaches: 80,
  fixtures: 95,
};

export function scoreTask(
  resourceType: ResourceType,
  competitionPriority: 1 | 2 | 3,
  season: number | null
): number {
  const base = RESOURCE_BASE_PRIORITY[resourceType];
  // Newer seasons first: they are cheaper to reason about and more recognisable.
  const recency = season ? Math.max(0, 2026 - season) : 0;
  return base * 10 + competitionPriority * 15 + recency;
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

/**
 * Follow-up work unlocked by data already imported: squads and transfer
 * histories for known teams. Generated after teams exist, because both are
 * per-team requests and would otherwise have nothing to point at.
 */
export function planTeamFollowUps(
  teams: { externalId: string; competitionPriority: 1 | 2 | 3 }[],
  satisfied: Set<string>,
  limit: number
): SyncTask[] {
  const tasks: SyncTask[] = [];
  for (const team of teams) {
    for (const resourceType of ["squad", "transfers"] as const) {
      const partial = { resourceType, teamExternalId: team.externalId, page: 1 };
      const taskKey = buildTaskKey(partial);
      if (satisfied.has(taskKey)) continue;
      tasks.push({
        ...partial,
        taskKey,
        priority: scoreTask(resourceType, team.competitionPriority, null),
      });
      if (tasks.length >= limit) return tasks.sort((a, b) => a.priority - b.priority);
    }
  }
  return tasks.sort((a, b) => a.priority - b.priority);
}
