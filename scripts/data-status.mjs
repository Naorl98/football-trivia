#!/usr/bin/env node
// Reports the real contents of the football knowledge base in D1.
//   npm run data:status [-- --remote]
// Every number is read from the database; nothing is estimated.

import { D1Client } from "../src/server/sync/d1Client.ts";

const target = process.argv.includes("--remote") ? "remote" : "local";
const db = new D1Client({
  target,
  accountId: process.env.CLOUDFLARE_ACCOUNT_ID ?? "367bed473a2c48604d27f2e668162c49",
});

const counts = await db.query(`
  SELECT
    (SELECT COUNT(*) FROM countries)            AS countries,
    (SELECT COUNT(*) FROM competitions)         AS competitions,
    (SELECT COUNT(*) FROM competition_seasons)  AS seasons,
    (SELECT COUNT(*) FROM teams)                AS teams,
    (SELECT COUNT(*) FROM venues)               AS venues,
    (SELECT COUNT(*) FROM players)              AS players,
    (SELECT COUNT(*) FROM player_teams)         AS career_links,
    (SELECT COUNT(*) FROM player_transfers)     AS transfers,
    (SELECT COUNT(*) FROM player_trophies)      AS trophies,
    (SELECT COUNT(*) FROM coaches)              AS coaches,
    (SELECT COUNT(*) FROM fixtures)             AS fixtures,
    (SELECT COUNT(*) FROM standings)            AS standing_rows,
    (SELECT COUNT(*) FROM competition_winners)  AS competition_winners,
    (SELECT COUNT(*) FROM player_season_stats)  AS player_season_stats
`);

const row = counts[0] ?? {};
console.log(`\nFootball knowledge base → ${target} D1\n`);
const labels = {
  countries: "Countries",
  competitions: "Competitions",
  seasons: "Competition seasons",
  teams: "Teams",
  venues: "Venues",
  players: "Players",
  career_links: "Career relationships",
  transfers: "Transfers",
  trophies: "Trophies",
  coaches: "Coaches",
  fixtures: "Fixtures",
  standing_rows: "Standing rows",
  competition_winners: "Competition winners",
  player_season_stats: "Player season stats",
};
for (const [key, label] of Object.entries(labels)) {
  console.log(`  ${label.padEnd(24)} ${String(row[key] ?? 0).padStart(8)}`);
}

const queue = await db.query(
  `SELECT status, COUNT(*) AS n FROM data_sync_queue GROUP BY status ORDER BY n DESC`
);
console.log(`\n  Sync queue:`);
if (queue.length === 0) console.log("    (empty — run npm run data:harvest)");
for (const q of queue) console.log(`    ${String(q.status).padEnd(12)} ${String(q.n).padStart(6)}`);

const runs = await db.query(
  `SELECT started_at, finished_at, requests_used, tasks_completed, tasks_failed, status, notes
     FROM data_sync_runs ORDER BY id DESC LIMIT 3`
);
console.log(`\n  Recent sync runs:`);
if (runs.length === 0) console.log("    (none yet)");
for (const r of runs) {
  console.log(
    `    ${r.started_at} → ${r.finished_at ?? "…"} | ${r.requests_used} req | ` +
      `${r.tasks_completed} ok / ${r.tasks_failed} failed | ${r.status} (${r.notes ?? ""})`
  );
}

const today = new Date().toISOString().slice(0, 10);
const todays = await db.query(
  `SELECT COUNT(*) AS n, MAX(rate_limit_remaining) AS remaining
     FROM api_request_log WHERE day_key = '${today}'`
);
console.log(
  `\n  API requests today (${today}): ${todays[0]?.n ?? 0}` +
    (todays[0]?.remaining != null ? ` | provider remaining: ${todays[0].remaining}` : "")
);
console.log();
