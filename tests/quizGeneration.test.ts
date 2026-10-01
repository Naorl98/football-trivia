import { describe, it } from "node:test";
import assert from "node:assert/strict";

import {
  D1_MAX_BOUND_PARAMS,
  buildWhere,
  pickQuestionIds,
  type QuestionFilter,
} from "../src/worker/db/questions.ts";
import { parseQuizConfiguration, ValidationError } from "../src/worker/lib/validate.ts";
import { CATEGORIES, COMPETITIONS, COUNTRIES, QUESTION_COUNTS } from "../src/shared/constants.ts";

/*
  THE REGRESSION THESE TESTS EXIST FOR

  Quiz creation failed in production with:

      D1_ERROR: too many SQL variables at offset 297: SQLITE_ERROR

  D1 rejects any statement carrying more than 100 bound parameters.
  `pickQuestionIds` used to bind every recently-seen question id as a parameter,
  and the client keeps a window of hundreds of them — so once a player had seen
  ~100 questions, EVERY subsequent quiz request 500'd, permanently, because the
  list lives in localStorage and never shrinks.

  Measured against production before the fix:
    * minimal filter  (1 filter param):  last OK 98 excludes, failed at 99
    * heavy filter   (26 filter params): last OK 73 excludes, failed at 74
  i.e. it is the statement TOTAL that matters, not the exclude list alone.
*/

/**
 * A D1 stand-in that enforces the real parameter ceiling AND models the
 * shuffle-key window.
 *
 * The window matters as much as the ceiling now. Selection no longer sorts the
 * whole table with ORDER BY RANDOM(); it picks a random pivot and walks an index
 * from it, wrapping to the start of the key space if the first range comes up
 * short (see migration 0007 and `pickQuestionIds`). A double that returned the
 * same rows for every query would make those two ranges look like one, so the
 * test would be blind to whether the wrap works at all — and would report
 * duplicates the real database cannot produce.
 *
 * So: each row gets a shuffle_key, and the double honours the comparison and the
 * LIMIT from the SQL it was handed. Nothing else about the WHERE clause is
 * modelled; `buildWhere` is unit tested on its own text, and the filters are
 * exercised for real against D1 by scripts/d1-query-plan.mjs.
 */
function fakeD1(rows: { id: number }[] = []) {
  const calls: { sql: string; params: unknown[] }[] = [];

  // Deterministic, and deliberately not in id order: a double whose key order
  // matches its id order cannot show that the result is actually shuffled.
  const keyed = rows.map((row, index) => ({
    id: row.id,
    shuffleKey: ((index * 7919) % 1000) * 1_000_000,
  }));

  const db = {
    prepare(sql: string) {
      const statement = {
        bind(...params: unknown[]) {
          if (params.length > D1_MAX_BOUND_PARAMS) {
            // Same failure mode D1 produces, surfaced locally.
            throw new Error(
              `D1_ERROR: too many SQL variables (${params.length} > ${D1_MAX_BOUND_PARAMS}): SQLITE_ERROR`
            );
          }
          calls.push({ sql, params });
          return statement;
        },
        async all<T>() {
          // The last two bound values are the pivot and the limit; the filter's
          // own parameters come before them.
          const limit = Number(params.at(-1));
          const pivot = Number(params.at(-2));
          const forward = sql.includes("shuffle_key >=");

          const matching = keyed
            .filter((row) => (forward ? row.shuffleKey >= pivot : row.shuffleKey < pivot))
            .sort((a, b) => a.shuffleKey - b.shuffleKey)
            .slice(0, Number.isFinite(limit) ? limit : undefined)
            .map((row) => ({ id: row.id }));

          return { results: matching as T[] };
        },
        async first<T>() {
          return { cnt: rows.length } as T;
        },
      };
      let params: unknown[] = [];
      // `bind` is what captures them; kept on the closure so `all` can read the
      // pivot and limit back out.
      const bind = statement.bind;
      statement.bind = (...args: unknown[]) => {
        params = args;
        return bind(...args);
      };
      return statement;
    },
  };
  return { db: db as unknown as D1Database, calls };
}

const baseFilter: QuestionFilter = {
  region: null,
  countries: [],
  competitions: [],
  categories: [],
  difficulty: "MIXED",
  gameMode: "CLASSIC",
  answerMode: "MULTIPLE_CHOICE",
};

/** The widest filter the product can actually produce from its own constants. */
const widestFilter: QuestionFilter = {
  region: "EUROPE",
  countries: COUNTRIES.map((c) => c.code),
  competitions: COMPETITIONS.map((c) => c.code),
  categories: CATEGORIES.map((c) => c.code),
  difficulty: "HARD",
  gameMode: "CLASSIC",
  answerMode: "FREE_TEXT",
};

describe("D1 bound-parameter budget", () => {
  it("stays under the ceiling for the widest filter the UI can build", () => {
    const { params } = buildWhere(widestFilter);
    // +2 for the pivot and the LIMIT that pickQuestionIds binds alongside the
    // filter. It was +1 when the ordering was ORDER BY RANDOM().
    assert.ok(
      params.length + 2 <= D1_MAX_BOUND_PARAMS,
      `widest filter needs ${params.length + 2} bound params, ceiling is ${D1_MAX_BOUND_PARAMS}`
    );
  });

  it("does not grow the parameter count with the exclude list", async () => {
    const counts: number[] = [];
    for (const n of [0, 50, 100, 300, 500]) {
      const { db, calls } = fakeD1([{ id: 1 }]);
      const excludeIds = Array.from({ length: n }, (_, i) => 100000 + i);
      await pickQuestionIds(db, baseFilter, 10, excludeIds);
      counts.push(calls[0].params.length);
    }
    assert.deepEqual(
      new Set(counts).size,
      1,
      `parameter count varied with the exclude list: ${counts.join(", ")}`
    );
  });

  // The exact shapes that failed in production.
  it("survives a 300-id exclude list on the widest filter", async () => {
    const { db } = fakeD1([{ id: 7 }]);
    const excludeIds = Array.from({ length: 300 }, (_, i) => 100000 + i);
    await assert.doesNotReject(() => pickQuestionIds(db, widestFilter, 50, excludeIds));
  });

  /*
    THESE THREE TESTS CHANGED SHAPE, NOT PURPOSE.

    They used to assert the text of the generated SQL: that the exclude list
    appeared as `CASE WHEN q.id IN (101,102,103)` in the ORDER BY, and that the
    ordering was `ORDER BY RANDOM() LIMIT ?`. Both of those are gone, because
    `ORDER BY RANDOM()` was the performance problem — measured at 25,197 rows
    read to return ten, with a full temp B-tree sort — and the exclude list no
    longer reaches SQL at all. Selection now walks a shuffle-key index from a
    random pivot and does the de-prioritisation in memory.

    The guarantees those tests protected are still guarantees, so they are
    asserted here on behaviour instead of on a string. Behaviour is the better
    test anyway: the old ones would have passed for any query that merely
    contained the right substring.
  */

  it("de-prioritises excluded ids rather than dropping them", async () => {
    // Twelve available, ten wanted, and nine of the twelve recently seen. The
    // three fresh ones must all be in, the quiz must still be full, and the
    // seen ones make up the difference — a player with a long history gets a
    // complete quiz, which is the rule this protects.
    const { db } = fakeD1(Array.from({ length: 12 }, (_, i) => ({ id: i + 1 })));
    const seen = [1, 2, 3, 4, 5, 6, 7, 8, 9];

    const ids = await pickQuestionIds(db, baseFilter, 10, seen);

    assert.equal(ids.length, 10, "a long history must not shorten the quiz");
    assert.equal(new Set(ids).size, ids.length, "returned duplicate ids");
    for (const fresh of [10, 11, 12]) {
      assert.ok(ids.includes(fresh), `fresh question ${fresh} should have been preferred`);
    }
    // And the three fresh ones come first, before anything already seen.
    assert.deepEqual(new Set(ids.slice(0, 3)), new Set([10, 11, 12]));
  });

  it("binds the pivot and the limit, and nothing else beyond the filter", async () => {
    const { db, calls } = fakeD1([{ id: 7 }]);
    const { params } = buildWhere(baseFilter);

    await pickQuestionIds(db, baseFilter, 10, [101, 102, 103]);

    // The filter's parameters, plus exactly two: the pivot and the limit. If a
    // future change starts binding the exclude list again, this is what notices
    // before the 100-parameter ceiling does in production.
    assert.equal(calls[0].params.length, params.length + 2);
    assert.match(calls[0].sql, /ORDER BY q\.shuffle_key/);
    assert.ok(!calls[0].sql.includes("RANDOM()"), "ORDER BY RANDOM() is the query this replaced");
  });
});

describe("no caller-supplied value is ever interpolated into SQL", () => {
  it("hostile exclude ids reach neither the SQL text nor the bound parameters", async () => {
    const { db, calls } = fakeD1(Array.from({ length: 10 }, (_, i) => ({ id: i + 1 })));
    const hostile = [
      1,
      "2); DROP TABLE questions;--",
      3.5,
      NaN,
      Infinity,
      null,
      undefined,
      {},
      "4",
      "' OR 1=1 --",
    ] as unknown as number[];

    await assert.doesNotReject(() => pickQuestionIds(db, baseFilter, 10, hostile));

    // The exclude list is now applied in memory, so none of it should appear
    // anywhere near the database — not inlined in the statement, and not bound.
    for (const call of calls) {
      assert.ok(!call.sql.includes("DROP"), "SQL text carried an exclude value");
      assert.ok(!call.sql.includes("OR 1=1"), "SQL text carried an exclude value");
      assert.ok(!/CASE WHEN|IN \(/.test(call.sql), "exclude ids should not be in the statement at all");
      for (const param of call.params) {
        assert.ok(
          typeof param !== "string" || !/DROP|OR 1=1|--/.test(param),
          `hostile value reached a bound parameter: ${String(param)}`
        );
      }
    }
  });

  it("the validator rejects non-integer ids before they ever reach SQL", () => {
    const config = parseQuizConfiguration({
      region: "WORLD",
      countries: [],
      competitions: ["ALL"],
      categories: [],
      difficulty: "MIXED",
      questionCount: 10,
      gameMode: "CLASSIC",
      answerMode: "MULTIPLE_CHOICE",
      excludeQuestionIds: [1, "x", 2.5, null, 2, 2],
    });
    assert.deepEqual(config.excludeQuestionIds, [1, 2], "kept only deduplicated integers");
  });
});

describe("configuration validation bounds the query", () => {
  it("drops country and competition codes the product does not define", () => {
    const config = parseQuizConfiguration({
      region: "WORLD",
      countries: ["ENG", "NOPE", "ESP", "ENG"],
      competitions: ["UCL", "NOT_A_LEAGUE", "UCL"],
      categories: ["CLUBS", "FAKE", "CLUBS"],
      difficulty: "MIXED",
      questionCount: 10,
      gameMode: "CLASSIC",
      answerMode: "MULTIPLE_CHOICE",
    });
    assert.deepEqual(config.countries, ["ENG", "ESP"]);
    assert.deepEqual(config.competitions, ["UCL"]);
    assert.deepEqual(config.categories, ["CLUBS"]);
  });

  // Without the allowlist a client could blow the same ceiling from the other
  // direction, by sending hundreds of scope strings.
  it("a flood of bogus scope codes cannot exceed the parameter ceiling", () => {
    const config = parseQuizConfiguration({
      region: "EUROPE",
      countries: Array.from({ length: 400 }, (_, i) => `XX${i}`),
      competitions: Array.from({ length: 400 }, (_, i) => `LEAGUE_${i}`),
      categories: Array.from({ length: 400 }, (_, i) => `CAT_${i}`),
      difficulty: "HARD",
      questionCount: 10,
      gameMode: "CLASSIC",
      answerMode: "MULTIPLE_CHOICE",
    });
    const { params } = buildWhere({
      region: config.region,
      countries: config.countries,
      competitions: config.competitions,
      categories: config.categories,
      difficulty: config.difficulty,
      gameMode: config.gameMode,
      answerMode: config.answerMode,
    });
    assert.ok(params.length + 1 <= D1_MAX_BOUND_PARAMS, `${params.length + 1} bound params`);
  });

  it("rejects a question count the product does not offer", () => {
    assert.throws(
      () =>
        parseQuizConfiguration({
          region: "WORLD",
          countries: [],
          competitions: ["ALL"],
          categories: [],
          difficulty: "MIXED",
          questionCount: 999,
          gameMode: "CLASSIC",
          answerMode: "MULTIPLE_CHOICE",
        }),
      ValidationError
    );
  });
});

describe("the required quiz scenarios all build a valid query", () => {
  const scenarios: { name: string; config: Record<string, unknown> }[] = [
    {
      name: "Easy / multiple choice / 10",
      config: { region: "WORLD", countries: [], competitions: ["ALL"], categories: [], difficulty: "EASY", questionCount: 10, gameMode: "CLASSIC", answerMode: "MULTIPLE_CHOICE" },
    },
    {
      name: "Normal / multiple choice / 10",
      config: { region: "WORLD", countries: [], competitions: ["ALL"], categories: [], difficulty: "NORMAL", questionCount: 10, gameMode: "CLASSIC", answerMode: "MULTIPLE_CHOICE" },
    },
    {
      name: "Hard / multiple choice / 20",
      config: { region: "WORLD", countries: [], competitions: ["ALL"], categories: [], difficulty: "HARD", questionCount: 20, gameMode: "CLASSIC", answerMode: "MULTIPLE_CHOICE" },
    },
    {
      name: "Expert / free text / 10",
      config: { region: "WORLD", countries: [], competitions: ["ALL"], categories: [], difficulty: "EXPERT", questionCount: 10, gameMode: "CLASSIC", answerMode: "FREE_TEXT" },
    },
    {
      name: "Impossible / multiple choice / 5",
      config: { region: "WORLD", countries: [], competitions: ["ALL"], categories: [], difficulty: "IMPOSSIBLE", questionCount: 5, gameMode: "CLASSIC", answerMode: "MULTIPLE_CHOICE" },
    },
    {
      name: "Top 6 Europe / Hard",
      config: { region: "EUROPE", countries: [], competitions: ["TOP_6_EUROPE"], categories: [], difficulty: "HARD", questionCount: 10, gameMode: "CLASSIC", answerMode: "MULTIPLE_CHOICE" },
    },
    {
      name: "Champions League / Expert",
      config: { region: "EUROPE", countries: [], competitions: ["UCL"], categories: ["CHAMPIONS_LEAGUE"], difficulty: "EXPERT", questionCount: 10, gameMode: "CLASSIC", answerMode: "MULTIPLE_CHOICE" },
    },
    {
      name: "Worldwide / Mixed",
      config: { region: "WORLD", countries: [], competitions: ["ALL"], categories: [], difficulty: "MIXED", questionCount: 10, gameMode: "CLASSIC", answerMode: "MULTIPLE_CHOICE" },
    },
  ];

  for (const { name, config } of scenarios) {
    it(`${name} — builds within budget, with and without a long history`, async () => {
      const parsed = parseQuizConfiguration(config);
      const filter: QuestionFilter = {
        region: parsed.region,
        countries: parsed.countries,
        competitions: parsed.competitions,
        categories: parsed.categories,
        difficulty: parsed.difficulty,
        gameMode: parsed.gameMode,
        answerMode: parsed.answerMode,
      };

      for (const historyLength of [0, 300]) {
        const { db, calls } = fakeD1(
          Array.from({ length: parsed.questionCount }, (_, i) => ({ id: i + 1 }))
        );
        const excludeIds = Array.from({ length: historyLength }, (_, i) => 100000 + i);
        const ids = await pickQuestionIds(db, filter, parsed.questionCount, excludeIds);

        assert.ok(
          calls[0].params.length <= D1_MAX_BOUND_PARAMS,
          `${name} with ${historyLength} excludes used ${calls[0].params.length} params`
        );
        assert.equal(new Set(ids).size, ids.length, `${name} returned duplicate ids`);
      }
    });
  }

  it("free-text scenarios restrict to questions that have a canonical answer", () => {
    const { where } = buildWhere({ ...baseFilter, answerMode: "FREE_TEXT" });
    assert.match(where, /supports_free_text = 1/);
  });

  it("MIXED does not constrain difficulty at all", () => {
    const mixed = buildWhere({ ...baseFilter, difficulty: "MIXED" });
    const easy = buildWhere({ ...baseFilter, difficulty: "EASY" });
    assert.ok(!mixed.where.includes("q.difficulty"));
    assert.match(easy.where, /q\.difficulty = \?/);
    assert.ok(easy.params.includes("EASY"));
  });

  it("'ALL' competitions never becomes a positive scope filter", () => {
    const { where } = buildWhere({ ...baseFilter, competitions: ["ALL"] });
    assert.ok(
      !where.includes("question_scopes"),
      "ALL must mean 'no restriction', not 'must carry a competition scope'"
    );
  });

  it("every offered question count is accepted", () => {
    for (const count of QUESTION_COUNTS) {
      assert.doesNotThrow(() =>
        parseQuizConfiguration({
          region: "WORLD",
          countries: [],
          competitions: ["ALL"],
          categories: [],
          difficulty: "MIXED",
          questionCount: count,
          gameMode: "CLASSIC",
          answerMode: "MULTIPLE_CHOICE",
        })
      );
    }
  });
});
