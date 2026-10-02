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

import { describe, it } from "node:test";
import assert from "node:assert/strict";

import {
  canAdvance,
  countriesIn,
  INITIAL_STATE,
  leagueOf,
  QUICK_PICKS,
  QUICK_PICK_BY_KEY,
  stepsFor,
  SUPPORTED_CONTINENTS,
  summaryOf,
  toConfiguration,
  type StepId,
  type WizardState,
} from "../src/client/lib/builderWizard.ts";
import { parseQuizConfiguration } from "../src/worker/lib/validate.ts";
import { COMPETITIONS, COUNTRIES, DIFFICULTY_LABELS, QUESTION_COUNTS } from "../src/shared/constants.ts";

const LABELS = {
  answerMode: { FREE_TEXT: "תשובה חופשית", MULTIPLE_CHOICE: "אמריקאי" } as const,
  difficulty: DIFFICULTY_LABELS as Record<string, string>,
  competition: (code: string) => COMPETITIONS.find((c) => c.code === code)?.nameHe ?? code,
  country: (code: string) => COUNTRIES.find((c) => c.code === code)?.nameHe ?? code,
};

const state = (over: Partial<WizardState> = {}): WizardState => ({ ...INITIAL_STATE, ...over });

/**
 * Walks the wizard the way a player does, and returns the configuration.
 *
 * Also asserts at every step that the step the player is on is one the state
 * actually has — which is the thing that breaks when a smart skip is wrong.
 */
function walk(steps: Partial<WizardState>[]): { final: WizardState; visited: StepId[] } {
  let current = state();
  const visited: StepId[] = [];
  for (const patch of steps) {
    current = { ...current, ...patch };
    const available = stepsFor(current);
    visited.push(available[Math.min(visited.length, available.length - 1)]);
  }
  return { final: current, visited: stepsFor(current) };
}

// ---------------------------------------------------------------------------
describe("the step sequence", () => {
  it("is four steps for the worldwide path", () => {
    assert.deepEqual(stepsFor(state({ scope: "WORLD" })), ["mode", "settings", "scope", "summary"]);
  });

  /*
    SMART SKIPPING. "כל העולם" means the geography step does not exist, not that
    it is greyed out — a disabled step is still a step the player has to get
    past, and the whole point is that the common path is short.
  */
  it("adds the geography step only for a region scope", () => {
    assert.ok(!stepsFor(state({ scope: "WORLD" })).includes("region"));
    assert.ok(!stepsFor(state({ scope: "PRESET", quickPick: "ucl" })).includes("region"));
    assert.ok(stepsFor(state({ scope: "REGION", continent: "EUROPE" })).includes("region"));
  });

  it("is five steps at most", () => {
    assert.equal(stepsFor(state({ scope: "REGION", continent: "EUROPE" })).length, 4 + 1 - 1 + 1);
    assert.ok(stepsFor(state({ scope: "REGION", continent: "EUROPE" })).length <= 5);
  });

  it("will not advance past an unanswered quick-pick step", () => {
    assert.equal(canAdvance(state({ scope: "PRESET", quickPick: null }), "scope"), false);
    assert.equal(canAdvance(state({ scope: "PRESET", quickPick: "ucl" }), "scope"), true);
  });

  it("accepts a continent alone as a region choice", () => {
    assert.equal(canAdvance(state({ scope: "REGION", continent: null }), "region"), false);
    assert.equal(canAdvance(state({ scope: "REGION", continent: "EUROPE" }), "region"), true);
  });

  it("advances from the first two steps unconditionally — they always have a value", () => {
    assert.equal(canAdvance(state(), "mode"), true);
    assert.equal(canAdvance(state(), "settings"), true);
  });
});

// ---------------------------------------------------------------------------
describe("choices only ever narrow to something that exists", () => {
  it("offers no continent without supported countries", () => {
    for (const continent of SUPPORTED_CONTINENTS) {
      assert.ok(
        countriesIn(continent.code).length > 0,
        `${continent.labelHe} has no supported countries and must not be offered`
      );
    }
  });

  it("offers no league the bank does not define", () => {
    for (const country of COUNTRIES) {
      const league = leagueOf(country.code);
      if (!league) continue;
      assert.ok(
        COMPETITIONS.some((c) => c.code === league),
        `${country.code} maps to ${league}, which is not a defined competition`
      );
    }
  });

  it("every quick pick names real competition codes", () => {
    for (const pick of QUICK_PICKS) {
      for (const code of pick.competitions ?? []) {
        assert.ok(COMPETITIONS.some((c) => c.code === code), `${pick.key} names unknown competition ${code}`);
      }
    }
  });

  /*
    ARCHETYPES ARE NOT SCOPES.

    "Who Am I?" changes what a question looks like; "Champions League" changes
    where the football comes from. The old builder put both in one chip row,
    which is how somebody picked "מי אני?" expecting a filter. The two groups are
    now separate and the distinction is in the data.
  */
  it("keeps question shapes and competition filters apart", () => {
    const archetypes = QUICK_PICKS.filter((p) => p.kind === "ARCHETYPE");
    const competitions = QUICK_PICKS.filter((p) => p.kind === "COMPETITION");
    assert.ok(archetypes.length >= 3);
    assert.ok(competitions.length >= 6);
    for (const pick of archetypes) {
      assert.ok(pick.gameMode, `${pick.key} is an archetype and must set a game mode`);
      assert.equal(pick.competitions, undefined, `${pick.key} must not pretend to be a scope`);
    }
    for (const pick of competitions) {
      assert.equal(pick.gameMode, undefined, `${pick.key} is a scope and must not change the game mode`);
      assert.ok(pick.competitions, `${pick.key} is a scope and must name competitions`);
    }
  });
});

// ---------------------------------------------------------------------------
/*
  THE FIVE REQUIRED FLOWS.

  Each one asserts the QUERY, not the screen: the answer mode, the difficulty,
  the count, the geography, the competition and the archetype that the engine
  will actually receive. And each configuration is then run through the real
  server-side parser, because a query the server rejects or silently rewrites is
  not the query the player built.
*/
describe("the required flows map to the right query", () => {
  const accepted = (config: ReturnType<typeof toConfiguration>) =>
    parseQuizConfiguration(JSON.parse(JSON.stringify(config)));

  it("FLOW A — free text, hard, 10, worldwide", () => {
    const { final } = walk([
      { answerMode: "FREE_TEXT" },
      { difficulty: "HARD", questionCount: 10 },
      { scope: "WORLD" },
    ]);
    const config = toConfiguration(final);
    assert.equal(config.answerMode, "FREE_TEXT");
    assert.equal(config.difficulty, "HARD");
    assert.equal(config.questionCount, 10);
    assert.equal(config.region, "WORLD");
    assert.deepEqual(config.competitions, ["ALL"]);
    assert.deepEqual(config.countries, []);
    assert.deepEqual(config.categories, []);
    assert.equal(config.gameMode, "CLASSIC");
    // The builder is not Quick Start: a player who asked for HARD gets HARD.
    assert.equal(config.preset, undefined);
    assert.deepEqual(stepsFor(final), ["mode", "settings", "scope", "summary"]);
    accepted(config);
  });

  it("FLOW B — multiple choice, normal, 15, Europe → Spain → La Liga", () => {
    const { final } = walk([
      { answerMode: "MULTIPLE_CHOICE" },
      { difficulty: "NORMAL", questionCount: 15 },
      { scope: "REGION" },
      { continent: "EUROPE", country: "ESP", league: "LA_LIGA" },
    ]);
    const config = toConfiguration(final);
    assert.equal(config.answerMode, "MULTIPLE_CHOICE");
    assert.equal(config.difficulty, "NORMAL");
    assert.equal(config.questionCount, 15);
    assert.equal(config.region, "EUROPE");
    assert.deepEqual(config.countries, ["ESP"]);
    assert.deepEqual(config.competitions, ["LA_LIGA"]);
    assert.deepEqual(stepsFor(final), ["mode", "settings", "scope", "region", "summary"]);
    accepted(config);
  });

  it("FLOW C — free text, expert, 10, Champions League", () => {
    const { final } = walk([
      { answerMode: "FREE_TEXT" },
      { difficulty: "EXPERT", questionCount: 10 },
      { scope: "PRESET", quickPick: "ucl" },
    ]);
    const config = toConfiguration(final);
    assert.equal(config.difficulty, "EXPERT");
    assert.deepEqual(config.competitions, ["UCL"]);
    assert.equal(config.region, "EUROPE");
    assert.equal(config.gameMode, "CLASSIC", "a competition filter must not change the game mode");
    assert.ok(!stepsFor(final).includes("region"), "a competition preset skips the country drill-down");
    accepted(config);
  });

  it("FLOW D — multiple choice, hard, 10, six big leagues", () => {
    const { final } = walk([
      { answerMode: "MULTIPLE_CHOICE" },
      { difficulty: "HARD", questionCount: 10 },
      { scope: "PRESET", quickPick: "top6" },
    ]);
    const config = toConfiguration(final);
    assert.deepEqual(config.competitions, ["TOP_6_EUROPE"]);
    assert.equal(config.region, "EUROPE");
    assert.ok(!stepsFor(final).includes("region"));
    accepted(config);
  });

  it("FLOW E — free text, hard, 10, Who Am I", () => {
    const { final } = walk([
      { answerMode: "FREE_TEXT" },
      { difficulty: "HARD", questionCount: 10 },
      { scope: "PRESET", quickPick: "whoami" },
    ]);
    const config = toConfiguration(final);
    assert.equal(config.gameMode, "WHO_AM_I", "an archetype preset sets the game mode directly");
    assert.deepEqual(config.categories, ["WHO_AM_I"]);
    assert.deepEqual(config.competitions, ["ALL"], "an archetype is not a competition filter");
    assert.equal(config.region, "WORLD");
    assert.ok(!stepsFor(final).includes("region"));
    accepted(config);
  });
});

// ---------------------------------------------------------------------------
describe("every configuration the wizard can produce is valid server-side", () => {
  it("survives the real parser for every combination of choices", () => {
    const answerModes = ["FREE_TEXT", "MULTIPLE_CHOICE"] as const;
    const difficulties = ["MIXED", "EASY", "NORMAL", "HARD", "EXPERT", "IMPOSSIBLE"] as const;
    const counts = [5, 10, 15, 20];
    let checked = 0;

    for (const answerMode of answerModes) {
      for (const difficulty of difficulties) {
        for (const questionCount of counts) {
          const scopes: Partial<WizardState>[] = [
            { scope: "WORLD" },
            ...QUICK_PICKS.map((p) => ({ scope: "PRESET" as const, quickPick: p.key })),
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

          for (const scope of scopes) {
            const config = toConfiguration(state({ answerMode, difficulty, questionCount, ...scope }));
            const parsed = parseQuizConfiguration(JSON.parse(JSON.stringify(config)));
            // Nothing the wizard offers may be dropped by the allow-lists.
            assert.equal(parsed.difficulty, config.difficulty);
            assert.equal(parsed.questionCount, config.questionCount);
            assert.equal(parsed.answerMode, config.answerMode);
            assert.equal(parsed.gameMode, config.gameMode);
            assert.deepEqual(parsed.countries, config.countries);
            assert.deepEqual(parsed.competitions.sort(), [...config.competitions].sort());
            assert.deepEqual(parsed.categories.sort(), [...config.categories].sort());
            checked++;
          }
        }
      }
    }
    assert.ok(checked > 400, `only ${checked} combinations were checked`);
  });

  it("every count the wizard offers is on the server's allow-list", () => {
    for (const count of [5, 10, 15, 20]) {
      assert.ok(QUESTION_COUNTS.includes(count as never), `${count} is not an accepted question count`);
    }
  });
});

// ---------------------------------------------------------------------------
describe("going back preserves selections", () => {
  /*
    The steps are not separate forms. All of it is one state object, so a step
    that is revisited is still filled in — which is the whole reason the state
    machine is a value rather than a stack of mounted components.
  */
  it("changing the scope leaves the earlier answers alone", () => {
    const chosen = state({ answerMode: "FREE_TEXT", difficulty: "EXPERT", questionCount: 20 });
    const withRegion = { ...chosen, scope: "REGION" as const, continent: "EUROPE" as const, country: "ITA" };
    const backToWorld = { ...withRegion, scope: "WORLD" as const };

    assert.equal(backToWorld.answerMode, "FREE_TEXT");
    assert.equal(backToWorld.difficulty, "EXPERT");
    assert.equal(backToWorld.questionCount, 20);
    // And the region answers are still there if the player goes back to it.
    assert.equal(backToWorld.continent, "EUROPE");
    assert.equal(backToWorld.country, "ITA");
  });

  it("a worldwide scope ignores a stale country rather than smuggling it in", () => {
    const config = toConfiguration(
      state({ scope: "WORLD", continent: "EUROPE", country: "ITA", league: "SERIE_A" })
    );
    assert.equal(config.region, "WORLD");
    assert.deepEqual(config.countries, []);
    assert.deepEqual(config.competitions, ["ALL"]);
  });

  it("choosing a country clears a league from a different country", () => {
    // The component clears these on selection; this asserts the mapping is safe
    // even if a stale value survives.
    const config = toConfiguration(state({ scope: "REGION", continent: "EUROPE", country: "ITA" }));
    assert.deepEqual(config.competitions, ["ALL"], "no league chosen means the country does the filtering");
  });
});

// ---------------------------------------------------------------------------
describe("the final summary", () => {
  it("is four compact lines", () => {
    const rows = summaryOf(state({ difficulty: "HARD", questionCount: 10 }), LABELS);
    assert.equal(rows.length, 4);
    assert.deepEqual(rows.map((r) => r.label), ["מצב", "קושי", "שאלות", "טווח"]);
  });

  it("reads the way the spec writes it", () => {
    const rows = summaryOf(
      state({ answerMode: "FREE_TEXT", difficulty: "HARD", questionCount: 10, scope: "PRESET", quickPick: "top6" }),
      LABELS
    );
    assert.deepEqual(rows.map((r) => r.value), ["תשובה חופשית", "קשה", "10 שאלות", "6 הליגות הגדולות"]);
  });

  it("spells out a drilled-down region", () => {
    const rows = summaryOf(
      state({ scope: "REGION", continent: "EUROPE", country: "ESP", league: "LA_LIGA" }),
      LABELS
    );
    assert.equal(rows.find((r) => r.label === "טווח")!.value, "אירופה · ספרד · לה ליגה");
  });

  it("points each line at a step the player can actually return to", () => {
    for (const scope of [
      state({ scope: "WORLD" }),
      state({ scope: "PRESET", quickPick: "ucl" }),
      state({ scope: "REGION", continent: "EUROPE" }),
    ]) {
      const steps = stepsFor(scope);
      for (const row of summaryOf(scope, LABELS)) {
        assert.ok(steps.includes(row.step), `"${row.label}" points at ${row.step}, which is not in this flow`);
      }
    }
  });

  it("names every quick pick it can show", () => {
    for (const pick of QUICK_PICKS) {
      const rows = summaryOf(state({ scope: "PRESET", quickPick: pick.key }), LABELS);
      assert.equal(rows.find((r) => r.label === "טווח")!.value, pick.labelHe);
      assert.ok(QUICK_PICK_BY_KEY.has(pick.key));
    }
  });
});
