import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { MockProvider } from "../src/server/providers/football/MockProvider.ts";
import { executeTask } from "../src/server/sync/harvest.ts";
import { buildTaskKey } from "../src/server/sync/queue.ts";
import {
  planTasks,
  scoreTask,
  COMPETITION_TARGETS,
  SEASON_WINDOW,
  isSeasonAccessible,
} from "../src/server/sync/planner.ts";
import { ApiFootballProvider } from "../src/server/providers/football/ApiFootballProvider.ts";
import { quotaDayKey, DEFAULT_OPERATIONAL_LIMIT } from "../src/server/sync/budget.ts";
import {
  upsertCountries,
  upsertPlayers,
  upsertStandings,
  upsertTeams,
  upsertTransfers,
} from "../src/server/sync/importers.ts";
import { ProviderPermanentError, ProviderQuotaError } from "../src/server/providers/football/types.ts";
import { parseResults, sqlValue } from "../src/server/sync/d1Client.ts";

const PROVIDER = "api-football";

const team = (id: string, name: string) => ({
  provider: PROVIDER,
  externalId: id,
  name,
  code: null,
  countryName: "England",
  founded: 1900,
  isNational: false,
  venue: null,
});

describe("sqlValue escaping", () => {
  test("escapes single quotes", () => {
    assert.equal(sqlValue("O'Neill"), "'O''Neill'");
  });
  test("renders null and undefined as NULL", () => {
    assert.equal(sqlValue(null), "NULL");
    assert.equal(sqlValue(undefined), "NULL");
  });
  test("renders booleans as 1/0", () => {
    assert.equal(sqlValue(true), "1");
    assert.equal(sqlValue(false), "0");
  });
  test("rejects non-finite numbers rather than emitting invalid SQL", () => {
    assert.equal(sqlValue(Number.NaN), "NULL");
    assert.equal(sqlValue(Infinity), "NULL");
  });
});

describe("parseResults", () => {
  test("extracts rows from the wrangler envelope", () => {
    const stdout = `noise\n[{"results":[{"a":1},{"a":2}],"success":true}]`;
    assert.deepEqual(parseResults<{ a: number }>(stdout), [{ a: 1 }, { a: 2 }]);
  });
  test("returns empty on unparseable output", () => {
    assert.deepEqual(parseResults("not json"), []);
  });
});

describe("importers produce idempotent SQL", () => {
  test("countries upsert on (provider, external_id)", () => {
    const sql = upsertCountries([{ provider: PROVIDER, externalId: "GB", name: "England", code: "GB" }]);
    assert.equal(sql.length, 1);
    assert.match(sql[0], /ON CONFLICT\(provider, external_id\) DO UPDATE/);
  });

  test("teams upsert and link to a competition season", () => {
    const sql = upsertTeams([team("33", "Manchester United")], {
      competitionExternalId: "39",
      season: 2024,
    });
    assert.ok(sql.some((s) => s.includes("INSERT INTO teams")));
    assert.ok(sql.some((s) => s.includes("ON CONFLICT(provider, external_id) DO UPDATE")));
    assert.ok(sql.some((s) => s.includes("INSERT OR IGNORE INTO team_seasons")));
  });

  test("players preserve existing detail with COALESCE on re-import", () => {
    const sql = upsertPlayers([
      {
        provider: PROVIDER,
        externalId: "154",
        name: "Lionel Messi",
        firstname: "Lionel",
        lastname: "Messi",
        nationality: null,
        birthDate: null,
        position: null,
      },
    ]);
    assert.match(sql[0], /nationality = COALESCE\(excluded\.nationality, players\.nationality\)/);
  });

  test("transfers get a deterministic key so the same move is stored once", () => {
    const transfer = {
      playerExternalId: "154",
      playerName: "Lionel Messi",
      fromTeamExternalId: "529",
      fromTeamName: "Barcelona",
      toTeamExternalId: "85",
      toTeamName: "Paris Saint Germain",
      date: "2021-08-10",
      type: "Free",
      feeText: null,
    };
    const first = upsertTransfers(PROVIDER, [transfer]);
    const second = upsertTransfers(PROVIDER, [transfer]);
    assert.deepEqual(first, second, "same input must produce identical SQL");
    // The batch opens with stub rows for the player and both clubs, so the
    // transfer itself is no longer the first statement.
    const transferRow = first.find((s) => s.includes("INSERT INTO player_transfers"))!;
    assert.ok(transferRow, "expected a player_transfers statement");
    assert.ok(transferRow.includes("154:529:85:2021-08-10"));
    assert.match(transferRow, /ON CONFLICT\(transfer_key\)/);
  });

  test("a transfer also records career history", () => {
    const sql = upsertTransfers(PROVIDER, [
      {
        playerExternalId: "1",
        playerName: "X",
        fromTeamExternalId: "2",
        fromTeamName: "A",
        toTeamExternalId: "3",
        toTeamName: "B",
        date: "2020-07-01",
        type: "€10M",
        feeText: "€10M",
      },
    ]);
    assert.ok(sql.some((s) => s.includes("INSERT OR IGNORE INTO player_teams")));
  });

  test("loans are flagged rather than treated as permanent moves", () => {
    const sql = upsertTransfers(PROVIDER, [
      {
        playerExternalId: "1",
        playerName: "X",
        fromTeamExternalId: "2",
        fromTeamName: "A",
        toTeamExternalId: "3",
        toTeamName: "B",
        date: "2020-07-01",
        type: "Loan",
        feeText: null,
      },
    ]);
    const careerRow = sql.find((s) => s.includes("player_teams"))!;
    // season, start_date, is_loan, source — matched across whitespace so the
    // assertion is about the loan flag, not about where the SQL wraps.
    assert.match(careerRow, /'2020-07-01',\s*1,\s*'transfer'/);
  });

  const CITY = { teamExternalId: "50", teamName: "Man City", rank: 1, points: 91, played: 38, won: 28, drawn: 7, lost: 3, goalsFor: 94, goalsAgainst: 33 };
  const ARSENAL = { teamExternalId: "42", teamName: "Arsenal", rank: 2, points: 89, played: 38, won: 28, drawn: 5, lost: 5, goalsFor: 88, goalsAgainst: 43 };

  test("standings derive a champion row from rank 1", () => {
    const sql = upsertStandings(PROVIDER, "39", 2023, [CITY, ARSENAL], { seasonComplete: true });
    const winnerRow = sql.find((s) => s.includes("competition_winners"));
    assert.ok(winnerRow, "expected a competition_winners statement");
    assert.match(winnerRow!, /ON CONFLICT\(competition_id, season\) DO UPDATE/);
  });

  test("standings without a rank-1 row produce no champion claim", () => {
    const sql = upsertStandings(PROVIDER, "39", 2023, [ARSENAL], { seasonComplete: true });
    assert.ok(!sql.some((s) => s.includes("competition_winners")));
  });

  test("a season still being played has a leader but no champion", () => {
    const sql = upsertStandings(PROVIDER, "39", 2026, [CITY, ARSENAL], { seasonComplete: false });
    assert.ok(sql.some((s) => s.includes("INSERT INTO standings")), "the table itself is still stored");
    assert.ok(
      !sql.some((s) => s.includes("competition_winners")),
      "topping the table in September is not winning the league"
    );
  });

  test("a grouped competition's several rank-1 rows produce no champion claim", () => {
    // The provider flattens group tables into one list, so a group stage arrives
    // as multiple rank-1 rows. Crowning the first would name a group winner.
    const sql = upsertStandings(
      PROVIDER,
      "2",
      2023,
      [CITY, { ...ARSENAL, rank: 1 }],
      { seasonComplete: true }
    );
    assert.ok(!sql.some((s) => s.includes("competition_winners")));
  });

  test("standings stub every club in the table so they need no separate /teams call", () => {
    const sql = upsertStandings(PROVIDER, "39", 2023, [CITY, ARSENAL], { seasonComplete: true });
    assert.ok(sql.some((s) => s.includes("INSERT OR IGNORE INTO teams") && s.includes("Man City")));
    assert.ok(sql.some((s) => s.includes("INSERT OR IGNORE INTO team_seasons")));
  });
});

describe("task keys and planning", () => {
  test("task keys are deterministic", () => {
    const a = buildTaskKey({ resourceType: "teams", competitionExternalId: "39", season: 2024 });
    const b = buildTaskKey({ resourceType: "teams", competitionExternalId: "39", season: 2024 });
    assert.equal(a, b);
    assert.equal(a, "teams:39:2024:-:-:1");
  });

  test("different pages are different tasks", () => {
    const p1 = buildTaskKey({ resourceType: "players", competitionExternalId: "39", season: 2024, page: 1 });
    const p2 = buildTaskKey({ resourceType: "players", competitionExternalId: "39", season: 2024, page: 2 });
    assert.notEqual(p1, p2);
  });

  test("planner spends the budget on question yield, not on row count", () => {
    // The catalogue is one request for every competition and season there is.
    assert.ok(scoreTask("competitions", 1, null) < scoreTask("standings", 1, 2024));
    // A league table brings a champion and stubs the whole division, so it runs
    // ahead of the /teams call that would only add metadata for the same clubs.
    assert.ok(scoreTask("standings", 1, 2024) < scoreTask("teams", 1, 2024));
    // Fixtures are hundreds of rows and almost no unambiguous questions.
    assert.ok(scoreTask("teams", 1, 2024) < scoreTask("fixtures", 1, 2024));
    assert.ok(scoreTask("transfers", 1, null) < scoreTask("fixtures", 1, 2024));
  });

  test("a season of age costs more than a tier of resource", () => {
    // Without this the five accessible seasons of every league score within a
    // few points of each other, the budget goes entirely on league tables, and
    // no per-club request is ever reached.
    assert.ok(scoreTask("standings", 1, 2024) > scoreTask("standings", 1, 2025));
    assert.ok(scoreTask("standings", 1, 2022) > scoreTask("teams", 1, 2025));
  });

  test("planner prefers higher-priority competitions and newer seasons", () => {
    assert.ok(scoreTask("teams", 1, 2024) < scoreTask("teams", 3, 2024));
    assert.ok(scoreTask("teams", 1, 2024) < scoreTask("teams", 1, 2015));
  });

  test("planner skips work already satisfied", () => {
    const all = planTasks({ satisfied: new Set(), knownCompetitionIds: new Set(["39"]) });
    const key = all[0].taskKey;
    const filtered = planTasks({ satisfied: new Set([key]), knownCompetitionIds: new Set(["39"]) });
    assert.ok(all.length > filtered.length);
    assert.ok(!filtered.some((t) => t.taskKey === key));
  });

  test("planner emits tasks in priority order", () => {
    const tasks = planTasks({ satisfied: new Set(), knownCompetitionIds: new Set(["39"]) });
    const priorities = tasks.map((t) => t.priority);
    assert.deepEqual(priorities, [...priorities].sort((a, b) => a - b));
  });

  test("planner never queues odds, predictions or injuries", () => {
    const types = new Set(planTasks({ satisfied: new Set(), knownCompetitionIds: new Set(["39"]) }).map((t) => t.resourceType));
    for (const banned of ["odds", "predictions", "injuries"]) {
      assert.ok(!types.has(banned as never), `must not request ${banned}`);
    }
  });

  test("no season work is planned before the competition catalogue is known", () => {
    const types = new Set(planTasks({ satisfied: new Set() }).map((t) => t.resourceType));
    assert.deepEqual([...types].sort(), ["competitions", "countries"]);
  });

  test("competition targets cover the priority-1 competitions", () => {
    const codes = COMPETITION_TARGETS.filter((c) => c.priority === 1).map((c) => c.localCode);
    for (const expected of ["PREMIER_LEAGUE", "LA_LIGA", "SERIE_A", "BUNDESLIGA", "LIGUE_1", "UCL", "WORLD_CUP"]) {
      assert.ok(codes.includes(expected), `missing priority-1 competition ${expected}`);
    }
  });
});

describe("budget", () => {
  test("quota day key is UTC and ISO-shaped", () => {
    assert.match(quotaDayKey(new Date("2026-03-05T23:30:00Z")), /^2026-03-05$/);
  });
  test("operational limit keeps a reserve below the free-plan cap", () => {
    assert.ok(DEFAULT_OPERATIONAL_LIMIT < 100);
    assert.ok(DEFAULT_OPERATIONAL_LIMIT >= 90);
  });
});

describe("executeTask against a mock provider", () => {
  test("countries task normalizes and produces SQL", async () => {
    const provider = new MockProvider({
      countries: [{ provider: PROVIDER, externalId: "GB", name: "England", code: "GB" }],
    });
    const result = await executeTask(provider, {
      taskKey: "countries:-:-:-:-:1",
      resourceType: "countries",
      priority: 1,
    });
    assert.equal(result.recordCount, 1);
    assert.ok(result.statements[0].includes("INSERT INTO countries"));
    assert.equal(provider.getRequestsUsed(), 1);
  });

  test("one task spends exactly one request", async () => {
    const provider = new MockProvider({ teams: [team("33", "Manchester United")] });
    await executeTask(provider, {
      taskKey: "teams:39:2024:-:-:1",
      resourceType: "teams",
      competitionExternalId: "39",
      season: 2024,
      priority: 10,
    });
    assert.equal(provider.getRequestsUsed(), 1);
  });

  test("paged resources report a next page", async () => {
    const provider = new MockProvider({
      players: [
        [{ provider: PROVIDER, externalId: "1", name: "A", firstname: null, lastname: null, nationality: null, birthDate: null, position: null }],
        [{ provider: PROVIDER, externalId: "2", name: "B", firstname: null, lastname: null, nationality: null, birthDate: null, position: null }],
      ],
    });
    const first = await executeTask(provider, {
      taskKey: "players:39:2024:-:-:1",
      resourceType: "players",
      competitionExternalId: "39",
      season: 2024,
      page: 1,
      priority: 10,
    });
    assert.equal(first.nextPage, 2, "expected page 2 to be queued");
  });

  test("the last page reports no next page", async () => {
    const provider = new MockProvider({
      players: [[{ provider: PROVIDER, externalId: "1", name: "A", firstname: null, lastname: null, nationality: null, birthDate: null, position: null }]],
    });
    const result = await executeTask(provider, {
      taskKey: "players:39:2024:-:-:1",
      resourceType: "players",
      competitionExternalId: "39",
      season: 2024,
      page: 1,
      priority: 10,
    });
    assert.equal(result.nextPage, null);
  });

  test("quota exhaustion surfaces as ProviderQuotaError", async () => {
    const provider = new MockProvider({ countries: [] }, 0);
    await assert.rejects(
      () => executeTask(provider, { taskKey: "countries:-:-:-:-:1", resourceType: "countries", priority: 1 }),
      ProviderQuotaError
    );
  });

  test("standings task builds both table and champion statements", async () => {
    const provider = new MockProvider({
      standings: [
        { teamExternalId: "50", teamName: "Man City", rank: 1, points: 91, played: 38, won: 28, drawn: 7, lost: 3, goalsFor: 94, goalsAgainst: 33 },
      ],
    });
    const result = await executeTask(provider, {
      taskKey: "standings:39:2023:-:-:1",
      resourceType: "standings",
      competitionExternalId: "39",
      season: 2023,
      priority: 20,
    });
    assert.ok(result.statements.some((s) => s.includes("INSERT INTO standings")));
    assert.ok(result.statements.some((s) => s.includes("competition_winners")));
  });

  test("a task missing required parameters spends no request", async () => {
    const provider = new MockProvider({});
    const result = await executeTask(provider, {
      taskKey: "standings:-:-:-:-:1",
      resourceType: "standings",
      priority: 20,
    });
    assert.equal(result.recordCount, 0);
    assert.equal(provider.getRequestsUsed(), 0);
  });
});

describe("the provider plan's season window", () => {
  test("only seasons inside the window are accessible", () => {
    assert.ok(isSeasonAccessible(SEASON_WINDOW.min));
    assert.ok(isSeasonAccessible(SEASON_WINDOW.max));
    assert.ok(!isSeasonAccessible(SEASON_WINDOW.min - 1));
    assert.ok(!isSeasonAccessible(SEASON_WINDOW.max + 1));
    // Season-less resources (the catalogue, a squad, a coach) are unaffected.
    assert.ok(isSeasonAccessible(null));
  });

  test("no task is ever planned for a season the plan cannot serve", () => {
    const tasks = planTasks({
      satisfied: new Set(),
      knownCompetitionIds: new Set(COMPETITION_TARGETS.map((c) => c.externalId)),
      includeHistorical: true,
    });
    assert.ok(tasks.length > 0, "expected the planner to produce work");
    const offending = tasks.filter((t) => t.season != null && !isSeasonAccessible(t.season));
    assert.deepEqual(
      offending.map((t) => t.taskKey),
      [],
      "a task outside the window costs a request and is answered with a refusal"
    );
  });
});

describe("API-Football error classification", () => {
  /** A provider whose single response is the given envelope. */
  const providerReturning = (body: unknown) =>
    new ApiFootballProvider({
      apiKey: "test-key",
      minRequestIntervalMs: 0,
      maxRetries: 0,
      fetchImpl: (async () =>
        new Response(JSON.stringify(body), {
          status: 200,
          headers: { "content-type": "application/json" },
        })) as unknown as typeof fetch,
    });

  test("a season the plan does not cover is permanent, not a quota stop", async () => {
    // Conflating the two is expensive in both directions. This message concerns
    // one request and nothing else, so the harvester must skip that season and
    // carry on; treating it as quota exhaustion aborts the run on the first
    // out-of-range season and leaves the rest of the day's budget unspent.
    const provider = providerReturning({
      errors: { plan: "Free plans do not have access to this season, try from 2022 to 2024." },
    });
    await assert.rejects(
      () => provider.getStandings({ competitionExternalId: "39", season: 2025 }),
      (error: unknown) => {
        assert.ok(
          error instanceof ProviderPermanentError,
          `expected ProviderPermanentError, got ${(error as Error)?.name}`
        );
        assert.ok(!(error instanceof ProviderQuotaError));
        return true;
      }
    );
  });

  test("running out of requests for the day is a quota stop", async () => {
    const provider = providerReturning({
      errors: { requests: "You have reached the request limit for the day" },
    });
    await assert.rejects(
      () => provider.getStandings({ competitionExternalId: "39", season: 2024 }),
      (error: unknown) => {
        assert.ok(error instanceof ProviderQuotaError, `expected ProviderQuotaError, got ${(error as Error)?.name}`);
        return true;
      }
    );
  });

  test("a parameter mistake is permanent so the request is not retried", async () => {
    const provider = providerReturning({ errors: { league: "The League field must be an integer." } });
    await assert.rejects(
      () => provider.getStandings({ competitionExternalId: "x", season: 2024 }),
      (error: unknown) => error instanceof ProviderPermanentError
    );
  });
});
