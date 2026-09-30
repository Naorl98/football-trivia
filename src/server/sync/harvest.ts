// Harvest orchestrator.
//
// Guarantees:
//   * every successful API response is written to D1 before the next request
//     goes out, so a crash never loses fetched data
//   * work is claimed from a durable queue, so tomorrow's run resumes exactly
//     where today's stopped
//   * the run stops cleanly the moment the daily budget or the provider quota
//     is exhausted, leaving the remaining work PENDING
//   * a resource already COMPLETE/ARCHIVED is skipped without spending a request
//   * pagination enqueues follow-up pages rather than looping past the budget

import { ProviderPermanentError, ProviderQuotaError, type FootballDataProvider } from "../providers/football/types.ts";
import type { D1Client } from "./d1Client.ts";
import { sqlValue } from "./d1Client.ts";
import { RequestBudget } from "./budget.ts";
import { SyncQueue, SyncState, buildTaskKey, type SyncTask } from "./queue.ts";
import {
  upsertCoaches,
  upsertCompetitions,
  upsertCountries,
  upsertFixtures,
  upsertSquad,
  upsertStandings,
  upsertTeams,
  upsertTopScorers,
  upsertTransfers,
  upsertTrophies,
} from "./importers.ts";
import { COMPETITION_TARGETS, planTasks, planTeamFollowUps } from "./planner.ts";

export interface HarvestOptions {
  provider: FootballDataProvider;
  db: D1Client;
  budget: RequestBudget;
  /** Hard ceiling for this run, on top of the daily budget. */
  maxRequests?: number;
  includeHistorical?: boolean;
  log?: (message: string) => void;
}

export interface HarvestReport {
  requestsUsed: number;
  requestsRemaining: number;
  tasksCompleted: number;
  tasksFailed: number;
  tasksPending: number;
  stoppedReason: "budget" | "quota" | "queue-empty" | "max-requests";
  recordsByResource: Record<string, number>;
}

const CURRENT_SEASON = 2025;

const targetByExternalId = new Map(COMPETITION_TARGETS.map((t) => [t.externalId, t]));

function localCodeFor(externalId: string): string | null {
  return targetByExternalId.get(externalId)?.localCode ?? null;
}

function priorityFor(externalId: string): number {
  return targetByExternalId.get(externalId)?.priority ?? 3;
}

/** Completed historical seasons are immutable and must never be re-fetched. */
function isArchivable(season: number | null | undefined): boolean {
  return typeof season === "number" && season < CURRENT_SEASON;
}

export async function runHarvest(options: HarvestOptions): Promise<HarvestReport> {
  const { provider, db, budget } = options;
  const log = options.log ?? (() => {});
  const queue = new SyncQueue(db);
  const state = new SyncState(db, provider.name);

  const report: HarvestReport = {
    requestsUsed: 0,
    requestsRemaining: 0,
    tasksCompleted: 0,
    tasksFailed: 0,
    tasksPending: 0,
    stoppedReason: "queue-empty",
    recordsByResource: {},
  };

  const runStartedAt = new Date().toISOString();
  await db.execute([
    `INSERT INTO data_sync_runs (provider, started_at, status) VALUES (${sqlValue(provider.name)}, ${sqlValue(
      runStartedAt
    )}, 'RUNNING');`,
  ]);

  const satisfied = await state.loadAllSatisfied();

  /**
   * Plans work against what the database currently knows.
   *
   * Season-level work is only queued for competitions already present in the
   * catalogue, so quota is never spent on competitions this provider/plan does
   * not actually cover. That means planning has to run again after the
   * competitions catalogue lands, and again once teams exist to hang squad and
   * transfer requests off — hence replan() rather than a single upfront pass.
   */
  const replan = async (): Promise<number> => {
    const knownCompetitionIds = new Set(
      (
        await db.query<{ external_id: string }>(
          `SELECT external_id FROM competitions WHERE provider = ${sqlValue(provider.name)}`
        )
      ).map((r) => String(r.external_id))
    );

    let added = 0;
    const planned = planTasks({
      satisfied,
      knownCompetitionIds,
      includeHistorical: options.includeHistorical,
    });
    if (planned.length > 0) {
      await queue.enqueue(planned);
      added += planned.length;
    }

    // Team-level follow-ups (squads, transfers) once teams exist.
    const knownTeams = await db.query<{ external_id: string; priority: number }>(
      `SELECT t.external_id AS external_id, COALESCE(MIN(c.priority), 3) AS priority
         FROM teams t
         LEFT JOIN team_seasons ts ON ts.team_id = t.id
         LEFT JOIN competitions c ON c.id = ts.competition_id
        WHERE t.provider = ${sqlValue(provider.name)}
        GROUP BY t.external_id
        LIMIT 400`
    );
    if (knownTeams.length > 0) {
      const followUps = planTeamFollowUps(
        knownTeams.map((t) => ({
          externalId: String(t.external_id),
          competitionPriority: (Number(t.priority) || 3) as 1 | 2 | 3,
        })),
        satisfied,
        300
      );
      if (followUps.length > 0) {
        await queue.enqueue(followUps);
        added += followUps.length;
      }
    }
    return added;
  };

  const initiallyPlanned = await replan();
  if (initiallyPlanned > 0) log(`planned ${initiallyPlanned} task(s)`);

  const maxRequests = options.maxRequests ?? Number.POSITIVE_INFINITY;
  let requestsThisRun = 0;

  // ---- Work the queue.
  while (true) {
    if (requestsThisRun >= maxRequests) {
      report.stoppedReason = "max-requests";
      break;
    }
    if (!budget.canSpend(1)) {
      report.stoppedReason = "budget";
      break;
    }

    const batch = await queue.claimBatch(1);
    if (batch.length === 0) {
      report.stoppedReason = "queue-empty";
      break;
    }
    const task = batch[0];

    // Skip without spending a request if this resource is already imported.
    if (satisfied.has(task.taskKey)) {
      await queue.markComplete(task.taskKey);
      continue;
    }

    try {
      const outcome = await executeTask(provider, task);
      requestsThisRun++;

      // Persist immediately — before any further request is made.
      const statements = [...outcome.statements];
      statements.push(
        state.markStatement(task.taskKey, task.resourceType, outcome.recordCount, isArchivable(task.season))
      );
      await db.execute(statements);
      await queue.markComplete(task.taskKey);
      satisfied.add(task.taskKey);

      report.tasksCompleted++;
      report.recordsByResource[task.resourceType] =
        (report.recordsByResource[task.resourceType] ?? 0) + outcome.recordCount;
      log(
        `✓ ${task.taskKey} → ${outcome.recordCount} record(s)` +
          (outcome.nextPage ? ` (queued page ${outcome.nextPage})` : "")
      );

      // Importing the catalogue or a team list unlocks work that could not be
      // planned before, so re-plan immediately rather than waiting a whole run.
      if (task.resourceType === "competitions" || task.resourceType === "teams") {
        const added = await replan();
        if (added > 0) log(`re-planned: +${added} task(s) now unlocked`);
      }

      // Pagination: queue the next page instead of looping past the budget.
      if (outcome.nextPage) {
        const nextTask: SyncTask = {
          ...task,
          page: outcome.nextPage,
          taskKey: buildTaskKey({ ...task, page: outcome.nextPage }),
          priority: task.priority,
        };
        await queue.enqueue([nextTask]);
      }
    } catch (error) {
      if (error instanceof ProviderQuotaError) {
        await queue.defer(task.taskKey, error.message);
        report.stoppedReason = "quota";
        log(`quota reached: ${error.message}`);
        break;
      }
      const permanent = error instanceof ProviderPermanentError;
      await queue.markFailed(task.taskKey, String(error), permanent);
      report.tasksFailed++;
      requestsThisRun++;
      log(`✗ ${task.taskKey}: ${String(error)}`);
      if (permanent) continue;
    }
  }

  const snapshot = budget.snapshot();
  report.requestsUsed = requestsThisRun;
  report.requestsRemaining = snapshot.remaining;
  report.tasksPending = await queue.pendingCount();

  await db.execute([
    `UPDATE data_sync_runs
        SET finished_at = datetime('now'), requests_used = ${sqlValue(requestsThisRun)},
            requests_limit = ${sqlValue(snapshot.providerLimit)},
            requests_remaining = ${sqlValue(snapshot.providerRemaining ?? snapshot.remaining)},
            tasks_completed = ${sqlValue(report.tasksCompleted)},
            tasks_failed = ${sqlValue(report.tasksFailed)},
            entities_json = ${sqlValue(JSON.stringify(report.recordsByResource))},
            status = 'COMPLETE', notes = ${sqlValue(report.stoppedReason)}
      WHERE started_at = ${sqlValue(runStartedAt)} AND provider = ${sqlValue(provider.name)};`,
  ]);

  return report;
}

interface TaskOutcome {
  statements: string[];
  recordCount: number;
  nextPage: number | null;
}

/** Runs exactly one provider request and turns the response into SQL. */
export async function executeTask(provider: FootballDataProvider, task: SyncTask): Promise<TaskOutcome> {
  const none: TaskOutcome = { statements: [], recordCount: 0, nextPage: null };

  switch (task.resourceType) {
    case "countries": {
      const page = await provider.getCountries();
      return { statements: upsertCountries(page.items), recordCount: page.items.length, nextPage: null };
    }

    case "competitions": {
      const page = await provider.getCompetitions();
      const statements = upsertCompetitions(
        page.items,
        (c) => localCodeFor(c.externalId),
        (c) => priorityFor(c.externalId)
      );
      return { statements, recordCount: page.items.length, nextPage: null };
    }

    case "teams": {
      const page = await provider.getTeams({
        competitionExternalId: task.competitionExternalId ?? undefined,
        season: task.season ?? undefined,
      });
      const statements = upsertTeams(page.items, {
        competitionExternalId: task.competitionExternalId,
        season: task.season,
      });
      return { statements, recordCount: page.items.length, nextPage: null };
    }

    case "squad": {
      const page = await provider.getSquad({ teamExternalId: task.teamExternalId ?? undefined });
      return { statements: upsertSquad(page.items), recordCount: page.items.length, nextPage: null };
    }

    case "transfers": {
      const page = await provider.getTransfers({ teamExternalId: task.teamExternalId ?? undefined });
      return {
        statements: upsertTransfers(provider.name, page.items),
        recordCount: page.items.length,
        nextPage: null,
      };
    }

    case "trophies": {
      const page = await provider.getTrophies({ playerExternalId: task.playerExternalId ?? undefined });
      return {
        statements: upsertTrophies(provider.name, page.items),
        recordCount: page.items.length,
        nextPage: null,
      };
    }

    case "coaches": {
      const page = await provider.getCoaches({ teamExternalId: task.teamExternalId ?? undefined });
      return { statements: upsertCoaches(page.items), recordCount: page.items.length, nextPage: null };
    }

    case "standings": {
      if (!task.competitionExternalId || task.season == null) return none;
      const page = await provider.getStandings({
        competitionExternalId: task.competitionExternalId,
        season: task.season,
      });
      return {
        statements: upsertStandings(provider.name, task.competitionExternalId, task.season, page.items),
        recordCount: page.items.length,
        nextPage: null,
      };
    }

    case "topscorers": {
      if (!task.competitionExternalId || task.season == null) return none;
      const page = await provider.getTopScorers({
        competitionExternalId: task.competitionExternalId,
        season: task.season,
      });
      return {
        statements: upsertTopScorers(provider.name, task.competitionExternalId, task.season, page.items),
        recordCount: page.items.length,
        nextPage: null,
      };
    }

    case "players": {
      const page = await provider.getPlayers({
        competitionExternalId: task.competitionExternalId ?? undefined,
        season: task.season ?? undefined,
        teamExternalId: task.teamExternalId ?? undefined,
        page: task.page ?? 1,
      });
      const nextPage = page.page < page.totalPages ? page.page + 1 : null;
      return {
        statements: upsertSquad(
          page.items.map((player) => ({
            player,
            teamExternalId: task.teamExternalId ?? "",
            season: task.season ?? null,
          }))
        ).filter((s) => !s.includes("player_teams") || task.teamExternalId),
        recordCount: page.items.length,
        nextPage,
      };
    }

    case "fixtures": {
      if (!task.competitionExternalId || task.season == null) return none;
      const page = await provider.getFixtures({
        competitionExternalId: task.competitionExternalId,
        season: task.season,
      });
      return { statements: upsertFixtures(page.items), recordCount: page.items.length, nextPage: null };
    }

    default:
      return none;
  }
}
