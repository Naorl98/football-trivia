#!/usr/bin/env node
// Reports the real question bank contents from D1.
//   npm run questions:stats [-- --remote]
// Every figure is queried, never estimated.

import { D1Client } from "../src/server/sync/d1Client.ts";

const target = process.argv.includes("--remote") ? "remote" : "local";
const db = new D1Client({
  target,
  accountId: process.env.CLOUDFLARE_ACCOUNT_ID ?? "367bed473a2c48604d27f2e668162c49",
});

const line = (label, value) => console.log(`  ${String(label).padEnd(34)} ${String(value).padStart(7)}`);

console.log(`\nFootball IQ question bank → ${target} D1\n`);

const totals = await db.query(`
  SELECT COUNT(*) AS total,
         SUM(CASE WHEN generated = 0 THEN 1 ELSE 0 END) AS curated,
         SUM(CASE WHEN generated = 1 THEN 1 ELSE 0 END) AS generated,
         SUM(CASE WHEN active = 1 THEN 1 ELSE 0 END) AS active,
         SUM(supports_free_text) AS free_text
    FROM questions
`);
const t = totals[0] ?? {};
line("Total questions", t.total ?? 0);
line("  curated", t.curated ?? 0);
line("  generated", t.generated ?? 0);
line("  active (playable)", t.active ?? 0);
line("Free-text capable", t.free_text ?? 0);

const extras = await db.query(`
  SELECT (SELECT COUNT(DISTINCT question_id) FROM question_hints)   AS with_hints,
         (SELECT COUNT(DISTINCT question_id) FROM answer_aliases)   AS with_aliases,
         (SELECT COUNT(*) FROM answer_aliases)                      AS alias_rows
`);
line("Questions with hints", extras[0]?.with_hints ?? 0);
line("Questions with aliases", extras[0]?.with_aliases ?? 0);
line("Alias rows", extras[0]?.alias_rows ?? 0);

const sections = [
  ["By difficulty", `SELECT difficulty AS k, COUNT(*) AS n FROM questions WHERE active = 1
                       GROUP BY difficulty
                       ORDER BY CASE difficulty WHEN 'EASY' THEN 1 WHEN 'NORMAL' THEN 2
                                WHEN 'HARD' THEN 3 WHEN 'EXPERT' THEN 4 ELSE 5 END`],
  ["By game mode", `SELECT mode AS k, COUNT(*) AS n FROM questions WHERE active = 1 GROUP BY mode ORDER BY n DESC`],
  ["By category", `SELECT category AS k, COUNT(*) AS n FROM questions WHERE active = 1 GROUP BY category ORDER BY n DESC`],
  ["By competition scope", `SELECT s.scope_value AS k, COUNT(DISTINCT s.question_id) AS n
                              FROM question_scopes s JOIN questions q ON q.id = s.question_id
                             WHERE s.scope_type = 'COMPETITION' AND q.active = 1
                             GROUP BY s.scope_value ORDER BY n DESC LIMIT 20`],
  ["By country scope", `SELECT s.scope_value AS k, COUNT(DISTINCT s.question_id) AS n
                          FROM question_scopes s JOIN questions q ON q.id = s.question_id
                         WHERE s.scope_type = 'COUNTRY' AND q.active = 1
                         GROUP BY s.scope_value ORDER BY n DESC LIMIT 20`],
];

for (const [title, sql] of sections) {
  console.log(`\n  ${title}:`);
  const rows = await db.query(sql);
  if (rows.length === 0) console.log("    (none)");
  for (const row of rows) console.log(`    ${String(row.k).padEnd(30)} ${String(row.n).padStart(6)}`);
}

// The number that actually matters for play: how small does a pool get once a
// player applies a common filter?
console.log(`\n  Minimum pool after common filters:`);
const pools = await db.query(`
  SELECT 'difficulty=' || difficulty AS k, COUNT(*) AS n
    FROM questions WHERE active = 1 AND mode = 'CLASSIC' GROUP BY difficulty
  UNION ALL
  SELECT 'free-text, difficulty=' || difficulty, COUNT(*)
    FROM questions WHERE active = 1 AND supports_free_text = 1 GROUP BY difficulty
`);
for (const row of pools) console.log(`    ${String(row.k).padEnd(30)} ${String(row.n).padStart(6)}`);
console.log();
