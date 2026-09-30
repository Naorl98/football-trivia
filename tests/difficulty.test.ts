import { describe, it } from "node:test";
import assert from "node:assert/strict";

import {
  ARCHETYPE_WEIGHT,
  BAND_ORDER,
  difficultyFor,
  difficultyScore,
  eraWeight,
  type Archetype,
  type Band,
} from "../seed/generators/difficulty.ts";
import { answerRank, numericDistractors } from "../seed/generators/numericOptions.ts";
import { generateAll } from "../seed/generators/index.ts";
import { seedQuestions } from "../seed/questions.ts";

// Generated once — generateAll() walks the whole dataset.
const generated = generateAll();

/** The archetype a question came from, recovered from its semantic key. */
function archetypeOf(semanticKey: string): string {
  return semanticKey.split(":")[0];
}

function countBy<T>(items: T[], key: (item: T) => string): Record<string, number> {
  const counts: Record<string, number> = {};
  for (const item of items) counts[key(item)] = (counts[key(item)] ?? 0) + 1;
  return counts;
}

describe("difficulty scoring", () => {
  it("is monotonic in fame", () => {
    const score = (fame: 0 | 1 | 2) => difficultyScore({ archetype: "first_club", fame });
    assert.ok(score(0) < score(1), "a better-known subject must not score harder");
    assert.ok(score(1) < score(2));
  });

  it("is monotonic in distractor closeness", () => {
    const score = (distractors: "far" | "mixed" | "near") =>
      difficultyScore({ archetype: "first_club", distractors });
    assert.ok(score("far") < score("mixed"));
    assert.ok(score("mixed") < score("near"));
  });

  it("never scores an older fact easier than a newer one", () => {
    const years = [2024, 2019, 2015, 2008, 1999, 1994, 1988, 1970, 1955];
    for (let i = 1; i < years.length; i++) {
      assert.ok(
        eraWeight(years[i]) >= eraWeight(years[i - 1]),
        `${years[i]} should not be easier than ${years[i - 1]}`
      );
    }
  });

  it("orders the archetypes as intended, with founding years hardest", () => {
    const entries = Object.entries(ARCHETYPE_WEIGHT) as [Archetype, number][];
    const hardest = entries.reduce((a, b) => (b[1] > a[1] ? b : a));
    assert.equal(hardest[0], "founded_year");
    // "Which country is this club from?" must stay the floor of the model.
    assert.equal(ARCHETYPE_WEIGHT.club_country, Math.min(...entries.map(([, w]) => w)));
  });

  it("puts a household name with unrelated distractors in the easiest band", () => {
    assert.equal(difficultyFor({ archetype: "nationality", fame: 0, distractors: "far" }), "EASY");
  });

  it("puts an obscure subject, an exact number and tight distractors in the hardest band", () => {
    assert.equal(difficultyFor({ archetype: "founded_year", fame: 2, distractors: "near" }), "IMPOSSIBLE");
  });
});

describe("the generated bank's difficulty ladder", () => {
  const byBand = countBy(generated, (q) => q.difficulty);

  it("fills every band", () => {
    for (const band of BAND_ORDER) {
      assert.ok((byBand[band] ?? 0) > 0, `${band} is empty`);
    }
  });

  // The regression this guards: the first pass produced 0 EASY questions from
  // every player generator, because the fame ladder started at NORMAL.
  it("keeps enough in each band to fill the longest quiz", () => {
    const LONGEST_QUIZ = 50;
    for (const band of BAND_ORDER) {
      assert.ok(
        (byBand[band] ?? 0) >= LONGEST_QUIZ,
        `${band} has only ${byBand[band] ?? 0} questions, fewer than a ${LONGEST_QUIZ}-question quiz needs`
      );
    }
  });

  it("is not top-heavy", () => {
    const total = generated.length;
    const lower = (byBand.EASY ?? 0) + (byBand.NORMAL ?? 0);
    assert.ok(
      lower / total >= 0.35,
      `only ${((lower / total) * 100).toFixed(0)}% of the bank is EASY or NORMAL`
    );
  });

  it("tapers towards the top", () => {
    assert.ok(
      (byBand.IMPOSSIBLE ?? 0) < (byBand.EXPERT ?? 0),
      "IMPOSSIBLE should be rarer than EXPERT"
    );
    assert.ok((byBand.EXPERT ?? 0) < (byBand.HARD ?? 0), "EXPERT should be rarer than HARD");
    const smallest = BAND_ORDER.reduce((a, b) => ((byBand[b] ?? 0) < (byBand[a] ?? 0) ? b : a));
    assert.equal(smallest, "IMPOSSIBLE");
  });

  // The regression this guards: every one of the 159 club founding-year
  // questions used to be IMPOSSIBLE, which made that band 59% one archetype —
  // so picking "בלתי אפשרי" meant playing a founding-year quiz.
  it("never lets one archetype dominate a band", () => {
    for (const band of BAND_ORDER) {
      const inBand = generated.filter((q) => q.difficulty === band);
      const byArchetype = countBy(inBand, (q) => archetypeOf(q.semanticKey));
      const [topArchetype, topCount] = Object.entries(byArchetype).sort((a, b) => b[1] - a[1])[0];
      const share = topCount / inBand.length;
      assert.ok(
        share <= 0.5,
        `${band} is ${(share * 100).toFixed(0)}% "${topArchetype}" — bands must stay varied`
      );
      assert.ok(
        Object.keys(byArchetype).length >= 5,
        `${band} draws on only ${Object.keys(byArchetype).length} archetypes`
      );
    }
  });

  it("spreads the hardest archetype across more than one band", () => {
    const founded = generated.filter((q) => archetypeOf(q.semanticKey) === "founded");
    const bands = new Set(founded.map((q) => q.difficulty));
    assert.ok(founded.length > 0, "expected founding-year questions to exist");
    assert.ok(bands.size >= 3, `founding years land in only ${bands.size} band(s)`);
  });

  it("still offers enough free-text questions at every level", () => {
    // Free-text quizzes can only use questions with a single canonical answer,
    // so this pool is much smaller than the band as a whole.
    const freeText = generated.filter((q) => q.freeText && q.canonicalAnswer);
    const byBandFreeText = countBy(freeText, (q) => q.difficulty);
    for (const band of BAND_ORDER) {
      assert.ok(
        (byBandFreeText[band] ?? 0) >= 50,
        `${band} has only ${byBandFreeText[band] ?? 0} free-text questions`
      );
    }
  });
});

describe("numeric answer options", () => {
  it("is deterministic", () => {
    const spec = { correct: 1892, offsets: [3, 5, 7, 9, 13], seedKey: "founded:liverpool" };
    assert.deepEqual(numericDistractors(spec), numericDistractors(spec));
  });

  it("returns three distinct values, none of them the answer", () => {
    for (const correct of [1, 2, 3, 7, 12, 1865, 1920, 2001]) {
      const distractors = numericDistractors({
        correct,
        offsets: [1, 2, 3, 4],
        min: 1,
        seedKey: `case:${correct}`,
      });
      assert.equal(distractors.length, 3, `correct=${correct}`);
      assert.equal(new Set(distractors).size, 3, `correct=${correct} has duplicates`);
      assert.ok(!distractors.includes(correct), `correct=${correct} appears as a distractor`);
      assert.ok(distractors.every((v) => v >= 1), `correct=${correct} produced a value below min`);
    }
  });

  // The regression this guards: options used to be built as
  // [n, n+1, n-1, n+2] and [n, n+7, n-5, n+13]. Both put exactly one distractor
  // below the answer, so the answer was ALWAYS the second-smallest of the four
  // and could be picked correctly with no football knowledge at all.
  it("does not make the answer's rank a giveaway", () => {
    const ranks = new Map<number, number>();
    for (let i = 0; i < 400; i++) {
      const correct = 1870 + (i % 130);
      const distractors = numericDistractors({
        correct,
        offsets: [3, 5, 7, 9, 13],
        seedKey: `spread:${i}`,
      });
      const rank = answerRank(correct, distractors);
      ranks.set(rank, (ranks.get(rank) ?? 0) + 1);
    }
    assert.equal(ranks.size, 4, `the answer only ever ranked ${[...ranks.keys()].join(", ")}`);
    for (const [rank, count] of ranks) {
      assert.ok(count / 400 > 0.12, `rank ${rank} occurs in only ${((count / 400) * 100).toFixed(0)}% of cases`);
    }
  });

  it("keeps the real bank's numeric questions free of a rank tell", () => {
    const numeric = generated.filter((q) => q.options.every((o) => /^\d+$/.test(o)));
    assert.ok(numeric.length > 50, `expected plenty of numeric questions, found ${numeric.length}`);

    const ranks = new Map<number, number>();
    for (const q of numeric) {
      const values = q.options.map(Number);
      const correct = values[q.correctIndex];
      const rank = answerRank(
        correct,
        values.filter((_, i) => i !== q.correctIndex)
      );
      ranks.set(rank, (ranks.get(rank) ?? 0) + 1);
    }
    assert.equal(
      ranks.size,
      4,
      `across ${numeric.length} numeric questions the answer only ranked ${[...ranks.keys()].sort().join(", ")}`
    );
    // No single rank may hold more than half of them.
    for (const [rank, count] of ranks) {
      assert.ok(
        count / numeric.length <= 0.5,
        `${((count / numeric.length) * 100).toFixed(0)}% of numeric answers sit at rank ${rank}`
      );
    }
  });
});

describe("the bank as a whole", () => {
  it("labels every curated and generated question with a known band", () => {
    const valid = new Set<Band>(BAND_ORDER);
    for (const q of generated) {
      assert.ok(valid.has(q.difficulty as Band), `generated ${q.semanticKey}: ${q.difficulty}`);
    }
    for (const [i, q] of seedQuestions.entries()) {
      assert.ok(valid.has(q.difficulty as Band), `curated #${i}: ${q.difficulty}`);
    }
  });

  it("gives every generated question exactly four distinct options", () => {
    for (const q of generated) {
      assert.equal(q.options.length, 4, q.semanticKey);
      assert.equal(new Set(q.options).size, 4, `${q.semanticKey} has duplicate options`);
      assert.ok(q.correctIndex >= 0 && q.correctIndex < 4, q.semanticKey);
    }
  });
});
