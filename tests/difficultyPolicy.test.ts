// Quick Start and the Daily Challenge.
//
// These are product rules about WHICH QUESTIONS ARE SERVED, so they are enforced
// in the question selection and tested there. "The UI does not offer Expert
// questions on the home page" is not a constraint — the quiz endpoint is public
// and unauthenticated, and a client can send whatever it likes.
//
// The fake D1 below is deliberately thin but not a stub of the thing under test:
// it runs the REAL buildWhere output, so the SQL these tests exercise is the SQL
// production runs, and it honours the bound difficulty and the quick-start
// predicate. What it fakes is the storage, not the query.

import { describe, it } from "node:test";
import assert from "node:assert/strict";

import {
  selectDailyChallenge,
  selectQuickStart,
} from "../src/worker/engine/difficultyPolicy.ts";
import {
  apportion,
  isQuickStartFriendly,
  QUICK_START_BANDS,
  QUICK_START_MIX,
  DAILY_ABOVE_HARD_MAX,
  DAILY_ABOVE_HARD_MIN,
} from "../src/server/football/difficulty.ts";
import type { QuestionFilter } from "../src/worker/db/questions.ts";
import type { Difficulty } from "../src/shared/types.ts";

const BANDS: Difficulty[] = ["EASY", "NORMAL", "HARD", "EXPERT", "IMPOSSIBLE"];

interface FakeRow {
  id: number;
  difficulty: Difficulty;
  quickSafe: boolean;
}

/** A bank with `per` questions in each band; half the HARD ones are unfriendly. */
function bank(per: Record<string, number>, hardSafeShare = 0.5): FakeRow[] {
  const rows: FakeRow[] = [];
  let id = 1;
  for (const band of BANDS) {
    const count = per[band] ?? 0;
    for (let i = 0; i < count; i++) {
      rows.push({
        id: id++,
        difficulty: band,
        quickSafe: band !== "HARD" ? true : i < Math.floor(count * hardSafeShare),
      });
    }
  }
  return rows;
}

function fakeD1(rows: FakeRow[]) {
  const seen: { sql: string; params: unknown[] }[] = [];
  const db = {
    prepare: (sql: string) => ({
      bind: (...params: unknown[]) => ({ sql, params }),
    }),
    batch: async (statements: { sql: string; params: unknown[] }[]) => {
      const out = [];
      for (const statement of statements) {
        seen.push(statement);
        const band = statement.params.find(
          (p): p is Difficulty => typeof p === "string" && BANDS.includes(p as Difficulty)
        );
        const needsSafe = /quick_start_safe = 1/.test(statement.sql);
        const limit = Number(statement.params[statement.params.length - 1]);
        const matching = rows.filter(
          (r) => r.difficulty === band && (!needsSafe || r.quickSafe)
        );
        out.push({ results: matching.slice(0, limit).map((r) => ({ id: r.id, difficulty: r.difficulty })) });
      }
      return out;
    },
    // The availability count is not part of selection and is never reached here.
    prepareCount: () => {
      throw new Error("not used");
    },
  };
  return { db: db as unknown as D1Database, seen, byId: new Map(rows.map((r) => [r.id, r])) };
}

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
describe("apportionment", () => {
  it("turns the Quick Start mix into exactly 2/4/4 for ten questions", () => {
    const quota = apportion(10, QUICK_START_MIX, { EASY: 100, NORMAL: 100, HARD: 100 });
    assert.deepEqual(quota, { EASY: 2, NORMAL: 4, HARD: 4 });
  });

  it("always sums to the requested total when the pool allows", () => {
    for (const total of [5, 10, 15, 20]) {
      const quota = apportion(total, QUICK_START_MIX, { EASY: 100, NORMAL: 100, HARD: 100 });
      const sum = Object.values(quota).reduce((a, b) => a + b, 0);
      assert.equal(sum, total, `total ${total} apportioned to ${JSON.stringify(quota)}`);
    }
  });

  it("never asks a band for more than it has", () => {
    const quota = apportion(10, QUICK_START_MIX, { EASY: 1, NORMAL: 2, HARD: 100 });
    assert.ok(quota.EASY <= 1);
    assert.ok(quota.NORMAL <= 2);
    assert.equal(Object.values(quota).reduce((a, b) => a + b, 0), 10, "the shortfall moves to HARD");
  });

  it("drops a band that is empty rather than returning a zero quota for it", () => {
    const quota = apportion(10, QUICK_START_MIX, { EASY: 0, NORMAL: 50, HARD: 50 });
    assert.equal(quota.EASY, undefined);
    assert.equal(quota.NORMAL + quota.HARD, 10);
  });
});

// ---------------------------------------------------------------------------
describe("the Quick Start familiarity guard", () => {
  it("lets EASY and NORMAL through unconditionally", () => {
    assert.equal(isQuickStartFriendly({ band: "EASY", subjectFame: 2.9 }), true);
    assert.equal(isQuickStartFriendly({ band: "NORMAL", subjectFame: 2.9 }), true);
  });

  it("never lets EXPERT or IMPOSSIBLE through", () => {
    assert.equal(isQuickStartFriendly({ band: "EXPERT", subjectFame: 0 }), false);
    assert.equal(isQuickStartFriendly({ band: "IMPOSSIBLE", subjectFame: 0 }), false);
  });

  /*
    "HARD BUT RECOGNISABLE" IS THE BAR.

    "לאיזו קבוצה עבר C. Dagba מ-Auxerre בשנת 2024?" is answerable, verifiable,
    and nobody who tapped "כל העולם" on the home page wants to meet it.
  */
  it("excludes a HARD question about somebody nobody has heard of", () => {
    assert.equal(isQuickStartFriendly({ band: "HARD", subjectFame: 2.6 }), false);
  });

  it("keeps a HARD question about a recognisable player", () => {
    assert.equal(
      isQuickStartFriendly({ band: "HARD", subjectFame: 0.8, entityProminence: 0.9, tier: "CORE" }),
      true
    );
  });

  it("excludes a HARD question whose least-known entity is obscure", () => {
    assert.equal(isQuickStartFriendly({ band: "HARD", subjectFame: 0, entityProminence: 2.5 }), false);
  });

  it("excludes a HARD question from a non-core competition", () => {
    assert.equal(isQuickStartFriendly({ band: "HARD", subjectFame: 0.8, tier: "NON_CORE" }), false);
  });
});

// ---------------------------------------------------------------------------
describe("Quick Start selection", () => {
  it("never returns an EXPERT or IMPOSSIBLE question", async () => {
    const rows = bank({ EASY: 50, NORMAL: 50, HARD: 50, EXPERT: 500, IMPOSSIBLE: 500 });
    const { db, byId } = fakeD1(rows);
    for (let run = 0; run < 25; run++) {
      const selection = await selectQuickStart(db, FILTER, 10);
      assert.equal(selection.ids.length, 10, "a full quiz");
      for (const id of selection.ids) {
        const band = byId.get(id)!.difficulty;
        assert.ok(QUICK_START_BANDS.includes(band), `${band} must never reach Quick Start`);
      }
    }
  });

  it("only queries the three accessible bands", async () => {
    const { db, seen } = fakeD1(bank({ EASY: 50, NORMAL: 50, HARD: 50, EXPERT: 50, IMPOSSIBLE: 50 }));
    await selectQuickStart(db, FILTER, 10);
    const queried = new Set(
      seen.flatMap((s) => s.params.filter((p): p is Difficulty => BANDS.includes(p as Difficulty)))
    );
    assert.deepEqual([...queried].sort(), ["EASY", "HARD", "NORMAL"]);
  });

  it("applies the familiarity guard in SQL, not after the fact", async () => {
    const { db, seen } = fakeD1(bank({ EASY: 50, NORMAL: 50, HARD: 50 }));
    await selectQuickStart(db, FILTER, 10);
    assert.ok(
      seen.every((s) => /quick_start_safe = 1/.test(s.sql)),
      "every Quick Start query must carry the guard"
    );
  });

  it("only serves HARD questions that pass the guard", async () => {
    // 20 HARD questions, 10 of them friendly.
    const rows = bank({ EASY: 50, NORMAL: 50, HARD: 20 }, 0.5);
    const { db, byId } = fakeD1(rows);
    const selection = await selectQuickStart(db, FILTER, 10);
    for (const id of selection.ids) {
      const row = byId.get(id)!;
      if (row.difficulty === "HARD") assert.equal(row.quickSafe, true);
    }
  });

  it("mixes the bands rather than filling up from one", async () => {
    const { db } = fakeD1(bank({ EASY: 50, NORMAL: 50, HARD: 50 }));
    const selection = await selectQuickStart(db, FILTER, 10);
    assert.deepEqual(selection.byBand, { EASY: 2, NORMAL: 4, HARD: 4 });
  });

  /*
    THE FALLBACK RULE, stated as the spec states it: never silently inject
    Expert or Impossible to reach the requested count. A short quiz is correct;
    a padded one is a lie.
  */
  it("comes back short rather than reaching into a harder band", async () => {
    const rows = bank({ EASY: 2, NORMAL: 2, HARD: 1, EXPERT: 500, IMPOSSIBLE: 500 });
    const { db, byId } = fakeD1(rows);
    const selection = await selectQuickStart(db, FILTER, 10);
    assert.ok(selection.ids.length < 10, "the pool cannot fill ten");
    assert.equal(selection.short, true, "and it says so");
    for (const id of selection.ids) {
      assert.ok(QUICK_START_BANDS.includes(byId.get(id)!.difficulty));
    }
  });

  it("rebalances within the allowed bands when one is thin", async () => {
    const { db, byId } = fakeD1(bank({ EASY: 1, NORMAL: 50, HARD: 50 }));
    const selection = await selectQuickStart(db, FILTER, 10);
    assert.equal(selection.ids.length, 10);
    const easy = selection.ids.filter((id) => byId.get(id)!.difficulty === "EASY").length;
    assert.ok(easy <= 1, "it cannot invent a second EASY question");
  });

  it("returns no duplicates", async () => {
    const { db } = fakeD1(bank({ EASY: 50, NORMAL: 50, HARD: 50 }));
    const selection = await selectQuickStart(db, FILTER, 20);
    assert.equal(new Set(selection.ids).size, selection.ids.length);
  });
});

// ---------------------------------------------------------------------------
describe("the Daily Challenge", () => {
  const full = () => bank({ EASY: 50, NORMAL: 50, HARD: 50, EXPERT: 50, IMPOSSIBLE: 50 });

  it("contains one or two questions above HARD, and no more", async () => {
    for (const seed of ["2026-10-01", "2026-10-02", "2026-10-03", "2026-10-04", "2026-10-05"]) {
      const { db, byId } = fakeD1(full());
      const selection = await selectDailyChallenge(db, FILTER, 10, seed);
      const aboveHard = selection.ids.filter((id) =>
        ["EXPERT", "IMPOSSIBLE"].includes(byId.get(id)!.difficulty)
      ).length;
      assert.ok(
        aboveHard >= DAILY_ABOVE_HARD_MIN && aboveHard <= DAILY_ABOVE_HARD_MAX,
        `${seed}: ${aboveHard} above-HARD questions`
      );
    }
  });

  it("is mostly playable", async () => {
    const { db, byId } = fakeD1(full());
    const selection = await selectDailyChallenge(db, FILTER, 10, "2026-10-03");
    const playable = selection.ids.filter((id) =>
      ["EASY", "NORMAL", "HARD"].includes(byId.get(id)!.difficulty)
    ).length;
    assert.ok(playable >= 8, `only ${playable} of 10 questions are EASY/NORMAL/HARD`);
  });

  it("puts the hardest questions last", async () => {
    const { db, byId } = fakeD1(full());
    const selection = await selectDailyChallenge(db, FILTER, 10, "2026-10-03");
    const bandsInOrder = selection.ids.map((id) => byId.get(id)!.difficulty);
    const lastTwo = bandsInOrder.slice(-2);
    assert.ok(
      lastTwo.some((b) => b === "EXPERT" || b === "IMPOSSIBLE"),
      `the boss question must be at the end, got ${bandsInOrder.join(" → ")}`
    );
    // And nothing above HARD may appear before the closing stretch.
    const firstAboveHard = bandsInOrder.findIndex((b) => b === "EXPERT" || b === "IMPOSSIBLE");
    assert.ok(firstAboveHard >= 7, `an above-HARD question appeared at position ${firstAboveHard + 1}`);
  });

  it("builds in difficulty overall", async () => {
    const { db, byId } = fakeD1(full());
    const selection = await selectDailyChallenge(db, FILTER, 10, "2026-10-03");
    const rank = (b: Difficulty) => BANDS.indexOf(b);
    const bandsInOrder = selection.ids.map((id) => rank(byId.get(id)!.difficulty));
    const firstHalf = bandsInOrder.slice(0, 5).reduce((a, b) => a + b, 0) / 5;
    const secondHalf = bandsInOrder.slice(5).reduce((a, b) => a + b, 0) / 5;
    assert.ok(secondHalf > firstHalf, `second half (${secondHalf}) must be harder than the first (${firstHalf})`);
  });

  it("is deterministic for a given date", async () => {
    const a = await selectDailyChallenge(fakeD1(full()).db, FILTER, 10, "2026-10-03");
    const b = await selectDailyChallenge(fakeD1(full()).db, FILTER, 10, "2026-10-03");
    assert.deepEqual(a.ids, b.ids, "two people comparing scores must have answered the same quiz");
  });

  it("differs from one day to the next", async () => {
    const a = await selectDailyChallenge(fakeD1(full()).db, FILTER, 10, "2026-10-03");
    const b = await selectDailyChallenge(fakeD1(full()).db, FILTER, 10, "2026-10-04");
    assert.notDeepEqual(a.ids, b.ids);
  });

  /*
    THE FALLBACK: no suitable Expert question means another strong HARD, not a
    bad Expert. Quality beats a rigid ratio.
  */
  it("falls back to HARD when nothing above it exists", async () => {
    const { db, byId } = fakeD1(bank({ EASY: 20, NORMAL: 20, HARD: 20 }));
    const selection = await selectDailyChallenge(db, FILTER, 10, "2026-10-03");
    assert.equal(selection.ids.length, 10, "the challenge is still a full ten");
    assert.equal(selection.aboveHard, 0);
    for (const id of selection.ids) {
      assert.ok(["EASY", "NORMAL", "HARD"].includes(byId.get(id)!.difficulty));
    }
  });

  it("prefers EXPERT over IMPOSSIBLE for the boss question", async () => {
    const { db, byId } = fakeD1(bank({ EASY: 20, NORMAL: 20, HARD: 20, EXPERT: 20, IMPOSSIBLE: 20 }));
    const selection = await selectDailyChallenge(db, FILTER, 10, "2026-10-03");
    const above = selection.ids
      .map((id) => byId.get(id)!.difficulty)
      .filter((b) => b === "EXPERT" || b === "IMPOSSIBLE");
    assert.ok(above.length > 0);
    assert.ok(
      above.every((b) => b === "EXPERT"),
      "an Expert question is hard for the right reasons; Impossible is a last resort"
    );
  });

  it("applies no familiarity guard — the Daily Challenge is allowed to be obscure", async () => {
    const { db, seen } = fakeD1(full());
    await selectDailyChallenge(db, FILTER, 10, "2026-10-03");
    assert.ok(
      seen.every((s) => !/quick_start_safe/.test(s.sql)),
      "the guard belongs to Quick Start only"
    );
  });

  it("returns no duplicates", async () => {
    const { db } = fakeD1(full());
    const selection = await selectDailyChallenge(db, FILTER, 10, "2026-10-03");
    assert.equal(new Set(selection.ids).size, selection.ids.length);
  });
});
