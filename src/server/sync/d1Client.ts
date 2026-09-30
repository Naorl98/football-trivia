// D1 access for admin/ingestion scripts.
//
// Sync runs from trusted local scripts, never from the Worker, so the
// API-Football key never reaches the edge or the browser. Writes go through
// the Wrangler CLI, which reuses the developer's existing Cloudflare OAuth
// session — there is no second credential to manage.

import { execFile } from "node:child_process";
import { mkdtempSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";
import { fileURLToPath } from "node:url";

const execFileAsync = promisify(execFile);

const WRANGLER_ENTRY = fileURLToPath(new URL("../../../node_modules/wrangler/bin/wrangler.js", import.meta.url));

export type D1Target = "local" | "remote";

export interface D1ClientOptions {
  databaseName?: string;
  target: D1Target;
  accountId?: string;
  cwd?: string;
}

/** Escapes a value for inline SQL. Only used for script-side ingestion. */
export function sqlValue(value: string | number | boolean | null | undefined): string {
  if (value === null || value === undefined) return "NULL";
  if (typeof value === "number") return Number.isFinite(value) ? String(value) : "NULL";
  if (typeof value === "boolean") return value ? "1" : "0";
  return `'${String(value).replace(/'/g, "''")}'`;
}

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

/**
 * Failures worth retrying rather than surfacing.
 *
 * `Authentication error [code: 10000]` is the one that matters in practice: the
 * Cloudflare API returns it intermittently on an otherwise valid OAuth session,
 * and against a remote database every write goes through the D1 import endpoint,
 * so a single blip can take out a batch. That batch is an API-Football response
 * already paid for out of a 100-request day, and the harvester's contract is that
 * a fetched response is persisted before the next request goes out — so giving up
 * on the first transient error breaks the guarantee the whole design rests on.
 *
 * Retrying is safe: every statement the importers generate is an idempotent
 * upsert, and Wrangler rolls a failed import back to the database's prior state.
 */
function isTransientD1Failure(error: unknown): boolean {
  const text = String((error as { stdout?: string })?.stdout ?? "") + String(error);
  return (
    /code:\s*10000|Authentication error|internal error|Internal Server Error|\b5\d\d\b|ECONNRESET|ETIMEDOUT|EAI_AGAIN|socket hang up|fetch failed|Network connection lost/i.test(
      text
    ) && !/no such table|syntax error|NOT NULL constraint|UNIQUE constraint|no such column/i.test(text)
  );
}

export class D1Client {
  private readonly databaseName: string;
  private readonly target: D1Target;
  private readonly env: NodeJS.ProcessEnv;
  private readonly cwd: string;
  private readonly maxAttempts = 4;

  /** Runs a Wrangler invocation, retrying transient Cloudflare API failures. */
  private async withRetry<T>(label: string, run: () => Promise<T>): Promise<T> {
    for (let attempt = 1; ; attempt++) {
      try {
        return await run();
      } catch (error) {
        if (attempt >= this.maxAttempts || !isTransientD1Failure(error)) throw error;
        // 1.5s, 3s, 6s — long enough for a token refresh or a blip to clear.
        await sleep(1500 * Math.pow(2, attempt - 1));
      }
    }
  }

  constructor(options: D1ClientOptions) {
    this.databaseName = options.databaseName ?? "football-iq-db";
    this.target = options.target;
    this.cwd = options.cwd ?? process.cwd();
    this.env = {
      ...process.env,
      ...(options.accountId ? { CLOUDFLARE_ACCOUNT_ID: options.accountId } : {}),
    };
  }

  /**
   * All SQL goes through a temp file rather than an inline --command. Multi-line
   * statements do not survive Windows shell argument parsing, and a file also
   * keeps generated SQL out of the process argument list entirely.
   */
  private async runFile(sql: string): Promise<string> {
    const dir = mkdtempSync(join(tmpdir(), "fiq-d1-"));
    const file = join(dir, "statements.sql");
    try {
      writeFileSync(file, sql, "utf8");
      // Invoke Wrangler's JS entry directly with the current Node binary: no
      // shell, so generated SQL can never be interpreted by a command line.
      return await this.withRetry("execute", async () => {
        const { stdout } = await execFileAsync(
          process.execPath,
          [
            WRANGLER_ENTRY,
            "d1",
            "execute",
            this.databaseName,
            `--${this.target}`,
            "--json",
            `--file=${file}`,
          ],
          { env: this.env, cwd: this.cwd, maxBuffer: 128 * 1024 * 1024 }
        );
        // Wrangler does not always exit non-zero for a failed import, and a write
        // that reports an error while claiming success would lose a harvested
        // response silently. Surface it so withRetry can act on it.
        if (/"error"\s*:/.test(stdout)) {
          const failure = new Error(`D1 execute reported an error: ${stdout.slice(0, 800)}`);
          (failure as Error & { stdout?: string }).stdout = stdout;
          throw failure;
        }
        return stdout;
      });
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  }

  /**
   * Runs a read query and returns typed rows.
   *
   * MUST use `--command`, not `--file`. Against a REMOTE database wrangler's
   * `--json` output for file input is an execution SUMMARY — `{"Total queries
   * executed": 1, "Rows read": 1659, ...}` — and not the rows at all. Parsing
   * that yields exactly one meaningless object, which reads as a successful
   * query returning one row.
   *
   * That is not a cosmetic difference. `seed-apply` builds its "what is already
   * in production" map from this call, so a one-row answer meant every question
   * in the seed looked new, every incremental apply planned a full re-insert,
   * and the write budget then refused it — which is why production sat at its
   * original 1,659 questions through several seed expansions. The failure was
   * silent in both directions: no error here, and a plausible-looking plan there.
   */
  async query<T = Record<string, unknown>>(sql: string): Promise<T[]> {
    const trimmed = sql.trim();
    const stdout = await this.runCommand(trimmed.endsWith(";") ? trimmed : `${trimmed};`);
    return parseResults<T>(stdout);
  }

  /** Single-statement execution. Returns real rows on both local and remote. */
  private async runCommand(sql: string): Promise<string> {
    return this.withRetry("query", async () => {
      const { stdout } = await execFileAsync(
        process.execPath,
        [
          WRANGLER_ENTRY,
          "d1",
          "execute",
          this.databaseName,
          `--${this.target}`,
          "--json",
          "--command",
          sql,
        ],
        { env: this.env, cwd: this.cwd, maxBuffer: 128 * 1024 * 1024 }
      );
      return stdout;
    });
  }

  /**
   * Executes a batch of statements in one CLI invocation.
   * Every harvested API response is flushed through here before the next
   * request goes out, so a crash never loses already-fetched data.
   */
  async execute(statements: string[]): Promise<void> {
    if (statements.length === 0) return;
    await this.runFile(statements.join("\n"));
  }

  async scalar<T = number>(sql: string, column: string): Promise<T | null> {
    const rows = await this.query<Record<string, T>>(sql);
    return rows.length > 0 ? rows[0][column] ?? null : null;
  }
}

/** Wrangler prints an array of result envelopes; pull the rows out of them. */
export function parseResults<T>(stdout: string): T[] {
  const start = stdout.indexOf("[");
  if (start === -1) return [];
  let parsed: unknown;
  try {
    parsed = JSON.parse(stdout.slice(start));
  } catch {
    return [];
  }
  if (!Array.isArray(parsed)) return [];
  const rows: T[] = [];
  for (const envelope of parsed) {
    const results = (envelope as { results?: T[] })?.results;
    if (Array.isArray(results)) rows.push(...results);
  }
  return rows;
}
