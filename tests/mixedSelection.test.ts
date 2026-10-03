// "מעורב", and the scope funnel that used to run backwards.
//
// Both of these are rules about WHICH QUESTIONS ARE SERVED, so both are tested
// against the real SQL the engine builds rather than against a description of
// it. The fake D1 below parses the statement it is given — mode, categories,
// difficulty, and the scope EXISTS clauses — so a test that passes here passes
// because the query says what it should, not because a stub agreed with it.

import { describe, it } from "node:test";
import assert from "node:assert/strict";

import { buildWhere, type QuestionFilter } from "../src/worker/db/questions.ts";
import { selectMixed } from "../src/worker/engine/mixedSelection.ts";
import {
  MIXED_TYPE_KEYS,
  MIXED_TYPE_MAX_SHARE,
  QUESTION_TYPE_BY_KEY,
  QUESTION_TYPES,
} from "../src/shared/questionTypes.ts";
import { BUILDER_MIXED_MIX } from "../src/server/football/difficulty.ts";
import type { Category, Difficulty, GameMode } from "../src/shared/types.ts";

const FILTER: QuestionFilter = {
  region: "WORLD",
  countries: [],
  competitions: ["ALL"],
  categories: [],
  difficulty: "MIXED",
  gameMode: "CLASSIC",
  answerMode: "MULTIPLE_CHOICE",
};

// ---------------------------------------------------------------------------
describe("the scope funnel", () => {
  /*
    THE BUG THIS LOCKS DOWN, measured on production before the fix:

      Europe                    1,106
      Europe + Spain            1,143
      Europe + Spain + La Liga  1,144
      Spain alone                 511

    Every drill-down step made the pool bigger, because scope matching was one
    flat OR over every requested tag. A player who chose La Liga was served all
    of Europe.
  */
  it("ANDs across dimensions so each step narrows", () => {
    const { where } = buildWhere({
      ...FILTER,
      region: "EUROPE",
      countries: ["ESP"],
      competitions: ["LA_LIGA"],
    });
    const existsCount = (where.match(/EXISTS/g) ?? []).length;
    assert.equal(existsCount, 3, "one EXISTS per narrowed dimension, ANDed together");
    assert.ok(!/OR/.test(where), `a single OR here is the old broadening bug: ${where}`);
  });

  it("ORs within a dimension, so two countries widen that dimension only", () => {
    const { where, params } = buildWhere({ ...FILTER, countries: ["ESP", "ITA"] });
    assert.equal((where.match(/EXISTS/g) ?? []).length, 1);
    assert.match(where, /scope_value IN \(\?,\?\)/);
    assert.ok(params.includes("ESP") && params.includes("ITA"));
  });

  it("filters no scope at all for all-of-football", () => {
    const { where } = buildWhere(FILTER);
    assert.ok(!/question_scopes/.test(where), "an unnarrowed request must not read the scope table");
  });

  it("expands a competition group inside its own dimension", () => {
    const { where, params } = buildWhere({ ...FILTER, competitions: ["TOP_6_EUROPE"] });
    assert.equal((where.match(/EXISTS/g) ?? []).length, 1);
    assert.ok(params.includes("PREMIER_LEAGUE") && params.includes("LIGA_PORTUGAL"));
  });

  it("omits the mode predicate when the mode is ANY", () => {
    assert.match(buildWhere(FILTER).where, /q\.mode = \?/);
    assert.ok(
      !/q\.mode = \?/.test(buildWhere({ ...FILTER, gameMode: null }).where),
      "a mixed-type count spans modes and must not be pinned to one"
    );
  });
});

// ---------------------------------------------------------------------------
interface FakeQuestion {
  id: number;
  mode: GameMode;
  category: Category;
  difficulty: Difficulty;
}

const BANDS: Difficulty[] = ["EASY", "NORMAL", "HARD", "EXPERT", "IMPOSSIBLE"];

/**
 * A bank with `per` questions of every (type, band) combination.
 *
 * Deliberately uniform: the point of most of these tests is that the DRAW
 * decides the shape, so the bank must not. The skewed case gets its own bank.
 */
function uniformBank(per = 40): FakeQuestion[] {
  const rows: FakeQuestion[] = [];
  let id = 1;
  for (const spec of QUESTION_TYPES) {
    for (const band of BANDS) {
      for (let i = 0; i < per; i++) {
        rows.push({
          id: id++,
          mode: spec.mode,
          category: (spec.categories[0] ?? "PLAYERS") as Category,
          difficulty: band,
        });
      }
    }
  }
  return rows;
}

/**
 * A D1 fake that honours the statement it is handed.
 *
 * It reads the bound parameters back out of the SQL the engine built: the mode,
 * the category list, the difficulty. Anything the engine fails to put in the
 * query is therefore invisible here too, which is the only way this can catch a
 * filter that was never applied.
 */
function fakeD1(rows: FakeQuestion[]) {
  const seen: string[] = [];
  const run = (sql: string, params: unknown[]) => {
    seen.push(sql);
    const strings = params.filter((p): p is string => typeof p === "string");
    const mode = /q\.mode = \?/.test(sql) ? (strings[0] as GameMode) : null;
    const rest = mode ? strings.slice(1) : strings;
    const categories = (sql.match(/q\.category IN \((\?(,\?)*)\)/) ?? [])[1]
      ? rest.splice(0, (sql.match(/q\.category IN \((\?(,\?)*)\)/)![1].split(",").length))
      : [];
    const band = /q\.difficulty = \?/.test(sql) ? (rest.shift() as Difficulty) : null;
    const limit = Number(params[params.length - 1]);

    const matching = rows.filter(
      (r) =>
        (mode === null || r.mode === mode) &&
        (categories.length === 0 || categories.includes(r.category)) &&
        (band === null || r.difficulty === band)
    );
    return { results: matching.slice(0, limit).map((r) => ({ id: r.id, difficulty: r.difficulty })) };
  };

  const db = {
    prepare: (sql: string) => ({ bind: (...params: unknown[]) => ({ sql, params }) }),
    batch: async (statements: { sql: string; params: unknown[] }[]) =>
      statements.map((s) => run(s.sql, s.params)),
  };
  return { db: db as unknown as D1Database, seen, byId: new Map(rows.map((r) => [r.id, r])) };
}

const typeOf = (q: FakeQuestion): string => {
  const exact = QUESTION_TYPES.find(
    (t) => t.mode === q.mode && t.categories.includes(q.category)
  );
  return exact?.key ?? QUESTION_TYPES.find((t) => t.mode === q.mode)!.key;
};

// ---------------------------------------------------------------------------
describe("mixed difficulty", () => {
  /*
    Three twenty-question MIXED quizzes on production, before this existed:

      EXPERT 5, IMPOSSIBLE 13, EASY 2
      IMPOSSIBLE 14, EASY 2, EXPERT 3, HARD 1
      IMPOSSIBLE 15, EXPERT 4, EASY 1

    "MIXED" was "no difficulty clause", so the quiz inherited a bank that is 54%
    IMPOSSIBLE. 85-90% of it sat above HARD and NORMAL was usually absent.
  */
  it("is mostly playable rather than shaped like the bank", async () => {
    const { db } = fakeD1(uniformBank());
    const selection = await selectMixed(db, FILTER, 20, { mixedType: false });
    assert.equal(selection.ids.length, 20);
    const aboveHard = (selection.byBand.EXPERT ?? 0) + (selection.byBand.IMPOSSIBLE ?? 0);
    assert.ok(aboveHard <= 7, `${aboveHard}/20 above HARD — the old draw gave 17-19`);
    assert.ok((selection.byBand.NORMAL ?? 0) > 0, "NORMAL was missing from two of the three old runs");
  });

  it("hits the declared weights for a ten-question quiz", async () => {
    const { db } = fakeD1(uniformBank());
    const selection = await selectMixed(db, FILTER, 10, { mixedType: false });
    // 15/30/30/15/10 over ten questions, by largest remainder.
    assert.deepEqual(selection.byBand, { EASY: 2, NORMAL: 3, HARD: 3, EXPERT: 1, IMPOSSIBLE: 1 });
  });

  it("uses every band the mix names", async () => {
    const { db } = fakeD1(uniformBank());
    const selection = await selectMixed(db, FILTER, 20, { mixedType: false });
    for (const band of Object.keys(BUILDER_MIXED_MIX)) {
      assert.ok((selection.byBand[band] ?? 0) > 0, `${band} absent from a twenty-question mix`);
    }
  });

  it("asks for one band per query rather than hoping for a mix", async () => {
    const { db, seen } = fakeD1(uniformBank());
    await selectMixed(db, FILTER, 10, { mixedType: false });
    assert.ok(
      seen.every((sql) => /q\.difficulty = \?/.test(sql)),
      "a cell with no difficulty predicate is the original bug in miniature"
    );
  });
});

// ---------------------------------------------------------------------------
describe("mixed question type", () => {
  it("spans several types rather than one", async () => {
    const { db, byId } = fakeD1(uniformBank());
    const selection = await selectMixed(db, FILTER, 10, { mixedType: true });
    assert.equal(selection.ids.length, 10);
    const types = new Set(selection.ids.map((id) => typeOf(byId.get(id)!)));
    assert.ok(types.size >= 5, `only ${types.size} distinct type(s) in a mixed quiz`);
  });

  /*
    THE SPEC'S RULE, and the reason it needs enforcing rather than hoping.

    Transfers are 7,553 of the 14,946 active questions. Apportioning a mixed
    quiz by availability hands it seven transfer questions out of ten, which is
    the transfers quiz wearing a different label.
  */
  it("lets no single type dominate, even when it has far more questions", async () => {
    const skewed = [
      ...uniformBank(2),
      // Ten thousand transfer questions against a handful of everything else.
      ...Array.from({ length: 10_000 }, (_, i) => ({
        id: 500_000 + i,
        mode: "CLASSIC" as GameMode,
        category: "TRANSFERS" as Category,
        difficulty: BANDS[i % BANDS.length],
      })),
    ];
    const { db, byId } = fakeD1(skewed);
    const selection = await selectMixed(db, FILTER, 10, { mixedType: true });
    const transfers = selection.ids.filter((id) => byId.get(id)!.category === "TRANSFERS").length;
    assert.ok(
      transfers <= Math.ceil(10 * MIXED_TYPE_MAX_SHARE),
      `${transfers}/10 transfer questions — availability decided the mix`
    );
  });

  it("draws only from types declared mixed-eligible", async () => {
    const { db, byId } = fakeD1(uniformBank());
    const selection = await selectMixed(db, FILTER, 20, { mixedType: true });
    for (const id of selection.ids) {
      const key = typeOf(byId.get(id)!);
      assert.ok(MIXED_TYPE_KEYS.includes(key), `${key} is not in the mixed set`);
    }
  });

  it("mixes both axes at once when both are mixed", async () => {
    const { db, byId } = fakeD1(uniformBank());
    const selection = await selectMixed(db, FILTER, 20, { mixedType: true });
    const types = new Set(selection.ids.map((id) => typeOf(byId.get(id)!)));
    const bands = new Set(selection.ids.map((id) => byId.get(id)!.difficulty));
    assert.ok(types.size >= 6, `${types.size} type(s)`);
    assert.ok(bands.size >= 4, `${bands.size} band(s) — the grid must hold both marginals`);
    const aboveHard = (selection.byBand.EXPERT ?? 0) + (selection.byBand.IMPOSSIBLE ?? 0);
    assert.ok(aboveHard <= 8, `${aboveHard}/20 above HARD`);
  });

  it("applies the chosen type's real mode and categories", async () => {
    const { db, seen } = fakeD1(uniformBank());
    await selectMixed(db, { ...FILTER, difficulty: "HARD" }, 10, { mixedType: true });
    const whoAmI = QUESTION_TYPE_BY_KEY.get("WHO_AM_I")!;
    assert.ok(
      seen.some((sql) => /q\.mode = \?/.test(sql)),
      "every cell pins a mode"
    );
    assert.equal(whoAmI.mode, "WHO_AM_I");
  });

  it("returns no duplicates", async () => {
    const { db } = fakeD1(uniformBank());
    const selection = await selectMixed(db, FILTER, 20, { mixedType: true });
    assert.equal(new Set(selection.ids).size, selection.ids.length);
  });

  it("comes back short and says so rather than padding", async () => {
    // Four questions in the whole bank, all one type.
    const tiny: FakeQuestion[] = Array.from({ length: 4 }, (_, i) => ({
      id: i + 1,
      mode: "WHO_AM_I" as GameMode,
      category: "WHO_AM_I" as Category,
      difficulty: "HARD" as Difficulty,
    }));
    const { db } = fakeD1(tiny);
    const selection = await selectMixed(db, FILTER, 10, { mixedType: true });
    assert.ok(selection.ids.length <= 4);
    assert.equal(selection.short, true);
    assert.equal(new Set(selection.ids).size, selection.ids.length);
  });
});
