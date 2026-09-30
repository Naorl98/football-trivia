// Durable sync queue.
//
// Every unit of import work is a row. A harvest that stops on quota leaves the
// rest PENDING, so tomorrow's run resumes exactly where today's ended with no
// manual bookkeeping. Task keys are deterministic, so re-planning the same work
// never enqueues it twice.

import type { D1Client } from "./d1Client.ts";
import { sqlValue } from "./d1Client.ts";

export type ResourceType =
  | "countries"
  | "competitions"
  | "teams"
  | "squad"
  | "players"
  | "transfers"
  | "trophies"
  | "coaches"
  | "fixtures"
  | "standings"
  | "topscorers";

export type TaskStatus = "PENDING" | "RUNNING" | "COMPLETE" | "FAILED" | "DEFERRED";

export interface SyncTask {
  id?: number;
  taskKey: string;
  resourceType: ResourceType;
  competitionExternalId?: string | null;
  season?: number | null;
  teamExternalId?: string | null;
  playerExternalId?: string | null;
  page?: number;
  /** Lower runs first. Derived from question-yield value in planner.ts. */
  priority: number;
  status?: TaskStatus;
  attemptCount?: number;
}

const MAX_ATTEMPTS = 3;

export function buildTaskKey(task: Omit<SyncTask, "taskKey" | "priority">): string {
  return [
    task.resourceType,
    task.competitionExternalId ?? "-",
    task.season ?? "-",
    task.teamExternalId ?? "-",
    task.playerExternalId ?? "-",
    task.page ?? 1,
  ].join(":");
}

export class SyncQueue {
  private readonly db: D1Client;

  constructor(db: D1Client) {
    this.db = db;
  }

  /** Adds tasks that are not already queued or complete. Idempotent. */
  async enqueue(tasks: SyncTask[]): Promise<number> {
    if (tasks.length === 0) return 0;
    const statements = tasks.map(
      (task) =>
        `INSERT OR IGNORE INTO data_sync_queue
          (task_key, resource_type, competition_external_id, season, team_external_id, player_external_id, page, priority, status)
         VALUES (${sqlValue(task.taskKey)}, ${sqlValue(task.resourceType)}, ${sqlValue(
          task.competitionExternalId ?? null
        )}, ${sqlValue(task.season ?? null)}, ${sqlValue(task.teamExternalId ?? null)}, ${sqlValue(
          task.playerExternalId ?? null
        )}, ${sqlValue(task.page ?? 1)}, ${sqlValue(task.priority)}, 'PENDING');`
    );
    await this.db.execute(statements);
    return tasks.length;
  }

  /**
   * Next runnable tasks, best value first.
   *
   * Only PENDING is runnable. DEFERRED means parked — work the subscription
   * cannot currently perform, such as a season outside the plan's window — and
   * re-claiming it would spend a request on a refusal every single run. A quota
   * stop does not use DEFERRED: `defer()` puts that task straight back to
   * PENDING, because it will succeed tomorrow untouched.
   */
  async claimBatch(limit: number): Promise<SyncTask[]> {
    const rows = await this.db.query<Record<string, unknown>>(
      `SELECT id, task_key, resource_type, competition_external_id, season, team_external_id,
              player_external_id, page, priority, status, attempt_count
         FROM data_sync_queue
        WHERE status = 'PENDING' AND attempt_count < ${MAX_ATTEMPTS}
        ORDER BY priority ASC, id ASC
        LIMIT ${Math.max(1, Math.floor(limit))}`
    );

    return rows.map((row) => ({
      id: Number(row.id),
      taskKey: String(row.task_key),
      resourceType: String(row.resource_type) as ResourceType,
      competitionExternalId: (row.competition_external_id as string) ?? null,
      season: row.season === null ? null : Number(row.season),
      teamExternalId: (row.team_external_id as string) ?? null,
      playerExternalId: (row.player_external_id as string) ?? null,
      page: Number(row.page ?? 1),
      priority: Number(row.priority ?? 100),
      status: String(row.status) as TaskStatus,
      attemptCount: Number(row.attempt_count ?? 0),
    }));
  }

  async markComplete(taskKey: string): Promise<void> {
    await this.db.execute([
      `UPDATE data_sync_queue
          SET status = 'COMPLETE', completed_at = datetime('now'), error = NULL
        WHERE task_key = ${sqlValue(taskKey)};`,
    ]);
  }

  /**
   * Records a failure. Transient problems go back to PENDING for another
   * attempt; permanent ones are marked FAILED immediately so the harvester
   * never burns quota retrying something that cannot succeed.
   */
  async markFailed(taskKey: string, error: string, permanent: boolean): Promise<void> {
    await this.db.execute([
      `UPDATE data_sync_queue
          SET status = ${permanent ? "'FAILED'" : "'PENDING'"},
              attempt_count = attempt_count + 1,
              last_attempt_at = datetime('now'),
              error = ${sqlValue(error.slice(0, 500))}
        WHERE task_key = ${sqlValue(taskKey)};`,
    ]);
  }

  /**
   * Parks work this subscription cannot perform, without spending a request.
   * It stays visible and costed in reports, and becomes runnable again — via
   * `unpark` — if the plan's coverage widens.
   */
  async park(taskKeys: string[], reason: string): Promise<number> {
    if (taskKeys.length === 0) return 0;
    const list = taskKeys.map((k) => sqlValue(k)).join(", ");
    await this.db.execute([
      `UPDATE data_sync_queue
          SET status = 'DEFERRED', error = ${sqlValue(reason.slice(0, 500))}
        WHERE task_key IN (${list}) AND status = 'PENDING';`,
    ]);
    return taskKeys.length;
  }

  /** Returns parked tasks to the runnable pool, e.g. after a plan upgrade. */
  async unpark(): Promise<void> {
    await this.db.execute([
      `UPDATE data_sync_queue SET status = 'PENDING', error = NULL WHERE status = 'DEFERRED';`,
    ]);
  }

  async deferredCount(): Promise<number> {
    const rows = await this.db.query<{ n: number }>(
      `SELECT COUNT(*) AS n FROM data_sync_queue WHERE status = 'DEFERRED'`
    );
    return Number(rows[0]?.n ?? 0);
  }

  /** Leaves a task for the next run without counting an attempt (quota stop). */
  async defer(taskKey: string, reason: string): Promise<void> {
    await this.db.execute([
      `UPDATE data_sync_queue
          SET status = 'PENDING', error = ${sqlValue(reason.slice(0, 500))}
        WHERE task_key = ${sqlValue(taskKey)};`,
    ]);
  }

  async counts(): Promise<Record<string, number>> {
    const rows = await this.db.query<{ status: string; n: number }>(
      `SELECT status, COUNT(*) AS n FROM data_sync_queue GROUP BY status`
    );
    return Object.fromEntries(rows.map((r) => [r.status, Number(r.n)]));
  }

  async pendingCount(): Promise<number> {
    const rows = await this.db.query<{ n: number }>(
      `SELECT COUNT(*) AS n FROM data_sync_queue WHERE status = 'PENDING' AND attempt_count < ${MAX_ATTEMPTS}`
    );
    return Number(rows[0]?.n ?? 0);
  }
}

/** Sync-state helpers: what is already imported and must not be re-fetched. */
export class SyncState {
  private readonly db: D1Client;
  private readonly provider: string;

  constructor(db: D1Client, provider: string) {
    this.db = db;
    this.provider = provider;
  }

  async isSatisfied(resourceKey: string): Promise<boolean> {
    const rows = await this.db.query<{ status: string }>(
      `SELECT status FROM data_sync_state
        WHERE provider = ${sqlValue(this.provider)} AND resource_key = ${sqlValue(resourceKey)}`
    );
    const status = rows[0]?.status;
    return status === "COMPLETE" || status === "ARCHIVED";
  }

  async loadAllSatisfied(): Promise<Set<string>> {
    const rows = await this.db.query<{ resource_key: string }>(
      `SELECT resource_key FROM data_sync_state
        WHERE provider = ${sqlValue(this.provider)} AND status IN ('COMPLETE','ARCHIVED')`
    );
    return new Set(rows.map((r) => String(r.resource_key)));
  }

  /**
   * Marks a resource imported. Completed historical seasons are ARCHIVED —
   * immutable, never re-fetched — while the current season stays COMPLETE so
   * it can be refreshed later.
   */
  markStatement(resourceKey: string, resourceType: string, recordCount: number, archived: boolean): string {
    return `INSERT INTO data_sync_state (provider, resource_key, resource_type, status, last_synced_at, record_count)
            VALUES (${sqlValue(this.provider)}, ${sqlValue(resourceKey)}, ${sqlValue(resourceType)},
                    ${archived ? "'ARCHIVED'" : "'COMPLETE'"}, datetime('now'), ${sqlValue(recordCount)})
            ON CONFLICT(resource_key) DO UPDATE SET
              status = excluded.status,
              last_synced_at = excluded.last_synced_at,
              record_count = excluded.record_count;`;
  }
}
