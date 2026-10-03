// The game-creation wizard.
//
// WHAT THESE TESTS ARE FOR
//
// "Verify the query, not just the UI." A wizard that looks right and builds the
// wrong quiz query is worse than a crowded one that builds the right query —
// the player gets questions they did not ask for and has no way to tell. So the
// state machine and the mapping to QuizConfiguration live outside React
// (src/client/lib/builderWizard.ts) and are asserted here, flow by flow, in the
// same five flows the Playwright pass drives through the real UI.
//
// The second pass added a question-type step, a competition branch, thirty
// countries and real "מעורב" options, so the flows below are the new ones. The
// two assertions that survived unchanged are the ones that matter most: every
// configuration the wizard can produce must pass the server's own parser, and
// nothing it offers may name a competition, country or league the bank does not
// have.

import { describe, it } from "node:test";
import { readFileSync } from "node:fs";
import assert from "node:assert/strict";

import {
  canAdvance,
  countriesIn,
  dimensionFor,
  INITIAL_STATE,
  leagueOf,
  orientationOf,
  PRESETS,
  PRESET_BY_KEY,
  SCOPE_COMPETITIONS,
  stepsFor,
  SUPPORTED_CONTINENTS,
  summaryOf,
  toConfiguration,
  type StepId,
  type WizardState,
} from "../src/client/lib/builderWizard.ts";
import { parseQuizConfiguration } from "../src/worker/lib/validate.ts";
import {
  COMPETITIONS,
  COUNTRIES,
  DIFFICULTY_LABELS,
  QUESTION_COUNTS,
  WIZARD_QUESTION_COUNTS,
} from "../src/shared/constants.ts";
import { MIXED_TYPE_KEY, QUESTION_TYPES, QUESTION_TYPE_BY_KEY } from "../src/shared/questionTypes.ts";

const LABELS = {
  answerMode: { FREE_TEXT: "תשובה חופשית", MULTIPLE_CHOICE: "אמריקאי" } as const,
  difficulty: DIFFICULTY_LABELS as Record<string, string>,
  competition: (code: string) => COMPETITIONS.find((c) => c.code === code)?.nameHe ?? code,
  country: (code: string) => COUNTRIES.find((c) => c.code === code)?.nameHe ?? code,
};

const state = (over: Partial<WizardState> = {}): WizardState => ({ ...INITIAL_STATE, ...over });

/** Applies a sequence of answers the way a player does. */
function walk(steps: Partial<WizardState>[]): WizardState {
  let current = state();
  for (const patch of steps) current = { ...current, ...patch };
  return current;
}

// ---------------------------------------------------------------------------
describe("the step sequence", () => {
  it("is five steps for the worldwide path", () => {
    assert.deepEqual(stepsFor(state({ scope: "WORLD" })), [
      "type",
      "mode",
      "settings",
      "scope",
      "summary",
    ]);
  });

  it("drills down one level at a time, never three lists at once", () => {
    const europe = state({ scope: "REGION", continent: "EUROPE" });
    assert.deepEqual(stepsFor(europe), ["type", "mode", "settings", "scope", "continent", "country", "summary"]);
    const spain = { ...europe, country: "ESP" };
    assert.deepEqual(stepsFor(spain), [
      "type",
      "mode",
      "settings",
      "scope",
      "continent",
      "country",
      "league",
      "summary",
    ]);
  });

  it("skips the country step until a continent is chosen", () => {
    const steps = stepsFor(state({ scope: "REGION" }));
    assert.ok(steps.includes("continent"));
    assert.ok(!steps.includes("country"), "nothing to list without a continent");
  });

  it("skips the league step for a country the bank has no league for", () => {
    // Brazil's clubs are in the bank; its domestic league is not a filter.
    assert.equal(leagueOf("BRA"), null);
    const steps = stepsFor(state({ scope: "REGION", continent: "SOUTH_AMERICA", country: "BRA" }));
    assert.ok(!steps.includes("league"));
  });

  it("gives a competition scope one step and no drill-down", () => {
    const steps = stepsFor(state({ scope: "COMPETITION" }));
    assert.deepEqual(steps, ["type", "mode", "settings", "scope", "competition", "summary"]);
    assert.ok(!steps.includes("country") && !steps.includes("continent"));
  });

  it("gives a preset one step and no drill-down", () => {
    const steps = stepsFor(state({ scope: "PRESET" }));
    assert.deepEqual(steps, ["type", "mode", "settings", "scope", "preset", "summary"]);
  });

  it("is eight steps at most", () => {
    const longest = Math.max(
      ...SUPPORTED_CONTINENTS.flatMap((continent) =>
        countriesIn(continent.code).map(
          (country) =>
            stepsFor(state({ scope: "REGION", continent: continent.code, country: country.code })).length
        )
      )
    );
    assert.equal(longest, 8, "continent, country and league are the deepest the wizard goes");
  });

  it("will not advance past a branch step with nothing chosen", () => {
    assert.equal(canAdvance(state({ scope: "PRESET" }), "preset"), false);
    assert.equal(canAdvance(state({ scope: "PRESET", preset: "ucl" }), "preset"), true);
    assert.equal(canAdvance(state({ scope: "COMPETITION" }), "competition"), false);
    assert.equal(canAdvance(state({ scope: "COMPETITION", competition: "UCL" }), "competition"), true);
    assert.equal(canAdvance(state({ scope: "REGION" }), "continent"), false);
  });

  it("accepts a continent alone, and 'all of the continent' as a country answer", () => {
    assert.equal(canAdvance(state({ scope: "REGION", continent: "EUROPE" }), "continent"), true);
    // A null country means "כל היבשת", which is an answer rather than a gap.
    assert.equal(canAdvance(state({ scope: "REGION", continent: "EUROPE" }), "country"), true);
  });

  it("advances from the always-answered steps unconditionally", () => {
    for (const step of ["type", "mode", "settings", "scope", "summary"] as StepId[]) {
      assert.equal(canAdvance(state(), step), true, step);
    }
  });

  it("asks for counts only on the steps that show options", () => {
    assert.deepEqual(dimensionFor("type"), ["types"]);
    assert.deepEqual(dimensionFor("continent"), ["continents"]);
    assert.deepEqual(dimensionFor("country"), ["countries"]);
    assert.deepEqual(dimensionFor("league"), ["countries", "competitions"]);
    assert.deepEqual(dimensionFor("competition"), ["competitions"]);
    assert.deepEqual(dimensionFor("preset"), ["presets"]);
    // The answer mode has two cards and no counts; the summary has its own.
    assert.deepEqual(dimensionFor("mode"), []);
    assert.deepEqual(dimensionFor("summary"), []);
  });
});

// ---------------------------------------------------------------------------
describe("every step offers enough to be worth a screen", () => {
  /*
    THE EMPTINESS THESE NUMBERS EXIST TO PREVENT. The first wizard's steps
    offered 2, 6, 2 and 2 options. A step with two cards on a 390x844 phone is
    seventy per cent empty space, and the fix is more real choices rather than
    bigger cards — so the floor is asserted, per step, and a regression that
    quietly drops options fails here rather than in a screenshot.
  */
  it("offers a dozen question types plus mixed", () => {
    assert.ok(QUESTION_TYPES.length >= 12, `${QUESTION_TYPES.length} question types`);
    assert.ok(QUESTION_TYPES.filter((t) => t.inMixed).length >= 10, "mixed needs something to mix");
  });

  it("offers four scope branches, not two", () => {
    // WORLD, REGION, COMPETITION, PRESET — asserted through the step machine so
    // a branch that exists but is unreachable still fails.
    const branches = (["WORLD", "REGION", "COMPETITION", "PRESET"] as const).map((scope) =>
      stepsFor(state({ scope }))
    );
    assert.equal(new Set(branches.map((b) => b.join(">"))).size, 4);
  });

  it("offers six continents, which is a grid rather than a short list", () => {
    assert.equal(SUPPORTED_CONTINENTS.length, 6);
  });

  it("offers twenty-one European countries, not seven", () => {
    assert.ok(countriesIn("EUROPE").length >= 20, `${countriesIn("EUROPE").length} European countries`);
    assert.ok(COUNTRIES.length >= 30, `${COUNTRIES.length} countries in total`);
  });

  it("offers ten presets with a subtitle and an icon each", () => {
    assert.ok(PRESETS.length >= 10, `${PRESETS.length} presets`);
    for (const preset of PRESETS) {
      assert.ok(preset.noteHe.length > 0, `${preset.key} has no subtitle`);
      assert.ok(preset.icon.length > 0, `${preset.key} has no icon`);
    }
  });

  it("gives every question type a one-line note and an icon", () => {
    for (const type of QUESTION_TYPES) {
      assert.ok(type.noteHe.length > 0 && type.noteHe.length < 40, `${type.key}: ${type.noteHe}`);
      assert.ok(type.icon.length > 0, `${type.key} has no icon`);
    }
  });
});

// ---------------------------------------------------------------------------
describe("choices only ever narrow to something that exists", () => {
  it("offers every continent, and the empty ones are disabled rather than hidden", () => {
    /*
      DISABLE, DO NOT DISAPPEAR. Africa and Oceania have no countries in the
      bank. Dropping them left the step with four cards and 200px of empty
      screen; offering them with a real zero fills the grid with a true
      statement — the continent is known, it has nothing in it yet — and the
      card lights up on its own the day African questions are harvested.
    */
    assert.equal(SUPPORTED_CONTINENTS.length, 6);
    for (const code of ["AFRICA", "OCEANIA"] as const) {
      assert.ok(SUPPORTED_CONTINENTS.some((c) => c.code === code), `${code} must still be offered`);
      assert.equal(countriesIn(code).length, 0, `${code} is expected to be empty for now`);
    }
    // Four of the six have real content behind them.
    assert.equal(SUPPORTED_CONTINENTS.filter((c) => countriesIn(c.code).length > 0).length, 4);
  });

  it("the worker counts exactly the continents the wizard offers", () => {
    /*
      The availability query carries its own copy of this list so the worker
      does not import a client module. A continent offered but not counted comes
      back as an unknown count, which the builder treats as "do not disable" —
      so the card would be selectable and produce an empty quiz. Cheaper to
      assert the two lists match than to share the module.
    */
    const source = readFileSync("src/worker/db/availability.ts", "utf8");
    const block = source.match(/const BUILDER_CONTINENTS = \[([^\]]*)\]/)?.[1] ?? "";
    const counted = [...block.matchAll(/"([A-Z_]+)"/g)].map((m) => m[1]).sort();
    assert.deepEqual(counted, SUPPORTED_CONTINENTS.map((c) => c.code).sort());
  });

  it("offers no league the bank does not define", () => {
    for (const country of COUNTRIES) {
      const league = leagueOf(country.code);
      if (league === null) continue;
      assert.ok(
        COMPETITIONS.some((c) => c.code === league),
        `${country.code} maps to ${league}, which is not a competition`
      );
    }
  });

  it("offers no competition code the validator would drop", () => {
    for (const competition of SCOPE_COMPETITIONS) {
      assert.notEqual(competition.type, "GROUP", "a group is a preset, not a competition");
      assert.ok(COMPETITIONS.some((c) => c.code === competition.code));
    }
  });

  it("every preset names real codes", () => {
    for (const preset of PRESETS) {
      for (const code of preset.competitions ?? []) {
        assert.ok(COMPETITIONS.some((c) => c.code === code), `${preset.key} names ${code}`);
      }
      for (const code of preset.countries ?? []) {
        assert.ok(COUNTRIES.some((c) => c.code === code), `${preset.key} names country ${code}`);
      }
    }
  });

  it("every country carries a flag, for the card that shows one", () => {
    for (const country of COUNTRIES) {
      assert.ok(country.flag.length > 0, `${country.code} has no flag`);
    }
  });

  it("keeps question shapes and scope presets apart", () => {
    /*
      THE MODELLING ERROR THIS LOCKS DOWN. The first wizard had one quick-pick
      row holding both "ליגת האלופות" (a place the football comes from) and "מי
      אני?" (a shape the question takes), which is how a player picked "מי אני?"
      expecting a filter. The shapes are now the first step and the presets are
      scope only, so no preset may name a game mode.
    */
    for (const preset of PRESETS) {
      assert.ok(!("gameMode" in preset), `${preset.key} is a scope preset and must not set a game mode`);
    }
    for (const type of QUESTION_TYPES) {
      assert.ok(!("competitions" in type), `${type.key} is a question shape and must not name a competition`);
    }
  });
});

// ---------------------------------------------------------------------------
describe("the required flows map to the right query", () => {
  const accepted = (config: ReturnType<typeof toConfiguration>) =>
    parseQuizConfiguration(JSON.parse(JSON.stringify(config)));

  it("FLOW A — mixed type, free text, mixed difficulty, 10, worldwide", () => {
    const final = walk([
      { questionType: MIXED_TYPE_KEY },
      { answerMode: "FREE_TEXT" },
      { difficulty: "MIXED", questionCount: 10 },
      { scope: "WORLD" },
    ]);
    const config = toConfiguration(final);
    assert.equal(config.questionType, MIXED_TYPE_KEY);
    assert.equal(config.answerMode, "FREE_TEXT");
    assert.equal(config.difficulty, "MIXED");
    assert.equal(config.questionCount, 10);
    assert.equal(config.region, "WORLD");
    assert.deepEqual(config.competitions, ["ALL"]);
    assert.deepEqual(config.countries, []);
    assert.deepEqual(config.categories, [], "mixed type pins no category — the grid does that");
    // The builder is not Quick Start: a player who asked for MIXED gets the
    // full-builder mix, including a taste of the bands above HARD.
    assert.equal(config.preset, undefined);
    assert.deepEqual(stepsFor(final), ["type", "mode", "settings", "scope", "summary"]);
    accepted(config);
  });

  it("FLOW B — Who Am I, multiple choice, hard, Europe → Spain → La Liga", () => {
    const final = walk([
      { questionType: "WHO_AM_I" },
      { answerMode: "MULTIPLE_CHOICE" },
      { difficulty: "HARD", questionCount: 10 },
      { scope: "REGION" },
      { continent: "EUROPE" },
      { country: "ESP" },
      { league: "LA_LIGA" },
    ]);
    const config = toConfiguration(final);
    assert.equal(config.gameMode, "WHO_AM_I", "the type decides the mode");
    assert.equal(config.answerMode, "MULTIPLE_CHOICE");
    assert.equal(config.difficulty, "HARD");
    assert.deepEqual(config.countries, ["ESP"]);
    assert.deepEqual(config.competitions, ["LA_LIGA"]);
    assert.deepEqual(stepsFor(final), [
      "type",
      "mode",
      "settings",
      "scope",
      "continent",
      "country",
      "league",
      "summary",
    ]);
    accepted(config);
  });

  it("FLOW C — mixed type, hard, 6 big leagues", () => {
    const final = walk([
      { questionType: MIXED_TYPE_KEY },
      { difficulty: "HARD", questionCount: 10 },
      { scope: "PRESET" },
      { preset: "top6" },
    ]);
    const config = toConfiguration(final);
    assert.deepEqual(config.competitions, ["TOP_6_EUROPE"]);
    assert.equal(config.questionType, MIXED_TYPE_KEY);
    assert.equal(config.difficulty, "HARD");
    accepted(config);
  });

  it("FLOW D — career path, expert, Europe → England → Premier League", () => {
    const final = walk([
      { questionType: "CAREER_PATH" },
      { answerMode: "FREE_TEXT" },
      { difficulty: "EXPERT", questionCount: 10 },
      { scope: "REGION" },
      { continent: "EUROPE" },
      { country: "ENG" },
      { league: "PREMIER_LEAGUE" },
    ]);
    const config = toConfiguration(final);
    assert.equal(config.gameMode, "CAREER_PATH");
    assert.equal(config.difficulty, "EXPERT");
    assert.deepEqual(config.countries, ["ENG"]);
    assert.deepEqual(config.competitions, ["PREMIER_LEAGUE"]);
    accepted(config);
  });

  it("FLOW E — a competition scope names only that competition", () => {
    const final = walk([
      { questionType: MIXED_TYPE_KEY },
      { difficulty: "MIXED", questionCount: 10 },
      { scope: "COMPETITION" },
      { competition: "UCL" },
    ]);
    const config = toConfiguration(final);
    assert.deepEqual(config.competitions, ["UCL"]);
    assert.deepEqual(config.countries, []);
    assert.equal(config.region, "WORLD");
    accepted(config);
  });

  it("a continent with no country chosen asks for that continent's countries", () => {
    /*
      WHY THE CONTINENT IS ITS COUNTRIES. There are only three REGION scope
      values in the whole bank — WORLD, EUROPE and SOUTH_AMERICA — so
      `region: "ASIA"` matched nothing and Israel, a core domain for this
      audience, was unreachable through the geography branch. The COUNTRY
      dimension is populated for all thirty countries.
    */
    const config = toConfiguration(state({ scope: "REGION", continent: "ASIA" }));
    assert.equal(config.region, "WORLD", "a region tag that matches nothing must not be sent");
    assert.deepEqual(
      [...config.countries].sort(),
      countriesIn("ASIA")
        .map((c) => c.code)
        .sort()
    );
    assert.ok(config.countries.includes("ISR"));
  });

  it("a question type's categories reach the query", () => {
    const config = toConfiguration(state({ questionType: "TRANSFERS" }));
    assert.deepEqual(config.categories, QUESTION_TYPE_BY_KEY.get("TRANSFERS")!.categories);
    assert.equal(config.gameMode, "CLASSIC");
  });

  it("a preset's categories replace the type's, because the preset was chosen later", () => {
    const config = toConfiguration(
      state({ questionType: "TRANSFERS", scope: "PRESET", preset: "nations" })
    );
    assert.deepEqual(config.categories, PRESET_BY_KEY.get("nations")!.categories);
  });
});

// ---------------------------------------------------------------------------
describe("every configuration the wizard can produce is valid server-side", () => {
  it("survives the real parser for every combination of choices", () => {
    const types = [MIXED_TYPE_KEY, ...QUESTION_TYPES.map((t) => t.key)];
    const difficulties = ["MIXED", "EASY", "NORMAL", "HARD", "EXPERT", "IMPOSSIBLE"] as const;
    let checked = 0;

    const scopes: Partial<WizardState>[] = [
      { scope: "WORLD" },
      ...PRESETS.map((p) => ({ scope: "PRESET" as const, preset: p.key })),
      ...SCOPE_COMPETITIONS.map((c) => ({ scope: "COMPETITION" as const, competition: c.code })),
      ...SUPPORTED_CONTINENTS.flatMap((continent) => [
        { scope: "REGION" as const, continent: continent.code },
        ...countriesIn(continent.code).flatMap((country) => [
          { scope: "REGION" as const, continent: continent.code, country: country.code },
          ...(leagueOf(country.code)
            ? [
                {
                  scope: "REGION" as const,
                  continent: continent.code,
                  country: country.code,
                  league: leagueOf(country.code)!,
                },
              ]
            : []),
        ]),
      ]),
    ];

    for (const questionType of types) {
      for (const difficulty of difficulties) {
        for (const scope of scopes) {
          const config = toConfiguration(state({ questionType, difficulty, ...scope }));
          const parsed = parseQuizConfiguration(JSON.parse(JSON.stringify(config)));
          // Nothing the wizard offers may be dropped by the allow-lists.
          assert.equal(parsed.difficulty, config.difficulty);
          assert.equal(parsed.questionCount, config.questionCount);
          assert.equal(parsed.answerMode, config.answerMode);
          assert.equal(parsed.gameMode, config.gameMode);
          assert.equal(parsed.questionType, config.questionType);
          assert.deepEqual([...parsed.countries].sort(), [...config.countries].sort());
          assert.deepEqual([...parsed.competitions].sort(), [...config.competitions].sort());
          assert.deepEqual([...parsed.categories].sort(), [...config.categories].sort());
          checked++;
        }
      }
    }
    assert.ok(checked > 2000, `only ${checked} combinations were checked`);
  });

  it("every count the wizard offers is on the server's allow-list", () => {
    for (const count of WIZARD_QUESTION_COUNTS) {
      assert.ok(QUESTION_COUNTS.includes(count as never), `${count} is not an accepted question count`);
    }
  });
});

// ---------------------------------------------------------------------------
describe("going back preserves selections", () => {
  const filled = state({
    questionType: "WHO_AM_I",
    answerMode: "MULTIPLE_CHOICE",
    difficulty: "EXPERT",
    questionCount: 20,
    scope: "REGION",
    continent: "EUROPE",
    country: "ESP",
    league: "LA_LIGA",
  });

  it("changing one answer leaves the earlier ones alone", () => {
    const changed = { ...filled, difficulty: "HARD" as const };
    assert.equal(changed.questionType, "WHO_AM_I");
    assert.equal(changed.answerMode, "MULTIPLE_CHOICE");
    assert.equal(changed.country, "ESP");
    assert.equal(changed.league, "LA_LIGA");
  });

  it("a worldwide scope ignores a stale country rather than smuggling it in", () => {
    const config = toConfiguration({ ...filled, scope: "WORLD" });
    assert.deepEqual(config.countries, []);
    assert.deepEqual(config.competitions, ["ALL"]);
  });

  it("a preset ignores a stale drill-down", () => {
    const config = toConfiguration({ ...filled, scope: "PRESET", preset: "ucl" });
    assert.deepEqual(config.competitions, ["UCL"]);
    assert.deepEqual(config.countries, []);
  });

  it("the question type survives a scope change", () => {
    const config = toConfiguration({ ...filled, scope: "COMPETITION", competition: "UCL" });
    assert.equal(config.gameMode, "WHO_AM_I");
  });
});

// ---------------------------------------------------------------------------
describe("the final summary", () => {
  it("is five compact lines", () => {
    const lines = summaryOf(state(), LABELS);
    assert.equal(lines.length, 5);
    for (const line of lines) assert.ok(line.value.length > 0 && line.value.length < 60, line.value);
  });

  it("reads the way the spec writes it", () => {
    const lines = summaryOf(
      state({ questionType: MIXED_TYPE_KEY, answerMode: "FREE_TEXT", difficulty: "MIXED", questionCount: 10 }),
      LABELS
    );
    assert.deepEqual(
      lines.map((l) => `${l.label}: ${l.value}`),
      [
        "סוג שאלות: מעורב",
        "איך משחקים: תשובה חופשית",
        "קושי: מעורב",
        "כמות: 10 שאלות",
        "מקור: כל העולם",
      ]
    );
  });

  it("spells out a drilled-down region with arrows", () => {
    const lines = summaryOf(
      state({ scope: "REGION", continent: "EUROPE", country: "ESP", league: "LA_LIGA" }),
      LABELS
    );
    const source = lines.find((l) => l.label === "מקור")!;
    assert.equal(source.value, "אירופה → ספרד → לה ליגה");
  });

  it("says 'all of the continent' when no country was chosen", () => {
    const lines = summaryOf(state({ scope: "REGION", continent: "ASIA" }), LABELS);
    assert.equal(lines.find((l) => l.label === "מקור")!.value, "אסיה → כל היבשת");
  });

  it("points each line at a step the player can actually return to", () => {
    for (const scope of ["WORLD", "COMPETITION", "PRESET"] as const) {
      const current = state({ scope, competition: "UCL", preset: "ucl" });
      const steps = stepsFor(current);
      for (const line of summaryOf(current, LABELS)) {
        assert.ok(steps.includes(line.step), `${line.label} points at ${line.step}, which is not in the flow`);
      }
    }
    const drilled = state({ scope: "REGION", continent: "EUROPE", country: "ESP", league: "LA_LIGA" });
    for (const line of summaryOf(drilled, LABELS)) {
      assert.ok(stepsFor(drilled).includes(line.step), `${line.label} -> ${line.step}`);
    }
  });

  it("names every preset it can show", () => {
    for (const preset of PRESETS) {
      const lines = summaryOf(state({ scope: "PRESET", preset: preset.key }), LABELS);
      assert.equal(lines.find((l) => l.label === "מקור")!.value, preset.labelHe);
    }
  });
});

// ---------------------------------------------------------------------------
describe("the orientation chip", () => {
  it("is one short line of the choices that change how the quiz plays", () => {
    const chip = orientationOf(
      state({ questionType: "WHO_AM_I", answerMode: "FREE_TEXT", difficulty: "HARD", questionCount: 15 }),
      LABELS
    );
    assert.equal(chip, "מי אני? · תשובה חופשית · קשה · 15");
    assert.ok(chip.length < 50, "an orientation chip that wraps is a receipt");
  });

  it("says מעורב on both axes that can be mixed", () => {
    assert.equal(orientationOf(state(), LABELS), "מעורב · תשובה חופשית · מעורב · 10");
  });
});
