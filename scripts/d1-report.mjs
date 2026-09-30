// Compact D1 reporting.
//
// `wrangler d1 execute` prints a banner, the statement, and a meta block around
// every result, which is fine for one query and useless for twenty. This runs a
// named set of queries and prints only `label: value` lines, so a full picture of
// the bank is a dozen lines rather than a dozen screens.
//
//   node scripts/d1-report.mjs                 # local
//   node scripts/d1-report.mjs --remote        # production
//   node scripts/d1-report.mjs --remote --sql "SELECT ..."   # one ad-hoc query

import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const WRANGLER_BIN = fileURLToPath(new URL("../node_modules/wrangler/bin/wrangler.js", import.meta.url));

const argv = process.argv.slice(2);
const remote = argv.includes("--remote");
const sqlIndex = argv.indexOf("--sql");
const adhoc = sqlIndex !== -1 ? argv[sqlIndex + 1] : null;

export function query(sql, { remote: isRemote = remote } = {}) {
  // Wrangler's own entry point is invoked with this Node rather than through
  // `npx`: on Windows spawnSync cannot launch a .cmd shim without a shell, and
  // going through a shell would mean quoting SQL for cmd.exe. This skips both
  // problems and one process.
  const args = [
    WRANGLER_BIN,
    "d1",
    "execute",
    "football-iq-db",
    isRemote ? "--remote" : "--local",
    "--json",
    "--command",
    sql,
  ];
  const out = execFileSync(process.execPath, args, {
    encoding: "utf8",
    maxBuffer: 64 * 1024 * 1024,
    env: { ...process.env, CLOUDFLARE_ACCOUNT_ID: "367bed473a2c48604d27f2e668162c49" },
    stdio: ["ignore", "pipe", "ignore"],
  });
  // wrangler prints a banner before the JSON; take from the first bracket.
  const start = out.indexOf("[");
  const parsed = JSON.parse(out.slice(start));
  return parsed[0].results;
}

function table(rows, columns) {
  for (const row of rows) {
    console.log(columns.map((c) => String(row[c] ?? "")).join("\t"));
  }
}

if (adhoc) {
  const rows = query(adhoc);
  if (rows.length === 0) console.log("(no rows)");
  else table(rows, Object.keys(rows[0]));
  process.exit(0);
}

const where = "active = 1";

console.log(`### ${remote ? "PRODUCTION" : "LOCAL"} question bank\n`);

const totals = query(`
  SELECT
    (SELECT COUNT(*) FROM questions) AS total,
    (SELECT COUNT(*) FROM questions WHERE active=1) AS active,
    (SELECT COUNT(*) FROM questions WHERE active=1 AND generated=1) AS generated,
    (SELECT COUNT(*) FROM questions WHERE active=1 AND generated=0) AS curated,
    (SELECT COUNT(*) FROM questions WHERE active=1 AND supports_free_text=1) AS free_text,
    (SELECT COUNT(*) FROM questions q WHERE q.active=1 AND EXISTS (SELECT 1 FROM question_options o WHERE o.question_id=q.id)) AS mcq,
    (SELECT COUNT(*) FROM questions q WHERE q.active=1 AND q.supports_free_text=1 AND EXISTS (SELECT 1 FROM question_options o WHERE o.question_id=q.id)) AS both_modes
`)[0];
for (const [key, value] of Object.entries(totals)) console.log(`${key}\t${value}`);

console.log("\n-- by mode --");
table(query(`SELECT mode, COUNT(*) AS n, SUM(supports_free_text) AS ft FROM questions WHERE ${where} GROUP BY mode ORDER BY n DESC`), ["mode", "n", "ft"]);

console.log("\n-- by category --");
table(query(`SELECT category, COUNT(*) AS n, SUM(supports_free_text) AS ft FROM questions WHERE ${where} GROUP BY category ORDER BY n DESC`), ["category", "n", "ft"]);

console.log("\n-- by difficulty --");
table(query(`SELECT difficulty, COUNT(*) AS n FROM questions WHERE ${where} GROUP BY difficulty ORDER BY n DESC`), ["difficulty", "n"]);

console.log("\n-- by competition scope --");
table(
  query(
    `SELECT s.scope_value AS scope, COUNT(DISTINCT q.id) AS n
     FROM question_scopes s JOIN questions q ON q.id = s.question_id
     WHERE q.active=1 AND s.scope_type='COMPETITION'
     GROUP BY s.scope_value ORDER BY n DESC LIMIT 20`
  ),
  ["scope", "n"]
);

console.log("\n-- knowledge base --");
const kb = query(`SELECT name FROM sqlite_master WHERE type='table' ORDER BY name`).map((r) => r.name);
const counted = [];
for (const name of kb) {
  if (name.startsWith("sqlite_") || name.startsWith("_cf_") || name.startsWith("d1_")) continue;
  counted.push(name);
}
// D1 rejects a compound SELECT with more than a handful of terms, so the table
// counts go out as scalar subqueries in one row — which is not a compound SELECT
// at all — in small batches.
const BATCH = 8;
for (let i = 0; i < counted.length; i += BATCH) {
  const batch = counted.slice(i, i + BATCH);
  const sql = `SELECT ${batch.map((t) => `(SELECT COUNT(*) FROM "${t}") AS "${t}"`).join(", ")}`;
  const row = query(sql)[0];
  for (const [name, n] of Object.entries(row)) console.log(`${name}\t${n}`);
}
