// Daily API request budget.
//
// The free API-Football plan allows ~100 requests/day. The harvester operates
// at 95 by default, keeping ~5 in reserve for retries and metadata checks, and
// stops cleanly rather than running the quota to zero. Spend is counted from
// api_request_log, so a crash mid-run cannot "forget" requests already made.

import type { D1Client } from "./d1Client.ts";
import { sqlValue } from "./d1Client.ts";

export const DEFAULT_DAILY_LIMIT = 100;
export const DEFAULT_OPERATIONAL_LIMIT = 95;

/**
 * API-Football's quota day resets at midnight UTC, so the budget day key is
 * UTC rather than local time.
 */
export function quotaDayKey(date: Date = new Date()): string {
  return date.toISOString().slice(0, 10);
}

export interface BudgetSnapshot {
  dayKey: string;
  used: number;
  operationalLimit: number;
  remaining: number;
  /** What the provider itself last reported, when known. */
  providerRemaining: number | null;
  providerLimit: number | null;
}

export class RequestBudget {
  private used = 0;
  private providerRemaining: number | null = null;
  private providerLimit: number | null = null;

  private readonly db: D1Client;
  private readonly provider: string;
  private readonly operationalLimit: number;
  private readonly dayKey: string;

  constructor(
    db: D1Client,
    provider: string,
    operationalLimit: number = DEFAULT_OPERATIONAL_LIMIT,
    dayKey: string = quotaDayKey()
  ) {
    this.db = db;
    this.provider = provider;
    this.operationalLimit = operationalLimit;
    this.dayKey = dayKey;
  }

  /** Loads how much of today's allowance was already spent by earlier runs. */
  async load(): Promise<void> {
    const rows = await this.db.query<{ used: number }>(
      `SELECT COUNT(*) AS used FROM api_request_log
       WHERE provider = ${sqlValue(this.provider)} AND day_key = ${sqlValue(this.dayKey)}`
    );
    this.used = Number(rows[0]?.used ?? 0);
  }

  snapshot(): BudgetSnapshot {
    return {
      dayKey: this.dayKey,
      used: this.used,
      operationalLimit: this.operationalLimit,
      remaining: Math.max(0, this.operationalLimit - this.used),
      providerRemaining: this.providerRemaining,
      providerLimit: this.providerLimit,
    };
  }

  /** True when at least `cost` requests can still be spent today. */
  canSpend(cost = 1): boolean {
    if (this.providerRemaining !== null && this.providerRemaining < cost) return false;
    return this.used + cost <= this.operationalLimit;
  }

  /** Records a request that was actually issued. */
  async record(entry: {
    endpoint: string;
    params: Record<string, string>;
    statusCode: number;
    results: number;
    rateLimitRemaining: number | null;
    rateLimitLimit: number | null;
  }): Promise<void> {
    this.used++;
    if (entry.rateLimitRemaining !== null) this.providerRemaining = entry.rateLimitRemaining;
    if (entry.rateLimitLimit !== null) this.providerLimit = entry.rateLimitLimit;

    await this.db.execute([
      `INSERT INTO api_request_log (provider, endpoint, params, day_key, status_code, results, rate_limit_remaining)
       VALUES (${sqlValue(this.provider)}, ${sqlValue(entry.endpoint)}, ${sqlValue(
        JSON.stringify(entry.params)
      )}, ${sqlValue(this.dayKey)}, ${sqlValue(entry.statusCode)}, ${sqlValue(entry.results)}, ${sqlValue(
        entry.rateLimitRemaining
      )});`,
    ]);
  }
}
