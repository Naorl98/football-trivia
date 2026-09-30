// D1 write accounting and the hard budget guard.
//
// WHY THIS EXISTS
//
// A single `db:seed:remote` spent the entire Cloudflare free-tier daily write
// allowance (100,000 rows) in one command. The seed was a full
// DELETE-everything + INSERT-everything of 21,781 rows; deleting and
// re-inserting each row also rewrites every index entry for it, so the real
// cost was ~105,550 rows written.
//
// The lesson is not "seed less often" — it is that no script should be able to
// spend the day's budget without saying so first. Everything that writes to D1
// now estimates its cost, prints it, and refuses to exceed the budget unless
// explicitly told to chunk.
//
// ACCOUNTING MODEL
//
// D1 bills "rows written", and an index entry counts as a row. Writing one row
// to a table with N indexes therefore costs roughly 1 + N. These per-table
// costs come straight from the CREATE INDEX statements in migrations/.

/** Rows written per row touched, by table: 1 for the row + 1 per index on it. */
export const WRITE_COST_PER_ROW: Record<string, number> = {
  // ---- Question bank (migrations 0001, 0002) ----
  questions: 8, // mode, category, difficulty, active, free_text, semantic_key + row
  question_options: 2, // question_id
  question_clues: 2, // question_id
  question_scopes: 3, // question_id, (scope_type, scope_value)
  answer_aliases: 3, // question_id, normalized
  question_hints: 2, // question_id
  quiz_challenges: 2, // public_id
  quiz_attempts: 1, // no indexes
  daily_challenges: 1,

  // ---- Football knowledge base (migration 0003) ----
  countries: 1,
  venues: 1,
  competitions: 1,
  competition_seasons: 1,
  teams: 2, // name
  team_seasons: 1,
  players: 2, // name
  player_teams: 3, // player_id, team_id
  player_transfers: 2, // player_id
  player_trophies: 2, // player_id
  coaches: 1,
  coach_teams: 1,
  fixtures: 2, // (competition_id, season)
  fixture_events: 1,
  standings: 2, // (competition_id, season)
  competition_winners: 1,
  player_season_stats: 1,
  team_season_stats: 1,
  data_sync_state: 1,
  data_sync_queue: 2, // (status, priority)
  data_sync_runs: 1,
  api_request_log: 2, // (provider, day_key)
};

/** Anything not in the table above is assumed to carry one index. */
const DEFAULT_COST = 2;

export function costPerRow(table: string): number {
  return WRITE_COST_PER_ROW[table] ?? DEFAULT_COST;
}

export type WriteVerb = "insert" | "update" | "delete" | "read" | "other";

export interface StatementCost {
  verb: WriteVerb;
  table: string | null;
  /** Rows this statement is expected to touch. */
  rows: number;
  /** Estimated rows written, including index entries. */
  cost: number;
}

const LEADING_COMMENT = /^\s*(--[^\n]*\n|\/\*[\s\S]*?\*\/|\s)+/;

/**
 * Classifies a single SQL statement.
 *
 * `rowsForDelete` supplies the expected row count for an unqualified DELETE,
 * which is the one statement whose cost cannot be read off the text — the
 * caller knows how many rows the table currently holds, this module does not.
 */
export function classifyStatement(sql: string, rowsForDelete = 0): StatementCost {
  const text = sql.replace(LEADING_COMMENT, "").trim();
  const upper = text.toUpperCase();

  if (upper.startsWith("INSERT")) {
    const table = matchTable(text, /INSERT\s+(?:OR\s+\w+\s+)?INTO\s+([A-Za-z_][A-Za-z0-9_]*)/i);
    // A multi-row VALUES list writes one row per tuple.
    const rows = Math.max(1, countValueTuples(text));
    return { verb: "insert", table, rows, cost: rows * costPerRow(table ?? "") };
  }

  if (upper.startsWith("UPDATE")) {
    const table = matchTable(text, /UPDATE\s+([A-Za-z_][A-Za-z0-9_]*)/i);
    return { verb: "update", table, rows: 1, cost: costPerRow(table ?? "") };
  }

  if (upper.startsWith("DELETE")) {
    const table = matchTable(text, /DELETE\s+FROM\s+([A-Za-z_][A-Za-z0-9_]*)/i);
    const rows = /\bWHERE\b/i.test(text) ? 1 : rowsForDelete;
    return { verb: "delete", table, rows, cost: rows * costPerRow(table ?? "") };
  }

  if (upper.startsWith("SELECT") || upper.startsWith("WITH") || upper.startsWith("PRAGMA")) {
    return { verb: "read", table: null, rows: 0, cost: 0 };
  }

  return { verb: "other", table: null, rows: 0, cost: 0 };
}

function matchTable(text: string, pattern: RegExp): string | null {
  const match = text.match(pattern);
  return match ? match[1].toLowerCase() : null;
}

/** Counts `(...)` groups after VALUES, so multi-row inserts are priced correctly. */
function countValueTuples(text: string): number {
  const at = text.search(/\bVALUES\b/i);
  if (at === -1) return 1;
  let depth = 0;
  let tuples = 0;
  for (let i = at; i < text.length; i++) {
    const ch = text[i];
    if (ch === "(") {
      if (depth === 0) tuples++;
      depth++;
    } else if (ch === ")") {
      depth = Math.max(0, depth - 1);
    }
  }
  return Math.max(1, tuples);
}

export interface WritePlan {
  statements: number;
  estimatedRowsWritten: number;
  byTable: Record<string, { rows: number; cost: number; inserts: number; updates: number; deletes: number }>;
}

/** Prices a batch of statements without executing any of them. */
export function planWrites(statements: string[], rowCounts: Record<string, number> = {}): WritePlan {
  const plan: WritePlan = { statements: statements.length, estimatedRowsWritten: 0, byTable: {} };

  for (const sql of statements) {
    const table = matchTable(sql, /(?:INTO|UPDATE|FROM)\s+([A-Za-z_][A-Za-z0-9_]*)/i);
    const cost = classifyStatement(sql, table ? rowCounts[table] ?? 0 : 0);
    if (cost.verb === "read" || cost.verb === "other") continue;

    const key = cost.table ?? "unknown";
    const entry = (plan.byTable[key] ??= { rows: 0, cost: 0, inserts: 0, updates: 0, deletes: 0 });
    entry.rows += cost.rows;
    entry.cost += cost.cost;
    if (cost.verb === "insert") entry.inserts += cost.rows;
    if (cost.verb === "update") entry.updates += cost.rows;
    if (cost.verb === "delete") entry.deletes += cost.rows;
    plan.estimatedRowsWritten += cost.cost;
  }

  return plan;
}

export const DEFAULT_MAX_WRITES_PER_RUN = 20000;

/** Reads the per-run ceiling from the environment, falling back to the default. */
export function maxWritesPerRun(env: Record<string, string | undefined> = process.env): number {
  const raw = env.MAX_D1_WRITES_PER_RUN;
  const parsed = raw === undefined ? NaN : Number(raw);
  return Number.isFinite(parsed) && parsed > 0 ? Math.floor(parsed) : DEFAULT_MAX_WRITES_PER_RUN;
}

export class WriteBudgetExceeded extends Error {
  // Fields assigned explicitly rather than as constructor parameter
  // properties: this module is loaded directly by Node's type-stripping
  // loader, which rejects that syntax.
  readonly estimated: number;
  readonly limit: number;

  constructor(estimated: number, limit: number) {
    super(
      `This run would write about ${estimated.toLocaleString()} rows, over the ${limit.toLocaleString()} ` +
        `limit (MAX_D1_WRITES_PER_RUN). Re-run with --chunk to split it, or raise the limit deliberately.`
    );
    this.estimated = estimated;
    this.limit = limit;
    this.name = "WriteBudgetExceeded";
  }
}

/**
 * Tracks what a run has actually spent, so a chunked job stops at the ceiling
 * rather than discovering it halfway through.
 */
export class WriteBudget {
  private spent = 0;
  readonly limit: number;

  constructor(limit: number = maxWritesPerRun()) {
    this.limit = limit;
  }

  get used(): number {
    return this.spent;
  }

  get remaining(): number {
    return Math.max(0, this.limit - this.spent);
  }

  /** Throws unless the whole plan fits in what is left. */
  assertFits(estimated: number): void {
    if (estimated > this.remaining) throw new WriteBudgetExceeded(estimated, this.limit);
  }

  /** True when the next chunk still fits. */
  canAfford(estimated: number): boolean {
    return estimated <= this.remaining;
  }

  record(estimated: number): void {
    this.spent += estimated;
  }
}

/**
 * Splits statements into batches that each stay under `perChunk` estimated
 * writes, so a large job can proceed without any single batch blowing past the
 * ceiling. Statements are never reordered — child rows must follow their parent.
 */
export function chunkByCost(
  statements: string[],
  perChunk: number,
  rowCounts: Record<string, number> = {}
): string[][] {
  const chunks: string[][] = [];
  let current: string[] = [];
  let currentCost = 0;

  for (const sql of statements) {
    const table = matchTable(sql, /(?:INTO|UPDATE|FROM)\s+([A-Za-z_][A-Za-z0-9_]*)/i);
    const { cost } = classifyStatement(sql, table ? rowCounts[table] ?? 0 : 0);
    if (current.length > 0 && currentCost + cost > perChunk) {
      chunks.push(current);
      current = [];
      currentCost = 0;
    }
    current.push(sql);
    currentCost += cost;
  }

  if (current.length > 0) chunks.push(current);
  return chunks;
}
