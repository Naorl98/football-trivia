#!/usr/bin/env node
// Harvests football data from the configured provider into D1, within a strict
// daily request budget, resuming wherever the previous run stopped.
//
//   npm run data:harvest              # local D1
//   npm run data:harvest -- --remote  # production D1
//   npm run data:harvest -- --max 20  # cap this run at 20 requests
//   npm run data:harvest -- --historical
//
// The API key is read from API_FOOTBALL_KEY (env or .dev.vars) and never
// leaves this process.

import { readFileSync, existsSync } from "node:fs";
import { ApiFootballProvider } from "../src/server/providers/football/ApiFootballProvider.ts";
import { D1Client } from "../src/server/sync/d1Client.ts";
import { RequestBudget, DEFAULT_OPERATIONAL_LIMIT, quotaDayKey } from "../src/server/sync/budget.ts";
import { runHarvest } from "../src/server/sync/harvest.ts";

function loadLocalEnv() {
  // .dev.vars is the Wrangler convention for local secrets and is gitignored.
  for (const file of [".dev.vars", ".env.local", ".env"]) {
    if (!existsSync(file)) continue;
    for (const line of readFileSync(file, "utf8").split("\n")) {
      const match = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/);
      if (!match) continue;
      const value = match[2].replace(/^["']|["']$/g, "");
      if (!process.env[match[1]]) process.env[match[1]] = value;
    }
  }
}

loadLocalEnv();

const args = process.argv.slice(2);
const target = args.includes("--remote") ? "remote" : "local";
const includeHistorical = args.includes("--historical");
const maxIndex = args.indexOf("--max");
const maxRequests = maxIndex !== -1 ? Number(args[maxIndex + 1]) : undefined;
const operationalLimit = Number(process.env.MAX_DAILY_API_REQUESTS ?? DEFAULT_OPERATIONAL_LIMIT);

const apiKey = process.env.API_FOOTBALL_KEY;
if (!apiKey) {
  console.error(`
API_FOOTBALL_KEY is not configured, so no data can be harvested.

  Local development:
    1. cp .env.example .dev.vars
    2. put your key in .dev.vars:   API_FOOTBALL_KEY=your_key_here
    3. npm run data:harvest

  The key is only ever used by these local ingestion scripts. It is never
  deployed to the Worker and never reaches the browser — gameplay reads
  exclusively from D1.
`);
  process.exit(2);
}

const db = new D1Client({
  target,
  accountId: process.env.CLOUDFLARE_ACCOUNT_ID ?? "367bed473a2c48604d27f2e668162c49",
});

const budget = new RequestBudget(db, "api-football", operationalLimit, quotaDayKey());
await budget.load();

const before = budget.snapshot();
console.log(`\nFootball IQ harvest → ${target} D1`);
console.log(`  quota day ${before.dayKey}: ${before.used}/${before.operationalLimit} used, ${before.remaining} available\n`);

if (before.remaining <= 0) {
  console.log("Daily budget already spent. Run again tomorrow — progress is saved.\n");
  process.exit(0);
}

const provider = new ApiFootballProvider({
  apiKey,
  // Every request is logged to D1 as it happens, which is also how the budget
  // survives a crash mid-run.
  onRequest: (info) => budget.record(info),
});

const report = await runHarvest({
  provider,
  db,
  budget,
  maxRequests: Number.isFinite(maxRequests) ? maxRequests : undefined,
  includeHistorical,
  log: (message) => console.log(`  ${message}`),
});

const after = budget.snapshot();
console.log(`\nHarvest finished (${report.stoppedReason})`);
console.log(`  requests used this run : ${report.requestsUsed}`);
console.log(`  requests remaining today: ${after.remaining}`);
if (after.providerRemaining !== null) {
  console.log(`  provider reports remaining: ${after.providerRemaining}/${after.providerLimit ?? "?"}`);
}
console.log(`  tasks completed        : ${report.tasksCompleted}`);
console.log(`  tasks failed           : ${report.tasksFailed}`);
console.log(`  tasks still pending    : ${report.tasksPending}`);
console.log(`  tasks parked (deferred): ${report.tasksDeferred}`);
console.log(`  records by resource    :`, report.recordsByResource);
console.log(`\nNext: npm run questions:generate${target === "remote" ? " -- --remote" : ""}\n`);
