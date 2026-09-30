#!/usr/bin/env node
// Queues /trophies requests for the players most likely to repay one.
//
//   node scripts/queue-trophies.mjs --remote [--limit 20] [--tier 2]
//
// WHY A CURATED QUEUE
//
// /trophies takes one request per player out of a 100-a-day allowance, so which
// players are chosen decides whether the endpoint is worth using at all. The
// knowledge base cannot answer that on its own: ranking players by how many clubs
// they have surfaces journeyman goalkeepers, because a long loan history looks
// exactly like a long career. Ranking by clubs in elite competitions surfaces
// squad players who moved between big clubs without winning anything.
//
// seed/data/players.ts already carries a verified fame signal — `tier`, where 1 is
// a global icon — so that is what selects the queue. The roster is used for
// nothing else here: it is not copied into the provider-backed tables, because the
// static generators already ask Who Am I about these same players and enriching
// api-football rows from it would both misattribute provenance and duplicate
// questions the bank already has.
//
// Yield is deliberately measured before committing more: run this with a small
// --limit, harvest, regenerate, and compare the trophy question count.

import { readFileSync } from "node:fs";
import { D1Client, sqlValue } from "../src/server/sync/d1Client.ts";
import { normalizeAnswer } from "../src/shared/answerMatching.ts";
import { PLAYERS } from "../seed/data/players.ts";

const argv = process.argv.slice(2);
const target = argv.includes("--remote") ? "remote" : "local";
const limitFlag = argv.indexOf("--limit");
const limit = limitFlag !== -1 ? Number(argv[limitFlag + 1]) : 20;
const tierFlag = argv.indexOf("--tier");
const maxTier = tierFlag !== -1 ? Number(argv[tierFlag + 1]) : 2;
const apply = argv.includes("--apply");

const db = new D1Client({
  target,
  accountId: process.env.CLOUDFLARE_ACCOUNT_ID ?? "367bed473a2c48604d27f2e668162c49",
});

const famous = PLAYERS.filter((p) => p.tier <= maxTier);
console.log(`\nCurated players at tier <= ${maxTier}: ${famous.length}`);

// Every spelling a curated player might be stored under, normalised.
const wanted = new Map();
for (const player of famous) {
  for (const label of [player.en, ...(player.aliases ?? [])]) {
    const key = normalizeAnswer(label);
    // Latin spellings only: the provider stores English names.
    if (!key || /[֐-׿]/.test(label)) continue;
    if (!wanted.has(key)) wanted.set(key, player);
  }
}

const rows = await db.query(`SELECT external_id, name FROM players WHERE name IS NOT NULL`);
console.log(`Provider players in the knowledge base: ${rows.length}`);

const matched = new Map();
for (const row of rows) {
  const player = wanted.get(normalizeAnswer(String(row.name)));
  if (!player || matched.has(player.id)) continue;
  matched.set(player.id, { externalId: String(row.external_id), storedName: String(row.name), player });
}

const alreadyDone = new Set(
  (
    await db.query(
      `SELECT task_key FROM data_sync_queue WHERE resource_type = 'trophies'
        UNION SELECT resource_key AS task_key FROM data_sync_state WHERE resource_type = 'trophies'`
    )
  ).map((r) => String(r.task_key))
);

const selected = [...matched.values()]
  .sort((a, b) => a.player.tier - b.player.tier || a.player.en.localeCompare(b.player.en))
  .map((m) => ({ ...m, taskKey: `trophies:-:-:-:${m.externalId}:1` }))
  .filter((m) => !alreadyDone.has(m.taskKey))
  .slice(0, limit);

console.log(`Matched to curated icons: ${matched.size}`);
console.log(`Queueing now (limit ${limit}): ${selected.length}\n`);
for (const m of selected) {
  console.log(`  tier ${m.player.tier}  ${m.storedName.padEnd(26)} (${m.player.en})`);
}

if (selected.length === 0) {
  console.log(`\nNothing to queue.\n`);
  process.exit(0);
}

if (!apply) {
  console.log(`\nDry run — pass --apply to enqueue.\n`);
  process.exit(0);
}

// Priority sits after the fixtures and top-scorer work, which is worth more per
// request, but ahead of the long tail of per-club crawling.
await db.execute(
  selected.map(
    (m) =>
      `INSERT OR IGNORE INTO data_sync_queue (task_key, resource_type, player_external_id, page, priority, status)
       VALUES (${sqlValue(m.taskKey)}, 'trophies', ${sqlValue(m.externalId)}, 1, 120, 'PENDING');`
  )
);
console.log(`\nQueued ${selected.length} trophies task(s) at priority 120.\n`);
