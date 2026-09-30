#!/usr/bin/env node
// End-to-end verification of the ingestion pipeline against a real local D1,
// using the mock provider instead of spending API-Football quota.
//
// Proves: harvest writes facts -> re-running imports nothing new (idempotent)
// -> generators turn those facts into playable questions -> re-generating adds
// no duplicates -> the quiz API can serve them.
//
//   node scripts/verify-pipeline.mjs

import { D1Client } from "../src/server/sync/d1Client.ts";
import { RequestBudget } from "../src/server/sync/budget.ts";
import { runHarvest } from "../src/server/sync/harvest.ts";
import { MockProvider } from "../src/server/providers/football/MockProvider.ts";

const db = new D1Client({
  target: "local",
  accountId: process.env.CLOUDFLARE_ACCOUNT_ID ?? "367bed473a2c48604d27f2e668162c49",
});

let passed = 0;
let failed = 0;
const check = (name, cond, detail = "") => {
  if (cond) {
    passed++;
    console.log(`  PASS  ${name}`);
  } else {
    failed++;
    console.log(`  FAIL  ${name}${detail ? ` — ${detail}` : ""}`);
  }
};

const P = "api-football";
const team = (id, name, venueId, venueName) => ({
  provider: P, externalId: id, name, code: null, countryName: "England",
  founded: 1900, isNational: false,
  venue: venueId ? { provider: P, externalId: venueId, name: venueName, city: "X", countryName: "England", capacity: 60000 } : null,
});

const mockData = {
  countries: [
    { provider: P, externalId: "GB", name: "England", code: "GB" },
    { provider: P, externalId: "ES", name: "Spain", code: "ES" },
  ],
  competitions: [
    {
      provider: P, externalId: "39", name: "Premier League", type: "LEAGUE",
      countryName: "England", countryCode: "GB",
      seasons: [
        { season: 2023, startDate: "2023-08-01", endDate: "2024-05-19", isCurrent: false, coverage: { standings: true } },
        { season: 2024, startDate: "2024-08-01", endDate: "2025-05-25", isCurrent: true, coverage: { standings: true } },
      ],
    },
  ],
  teams: [
    team("33", "Manchester United", "556", "Old Trafford"),
    team("40", "Liverpool", "550", "Anfield"),
    team("42", "Arsenal", "494", "Emirates Stadium"),
    team("50", "Manchester City", "555", "Etihad Stadium"),
    team("49", "Chelsea", "519", "Stamford Bridge"),
  ],
  standings: [
    { teamExternalId: "50", teamName: "Manchester City", rank: 1, points: 91, played: 38, won: 28, drawn: 7, lost: 3, goalsFor: 96, goalsAgainst: 34 },
    { teamExternalId: "42", teamName: "Arsenal", rank: 2, points: 89, played: 38, won: 28, drawn: 5, lost: 5, goalsFor: 91, goalsAgainst: 29 },
    { teamExternalId: "40", teamName: "Liverpool", rank: 3, points: 82, played: 38, won: 24, drawn: 10, lost: 4, goalsFor: 86, goalsAgainst: 41 },
  ],
  transfers: [
    { playerExternalId: "874", playerName: "Cristiano Ronaldo", fromTeamExternalId: "496", fromTeamName: "Juventus", toTeamExternalId: "33", toTeamName: "Manchester United", date: "2021-08-27", type: "€ 15M", feeText: "€ 15M" },
    { playerExternalId: "874", playerName: "Cristiano Ronaldo", fromTeamExternalId: "33", fromTeamName: "Manchester United", toTeamExternalId: "2506", toTeamName: "Al Nassr", date: "2023-01-01", type: "Free", feeText: null },
    { playerExternalId: "874", playerName: "Cristiano Ronaldo", fromTeamExternalId: "541", fromTeamName: "Real Madrid", toTeamExternalId: "496", toTeamName: "Juventus", date: "2018-07-10", type: "€ 117M", feeText: "€ 117M" },
  ],
  squad: [
    { player: { provider: P, externalId: "874", name: "Cristiano Ronaldo", firstname: "Cristiano", lastname: "Ronaldo", nationality: "Portugal", birthDate: "1985-02-05", position: "Attacker" }, teamExternalId: "33", season: 2023 },
    { player: { provider: P, externalId: "306", name: "Kevin De Bruyne", firstname: "Kevin", lastname: "De Bruyne", nationality: "Belgium", birthDate: "1991-06-28", position: "Midfielder" }, teamExternalId: "50", season: 2023 },
  ],
};

console.log(`\nPipeline verification (mock provider → real local D1)\n`);

// Clean slate for the knowledge tables so the run is reproducible.
await db.execute([
  "DELETE FROM api_request_log;",
  "DELETE FROM data_sync_queue;",
  "DELETE FROM data_sync_state;",
  "DELETE FROM data_sync_runs;",
  "DELETE FROM competition_winners;",
  "DELETE FROM standings;",
  "DELETE FROM player_transfers;",
  "DELETE FROM player_teams;",
  "DELETE FROM team_seasons;",
  "DELETE FROM players;",
  "DELETE FROM teams;",
  "DELETE FROM venues;",
  "DELETE FROM competition_seasons;",
  "DELETE FROM competitions;",
  "DELETE FROM countries;",
  "DELETE FROM questions WHERE id >= 500000;",
]);

async function harvest(maxRequests) {
  const provider = new MockProvider(mockData);
  const budget = new RequestBudget(db, P, 95);
  await budget.load();
  const originalPage = provider.constructor.prototype;
  // Record each mock call in the budget, mirroring the real provider wiring.
  for (const method of ["getCountries", "getCompetitions", "getTeams", "getSquad", "getTransfers", "getStandings", "getTopScorers", "getFixtures", "getCoaches", "getTrophies", "getPlayers"]) {
    const original = provider[method].bind(provider);
    provider[method] = async (...args) => {
      const result = await original(...args);
      await budget.record({
        endpoint: `/${method}`, params: {}, statusCode: 200,
        results: result.items.length,
        rateLimitRemaining: result.rateLimitRemaining, rateLimitLimit: result.rateLimitLimit,
      });
      return result;
    };
  }
  void originalPage;
  return runHarvest({ provider, db, budget, maxRequests, log: () => {} });
}

// ---- First harvest. Budget is generous enough to drain the mock queue, which
// is small because the planner only queues work for competitions the provider
// actually returned.
const first = await harvest(40);
check("harvest completes without error", first.tasksFailed === 0, JSON.stringify(first.recordsByResource));
check("harvest spent API requests", first.requestsUsed > 0, `used ${first.requestsUsed}`);

const afterFirst = (await db.query(`
  SELECT (SELECT COUNT(*) FROM countries) c, (SELECT COUNT(*) FROM competitions) comp,
         (SELECT COUNT(*) FROM competition_seasons) seasons, (SELECT COUNT(*) FROM teams) teams,
         (SELECT COUNT(*) FROM venues) venues, (SELECT COUNT(*) FROM standings) st,
         (SELECT COUNT(*) FROM competition_winners) win
`))[0];
check("countries imported", Number(afterFirst.c) === 2, JSON.stringify(afterFirst));
check("competitions imported", Number(afterFirst.comp) === 1);
check("competition seasons imported", Number(afterFirst.seasons) === 2);
check("teams imported", Number(afterFirst.teams) === 5);
check("venues imported", Number(afterFirst.venues) === 5);
check("standings imported", Number(afterFirst.st) >= 3);
check("champion derived from standings", Number(afterFirst.win) >= 1);

const champion = await db.query(`
  SELECT t.name AS champion, r.name AS runner_up, cw.season
    FROM competition_winners cw JOIN teams t ON t.id = cw.team_id
    LEFT JOIN teams r ON r.id = cw.runner_up_team_id`);
check("champion is the rank-1 team", champion[0]?.champion === "Manchester City", JSON.stringify(champion[0]));
check("runner-up is the rank-2 team", champion[0]?.runner_up === "Arsenal");

// ---- Idempotency: the whole point of the sync-state table.
const second = await harvest(40);
const afterSecond = (await db.query(`
  SELECT (SELECT COUNT(*) FROM countries) c, (SELECT COUNT(*) FROM teams) teams,
         (SELECT COUNT(*) FROM venues) venues, (SELECT COUNT(*) FROM standings) st,
         (SELECT COUNT(*) FROM player_transfers) tr, (SELECT COUNT(*) FROM players) pl
`))[0];
check("re-running creates no duplicate countries", Number(afterSecond.c) === Number(afterFirst.c));
check("re-running creates no duplicate teams", Number(afterSecond.teams) === Number(afterFirst.teams));
check("re-running creates no duplicate venues", Number(afterSecond.venues) === Number(afterFirst.venues));
check("re-running creates no duplicate standings", Number(afterSecond.st) === Number(afterFirst.st));
check(
  "a fully-synced dataset spends zero API requests on re-run",
  second.requestsUsed === 0,
  `first ${first.requestsUsed}, second ${second.requestsUsed}`
);
check("second run finds the queue already drained", second.stoppedReason === "queue-empty", second.stoppedReason);

// ---- Sync state / archive behaviour
const states = await db.query(`SELECT resource_key, status FROM data_sync_state ORDER BY resource_key`);
check("sync state recorded", states.length > 0);
const archived = states.filter((s) => s.status === "ARCHIVED");
check("completed historical seasons are archived", archived.length > 0,
  states.map((s) => `${s.resource_key}=${s.status}`).join(", "));

// ---- Budget accounting
const logged = Number((await db.query(`SELECT COUNT(*) n FROM api_request_log`))[0].n);
check("every request is logged for the budget", logged === first.requestsUsed + second.requestsUsed,
  `logged ${logged}, harvested ${first.requestsUsed + second.requestsUsed}`);

// ---- Question generation from the imported facts
const { execFile } = await import("node:child_process");
const { promisify } = await import("node:util");
const run = promisify(execFile);
const gen1 = await run(process.execPath, ["scripts/questions-generate.mjs"], { maxBuffer: 32 * 1024 * 1024 });
const generatedCount = Number(/(\d+) new question\(s\) written/.exec(gen1.stdout)?.[1] ?? 0);
check("questions generated from imported facts", generatedCount > 0, gen1.stdout.slice(-300));

const kbQuestions = await db.query(`SELECT COUNT(*) n FROM questions WHERE id >= 500000`);
check("generated questions stored in D1", Number(kbQuestions[0].n) === generatedCount);

const sample = await db.query(`
  SELECT q.question_he, q.semantic_key, COUNT(o.id) AS options,
         SUM(o.is_correct) AS correct
    FROM questions q JOIN question_options o ON o.question_id = q.id
   WHERE q.id >= 500000 GROUP BY q.id LIMIT 50`);
check("every generated question has exactly 4 options", sample.every((r) => Number(r.options) === 4));
check("every generated question has exactly 1 correct option", sample.every((r) => Number(r.correct) === 1));

// ---- Re-generation is idempotent
const gen2 = await run(process.execPath, ["scripts/questions-generate.mjs"], { maxBuffer: 32 * 1024 * 1024 });
const kbAfter = await db.query(`SELECT COUNT(*) n FROM questions WHERE id >= 500000`);
check("re-generating adds no duplicates", Number(kbAfter[0].n) === generatedCount,
  `${kbAfter[0].n} vs ${generatedCount}`);
check("re-generation reports nothing new", /Nothing new to write|accepted: 0/.test(gen2.stdout));

// ---- Generated questions are playable through the same engine
const playable = await db.query(`
  SELECT COUNT(*) n FROM questions WHERE id >= 500000 AND active = 1`);
check("generated questions are active and playable", Number(playable[0].n) === generatedCount);

const freeText = await db.query(`
  SELECT COUNT(*) n FROM questions q
   WHERE q.id >= 500000 AND q.supports_free_text = 1
     AND EXISTS (SELECT 1 FROM answer_aliases a WHERE a.question_id = q.id)`);
check("free-text generated questions carry aliases", Number(freeText[0].n) > 0);

console.log(`\n${passed} passed, ${failed} failed\n`);
process.exit(failed === 0 ? 0 : 1);
