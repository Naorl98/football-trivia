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

/** A D1 stand-in that enforces the real parameter ceiling. */
function fakeD1(rows: { id: number }[] = []) {
  const calls: { sql: string; params: unknown[] }[] = [];
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
          return { results: rows as T[] };
        },
        async first<T>() {
          return { cnt: rows.length } as T;
        },
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
    // +1 for the LIMIT that pickQuestionIds binds alongside the filter.
    assert.ok(
      params.length + 1 <= D1_MAX_BOUND_PARAMS,
      `widest filter needs ${params.length + 1} bound params, ceiling is ${D1_MAX_BOUND_PARAMS}`
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

  it("still de-prioritises excluded ids rather than dropping the clause", async () => {
    const { db, calls } = fakeD1([{ id: 7 }]);
    await pickQuestionIds(db, baseFilter, 10, [101, 102, 103]);
    assert.match(calls[0].sql, /CASE WHEN q\.id IN \(101,102,103\)/);
    assert.match(calls[0].sql, /ORDER BY/);
  });

  it("omits the ordering clause entirely when nothing is excluded", async () => {
    const { db, calls } = fakeD1([{ id: 7 }]);
    await pickQuestionIds(db, baseFilter, 10, []);
    assert.ok(!calls[0].sql.includes("CASE WHEN"));
    assert.match(calls[0].sql, /ORDER BY RANDOM\(\) LIMIT \?/);
  });
});

describe("exclude ids are never interpolated as caller-supplied text", () => {
  it("drops anything that is not a finite integer", async () => {
    const { db, calls } = fakeD1([{ id: 7 }]);
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
    ] as unknown as number[];
    await pickQuestionIds(db, baseFilter, 10, hostile);

    // Only the genuine integer survives.
    assert.match(calls[0].sql, /IN \(1\)/);
    assert.ok(!calls[0].sql.includes("DROP"));
    assert.ok(!calls[0].sql.includes("3.5"));
    assert.ok(!/NaN|Infinity|null|undefined|object/.test(calls[0].sql));
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
