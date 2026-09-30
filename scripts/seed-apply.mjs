#!/usr/bin/env node
// Applies seed/seed.sql to D1 incrementally.
//
//   npm run db:apply                 # local, executes
//   npm run db:apply -- --remote     # production
//   npm run d1:write-plan            # dry run, prints the cost and exits
//
// WHAT THIS REPLACES
//
// The old path ran seed.sql as written: six unqualified DELETEs followed by
// 21,781 INSERTs. Counting index maintenance that is ~105,550 rows written —
// the whole free-tier daily allowance, spent every single time, even when not
// one question had changed.
//
// This script compares a per-question content hash against what D1 already
// holds and touches only the difference. A re-run with no content change writes
// zero rows and issues zero statements.

import { readFileSync } from "node:fs";
import { D1Client } from "../src/server/sync/d1Client.ts";
import {
  WriteBudget,
  WriteBudgetExceeded,
  chunkByCost,
  maxWritesPerRun,
  planWrites,
} from "../src/server/sync/writeBudget.ts";

const args = process.argv.slice(2);
const target = args.includes("--remote") ? "remote" : "local";
const dryRun = args.includes("--dry-run") || args.includes("--plan");
const allowChunking = args.includes("--chunk");
// Removing questions is never implied. It only happens when asked for.
const prune = args.includes("--prune");
// One-time backfill after migration 0004. Rows that already exist but have no
// content_hash are assumed to match the current seed, so only the hash is
// written — 1 UPDATE per question instead of deleting and re-inserting all of
// its rows. Costs ~13k rows instead of ~97k. Only correct immediately after the
// column is added; a later run without this flag rewrites anything that differs.
const assumeCurrent = args.includes("--assume-current");

const CHILD_TABLES = [
  "question_options",
  "question_clues",
  "question_scopes",
  "answer_aliases",
  "question_hints",
];

// ---------------------------------------------------------------- parse
/**
 * Splits seed.sql into one block per question.
 *
 * build-seed.mjs emits a `-- @q <id> <hash>` header before each question's
 * statements, so this needs no SQL parsing and cannot drift from the emitter.
 */
function parseSeed(sql) {
  const blocks = new Map();
  let current = null;

  for (const rawLine of sql.split("\n")) {
    const header = rawLine.match(/^--\s*@q\s+(\d+)\s+([0-9a-f]+)\s*$/);
    if (header) {
      current = { id: Number(header[1]), hash: header[2], statements: [] };
      blocks.set(current.id, current);
      continue;
    }
    const line = rawLine.trim();
    // Everything before the first header is the DELETE preamble — deliberately
    // dropped. Wiping the bank is exactly what this script exists to avoid.
    if (!current || !line || line.startsWith("--")) continue;
    current.statements.push(line);
  }

  return blocks;
}

const seedSql = readFileSync(new URL("../seed/seed.sql", import.meta.url), "utf8");
const desired = parseSeed(seedSql);

if (desired.size === 0) {
  console.error("seed.sql has no question blocks. Run `npm run seed:build` first.\n");
  process.exit(1);
}

// ---------------------------------------------------------------- diff
const db = new D1Client({
  target,
  accountId: process.env.CLOUDFLARE_ACCOUNT_ID ?? "367bed473a2c48604d27f2e668162c49",
});

console.log(`\nFootball IQ seed → ${target} D1${dryRun ? "  (dry run)" : ""}\n`);

// One read. Reads are on a separate, far larger free-tier allowance than writes.
const existingRows = await db.query(`SELECT id, content_hash FROM questions`);
const existing = new Map(existingRows.map((r) => [Number(r.id), r.content_hash ?? null]));

const toInsert = [];
const toUpdate = [];
const toBackfill = [];
let unchanged = 0;

for (const [id, block] of desired) {
  const have = existing.get(id);
  if (have === undefined) toInsert.push(block);
  else if (have === null && assumeCurrent) toBackfill.push(block);
  else if (have !== block.hash) toUpdate.push(block);
  else unchanged++;
}

const orphaned = [...existing.keys()].filter((id) => !desired.has(id));

// ---------------------------------------------------------------- statements
const statements = [];

for (const block of toInsert) statements.push(...block.statements);

// Backfill writes the hash and nothing else.
for (const block of toBackfill) {
  statements.push(`UPDATE questions SET content_hash = '${block.hash}' WHERE id = ${block.id};`);
}

// A changed question replaces its own rows only — never the whole table.
for (const block of toUpdate) {
  for (const table of CHILD_TABLES) {
    statements.push(`DELETE FROM ${table} WHERE question_id = ${block.id};`);
  }
  statements.push(`DELETE FROM questions WHERE id = ${block.id};`);
  statements.push(...block.statements);
}

if (prune && orphaned.length > 0) {
  for (const id of orphaned) {
    for (const table of CHILD_TABLES) statements.push(`DELETE FROM ${table} WHERE question_id = ${id};`);
    statements.push(`DELETE FROM questions WHERE id = ${id};`);
  }
}

// ---------------------------------------------------------------- plan
// A changed question's DELETEs are id-qualified, so each removes the handful of
// rows that question owns rather than a whole table.
const rowCounts = Object.fromEntries(CHILD_TABLES.map((t) => [t, 6]));
const plan = planWrites(statements, rowCounts);
const limit = maxWritesPerRun();

console.log(`  questions in seed      : ${desired.size}`);
console.log(`  already loaded         : ${existing.size}`);
console.log(`  new (insert)           : ${toInsert.length}`);
console.log(`  changed (rewrite)      : ${toUpdate.length}`);
if (assumeCurrent) console.log(`  hash backfill only     : ${toBackfill.length}`);
console.log(`  unchanged (skipped)    : ${unchanged}`);
console.log(`  in D1 but not in seed  : ${orphaned.length}${prune ? " (will be pruned)" : " (left alone)"}`);
console.log("");
console.log(`  statements             : ${plan.statements}`);
console.log(`  estimated rows written : ${plan.estimatedRowsWritten.toLocaleString()}`);
console.log(`  budget                 : ${limit.toLocaleString()} (MAX_D1_WRITES_PER_RUN)`);

if (Object.keys(plan.byTable).length > 0) {
  console.log(`\n  by table:`);
  for (const [table, e] of Object.entries(plan.byTable).sort((a, b) => b[1].cost - a[1].cost)) {
    console.log(
      `    ${table.padEnd(20)} +${String(e.inserts).padStart(6)} ins  ` +
        `-${String(e.deletes).padStart(6)} del  ≈${String(e.cost).padStart(7)} rows`
    );
  }
}

if (statements.length === 0) {
  console.log(`\nNothing to do — D1 already matches the seed. 0 rows written.\n`);
  process.exit(0);
}

if (dryRun) {
  console.log(`\nDry run: nothing was written. Drop --dry-run to apply.\n`);
  process.exit(0);
}

// ---------------------------------------------------------------- apply
const budget = new WriteBudget(limit);

try {
  budget.assertFits(plan.estimatedRowsWritten);
} catch (err) {
  if (err instanceof WriteBudgetExceeded && !allowChunking) {
    console.error(`\n${err.message}\n`);
    process.exit(3);
  }
  if (!(err instanceof WriteBudgetExceeded)) throw err;
  console.log(`\n  over budget — chunking to stay under ${limit.toLocaleString()} rows per run`);
}

const chunks = allowChunking
  ? chunkByCost(statements, Math.min(limit, 5000), rowCounts)
  : [statements];

let applied = 0;
let spent = 0;

for (const [index, chunk] of chunks.entries()) {
  const chunkCost = planWrites(chunk, rowCounts).estimatedRowsWritten;
  if (!budget.canAfford(chunkCost)) {
    console.log(
      `\n  stopping at chunk ${index + 1}/${chunks.length}: the next one needs ` +
        `${chunkCost.toLocaleString()} rows and only ${budget.remaining.toLocaleString()} are left in this run.`
    );
    console.log(`  Re-run to continue — everything already applied is skipped.\n`);
    break;
  }
  await db.execute(chunk);
  budget.record(chunkCost);
  applied += chunk.length;
  spent += chunkCost;
  if (chunks.length > 1) {
    console.log(`  chunk ${index + 1}/${chunks.length}: ${chunk.length} statements, ≈${chunkCost} rows`);
  }
}

console.log(`\nApplied.`);
console.log(`  statements executed    : ${applied}`);
console.log(`  rows written (est.)    : ${spent.toLocaleString()}`);
console.log(`  inserts                : ${toInsert.length} question(s)`);
console.log(`  updates                : ${toUpdate.length} question(s)`);
console.log(`  skipped unchanged      : ${unchanged} question(s)`);
const pending = desired.size - unchanged - toInsert.length - toUpdate.length;
console.log(`  pending work           : ${Math.max(0, pending)}`);
console.log("");
